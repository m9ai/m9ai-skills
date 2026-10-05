'use strict';

/**
 * 报销单审计：必填项、金额合计与声明值核对、超标、重复票据号、疑似拆分。
 *
 * 限额必须由用户提供（--limit= / --limits-file=）：不同单位的差旅与招待标准差异很大，
 * 内置一套"通用标准"只会给出看似权威的错误结论，所以本脚本不内置任何限额。
 *
 * 用法:
 *   node scripts/expense.js check <CSV> [选项]
 *   node scripts/expense.js --selftest
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

const money = (c) => (c === null ? '—' : (c / 100).toFixed(2));
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

// ------------------------------------------------------------------ 列定义

const COLS = {
  date: { aliases: ['费用日期', '发生日期', '日期', 'date'], label: '费用日期' },
  person: { aliases: ['报销人', '申请人', '姓名', '员工', 'person'], label: '报销人' },
  dept: { aliases: ['部门', '所属部门', 'dept'], label: '部门' },
  type: { aliases: ['费用类型', '费用科目', '类型', '科目', 'type'], label: '费用类型' },
  amount: { aliases: ['报销金额', '金额', 'amount'], label: '金额' },
  invoiceNo: { aliases: ['发票号码', '票据号', '票据号码', '发票号'], label: '票据号' },
  reason: { aliases: ['事由', '摘要', '费用说明', '备注', 'reason'], label: '事由' },
  approver: { aliases: ['审批人', '审核人', 'approver'], label: '审批人' },
};

/** 必填项（列存在才检查单元格是否为空）。 */
const REQUIRED = ['date', 'person', 'type', 'amount', 'invoiceNo'];

function load(file, delimiter) {
  const text = decode(fs.readFileSync(file));
  const delim = delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delim);
  if (rows.length === 0) return { rows: [], idx: {}, header: [] };
  const header = rows[0];
  const idx = {};
  for (const key of Object.keys(COLS)) idx[key] = findColumn(header, COLS[key].aliases);
  if (idx.amount < 0) {
    console.error(`[${file}] 找不到金额列，请用 --amount= 指定列名或列号`);
    process.exit(2);
  }
  const isHeader = toCents(header[idx.amount]) === null;
  const body = isHeader ? rows.slice(1) : rows;
  const out = body.map((row, i) => ({
    line: isHeader ? i + 2 : i + 1,
    row,
    date: idx.date >= 0 ? row[idx.date] : '',
    dateIso: idx.date >= 0 ? toDate(row[idx.date]) : null,
    person: idx.person >= 0 ? String(row[idx.person]).trim() : '',
    dept: idx.dept >= 0 ? String(row[idx.dept]).trim() : '',
    type: idx.type >= 0 ? String(row[idx.type]).trim() : '',
    amountRaw: row[idx.amount],
    cents: toCents(row[idx.amount]),
    invoiceNo: idx.invoiceNo >= 0 ? String(row[idx.invoiceNo]).trim() : '',
    reason: idx.reason >= 0 ? String(row[idx.reason]).trim() : '',
    approver: idx.approver >= 0 ? String(row[idx.approver]).trim() : '',
  }));
  return { rows: out, idx, header, hasHeader: isHeader };
}

// ------------------------------------------------------------------ 审计

/**
 * @param {Array} rows 报销明细
 * @param {object} opts 含 limits（类型→分）、maxAgeDays、requireApprover
 */
