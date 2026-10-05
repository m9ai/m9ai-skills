'use strict';

/**
 * CSV 分组聚合：计数、求和、均值、中位数、分位数、极值、去重计数。
 *
 * 不做多表关联、不做透视表、不做窗口函数——那是电子表格或数据库的活，
 * 在这里硬做只会得到一个既慢又容易算错的玩具。
 *
 * 用法:
 *   node scripts/agg.js run <CSV> [--group=列] [--sum=列] ... [--top=N] [--sort=列] [--json]
 *   node scripts/agg.js describe <CSV> [--col=列]
 *   node scripts/agg.js --selftest
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

/** 千分位、货币符号、全角、括号负数都能吃。失败返回 null。 */
function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  let neg = false;
  if (/^[（(]/.test(s) && /[）)]$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[，,\s]/g, '').replace(/^[¥￥$+]/, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s === '' || s === '-') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// ------------------------------------------------------------------ 统计

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 线性插值分位数，p 取 0–100。 */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx); const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** 显示宽度：中日韩字符按 2 计，用于表格对齐。 */
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦　-〿]/.test(ch) ? 2 : 1;
  }
  return w;
}
function pad(s, n) { return String(s) + ' '.repeat(Math.max(0, n - dispWidth(String(s)))); }
function padLeft(s, n) { return ' '.repeat(Math.max(0, n - dispWidth(String(s)))) + String(s); }

