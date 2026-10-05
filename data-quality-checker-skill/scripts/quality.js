'use strict';

/**
 * 数据质量体检：空值率、唯一性、类型一致性、异常值、枚举合法性、重复行。
 *
 * 只报「能确定性判断」的问题，并区分：
 *   Q0xx = 通常真的是问题（重复行、非法日期、枚举越界）
 *   W1xx = 需要结合业务判断（常量列、高基数列、异常值）
 * 异常值用 IQR 法则判出，只提示不判定"错误"——业务上的大额订单完全可能是真的。
 *
 * 用法:
 *   node scripts/quality.js check <CSV> [--enum=列:值1|值2] [--null-rate=0.3] [--json]
 *   node scripts/quality.js --selftest
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

/** 只认带分隔符的日期：8 位纯数字与订单号无法区分，不猜。 */
function toDate(raw) {
  const s = String(raw).trim().replace(/[／/.]/g, '-').replace(/[年月]/g, '-').replace(/日/g, '');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const looksLikeDate = (raw) => {
  const s = String(raw).trim();
  return /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(s);
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx); const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦　-〿]/.test(ch) ? 2 : 1;
  return w;
}
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - dispWidth(String(s))));
const padLeft = (s, n) => ' '.repeat(Math.max(0, n - dispWidth(String(s)))) + String(s);

// ------------------------------------------------------------------ 体检

/** 推断一列的类型；mixed 表示数字与非数字混杂。 */
function inferType(values) {
  const filled = values.map((v) => String(v).trim()).filter((v) => v !== '');
  if (filled.length === 0) return 'empty';
  const nums = filled.filter((v) => toNumber(v) !== null);
  const dates = filled.filter((v) => toDate(v) !== null);
  const invalidDates = filled.filter((v) => looksLikeDate(v) && toDate(v) === null).length;
  // 全是日期形态但有几个非法时，仍按日期列标注并说明数量，
  // 否则一个 2026-02-30 会让整列降级成 string，反而看不出问题在哪
  if (dates.length === filled.length) return 'date';
  if (dates.length > 0 && dates.length + invalidDates === filled.length) return `date (${invalidDates} 个非法)`;
  if (nums.length === filled.length) return filled.every((v) => /^-?\d+$/.test(String(v).trim())) ? 'integer' : 'decimal';
  if (nums.length > 0) return 'mixed';
  return 'string';
}

/** IQR 法则找异常值：需要至少 4 个数据点才有统计意义。 */
function outliers(sorted) {
  if (sorted.length < 4) return [];
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  if (iqr === 0) return []; // 四分位距为 0 说明极度集中，不判异常
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return sorted.filter((v) => v < lo || v > hi);
}

/**
 * @returns {{ columns, issues, duplicateRows, rowCount }}
 */
