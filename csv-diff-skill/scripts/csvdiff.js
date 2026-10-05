'use strict';

/**
 * 按关键列比对两个 CSV，输出新增 / 删除 / 变更。
 *
 * 值比较默认做「数值归一化」：100 与 100.00 视为相同，因为那只是写法差异。
 * 需要严格按字符串比对时加 --exact。
 *
 * 用法:
 *   node scripts/csvdiff.js diff <A表> <B表> --key=列[,列] [--compare=列,列] [--exact] [--json]
 *   node scripts/csvdiff.js --selftest
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

function toNumber(raw) {
  let s = String(raw).trim().replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  s = s.replace(/[，,\s]/g, '').replace(/^[¥￥$]/, '');
  if (s === '' || s === '-') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function load(file, delimiter) {
  const text = decode(fs.readFileSync(file));
  const delim = delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delim);
  if (rows.length < 1) return { header: [], rows: [] };
  return { header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
}

function columnIndex(header, name) {
  const i = header.indexOf(name);
  if (i >= 0) return i;
  const n = Number(name);
  if (!Number.isNaN(n) && n >= 1 && n <= header.length) return n - 1;
  return header.map((h) => h.toLowerCase()).indexOf(String(name).toLowerCase());
}

/** 值比较。--exact 时严格按字符串（trim 后）；否则数值相等也算相同。 */
function sameValue(a, b, exact) {
  const sa = String(a === undefined ? '' : a).trim();
  const sb = String(b === undefined ? '' : b).trim();
  if (sa === sb) return true;
  if (exact) return false;
  const na = toNumber(sa); const nb = toNumber(sb);
  if (na === null || nb === null) return false;
  return na === nb;
}

// ------------------------------------------------------------------ 比对

/**
 * @returns {{ added, removed, changed, unchanged, keyDupA, keyDupB, onlyInA, onlyInB }}
 */