function audit(rows, opts) {
  const issues = []; // { line, level, code, msg }
  const push = (line, level, code, msg) => issues.push({ line, level, code, msg });

  // 必填项
  for (const r of rows) {
    for (const key of REQUIRED) {
      if (opts.idx[key] < 0) continue; // 列不存在就不检查
      const v = key === 'amount' ? r.amountRaw : r[key];
      if (v === undefined || String(v).trim() === '') {
        push(r.line, 'E', 'E401', `必填项「${COLS[key].label}」为空`);
      }
    }
    // 金额合法性
    if (r.cents === null && String(r.amountRaw).trim() !== '') {
      push(r.line, 'E', 'E402', `金额无法解析：「${r.amountRaw}」`);
    } else if (r.cents === 0) {
      push(r.line, 'E', 'E402', '金额为 0');
    } else if (r.cents !== null && r.cents < 0) {
      push(r.line, 'W', 'W506', `金额为负（${money(r.cents)}）：确认是否为冲销`);
    }
    // 票据号格式：看起来像发票号码（全数字）但位数不对
    if (r.invoiceNo !== '' && /^\d+$/.test(r.invoiceNo) && !/^\d{8}$/.test(r.invoiceNo)) {
      push(r.line, 'W', 'W507', `票据号「${r.invoiceNo}」不是 8 位：确认是否为增值税发票号码`);
    }
    // 费用日期过久
    if (r.dateIso) {
      const today = new Date().toISOString().slice(0, 10);
      const days = Math.round((Date.parse(today) - Date.parse(r.dateIso)) / 86400000);
      if (days > opts.maxAgeDays) {
        push(r.line, 'W', 'W503', `费用发生日距今 ${days} 天（${r.dateIso}），超过 ${opts.maxAgeDays} 天`);
      }
      if (days < 0) push(r.line, 'E', 'E406', `费用日期在未来：${r.dateIso}`);
    } else if (r.date !== '') {
      push(r.line, 'E', 'E406', `费用日期无法识别：「${r.date}」`);
    }
    // 缺审批人
    if (opts.requireApprover && opts.idx.approver >= 0 && r.approver === '') {
      push(r.line, 'W', 'W502', '缺少审批人');
    }
  }

  // 重复票据号（跨行）
  const byInvoice = new Map();
  for (const r of rows) {
    if (r.invoiceNo === '') continue;
    if (!byInvoice.has(r.invoiceNo)) byInvoice.set(r.invoiceNo, []);
    byInvoice.get(r.invoiceNo).push(r.line);
  }
  for (const [no, lines] of byInvoice) {
    if (lines.length > 1) {
      push(lines[0], 'E', 'E403', `票据号重复：「${no}」出现在第 ${lines.join('、')} 行`);
    }
  }

  // 同一人同日同金额：疑似拆分规避审批
  const combo = new Map();
  for (const r of rows) {
    if (!r.person || !r.dateIso || r.cents === null) continue;
    const key = `${r.person}|${r.dateIso}|${r.cents}|${r.type}`;
    if (!combo.has(key)) combo.set(key, []);
    combo.get(key).push(r.line);
  }
  for (const [key, lines] of combo) {
    if (lines.length > 1) {
      const [person, date, cents] = key.split('|');
      push(lines[0], 'W', 'W504', `${person} 于 ${date} 有 ${lines.length} 笔同为 ${money(Number(cents))} 的报销（第 ${lines.join('、')} 行）：确认是否拆分`);
    }
  }

  // 超标：按费用类型限额
  for (const r of rows) {
    if (r.cents === null || r.type === '') continue;
    const limit = opts.limits[normalizeType(r.type)];
    if (limit === undefined) continue;
    if (r.cents > limit) {
      push(r.line, 'W', 'W501', `「${r.type}」${money(r.cents)} 超出限额 ${money(limit)}（超 ${money(r.cents - limit)}）`);
    }
  }

  return issues;
}

/** 限额比对时忽略大小写与空格。 */
function normalizeType(t) {
  return String(t).replace(/\s/g, '').toLowerCase();
}