function checkQuality(table, opts) {
  const { header, rows } = table;
  const rowCount = rows.length;
  const issues = [];

  // 重复行（整行内容完全相同）
  const seen = new Map();
  rows.forEach((row, i) => {
    const key = row.join('\u0001');
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(i + 2);
  });
  const duplicateRows = [...seen.values()].filter((lines) => lines.length > 1);

  const columns = [];
  for (let c = 0; c < header.length; c++) {
    const rawValues = rows.map((r) => (r[c] === undefined ? '' : String(r[c])));
    const trimmed = rawValues.map((v) => v.trim());
    const nonBlank = trimmed.filter((v) => v !== '');
    const blankCount = rowCount - nonBlank.length;
    const nullRate = rowCount ? blankCount / rowCount : 0;
    const unique = new Set(nonBlank).size;
    const type = inferType(rawValues);
    const samples = [...new Set(nonBlank)].slice(0, 3);
    const hasPadding = rawValues.some((v) => v !== '' && v !== v.trim());

    // 只要能解析出足够多的数值就找异常值：mixed 列里的大额离群同样值得提示
    const nums = nonBlank.map(toNumber).filter((v) => v !== null).sort((a, b) => a - b);
    const outCount = nums.length >= 4 ? outliers(nums) : [];

    const col = {
      index: c + 1, name: header[c] || `列${c + 1}`, type,
      nonBlank: nonBlank.length, blankCount, nullRate, unique,
      samples, hasPadding,
      min: nums.length ? nums[0] : null,
      max: nums.length ? nums[nums.length - 1] : null,
      avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
      outliers: outCount.length,
      invalidDates: rawValues.filter((v) => looksLikeDate(v) && toDate(v) === null).length,
    };
    columns.push(col);

    // ---- 规则
    if (blankCount === rowCount && rowCount > 0) {
      issues.push({ level: 'E', code: 'Q002', col: col.name, msg: `整列为空（${rowCount} 行全空）` });
    } else if (nullRate > opts.nullRate) {
      issues.push({ level: 'E', code: 'Q001', col: col.name, msg: `空值率 ${(nullRate * 100).toFixed(1)}%，超过阈值 ${(opts.nullRate * 100).toFixed(0)}%` });
    }
    if (type === 'mixed') {
      issues.push({ level: 'E', code: 'Q008', col: col.name, msg: '数字与非数字混杂，类型不一致' });
    }
    if (col.invalidDates > 0) {
      issues.push({ level: 'E', code: 'Q007', col: col.name, msg: `${col.invalidDates} 个形似日期但无法解析（如 2026-02-30）` });
    }
    if (hasPadding) {
      issues.push({ level: 'E', code: 'Q006', col: col.name, msg: '存在首尾空格' });
    }
    if (unique === 1 && nonBlank.length > 1) {
      issues.push({ level: 'W', code: 'W101', col: col.name, msg: `只有一个取值「${samples[0]}」，该列可能没有信息量` });
    }
    if (unique === nonBlank.length && nonBlank.length > 1 && (type === 'integer' || type === 'string')) {
      issues.push({ level: 'W', code: 'W102', col: col.name, msg: `每个值都唯一（${unique}/${nonBlank.length}），疑似主键或编号` });
    }
    if (outCount.length > 0) {
      issues.push({ level: 'W', code: 'W104', col: col.name, msg: `${outCount.length} 个统计异常值（IQR 法则）：${outCount.slice(0, 3).join('、')}${outCount.length > 3 ? '…' : ''}` });
    }
    // 枚举合法性
    const allowed = opts.enums[col.name];
    if (allowed) {
      const bad = [...new Set(nonBlank.filter((v) => !allowed.includes(v)))];
      if (bad.length) {
        issues.push({ level: 'E', code: 'Q005', col: col.name, msg: `${bad.length} 个取值不在允许集合内：${bad.slice(0, 5).join('、')}` });
      }
    }
  }

  if (duplicateRows.length) {
    issues.push({
      level: 'E', code: 'Q003', col: '（整行）',
      msg: `${duplicateRows.length} 组完全重复的行：${duplicateRows.slice(0, 3).map((l) => `第 ${l.join('、')} 行`).join('；')}`,
    });
  }

  return { columns, issues, duplicateRows, rowCount };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const mk = (header, rows) => ({ header, rows });
  const opts = { nullRate: 0.3, enums: {} };
  const codes = (r, level) => r.issues.filter((i) => i.level === level).map((i) => `${i.code}:${i.col}`).sort();

  console.log('类型推断');
  check('整数列', inferType(['1', '2', '3']), 'integer');
  check('小数列', inferType(['1.5', '2']), 'decimal');
  check('日期列', inferType(['2026-01-01', '2026-01-02']), 'date');
  check('字符串列', inferType(['上海', '北京']), 'string');
  check('混杂列', inferType(['1', 'abc']), 'mixed');
  check('空列', inferType(['', '']), 'empty');
  check('空值不影响判断', inferType(['1', '', '3']), 'integer');

  console.log('异常值（IQR）');
  check('明显离群', outliers([1, 2, 3, 4, 5, 100]).length, 1);
  check('无离群', outliers([1, 2, 3, 4, 5, 6]).length, 0);
  check('数据点不足不判', outliers([1, 100]).length, 0);

  console.log('重复行');
  let r = checkQuality(mk(['a', 'b'], [['1', 'x'], ['1', 'x']]), opts);
  check('检出重复行', r.duplicateRows.length, 1);
  check('对应规则码', codes(r, 'E').includes('Q003:（整行）'), true);

  console.log('空值率');
  r = checkQuality(mk(['a'], [['1'], [''], [''], ['']]), opts);
  check('超阈值报错', codes(r, 'E').some((c) => c.startsWith('Q001')), true);
  r = checkQuality(mk(['a'], [['1'], ['2'], ['3'], ['']]), opts);
  check('未超阈值不报', codes(r, 'E').some((c) => c.startsWith('Q001')), false);

  console.log('整列为空');
  r = checkQuality(mk(['a', 'b'], [['1', ''], ['2', '']]), opts);
  check('Q002', codes(r, 'E').some((c) => c.startsWith('Q002:b')), true);

  console.log('类型不一致');
  r = checkQuality(mk(['a'], [['1'], ['abc']]), opts);
  check('Q008', codes(r, 'E').some((c) => c.startsWith('Q008')), true);

  console.log('非法日期');
  r = checkQuality(mk(['d'], [['2026-01-01'], ['2026-02-30']]), opts);
  check('Q007', codes(r, 'E').some((c) => c.startsWith('Q007')), true);

  console.log('首尾空格');
  r = checkQuality(mk(['a'], [[' 1 '], ['2']]), opts);
  check('Q006', codes(r, 'E').some((c) => c.startsWith('Q006')), true);

  console.log('常量列与高基数列');
  r = checkQuality(mk(['a', 'b'], [['x', '1'], ['x', '2'], ['x', '3']]), opts);
  check('W101 常量列', codes(r, 'W').some((c) => c.startsWith('W101:a')), true);
  check('W102 高基数列', codes(r, 'W').some((c) => c.startsWith('W102:b')), true);

  console.log('枚举合法性');
  const enumOpts = { nullRate: 0.3, enums: { 状态: ['已完成', '待付款'] } };
  r = checkQuality(mk(['状态'], [['已完成'], ['待付款']]), enumOpts);
  check('合法值无问题', codes(r, 'E'), []);
  r = checkQuality(mk(['状态'], [['已完成'], ['已取消']]), enumOpts);
  check('越界值报错', codes(r, 'E').some((c) => c.startsWith('Q005')), true);

  console.log('干净数据');
  r = checkQuality(mk(['部门', '金额'], [['销售部', '1000'], ['技术部', '2000'], ['市场部', '1500']]), opts);
  check('无 E 级问题', codes(r, 'E'), []);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `数据质量体检：空值率、唯一性、类型一致性、异常值、枚举合法性、重复行

用法:
  node scripts/quality.js check <CSV> [--enum=列:值1|值2] [--null-rate=0.3] [--json]
  node scripts/quality.js --selftest

选项:
  --enum=列:值1|值2   枚举列的合法取值，可重复指定多个列
  --null-rate=0.3     空值率告警阈值，默认 30%
  --delimiter=,       强制分隔符
  --json              输出 JSON

规则:
  Q002 整列为空      Q003 完全重复的行   Q005 枚举取值越界
  Q006 首尾有空格    Q007 形似日期但非法  Q008 类型不一致
  Q001 空值率超阈值
  W101 常量列  W102 高基数列（疑似主键）  W104 统计异常值（IQR 法则）

说明:
  Q0xx 通常真的是问题；W1xx 需要结合业务判断——
  统计异常值可能完全合理（比如一笔真实的大额订单）。

退出码: 0 = 无 Q 级问题，1 = 存在 Q 级问题，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { nullRate: 0.3, enums: {}, json: false, delimiter: null };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--null-rate=')) opts.nullRate = Number(arg.slice(12));
    else if (arg.startsWith('--delimiter=')) opts.delimiter = arg.slice(12);
    else if (arg.startsWith('--enum=')) {
      const spec = arg.slice(7);
      const i = spec.indexOf(':');
      if (i < 0) { console.error(`--enum 格式应为「列:值1|值2」，收到「${spec}」`); process.exit(2); }
      opts.enums[spec.slice(0, i).trim()] = spec.slice(i + 1).split('|').map((s) => s.trim());
    } else rest.push(arg);
  }
  return { opts, rest };
}

function load(file, delimiter) {
  const text = decode(fs.readFileSync(file));
  const delim = delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delim);
  if (rows.length < 1) return { header: [], rows: [] };
  return { header: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
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

  const table = load(file, opts.delimiter);
  if (table.rows.length === 0) { console.error('没有数据行'); process.exit(2); }
  const r = checkQuality(table, opts);

  if (opts.json) {
    console.log(JSON.stringify({
      file, rowCount: r.rowCount, columnCount: table.header.length,
      columns: r.columns, issues: r.issues,
      duplicateGroups: r.duplicateRows.length,
    }, null, 2));
    process.exit(r.issues.some((i) => i.level === 'E') ? 1 : 0);
  }

  console.log(`文件: ${file}　${r.rowCount} 行 × ${table.header.length} 列`);
  console.log('');

  const headers = ['列', '类型', '非空', '空值率', '唯一值', '最小', '最大', '均值', '示例'];
  const bodyRows = r.columns.map((c) => [
    c.name, c.type, String(c.nonBlank), `${(c.nullRate * 100).toFixed(0)}%`, String(c.unique),
    c.min === null ? '—' : String(c.min), c.max === null ? '—' : String(c.max),
    c.avg === null ? '—' : c.avg.toFixed(2),
    c.samples.slice(0, 2).join('/') || '—',
  ]);
  const widths = headers.map((h) => dispWidth(h));
  for (const row of bodyRows) row.forEach((c, i) => { widths[i] = Math.max(widths[i], dispWidth(c)); });
  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of bodyRows) {
    console.log(row.map((c, i) => (i === 0 || i === 1 ? pad(c, widths[i]) : padLeft(c, widths[i]))).join('  '));
  }
  console.log('');

  const errs = r.issues.filter((i) => i.level === 'E');
  const warns = r.issues.filter((i) => i.level === 'W');
  console.log(`问题：Q 级 ${errs.length} / W 级 ${warns.length}`);
  console.log('');

  if (errs.length) {
    console.log('--- Q 级（通常真的是问题）---');
    for (const i of errs) console.log(`  ✗ ${i.code} ${i.col}：${i.msg}`);
    console.log('');
  }
  if (warns.length) {
    console.log('--- W 级（需结合业务判断）---');
    for (const i of warns) console.log(`  ⚠ ${i.code} ${i.col}：${i.msg}`);
    console.log('');
  }
  if (!r.issues.length) console.log('未发现问题。');
  else console.log('说明：W1xx 只是提示，不意味着数据有错——异常值、常量列在很多场景下是合理的。');

  if (errs.length) process.exit(1);
}

main();
