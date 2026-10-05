'use strict';

/**
 * 银行对账：两方账单按「金额 + 日期」模糊匹配，输出未达账项与差异。
 *
 * 匹配分两轮：
 *   1) 1:1 —— 金额相等（用「分」做整数比较，避开浮点误差）且日期差在容差内，取日期最近的一笔
 *   2) 1:N —— 一笔对多笔之和（本金+手续费、合并打款等），子集规模默认 ≤ 3
 * 剩下的分别是「仅企业有」（未达账项）与「仅银行有」，并标出可疑的近似项供人工核对。
 *
 * 用法:
 *   node scripts/reconcile.js match <企业CSV> <银行CSV> [选项]
 *   node scripts/reconcile.js --selftest
 */

const fs = require('fs');

// ---------------------------------------------------------------- 基础工具

function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try { return new TextDecoder('gbk').decode(buf); } catch { return buf.toString('utf8'); }
  }
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function sniffDelimiter(text) {
  const firstLine = text.split('\n')[0];
  const counts = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** 金额转「分」的整数，避开浮点比较。全角、千分位、货币符号、括号负数都能吃。 */
function toCents(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  let neg = false;
  if (/^[（(]/.test(s) && /[）)]$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[，,\s]/g, '').replace(/^[¥￥$+]/, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return neg ? -n : n;
}

function toDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/[／/.]/g, '-').replace(/[年月]/g, '-').replace(/日/g, '');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const cents2 = (c) => (c / 100).toFixed(2);
const money = (c) => (c === null ? '—' : (c / 100).toFixed(2));

/** 相差天数；任一侧无日期时返回 0（视为不约束）。 */
function dayGap(d1, d2) {
  if (!d1 || !d2) return 0;
  return Math.abs((Date.parse(d1) - Date.parse(d2)) / 86400000);
}

// ------------------------------------------------------------------ 读表

const DATE_ALIASES = ['日期', '交易日期', '记账日期', 'date', '交易时间'];
const AMOUNT_ALIASES = ['金额', '交易金额', '发生额', 'amount', '金额(元)'];
const DESC_ALIASES = ['摘要', '对方户名', '备注', '描述', 'desc', '用途'];

const norm = (s) => String(s).replace(/[\s（）()【】\[\]：:元]/g, '').toLowerCase();

function findColumn(header, aliases) {
  for (const a of aliases) {
    const i = header.findIndex((h) => norm(h) === norm(a));
    if (i >= 0) return i;
  }
  for (const a of aliases) {
    const i = header.findIndex((h) => norm(a) !== '' && norm(h).includes(norm(a)));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * 读一侧账单。
 * @returns {{ rows: Array, cols: object, skipped: number }}
 */
function loadSide(file, overrides, delimiter) {
  const text = decode(fs.readFileSync(file));
  const delim = delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delim);
  if (rows.length === 0) return { rows: [], cols: {}, skipped: 0 };
  const header = rows[0];

  const pick = (key, aliases) => {
    if (overrides[key]) {
      const i = header.findIndex((h) => norm(h) === norm(overrides[key]));
      if (i >= 0) return i;
      const n = Number(overrides[key]);
      if (!Number.isNaN(n) && n >= 1 && n <= header.length) return n - 1;
    }
    return findColumn(header, aliases);
  };

  const cols = {
    date: pick('date', DATE_ALIASES),
    amount: pick('amount', AMOUNT_ALIASES),
    desc: pick('desc', DESC_ALIASES),
  };
  if (cols.amount < 0) {
    console.error(`[${file}] 找不到金额列，请用 --a-amount= / --b-amount= 指定列名或第几列（如 3）`);
    process.exit(2);
  }

  const isHeader = toCents(header[cols.amount]) === null;
  const body = isHeader ? rows.slice(1) : rows;

  const out = [];
  let skipped = 0;
  body.forEach((row, i) => {
    const cents = toCents(row[cols.amount]);
    if (cents === null) { skipped++; return; }
    out.push({
      line: (isHeader ? i + 2 : i + 1),
      cents,
      date: cols.date >= 0 ? toDate(row[cols.date]) : null,
      desc: cols.desc >= 0 ? String(row[cols.desc]).trim() : '',
    });
  });
  return { rows: out, cols, skipped };
}

// ------------------------------------------------------------------ 匹配

/**
 * 在候选集合里找规模 ≤ maxSplit、和等于目标的子集。
 * 候选超过 60 个时放弃（组合爆炸且实际意义不大）。
 */
function findSubsetSum(pool, target, maxSplit) {
  if (pool.length === 0 || pool.length > 60) return null;
  const limit = Math.min(maxSplit, pool.length);
  const chosen = [];
  const dfs = (start, remaining) => {
    if (remaining === 0 && chosen.length > 1) return true;
    if (chosen.length >= limit) return false;
    for (let i = start; i < pool.length; i++) {
      const v = pool[i].cents;
      // 同号才可能相加得到目标，剪枝
      if (v !== 0 && Math.sign(v) !== Math.sign(target) && remaining !== 0) continue;
      if (Math.abs(v) > Math.abs(remaining) && Math.sign(v) === Math.sign(remaining)) continue;
      chosen.push(pool[i]);
      if (dfs(i + 1, remaining - v)) return true;
      chosen.pop();
    }
    return false;
  };
  return dfs(0, target) ? chosen.slice() : null;
}

/**
 * 主匹配流程。
 * @returns {{ pairs: Array, onlyA: Array, onlyB: Array, suspicious: Array }}
 */
function reconcile(sideA, sideB, opts) {
  const bUsed = new Set();
  const pairs = [];
  const unmatchedA = [];

  // 第一轮：1:1，金额相等 + 日期最近
  for (const x of sideA) {
    let best = -1; let bestGap = Infinity;
    for (let j = 0; j < sideB.length; j++) {
      if (bUsed.has(j)) continue;
      if (sideB[j].cents !== x.cents) continue;
      const gap = dayGap(x.date, sideB[j].date);
      if (gap > opts.days) continue;
      if (gap < bestGap) { bestGap = gap; best = j; }
    }
    if (best >= 0) {
      bUsed.add(best);
      pairs.push({ kind: '1:1', a: [x], b: [sideB[best]], gap: bestGap });
    } else {
      unmatchedA.push(x);
    }
  }

  const restB = sideB.filter((_, j) => !bUsed.has(j));

  // 第二轮：1:N，一笔企业账 = 多笔银行账之和
  const stillA = [];
  if (opts.maxSplit > 1) {
    const pool = restB.slice();
    for (const x of unmatchedA) {
      const subset = findSubsetSum(pool, x.cents, opts.maxSplit);
      if (!subset) { stillA.push(x); continue; }
      // 拆分匹配仍要看日期：每一笔都应在容差内
      const gap = Math.max(...subset.map((y) => dayGap(x.date, y.date)));
      if (gap > opts.days) { stillA.push(x); continue; }
      for (const y of subset) pool.splice(pool.indexOf(y), 1);
      pairs.push({ kind: `1:${subset.length}`, a: [x], b: subset, gap });
    }
  } else {
    stillA.push(...unmatchedA);
  }

  const onlyB = pool_leftover(restB, pairs);

  // 可疑近似项：日期接近但金额差很小，可能是记错金额或手续费
  const suspicious = [];
  for (const x of stillA) {
    for (const y of onlyB) {
      if (Math.sign(x.cents) !== Math.sign(y.cents)) continue;
      if (dayGap(x.date, y.date) > opts.days) continue;
      const diff = Math.abs(x.cents - y.cents);
      const tol = Math.max(100, Math.round(Math.abs(x.cents) * opts.nearRatio));
      if (diff <= tol) suspicious.push({ a: x, b: y, diff });
    }
  }

  return { pairs, onlyA: stillA, onlyB, suspicious };
}

/** 从剩余银行账里剔除已被 1:N 匹配掉的那些。 */
function pool_leftover(restB, pairs) {
  const used = new Set();
  for (const p of pairs) for (const y of p.b) used.add(y);
  return restB.filter((y) => !used.has(y));
}

// ------------------------------------------------------------------ 输出

function sum(arr) { return arr.reduce((n, x) => n + x.cents, 0); }

function render(opts, res, meta) {
  const { aFile, bFile, a, b } = meta;
  console.log(`企业账: ${aFile}（${a.rows.length} 笔，合计 ${money(sum(a.rows))}）`);
  console.log(`银行账: ${bFile}（${b.rows.length} 笔，合计 ${money(sum(b.rows))}）`);
  console.log(`匹配条件: 金额相等 + 日期相差 ≤ ${opts.days} 天，拆分最多 ${opts.maxSplit} 笔`);
  console.log('');

  const exact = res.pairs.filter((p) => p.kind === '1:1').length;
  const split = res.pairs.length - exact;
  console.log(`已匹配 ${res.pairs.length} 组（1:1 ${exact} 组，拆分 ${split} 组）`);
  console.log(`仅企业有 ${res.onlyA.length} 笔，合计 ${money(sum(res.onlyA))}　← 未达账项`);
  console.log(`仅银行有 ${res.onlyB.length} 笔，合计 ${money(sum(res.onlyB))}`);
  if (res.suspicious.length) console.log(`可疑近似 ${res.suspicious.length} 对（金额接近但不等，需人工核对）`);
  console.log('');

  const show = (title, arr, flag) => {
    if (arr.length === 0) return;
    console.log(`--- ${title}（${arr.length} 笔，合计 ${money(sum(arr))}）---`);
    for (const x of arr) {
      console.log(`  ${flag} 行${String(x.line).padStart(3)}  ${x.date || '　　　　　　'}  ${money(x.cents).padStart(12)}  ${x.desc}`);
    }
    console.log('');
  };

  show('仅企业有（企业已记账，银行未发生）', res.onlyA, 'A');
  show('仅银行有（银行已发生，企业未记账）', res.onlyB, 'B');

  const splits = res.pairs.filter((p) => p.kind !== '1:1');
  if (splits.length) {
    console.log('--- 拆分匹配（一笔对多笔之和）---');
    for (const p of splits) {
      console.log(`  A 行${p.a[0].line} ${money(p.a[0].cents)} = ${p.b.map((y) => `B 行${y.line} ${money(y.cents)}`).join(' + ')}`);
    }
    console.log('');
  }

  if (res.suspicious.length) {
    console.log('--- 可疑近似（日期接近但金额不等）---');
    for (const s of res.suspicious) {
      console.log(`  A 行${s.a.line} ${money(s.a.cents)} ≈ B 行${s.b.line} ${money(s.b.cents)}　差 ${money(s.diff)}　${s.a.desc}`);
    }
    console.log('');
  }

  if (res.onlyA.length === 0 && res.onlyB.length === 0) {
    console.log('✓ 两方完全匹配，无未达账项。');
  } else {
    console.log('提示：未达账项常见于在途资金、手续费、利息与期末未入账交易，需人工确认性质。');
  }
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  console.log('金额解析（转成「分」的整数）');
  check('普通', toCents('1234.56'), 123456);
  check('千分位', toCents('1,234.56'), 123456);
  check('货币符号', toCents('¥1,234.56'), 123456);
  check('负号', toCents('-500.00'), -50000);
  check('括号负数', toCents('(500.00)'), -50000);
  check('全角', toCents('１２３４．５６'), 123456);
  check('非法', toCents('abc'), null);

  console.log('日期与间隔');
  check('相差天数', dayGap('2026-03-01', '2026-03-04'), 3);
  check('缺日期不约束', dayGap(null, '2026-03-04'), 0);

  console.log('匹配');
  const mk = (line, cents, date, desc) => ({ line, cents, date, desc: desc || '' });
  const opts = { days: 3, maxSplit: 3, nearRatio: 0.02 };

  // 1:1 基本匹配
  let r = reconcile([mk(2, -100000, '2026-03-01')], [mk(2, -100000, '2026-03-02')], opts);
  check('1:1 匹配', r.pairs.length, 1);
  check('无未达账项', [r.onlyA.length, r.onlyB.length], [0, 0]);

  // 日期超容差不匹配
  r = reconcile([mk(2, -100000, '2026-03-01')], [mk(2, -100000, '2026-03-20')], opts);
  check('日期超容差不匹配', [r.pairs.length, r.onlyA.length, r.onlyB.length], [0, 1, 1]);

  // 金额不同不匹配，但落入可疑近似
  r = reconcile([mk(2, -100000, '2026-03-01')], [mk(2, -100100, '2026-03-01')], opts);
  check('金额不等不匹配', r.pairs.length, 0);
  check('记为可疑近似', r.suspicious.length, 1);

  // 方向相反不匹配
  r = reconcile([mk(2, -100000, '2026-03-01')], [mk(2, 100000, '2026-03-01')], opts);
  check('方向相反不匹配', r.pairs.length, 0);

  // 1:2 拆分匹配：一笔 100 = 99 + 1（本金 + 手续费）
  r = reconcile([mk(2, -100000, '2026-03-01')], [mk(2, -99000, '2026-03-01'), mk(3, -1000, '2026-03-01')], opts);
  check('1:2 拆分匹配', [r.pairs.length, r.pairs[0].kind], [1, '1:2']);

  // 重复金额按日期最近优先
  r = reconcile(
    [mk(2, -100000, '2026-03-01')],
    [mk(2, -100000, '2026-03-10'), mk(3, -100000, '2026-03-01')],
    opts
  );
  check('取日期最近的一笔', r.pairs[0].b[0].line, 3);

  // 两笔同额应分别匹配两笔
  r = reconcile(
    [mk(2, -100000, '2026-03-01'), mk(3, -100000, '2026-03-02')],
    [mk(2, -100000, '2026-03-01'), mk(3, -100000, '2026-03-02')],
    opts
  );
  check('同额多笔分别匹配', r.pairs.length, 2);

  console.log('子集和');
  const pool = [mk(2, -99000), mk(3, -1000), mk(4, -500)];
  check('能凑出目标', findSubsetSum(pool, -100000, 3).length, 2);
  check('凑不出返回 null', findSubsetSum(pool, -77777, 3), null);
  check('单笔不算拆分', findSubsetSum(pool, -99000, 3), null);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `银行对账：两方账单按金额 + 日期模糊匹配，输出未达账项与差异

用法:
  node scripts/reconcile.js match <企业CSV> <银行CSV> [选项]
  node scripts/reconcile.js --selftest

选项:
  --a-date=<列名|列号>   企业侧日期列（默认自动识别）
  --a-amount=<列名|列号> 企业侧金额列
  --a-desc=<列名|列号>   企业侧摘要列
  --b-date= --b-amount= --b-desc=   银行侧，同上
  --days=N               日期容差天数，默认 3（T+1 到账常见）
  --flip-b               银行侧金额取反（两侧借贷方向相反时用）
  --max-split=N          一笔对多笔的最大拆分笔数，默认 3，设 1 可关闭
  --near-ratio=0.02      可疑近似的金额相对差阈值，默认 2%
  --delimiter=,          强制指定分隔符
  --json                 输出 JSON

退出码: 0 = 完全匹配，1 = 存在未达账项，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { days: 3, maxSplit: 3, nearRatio: 0.02, flipB: false, json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--flip-b') opts.flipB = true;
    else if (arg.startsWith('--days=')) opts.days = Number(arg.slice(7)) || 0;
    else if (arg.startsWith('--max-split=')) opts.maxSplit = Number(arg.slice(12));
    else if (arg.startsWith('--near-ratio=')) opts.nearRatio = Number(arg.slice(13)) || 0.02;
    else if (arg.startsWith('--delimiter=')) opts.delimiter = arg.slice(12);
    else if (arg.startsWith('--a-date=')) opts.aDate = arg.slice(9);
    else if (arg.startsWith('--a-amount=')) opts.aAmount = arg.slice(11);
    else if (arg.startsWith('--a-desc=')) opts.aDesc = arg.slice(9);
    else if (arg.startsWith('--b-date=')) opts.bDate = arg.slice(9);
    else if (arg.startsWith('--b-amount=')) opts.bAmount = arg.slice(11);
    else if (arg.startsWith('--b-desc=')) opts.bDesc = arg.slice(9);
    else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'match') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const [aFile, bFile] = rest;
  if (!aFile || !bFile) { console.error('需要两个 CSV 文件\n\n' + USAGE); process.exit(2); }
  for (const f of [aFile, bFile]) {
    if (!fs.existsSync(f)) { console.error(`文件不存在: ${f}`); process.exit(2); }
  }

  const a = loadSide(aFile, { date: opts.aDate, amount: opts.aAmount, desc: opts.aDesc }, opts.delimiter);
  const b = loadSide(bFile, { date: opts.bDate, amount: opts.bAmount, desc: opts.bDesc }, opts.delimiter);
  if (opts.flipB) for (const x of b.rows) x.cents = -x.cents;

  const res = reconcile(a.rows, b.rows, opts);

  if (opts.json) {
    const brief = (arr) => arr.map((x) => ({ line: x.line, date: x.date, amount: cents2(x.cents), desc: x.desc }));
    console.log(JSON.stringify({
      aFile, bFile,
      aTotal: cents2(sum(a.rows)), bTotal: cents2(sum(b.rows)),
      matched: res.pairs.length,
      onlyA: brief(res.onlyA), onlyB: brief(res.onlyB),
      onlyATotal: cents2(sum(res.onlyA)), onlyBTotal: cents2(sum(res.onlyB)),
      suspicious: res.suspicious.map((s) => ({
        a: brief([s.a])[0], b: brief([s.b])[0], diff: cents2(s.diff),
      })),
    }, null, 2));
  } else {
    render(opts, res, { aFile, bFile, a, b });
    if (a.skipped || b.skipped) {
      console.log(`注意：跳过金额无法解析的行 ${a.skipped + b.skipped} 行（企业 ${a.skipped} / 银行 ${b.skipped}）`);
    }
  }

  if (res.onlyA.length || res.onlyB.length) process.exit(1);
}

main();