/** 按类型/按人小计。 */
function subtotals(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    if (r.cents === null) continue;
    const k = keyFn(r) || '（未填）';
    const cur = map.get(k) || { count: 0, cents: 0 };
    cur.count++; cur.cents += r.cents;
    map.set(k, cur);
  }
  return [...map].sort((a, b) => b[1].cents - a[1].cents);
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const codes = (issues, level) => issues.filter((i) => i.level === level).map((i) => i.code).sort();

  console.log('金额解析');
  check('千分位', toCents('1,234.56'), 123456);
  check('括号负数', toCents('(500.00)'), -50000);
  check('非法', toCents('abc'), null);
  check('空串', toCents(''), null);

  const mkIdx = (keys) => {
    const idx = {};
    for (const k of Object.keys(COLS)) idx[k] = keys.includes(k) ? 0 : -1;
    return idx;
  };
  const baseOpts = (extra) => ({
    idx: mkIdx(['date', 'person', 'type', 'amount', 'invoiceNo', 'approver']),
    limits: {}, maxAgeDays: 90, requireApprover: false, ...extra,
  });
  // 用「3 天前」而不是写死日期：写死的日期会随时间推移越过 maxAgeDays，让用例自己失效
  const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const rec = (o) => ({
    line: 2, row: [], date: recent, dateIso: recent, person: '张三', dept: '销售部',
    type: '差旅', amountRaw: '100.00', cents: 10000, invoiceNo: '12345678',
    reason: '', approver: '', ...o,
  });

  console.log('必填项');
  check('齐全无问题', codes(audit([rec()], baseOpts()), 'E'), []);
  check('票据号为空', codes(audit([rec({ invoiceNo: '' })], baseOpts()), 'E'), ['E401']);
  check('金额为空', codes(audit([rec({ amountRaw: '', cents: null })], baseOpts()), 'E'), ['E401']);
  check('金额为 0', codes(audit([rec({ amountRaw: '0', cents: 0 })], baseOpts()), 'E'), ['E402']);
  check('金额非法', codes(audit([rec({ amountRaw: 'abc', cents: null })], baseOpts()), 'E'), ['E402']);
  check('负数只提醒', codes(audit([rec({ amountRaw: '-100', cents: -10000 })], baseOpts()), 'W'), ['W506']);

  console.log('重复票据号');
  const dupRows = [rec({ line: 2 }), rec({ line: 3 })];
  check('重复票据号', codes(audit(dupRows, baseOpts()), 'E'), ['E403']);

  console.log('疑似拆分');
  const splitRows = [
    rec({ line: 2, dateIso: recent, date: recent }),
    rec({ line: 3, dateIso: recent, date: recent }),
  ];
  check('同人同日同额', codes(audit(splitRows, baseOpts()), 'W'), ['W504']);

  console.log('日期');
  check('未来日期', codes(audit([rec({ dateIso: '2099-01-01', date: '2099-01-01' })], baseOpts()), 'E'), ['E406']);
  check('过期提醒', codes(audit([rec({ dateIso: '2020-01-01', date: '2020-01-01' })], baseOpts()), 'W'), ['W503']);
  check('无法识别的日期', codes(audit([rec({ dateIso: null, date: '上周' })], baseOpts()), 'E'), ['E406']);

  console.log('超标（限额由用户提供）');
  const limOpts = baseOpts({ limits: { 差旅: 50000 } });
  check('未超标', codes(audit([rec({ cents: 10000, amountRaw: '100.00' })], limOpts), 'W'), []);
  check('超标提醒', codes(audit([rec({ cents: 60000, amountRaw: '600.00' })], limOpts), 'W'), ['W501']);
  check('无对应限额不判', codes(audit([rec({ type: '办公用品', cents: 999999, amountRaw: '9999.99' })], limOpts), 'W'), []);

  console.log('缺审批人');
  check('开启后检出', codes(audit([rec({ approver: '' })], baseOpts({ requireApprover: true })), 'W'), ['W502']);
  check('关闭后不检', codes(audit([rec({ approver: '' })], baseOpts()), 'W'), []);

  console.log('小计');
  const sub = subtotals([rec({ type: '差旅', cents: 10000 }), rec({ type: '差旅', cents: 5000 }), rec({ type: '餐饮', cents: 3000 })], (r) => r.type);
  check('按类型小计', sub.map(([k, v]) => [k, v.cents]), [['差旅', 15000], ['餐饮', 3000]]);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `报销单审计：必填项、金额合计核对、超标、重复票据号、疑似拆分

用法:
  node scripts/expense.js check <CSV> [选项]
  node scripts/expense.js --selftest

选项:
  --limit=<类型:金额>   单项限额，可重复（--limit=差旅:500 --limit=餐饮:200）
  --limits-file=<CSV>   限额表（两列：费用类型,限额）
  --declared-total=<金额> 报销单声明合计，用于核对明细加总是否一致
  --max-age-days=90     费用发生日距今超过此天数则提醒
  --require-approver    要求审批人必填（列存在时检查）
  --delimiter=,         强制分隔符
  --json                输出 JSON

注意：本脚本不内置任何限额标准——差旅与招待标准各单位差异极大，
内置"通用标准"只会给出看似权威的错误结论。请用 --limit= 提供。

退出码: 0 = 无 E 级问题，1 = 存在 E 级问题，2 = 用法错误`;

function parseArgs(argv) {
  const opts = {
    limits: {}, maxAgeDays: 90, requireApprover: false, json: false,
    declaredTotal: null, delimiter: null, limitsFile: null, limitList: [],
  };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--require-approver') opts.requireApprover = true;
    else if (arg.startsWith('--limit=')) opts.limitList.push(arg.slice(8));
    else if (arg.startsWith('--limits-file=')) opts.limitsFile = arg.slice(14);
    else if (arg.startsWith('--declared-total=')) opts.declaredTotal = toCents(arg.slice(17));
    else if (arg.startsWith('--max-age-days=')) opts.maxAgeDays = Number(arg.slice(15));
    else if (arg.startsWith('--delimiter=')) opts.delimiter = arg.slice(12);
    else rest.push(arg);
  }
  return { opts, rest };
}