function diffTables(a, b, opts) {
  const keyIdxA = opts.keyNames.map((n) => columnIndex(a.header, n));
  const keyIdxB = opts.keyNames.map((n) => columnIndex(b.header, n));
  for (const [table, idxs, names, label] of [[a, keyIdxA, opts.keyNames, 'A 表'], [b, keyIdxB, opts.keyNames, 'B 表']]) {
    idxs.forEach((i, k) => {
      if (i < 0) {
        console.error(`${label} 没有关键列「${names[k]}」。可用列: ${table.header.join(' / ')}`);
        process.exit(2);
      }
    });
  }

  // 要比对的列：两表都存在、且不是关键列的那些
  const compareIdx = [];
  if (opts.compareNames && opts.compareNames.length) {
    for (const n of opts.compareNames) {
      const ia = columnIndex(a.header, n);
      const ib = columnIndex(b.header, n);
      if (ia < 0 || ib < 0) {
        console.error(`比对列「${n}」不是两表共有（A:${ia >= 0} B:${ib >= 0}）`);
        process.exit(2);
      }
      compareIdx.push({ name: a.header[ia], ia, ib });
    }
  } else {
    for (const name of a.header) {
      const ia = columnIndex(a.header, name);
      const ib = columnIndex(b.header, name);
      if (ia < 0 || ib < 0) continue;
      if (opts.keyNames.includes(name)) continue;
      compareIdx.push({ name, ia, ib });
    }
  }

  const keyOf = (row, idxs) => idxs.map((i) => String(row[i] === undefined ? '' : row[i]).trim()).join('\u0001');

  const mapA = new Map();
  const mapB = new Map();
  const keyDupA = [];
  const keyDupB = [];
  a.rows.forEach((row, i) => {
    const k = keyOf(row, keyIdxA);
    if (mapA.has(k)) keyDupA.push({ key: k.split('\u0001'), lines: [mapA.get(k).line, i + 2] });
    else mapA.set(k, { row, line: i + 2 });
  });
  b.rows.forEach((row, i) => {
    const k = keyOf(row, keyIdxB);
    if (mapB.has(k)) keyDupB.push({ key: k.split('\u0001'), lines: [mapB.get(k).line, i + 2] });
    else mapB.set(k, { row, line: i + 2 });
  });

  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const [k, va] of mapA) {
    const vb = mapB.get(k);
    if (!vb) { removed.push({ key: k.split('\u0001'), line: va.line, row: va.row }); continue; }
    const diffs = [];
    for (const c of compareIdx) {
      const x = va.row[c.ia]; const y = vb.row[c.ib];
      if (!sameValue(x, y, opts.exact)) {
        diffs.push({ column: c.name, from: String(x === undefined ? '' : x), to: String(y === undefined ? '' : y) });
      }
    }
    if (diffs.length) changed.push({ key: k.split('\u0001'), lineA: va.line, lineB: vb.line, diffs });
    else unchanged++;
  }
  for (const [k, vb] of mapB) {
    if (!mapA.has(k)) added.push({ key: k.split('\u0001'), line: vb.line, row: vb.row });
  }

  const onlyInA = a.header.filter((h) => !b.header.includes(h));
  const onlyInB = b.header.filter((h) => !a.header.includes(h));

  return { added, removed, changed, unchanged, keyDupA, keyDupB, onlyInA, onlyInB, keyNames: opts.keyNames };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const T = (header, rows) => ({ header, rows });
  const O = (keyNames, extra) => ({ keyNames, compareNames: null, exact: false, ...extra });
  const keys = (arr) => arr.map((x) => x.key.join('/'));

  console.log('值比较');
  check('相同字符串', sameValue('abc', 'abc', false), true);
  check('数值写法不同视为相同', sameValue('100', '100.00', false), true);
  check('千分位视为相同', sameValue('1,000', '1000', false), true);
  check('strict 下不等', sameValue('100', '100.00', true), false);
  check('空与空相同', sameValue(undefined, '', false), true);

  const A = T(['订单号', '金额', '状态'], [
    ['1001', '1200', '已完成'],
    ['1002', '1500', '待付款'],
    ['1003', '900', '已完成'],
  ]);

  console.log('无变化');
  let r = diffTables(A, T(['订单号', '金额', '状态'], [
    ['1001', '1200', '已完成'], ['1002', '1500', '待付款'], ['1003', '900', '已完成'],
  ]), O(['订单号']));
  check('全部未变更', [r.unchanged, r.added.length, r.removed.length, r.changed.length], [3, 0, 0, 0]);

  console.log('新增与删除');
  r = diffTables(A, T(['订单号', '金额', '状态'], [
    ['1001', '1200', '已完成'], ['1003', '900', '已完成'], ['1004', '500', '待付款'],
  ]), O(['订单号']));
  check('删除 1002', keys(r.removed), ['1002']);
  check('新增 1004', keys(r.added), ['1004']);

  console.log('变更');
  r = diffTables(A, T(['订单号', '金额', '状态'], [
    ['1001', '1200', '已完成'], ['1002', '1800', '已完成'], ['1003', '900', '已完成'],
  ]), O(['订单号']));
  check('变更 1002', keys(r.changed), ['1002']);
  check('变更字段', r.changed[0].diffs.map((d) => `${d.column}:${d.from}→${d.to}`), ['金额:1500→1800', '状态:待付款→已完成']);

  console.log('数值写法差异不算变更');
  r = diffTables(A, T(['订单号', '金额', '状态'], [
    ['1001', '1200.00', '已完成'], ['1002', '1500', '待付款'], ['1003', '900', '已完成'],
  ]), O(['订单号']));
  check('不算变更', r.changed.length, 0);

  console.log('只比对指定列');
  r = diffTables(A, T(['订单号', '金额', '状态'], [
    ['1001', '1200', '已完成'], ['1002', '9999', '待付款'], ['1003', '900', '已完成'],
  ]), O(['订单号'], { compareNames: ['状态'] }));
  check('未指定的列不比对', r.changed.length, 0);

  console.log('多列关键');
  const A2 = T(['区域', '月份', '金额'], [['华东', '1月', '100'], ['华南', '1月', '200']]);
  const B2 = T(['区域', '月份', '金额'], [['华东', '1月', '150'], ['华南', '2月', '200']]);
  r = diffTables(A2, B2, O(['区域', '月份']));
  check('组合键变更', keys(r.changed), ['华东/1月']);
  check('组合键新增', keys(r.added), ['华南/2月']);

  console.log('关键列重复');
  const A3 = T(['订单号', '金额'], [['1001', '100'], ['1001', '200']]);
  r = diffTables(A3, T(['订单号', '金额'], [['1001', '100']]), O(['订单号']));
  check('检出 A 表重复键', r.keyDupA.length, 1);

  console.log('列集合不同');
  r = diffTables(A, T(['订单号', '金额', '备注'], [['1001', '1200', 'x']]), O(['订单号']));
  check('B 特有列', r.onlyInB, ['备注']);
  check('A 特有列', r.onlyInA, ['状态']);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `按关键列比对两个 CSV，输出新增 / 删除 / 变更

用法:
  node scripts/csvdiff.js diff <A表> <B表> --key=列[,列] [选项]
  node scripts/csvdiff.js --selftest

选项:
  --key=列[,列]      关键列，必填，可多个（列名或列号）
  --compare=列[,列]  要比对的列，默认两表共有的所有非关键列
  --exact            严格按字符串比较（默认 100 与 100.00 视为相同）
  --delimiter=,      强制分隔符
  --json             输出 JSON

说明:
  - 默认做数值归一化：100 与 100.00 只是写法差异，不算变更
  - 某一表内部关键列重复时，只保留第一行比对，并在报告里提示
  - 两表列集合不一致时，只比对共有列，并列出各自特有的列

退出码: 0 = 无差异，1 = 有差异，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { keyNames: [], compareNames: null, exact: false, json: false, delimiter: null };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--exact') opts.exact = true;
    else if (arg.startsWith('--key=')) opts.keyNames = arg.slice(6).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--compare=')) opts.compareNames = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--delimiter=')) opts.delimiter = arg.slice(12);
    else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'diff') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const [fileA, fileB] = rest;
  if (!fileA || !fileB) { console.error('需要两个 CSV 文件\n\n' + USAGE); process.exit(2); }
  if (opts.keyNames.length === 0) { console.error('必须用 --key= 指定关键列\n\n' + USAGE); process.exit(2); }
  for (const f of [fileA, fileB]) {
    if (!fs.existsSync(f)) { console.error(`文件不存在: ${f}`); process.exit(2); }
  }

  const a = load(fileA, opts.delimiter);
  const b = load(fileB, opts.delimiter);
  const r = diffTables(a, b, opts);
  const total = r.added.length + r.removed.length + r.changed.length;

  if (opts.json) {
    console.log(JSON.stringify({
      fileA, fileB,
      key: r.keyNames,
      summary: { unchanged: r.unchanged, added: r.added.length, removed: r.removed.length, changed: r.changed.length },
      added: r.added, removed: r.removed, changed: r.changed,
      duplicateKeys: { a: r.keyDupA, b: r.keyDupB },
      columnsOnlyInA: r.onlyInA, columnsOnlyInB: r.onlyInB,
    }, null, 2));
    process.exit(total ? 1 : 0);
  }

  console.log(`A 表: ${fileA}（${a.rows.length} 行）`);
  console.log(`B 表: ${fileB}（${b.rows.length} 行）`);
  console.log(`关键列: ${r.keyNames.join(' / ')}　比较方式: ${opts.exact ? '严格字符串' : '数值归一化（100 = 100.00）'}`);
  console.log('');
  console.log(`未变更 ${r.unchanged}，新增 ${r.added.length}，删除 ${r.removed.length}，变更 ${r.changed.length}`);
  console.log('');

  const keyStr = (k) => k.join('/');

  if (r.changed.length) {
    console.log(`--- 变更（${r.changed.length}）---`);
    for (const c of r.changed) {
      console.log(`  ${keyStr(c.key)}  （A 第 ${c.lineA} 行 → B 第 ${c.lineB} 行）`);
      for (const d of c.diffs) console.log(`      ${d.column}: ${d.from || '（空）'} → ${d.to || '（空）'}`);
    }
    console.log('');
  }
  if (r.added.length) {
    console.log(`--- 新增（B 有 A 无，${r.added.length}）---`);
    for (const x of r.added) console.log(`  第 ${x.line} 行　${keyStr(x.key)}`);
    console.log('');
  }
  if (r.removed.length) {
    console.log(`--- 删除（A 有 B 无，${r.removed.length}）---`);
    for (const x of r.removed) console.log(`  第 ${x.line} 行　${keyStr(x.key)}`);
    console.log('');
  }

  for (const [label, arr] of [['A 表', r.keyDupA], ['B 表', r.keyDupB]]) {
    if (arr.length) {
      console.log(`⚠ ${label}关键列重复 ${arr.length} 处：${arr.slice(0, 3).map((x) => `${keyStr(x.key)}（第 ${x.lines.join('、')} 行）`).join('；')}`);
      console.log('  重复的关键列只按第一行比对，请先去重再比对。');
      console.log('');
    }
  }
  if (r.onlyInA.length || r.onlyInB.length) {
    if (r.onlyInA.length) console.log(`仅 A 表有的列（未参与比对）: ${r.onlyInA.join(' / ')}`);
    if (r.onlyInB.length) console.log(`仅 B 表有的列（未参与比对）: ${r.onlyInB.join(' / ')}`);
    console.log('');
  }

  console.log(total ? `存在差异 ${total} 处。` : '✓ 两表一致。');

  if (total) process.exit(1);
}

main();