const fmt = (n, digits) => {
  if (n === null || n === undefined) return '—';
  const fixed = Number(n).toFixed(digits === undefined ? 2 : digits);
  // 千分位
  const [int, dec] = fixed.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${withSep}.${dec}` : withSep;
};

// ------------------------------------------------------------------ 读表

function loadTable(file, delimiter) {
  const text = decode(fs.readFileSync(file));
  const delim = delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delim);
  if (rows.length === 0) return { header: [], rows: [] };
  return { header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
}

function columnIndex(header, name) {
  const i = header.indexOf(name);
  if (i >= 0) return i;
  const n = Number(name);
  if (!Number.isNaN(n) && n >= 1 && n <= header.length) return n - 1;
  const lower = header.map((h) => h.toLowerCase());
  const j = lower.indexOf(String(name).toLowerCase());
  return j;
}

function resolveColumns(header, names, flagName) {
  const out = [];
  for (const name of names) {
    const i = columnIndex(header, name);
    if (i < 0) {
      console.error(`${flagName} 指定的列不存在: 「${name}」\n可用列: ${header.join(' / ')}`);
      process.exit(2);
    }
    out.push(i);
  }
  return out;
}

// ------------------------------------------------------------------ 聚合

const splitList = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

/**
 * @returns {Array<{ key: string[], values: object, count: number }>}
 */
function aggregate(table, opts) {
  const groups = new Map();
  const metrics = opts.metrics; // [{ kind, col, label }]

  for (const row of table.rows) {
    const keyParts = opts.groupIdx.map((i) => (row[i] === undefined ? '' : String(row[i]).trim()));
    const key = keyParts.join('\u0001');
    if (!groups.has(key)) {
      groups.set(key, { key: keyParts, values: metrics.map(() => []), count: 0 });
    }
    const g = groups.get(key);
    g.count++;
    metrics.forEach((m, mi) => {
      const raw = row[m.col] === undefined ? '' : String(row[m.col]);
      if (m.kind === 'distinct') { g.values[mi].push(raw); return; }
      if (m.kind === 'count') { g.values[mi].push(1); return; }
      const v = toNumber(raw);
      if (v !== null) g.values[mi].push(v); // 无法解析的值计入「空值」而非 0
    });
  }

  const out = [];
  for (const g of groups.values()) {
    const values = {};
    metrics.forEach((m, mi) => {
      const arr = g.values[mi];
      const needNumbers = m.kind !== 'distinct';
      const nums = needNumbers ? arr.filter((x) => x !== null) : [];
      const sorted = nums.slice().sort((a, b) => a - b);
      switch (m.kind) {
        case 'count': values[m.label] = g.count; break;
        case 'distinct': values[m.label] = new Set(arr).size; break;
        case 'sum': values[m.label] = nums.length ? nums.reduce((a, b) => a + b, 0) : null; break;
        case 'avg': values[m.label] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break;
        case 'min': values[m.label] = sorted.length ? sorted[0] : null; break;
        case 'max': values[m.label] = sorted.length ? sorted[sorted.length - 1] : null; break;
        case 'median': values[m.label] = median(sorted); break;
        case 'p90': values[m.label] = percentile(sorted, 90); break;
        case 'p95': values[m.label] = percentile(sorted, 95); break;
        case 'blank': values[m.label] = g.count - nums.length; break;
        default: values[m.label] = null;
      }
    });
    out.push({ key: g.key, count: g.count, values });
  }
  return out;
}

/** 排序：--sort=列名:desc，缺省按第一个度量降序。 */
function sortRows(rows, opts, metrics) {
  const sortSpec = opts.sort;
  let col = null; let dir = 'desc';
  if (sortSpec) {
    const parts = String(sortSpec).split(':');
    col = parts[0];
    dir = (parts[1] || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  }
  const idx = col === null ? -1 : metrics.findIndex((m) => m.label === col);
  const keyIdx = col === null ? -1 : Number(col) - 1;

  const cmp = (av, bv) => {
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;  // 空值永远排后面
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      const d = av - bv;
      return dir === 'asc' ? d : -d;
    }
    const s = String(av).localeCompare(String(bv), 'zh');
    return dir === 'asc' ? s : -s;
  };
  return rows.slice().sort((a, b) => {
    if (idx >= 0) return cmp(a.values[metrics[idx].label], b.values[metrics[idx].label]);
    if (keyIdx >= 0) return cmp(a.key[keyIdx], b.key[keyIdx]);
    return cmp(a.count, b.count);
  });
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  console.log('统计函数');
  check('奇数个中位数', median([1, 2, 3]), 2);
  check('偶数个中位数', median([1, 2, 3, 4]), 2.5);
  check('空数组', median([]), null);
  check('P90 单值', percentile([5], 90), 5);
  check('P90 插值', percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);

  console.log('数字解析');
  check('千分位', toNumber('1,234.56'), 1234.56);
  check('货币符号', toNumber('¥1130'), 1130);
  check('括号负数', toNumber('(500)'), -500);
  check('非法', toNumber('abc'), null);

  const table = {
    header: ['部门', '姓名', '金额'],
    rows: [
      ['销售部', '张三', '1000'],
      ['销售部', '李四', '3000'],
      ['技术部', '王五', '2000'],
      ['技术部', '赵六', ''],
    ],
  };

  console.log('分组聚合');
  const m1 = [{ kind: 'sum', col: 2, label: '金额合计' }, { kind: 'avg', col: 2, label: '金额均值' }];
  let r = aggregate(table, { groupIdx: [0], metrics: m1 });
  check('两组', r.length, 2);
  check('销售部求和', r.find((x) => x.key[0] === '销售部').values['金额合计'], 4000);
  check('技术部求和（空值跳过）', r.find((x) => x.key[0] === '技术部').values['金额合计'], 2000);
  check('技术部均值（不含空值）', r.find((x) => x.key[0] === '技术部').values['金额均值'], 2000);
  check('行数含空值行', r.find((x) => x.key[0] === '技术部').count, 2);

  console.log('去重计数');
  const m2 = [{ kind: 'distinct', col: 1, label: '人数' }];
  r = aggregate(table, { groupIdx: [0], metrics: m2 });
  check('销售部去重人数', r.find((x) => x.key[0] === '销售部').values['人数'], 2);

  console.log('空值计数');
  const m3 = [{ kind: 'blank', col: 2, label: '金额空值' }];
  r = aggregate(table, { groupIdx: [0], metrics: m3 });
  check('技术部空值数', r.find((x) => x.key[0] === '技术部').values['金额空值'], 1);

  console.log('整表聚合（不分组）');
  r = aggregate(table, { groupIdx: [], metrics: m1 });
  check('只有一行', r.length, 1);
  check('总额', r[0].values['金额合计'], 6000);

  console.log('多列分组');
  r = aggregate(table, { groupIdx: [0, 1], metrics: m1 });
  check('四组', r.length, 4);

  console.log('排序');
  const sorted = sortRows(aggregate(table, { groupIdx: [0], metrics: m1 }), { sort: '金额合计:desc' }, m1);
  check('按合计降序', sorted.map((x) => x.key[0]), ['销售部', '技术部']);

  console.log('显示宽度');
  check('中文按 2 计', dispWidth('部门'), 4);
  check('数字按 1 计', dispWidth('123'), 3);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `CSV 分组聚合

用法:
  node scripts/agg.js run <CSV> [选项]
  node scripts/agg.js describe <CSV> [--col=列]     # 单列统计概览
  node scripts/agg.js --selftest

选项:
  --group=列名[,列名]  分组列，可逗号分隔多个；不填则对整表聚合
  --sum=列名[,列名]    求和
  --avg=列名[,列名]    均值
  --min= / --max=      最小 / 最大
  --median=             中位数
  --p90= / --p95=      分位数
  --distinct=列名[,..] 去重计数
  --blank=列名[,..]    空值计数
  --count              计入行数（默认总会输出行数）
  --top=N              只显示前 N 组
  --sort=列名:asc|desc 排序，缺省按行数降序
  --delimiter=,        强制分隔符
  --json               输出 JSON

列名可填表头文字，也可填列号（1 起）。

不做多表关联、透视表与窗口函数——那是电子表格或数据库的活。

退出码: 0 = 正常，2 = 用法错误`;

function parseArgs(argv) {
  const opts = {
    groupIdx: [], metrics: [], rawMetrics: [], rawGroups: [],
    top: null, sort: null, json: false, delimiter: null, col: null,
  };
  const rest = [];
  const kinds = { sum: 'sum', avg: 'avg', min: 'min', max: 'max', median: 'median', p90: 'p90', p95: 'p95', distinct: 'distinct', blank: 'blank' };
  for (const arg of argv) {
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--count') { opts.wantCount = true; continue; }
    let matched = false;
    for (const [flag, kind] of Object.entries(kinds)) {
      if (arg.startsWith(`--${flag}=`)) {
        const cols = splitList(arg.slice(flag.length + 3));
        for (const c of cols) opts.rawMetrics.push({ kind, colName: c });
        matched = true; break;
      }
    }
    if (matched) continue;
    if (arg.startsWith('--group=')) { opts.rawGroups = splitList(arg.slice(8)); matched = true; }
    else if (arg.startsWith('--top=')) { opts.top = Number(arg.slice(6)); matched = true; }
    else if (arg.startsWith('--sort=')) { opts.sort = arg.slice(7); matched = true; }
    else if (arg.startsWith('--delimiter=')) { opts.delimiter = arg.slice(12); matched = true; }
    else if (arg.startsWith('--col=')) { opts.col = arg.slice(6); matched = true; }
    if (!matched) rest.push(arg);
  }
  return { opts, rest };
}

function buildMetrics(header, opts) {
  const metrics = [];
  for (const { kind, colName } of opts.rawMetrics) {
    const i = columnIndex(header, colName);
    if (i < 0) {
      console.error(`列不存在: 「${colName}」\n可用列: ${header.join(' / ')}`);
      process.exit(2);
    }
    const kindLabel = { sum: '合计', avg: '均值', min: '最小', max: '最大', median: '中位数', p90: 'P90', p95: 'P95', distinct: '去重数', blank: '空值数' }[kind];
    metrics.push({ kind, col: i, label: `${header[i]}_${kindLabel}` });
  }
  return metrics;
}

/** 计数类度量不显示小数位。 */
const INT_KINDS = new Set(['distinct', 'count', 'blank']);

function printTable(rows, groupNames, metrics, top) {
  const shown = top ? rows.slice(0, top) : rows;
  const headers = [...groupNames, '行数', ...metrics.map((m) => m.label)];
  const cellOf = (r) => [
    ...r.key,
    String(r.count),
    ...metrics.map((m) => fmt(r.values[m.label], INT_KINDS.has(m.kind) ? 0 : 2)),
  ];
  const widths = headers.map((h) => dispWidth(h));
  for (const r of shown) cellOf(r).forEach((c, i) => { widths[i] = Math.max(widths[i], dispWidth(c)); });
  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of shown) {
    console.log(cellOf(r).map((c, i) => (i >= groupNames.length ? padLeft(c, widths[i]) : pad(c, widths[i]))).join('  '));
  }
}

function cmdRun(file, opts) {
  const table = loadTable(file, opts.delimiter);
  if (table.rows.length === 0) { console.error('没有数据行'); process.exit(2); }
  const groupIdx = resolveColumns(table.header, opts.rawGroups, '--group');
  const metrics = buildMetrics(table.header, opts);
  const rows = aggregate(table, { groupIdx, metrics });
  const sorted = sortRows(rows, opts, metrics);

  if (opts.json) {
    console.log(JSON.stringify({
      file,
      rows: table.rows.length,
      groups: groupIdx.map((i) => table.header[i]),
      metrics: metrics.map((m) => m.label),
      data: sorted.map((r) => ({ key: r.key, count: r.count, ...r.values })),
    }, null, 2));
    return;
  }

  console.log(`文件: ${file}　数据 ${table.rows.length} 行`);
  console.log(groupIdx.length ? `分组: ${groupIdx.map((i) => table.header[i]).join(' / ')}` : '分组: 无（整表聚合）');
  console.log(`共 ${rows.length} 组${opts.top ? `，显示前 ${opts.top} 组` : ''}`);
  console.log('');
  if (metrics.length === 0) {
    console.log('未指定度量（--sum= / --avg= 等），只输出行数。');
  }
  printTable(sorted, groupIdx.map((i) => table.header[i]), metrics, opts.top);
}

function cmdDescribe(file, opts) {
  const table = loadTable(file, opts.delimiter);
  if (table.rows.length === 0) { console.error('没有数据行'); process.exit(2); }
  const targets = opts.col ? [opts.col] : table.header;
  console.log(`文件: ${file}　数据 ${table.rows.length} 行`);
  console.log('');
  const headers = ['列', '非空', '空值', '去重数', '最小', '最大', '均值', '中位数', 'P90'];
  const rowsOut = [];
  for (const name of targets) {
    const i = columnIndex(table.header, name);
    if (i < 0) { console.error(`列不存在: ${name}`); process.exit(2); }
    const raw = table.rows.map((r) => (r[i] === undefined ? '' : String(r[i]).trim()));
    const nonBlank = raw.filter((s) => s !== '');
    const nums = raw.map(toNumber).filter((x) => x !== null).sort((a, b) => a - b);
    rowsOut.push({
      name: table.header[i],
      nonBlank: nonBlank.length,
      blank: raw.length - nonBlank.length,
      distinct: new Set(nonBlank).size,
      min: nums.length ? nums[0] : null,
      max: nums.length ? nums[nums.length - 1] : null,
      avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
      med: median(nums),
      p90: percentile(nums, 90),
      numeric: nums.length === nonBlank.length && nonBlank.length > 0,
    });
  }
  const widths = headers.map((h) => dispWidth(h));
  for (const r of rowsOut) {
    const cells = [r.name, r.nonBlank, r.blank, r.distinct, fmt(r.min), fmt(r.max), fmt(r.avg), fmt(r.med), fmt(r.p90)];
    cells.forEach((c, i) => { widths[i] = Math.max(widths[i], dispWidth(c)); });
  }
  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rowsOut) {
    const cells = [r.name, r.nonBlank, r.blank, r.distinct, fmt(r.min), fmt(r.max), fmt(r.avg), fmt(r.med), fmt(r.p90)];
    console.log(cells.map((c, i) => (i === 0 ? pad(c, widths[i]) : padLeft(c, widths[i]))).join('  '));
  }
  console.log('');
  const nonNumeric = rowsOut.filter((r) => !r.numeric).map((r) => r.name);
  if (nonNumeric.length) console.log(`非数值列（统计项不适用）: ${nonNumeric.join(' / ')}`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }

  const cmd = argv[0];
  if (cmd !== 'run' && cmd !== 'describe') { console.error(`未知子命令: ${cmd}\n\n${USAGE}`); process.exit(2); }
  const { opts, rest } = parseArgs(argv.slice(1));
  const file = rest[0];
  if (!file) { console.error('需要 CSV 文件\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }

  if (cmd === 'run') cmdRun(file, opts);
  else cmdDescribe(file, opts);
}

main();