function buildLimits(opts) {
  const limits = {};
  for (const item of opts.limitList) {
    const i = item.lastIndexOf(':');
    if (i < 0) { console.error(`--limit 格式应为「类型:金额」，收到「${item}」`); process.exit(2); }
    const type = item.slice(0, i).trim();
    const cents = toCents(item.slice(i + 1));
    if (cents === null) { console.error(`--limit 金额无法解析：「${item}」`); process.exit(2); }
    limits[normalizeType(type)] = cents;
  }
  if (opts.limitsFile) {
    if (!fs.existsSync(opts.limitsFile)) { console.error(`限额文件不存在: ${opts.limitsFile}`); process.exit(2); }
    const rows = parseCsv(decode(fs.readFileSync(opts.limitsFile)), ',');
    for (const row of rows) {
      if (row.length < 2) continue;
      const cents = toCents(row[1]);
      if (cents === null) continue; // 表头行
      limits[normalizeType(row[0])] = cents;
    }
  }
  return limits;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'check') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const file = rest[0];
  if (!file) { console.error('需要 CSV 文件\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }

  const { rows, idx } = load(file, opts.delimiter);
  const limits = buildLimits(opts);
  const auditOpts = {
    idx, limits, maxAgeDays: opts.maxAgeDays, requireApprover: opts.requireApprover,
  };
  const issues = audit(rows, auditOpts);

  const total = rows.reduce((n, r) => n + (r.cents || 0), 0);
  const errs = issues.filter((i) => i.level === 'E');
  const warns = issues.filter((i) => i.level === 'W');

  // 声明合计核对
  let totalMismatch = null;
  if (opts.declaredTotal !== null && opts.declaredTotal !== total) {
    totalMismatch = { declared: opts.declaredTotal, actual: total };
    issues.push({ line: 0, level: 'E', code: 'E405', msg: `明细加总 ${money(total)} 与声明合计 ${money(opts.declaredTotal)} 不符（差 ${money(total - opts.declaredTotal)}）` });
  }

  if (opts.json) {
    console.log(JSON.stringify({
      file, rows: rows.length, total: money(total),
      declaredTotal: opts.declaredTotal === null ? null : money(opts.declaredTotal),
      errorCount: errs.length, warningCount: warns.length,
      byType: subtotals(rows, (r) => r.type).map(([k, v]) => ({ type: k, count: v.count, amount: money(v.cents) })),
      byPerson: subtotals(rows, (r) => r.person).map(([k, v]) => ({ person: k, count: v.count, amount: money(v.cents) })),
      issues,
    }, null, 2));
    process.exit(issues.some((i) => i.level === 'E') ? 1 : 0);
  }

  console.log(`文件: ${file}`);
  console.log(`共 ${rows.length} 笔，合计 ${money(total)}`);
  if (opts.declaredTotal !== null) {
    console.log(`声明合计 ${money(opts.declaredTotal)}　明细加总 ${money(total)}　${totalMismatch ? '✗ 不符' : '✓ 一致'}`);
  }
  console.log(`问题：错误 ${errs.length} / 提醒 ${warns.length}`);
  console.log('');

  if (rows.length) {
    console.log('--- 按费用类型 ---');
    for (const [k, v] of subtotals(rows, (r) => r.type)) {
      console.log(`  ${String(k).padEnd(10)} ${String(v.count).padStart(3)} 笔  ${money(v.cents).padStart(12)}`);
    }
    console.log('');
    if (idx.person >= 0) {
      console.log('--- 按报销人 ---');
      for (const [k, v] of subtotals(rows, (r) => r.person)) {
        console.log(`  ${String(k).padEnd(10)} ${String(v.count).padStart(3)} 笔  ${money(v.cents).padStart(12)}`);
      }
      console.log('');
    }
  }

  if (issues.length) {
    console.log('--- 问题明细 ---');
    for (const i of issues.sort((a, b) => a.line - b.line)) {
      const where = i.line ? `第 ${i.line} 行` : '合计';
      console.log(`  ${i.level === 'E' ? '✗' : '⚠'} ${where}  ${i.code} ${i.msg}`);
    }
    console.log('');
    const tally = new Map();
    for (const i of issues) tally.set(i.code, (tally.get(i.code) || 0) + 1);
    console.log('汇总');
    for (const [code, n] of [...tally].sort()) console.log(`  ${code}: ${n}`);
    console.log('');
  } else {
    console.log('未发现问题。');
  }

  if (!Object.keys(limits).length) {
    console.log('提示：未提供 --limit=，未做超标检查。超标标准需由你所在单位提供。');
  }

  if (issues.some((i) => i.level === 'E')) process.exit(1);
}

main();
