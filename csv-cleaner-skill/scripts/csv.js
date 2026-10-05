#!/usr/bin/env node
// CSV 清洗：编码检测、分隔符嗅探、去空行、类型归一化、日期标准化。
//
// 用法：
//   node scripts/csv.js inspect <文件> [--json]
//   node scripts/csv.js clean <文件> [-o 输出] [选项]
//   node scripts/csv.js --selftest
//
// 依赖仅为 Node 内置（fs / TextDecoder），不联网、不上传。

'use strict';

const fs = require('fs');
const path = require('path');

const DELIMITER_NAMES = { ',': '逗号', '\t': '制表符', ';': '分号', '|': '竖线' };

// ---------------------------------------------------------------- 编码与读取

/**
 * 检测编码并解码。
 * 顺序：BOM → 严格 UTF-8 → GB18030（中文 CSV 最常见的两种来源）。
 */
function decodeBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf-8 (BOM)', text: buf.toString('utf8').replace(/^﻿/, '') };
  }
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
  } catch (err) {
    // 不是合法 UTF-8，继续尝试中文编码
  }
  try {
    return { encoding: 'gb18030（推测，已转码为 UTF-8）', text: new TextDecoder('gb18030').decode(buf) };
  } catch (err) {
    return { encoding: '未知（按 UTF-8 宽松解码，可能含乱码）', text: buf.toString('utf8') };
  }
}

function readCsv(file) {
  const buf = fs.readFileSync(file);
  const decoded = decodeBuffer(buf);
  return { ...decoded, text: decoded.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') };
}

// ---------------------------------------------------------------- CSV 解析

/**
 * 按 RFC 4180 解析：支持引号包裹、"" 转义、字段内换行。
 * @returns {string[][]}
 */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = values[0];
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** 嗅探分隔符：取「列数最多且各行列数最一致」的那个。 */
function sniffDelimiter(text) {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -1;

  for (const delimiter of candidates) {
    const rows = parseCsv(text, delimiter).filter((r) => r.some((cell) => cell.trim() !== ''));
    if (rows.length === 0) continue;
    const counts = rows.map((r) => r.length);
    const modal = mode(counts);
    const consistency = counts.filter((c) => c === modal).length / counts.length;
    // 列数太少的候选（比如正文里恰好没有逗号）不该赢
    const score = modal > 1 ? modal * consistency : consistency * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 值归一化

function toHalfWidth(input) {
  return input
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/** 把「1,234.56」「¥1,234.56」「(1,234.56)」这类写法归一成纯数字字符串。 */
function normalizeNumber(raw) {
  let s = String(raw).trim();
  if (s === '') return null;

  let negative = false;
  // 财务写法：括号表示负数
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  s = toHalfWidth(s);
  s = s.replace(/^[¥￥$]\s*/, '');
  s = s.replace(/[,，\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.endsWith('%')) return null; // 百分比不擅自转小数

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  // 不动小数位：金额场景里 500.00 与 500 含义不同，擅自去掉尾随零会造成误解
  return (negative ? '-' : '') + s;
}

// 带分隔符的写法无歧义，始终识别
const DATE_PATTERN = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/;
// 20260101 这种紧凑写法与 8 位编号（订单号、流水号）无法区分，默认不识别，
// 只有用户显式加 --compact-dates 才启用，否则会把编号列洗成日期
const COMPACT_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * 把常见日期写法归一成 YYYY-MM-DD；无法确认时返回 null，绝不猜。
 * @param {string} raw 原始值
 * @param {boolean} allowCompact 是否把 8 位纯数字当作日期
 */
function normalizeDate(raw, allowCompact) {
  const s = toHalfWidth(String(raw).trim());
  const patterns = allowCompact ? [DATE_PATTERN, COMPACT_DATE_PATTERN] : [DATE_PATTERN];
  for (const pattern of patterns) {
    const m = pattern.exec(s);
    if (!m) continue;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // 校验该月是否真有这一天（含闰年）
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
      return null;
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/** 长得像日期但校验不过（如 2026-02-30）——这是真正的数据错误，要单独点出来。 */
function looksLikeDate(raw) {
  return DATE_PATTERN.test(toHalfWidth(String(raw).trim()));
}

/**
 * 列类型推断。先看原始形态，再看归一化后能变成什么，
 * 这样「1,234.56」会被判成「可归一为数字」而不是笼统的 string。
 * @returns {{ type: string, invalidDates: number }}
 */
function inferColumnType(values) {
  const filled = values.filter((v) => String(v).trim() !== '');
  if (filled.length === 0) return { type: 'empty', invalidDates: 0 };

  const numOk = filled.filter((v) => normalizeNumber(v) !== null).length;
  const dateOk = filled.filter((v) => normalizeDate(v) !== null).length;
  const invalidDates = filled.filter((v) => normalizeDate(v) === null && looksLikeDate(v)).length;

  let type;
  if (filled.every((v) => /^-?\d+$/.test(v))) type = 'integer';
  else if (filled.every((v) => /^-?\d+(\.\d+)?$/.test(v))) type = 'decimal';
  else if (dateOk === filled.length) type = 'date (可归一)';
  else if (numOk === filled.length) type = 'number (可归一)';
  else if (dateOk > 0 && dateOk + invalidDates === filled.length) type = `date (${invalidDates} 个非法)`;
  else type = 'string';

  return { type, invalidDates };
}

// ---------------------------------------------------------------- 体检

function inspect(file, opts) {
  const { encoding, text } = readCsv(file);
  const delimiter = opts.delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delimiter);

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  const emptyRows = rows.length - nonEmpty.length;

  const counts = nonEmpty.map((r) => r.length);
  const columnCount = counts.length > 0 ? mode(counts) : 0;
  const raggedRows = [];
  nonEmpty.forEach((r) => {
    if (r.length !== columnCount) raggedRows.push(r.length);
  });

  const looksHeader =
    nonEmpty.length > 1 &&
    nonEmpty[0].every((cell) => cell.trim() !== '' && !/^-?[\d.,]+$/.test(cell.trim()));

  const dataRows = looksHeader ? nonEmpty.slice(1) : nonEmpty;
  const header = looksHeader ? nonEmpty[0] : null;

  const columns = [];
  for (let c = 0; c < columnCount; c++) {
    const values = dataRows.map((r) => (r[c] === undefined ? '' : r[c]));
    const blanks = values.filter((v) => String(v).trim() === '').length;
    const samples = Array.from(new Set(values.filter((v) => String(v).trim() !== '').slice(0, 3)));
    const typeInfo = inferColumnType(values);
    columns.push({
      index: c + 1,
      name: header ? header[c] : `列${c + 1}`,
      type: typeInfo.type,
      invalidDates: typeInfo.invalidDates,
      blankCount: blanks,
      uniqueCount: new Set(values).size,
      samples,
    });
  }

  const seen = new Set();
  let duplicateRows = 0;
  for (const r of dataRows) {
    const key = r.join('\u0001');
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }

  // 全角字符与首尾空白
  let fullWidthCells = 0;
  let paddedCells = 0;
  for (const r of dataRows) {
    for (const cell of r) {
      if (/[！-～　]/.test(cell)) fullWidthCells++;
      if (cell !== cell.trim()) paddedCells++;
    }
  }

  return {
    file,
    encoding,
    delimiter,
    delimiterName: DELIMITER_NAMES[delimiter] || delimiter,
    hasHeader: looksHeader,
    totalRows: rows.length,
    emptyRows,
    dataRows: dataRows.length,
    columnCount,
    raggedRowCount: raggedRows.length,
    duplicateRows,
    fullWidthCells,
    paddedCells,
    columns,
  };
}

// ---------------------------------------------------------------- 清洗

function escapeCsvField(value, delimiter) {
  const s = String(value === null || value === undefined ? '' : value);
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function serializeCsv(rows, delimiter) {
  return rows.map((r) => r.map((cell) => escapeCsvField(cell, delimiter)).join(delimiter)).join('\n') + '\n';
}

function clean(file, opts) {
  const { encoding, text } = readCsv(file);
  const delimiter = opts.delimiter || sniffDelimiter(text);
  let rows = parseCsv(text, delimiter);

  const report = {
    file,
    sourceEncoding: encoding,
    delimiter: DELIMITER_NAMES[delimiter] || delimiter,
    removedEmptyRows: 0,
    trimmedCells: 0,
    normalizedNumbers: 0,
    normalizedDates: 0,
    halfWidthCells: 0,
    raggedRows: [],
  };

  // 1. 去空行
  const before = rows.length;
  rows = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  report.removedEmptyRows = before - rows.length;

  const counts = rows.map((r) => r.length);
  const columnCount = counts.length > 0 ? mode(counts) : 0;
  rows.forEach((r, i) => {
    if (r.length !== columnCount) report.raggedRows.push(i + 1);
  });

  // 2. 首行是否为表头（是则原样保留，不做归一化）
  const looksHeader =
    rows.length > 1 &&
    rows[0].every((cell) => cell.trim() !== '' && !/^-?[\d.,]+$/.test(cell.trim()));
  const startIndex = looksHeader ? 1 : 0;

  // 3. 逐单元格清洗
  rows = rows.map((row, rowIndex) =>
    row.map((cell) => {
      let out = cell;
      if (opts.trim && out !== out.trim()) {
        out = out.trim();
        report.trimmedCells++;
      }
      if (opts.fullwidth && /[！-～　]/.test(out)) {
        out = toHalfWidth(out);
        report.halfWidthCells++;
      }
      if (rowIndex >= startIndex) {
        if (opts.normalizeDates) {
          const date = normalizeDate(out, opts.compactDates);
          if (date !== null && date !== out) {
            out = date;
            report.normalizedDates++;
          }
        }
        if (opts.normalizeNumbers) {
          const num = normalizeNumber(out);
          if (num !== null && num !== out) {
            out = num;
            report.normalizedNumbers++;
          }
        }
      }
      return out;
    })
  );

  // 4. 补齐/截断列数，保证输出是规整的矩形
  rows = rows.map((r) => {
    if (r.length === columnCount) return r;
    const copy = r.slice(0, columnCount);
    while (copy.length < columnCount) copy.push('');
    return copy;
  });

  const out = serializeCsv(rows, delimiter);
  return { report, csv: out, rowCount: rows.length, columnCount };
}

// ---------------------------------------------------------------- 自测

function runSelftest() {
  let failed = 0;
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) console.log(`    实际: ${JSON.stringify(actual)}\n    期望: ${JSON.stringify(expected)}`);
  };

  // 解析：引号、转义、字段内换行
  check('引号内含分隔符', parseCsv('a,"b,c",d', ','), [['a', 'b,c', 'd']]);
  check('双引号转义', parseCsv('"a""b"', ','), [['a"b']]);
  check('字段内换行', parseCsv('"a\nb",c', ','), [['a\nb', 'c']]);

  // 分隔符嗅探
  check('嗅探分号', sniffDelimiter('a;b;c\n1;2;3'), ';');
  check('嗅探制表符', sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  check('引号内的逗号不干扰嗅探', sniffDelimiter('a;"b,c";d\n1;"x,y";2'), ';');

  // 数字归一化
  check('千分位', normalizeNumber('1,234.56'), '1234.56');
  check('货币符号', normalizeNumber('¥1,234.50'), '1234.50');
  check('括号负数', normalizeNumber('(1,234.56)'), '-1234.56');
  check('全角数字', normalizeNumber('１２３４'), '1234');
  check('百分比不动', normalizeNumber('12.5%'), null);
  check('非数字不动', normalizeNumber('abc'), null);

  // 日期归一化
  check('斜杠日期', normalizeDate('2026/3/5'), '2026-03-05');
  check('中文日期', normalizeDate('2026年3月5日'), '2026-03-05');
  check('非法日期不猜', normalizeDate('2026-02-30'), null);
  check('非日期不动', normalizeDate('合计'), null);
  // 8 位纯数字默认不认（可能是编号），显式开启才转
  check('紧凑日期默认不动', normalizeDate('20260305'), null);
  check('紧凑日期显式开启', normalizeDate('20260305', true), '2026-03-05');
  check('紧凑日期非法不猜', normalizeDate('20260230', true), null);

  // 序列化往返
  const rows = [['a', 'b,c'], ['1', 'say "hi"']];
  check('序列化后能还原', parseCsv(serializeCsv(rows, ','), ','), rows);

  // 列类型（先看原始形态，再看可归一成什么）
  check('整数列', inferColumnType(['1', '2', '']).type, 'integer');
  check('千分位列', inferColumnType(['1,234', '2']).type, 'number (可归一)');
  check('日期列', inferColumnType(['2026/1/1', '2026/1/2']).type, 'date (可归一)');
  check('8 位编号列不误判为日期', inferColumnType(['20260101', '20260102']).type, 'integer');
  check('含非法日期', inferColumnType(['2026/1/1', '2026-02-30']).type, 'date (1 个非法)');
  check('字符串列', inferColumnType(['上海', '北京']).type, 'string');

  console.log(`\n失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const opts = {
    json: false,
    selftest: false,
    delimiter: null,
    output: null,
    stdout: false,
    force: false,
    bom: false,
    trim: true,
    dropEmptyRows: true,
    normalizeNumbers: true,
    normalizeDates: true,
    compactDates: false,
    fullwidth: false,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--stdout') opts.stdout = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--bom') opts.bom = true;
    else if (arg === '--no-trim') opts.trim = false;
    else if (arg === '--no-normalize-numbers') opts.normalizeNumbers = false;
    else if (arg === '--no-normalize-dates') opts.normalizeDates = false;
    else if (arg === '--compact-dates') opts.compactDates = true;
    else if (arg === '--fullwidth') opts.fullwidth = true;
    else if (arg === '-o' || arg === '--output') opts.output = argv[++i];
    else if (arg.startsWith('--output=')) opts.output = arg.slice('--output='.length);
    else if (arg === '--delimiter') opts.delimiter = unescapeDelimiter(argv[++i]);
    else if (arg.startsWith('--delimiter=')) opts.delimiter = unescapeDelimiter(arg.slice('--delimiter='.length));
    else if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
    else opts.rest.push(arg);
  }
  return opts;
}

function unescapeDelimiter(raw) {
  if (raw === '\\t' || raw === 'tab') return '\t';
  return raw;
}

const USAGE = `用法:
  node scripts/csv.js inspect <文件> [--delimiter=,] [--json]
  node scripts/csv.js clean <文件> [-o 输出] [--stdout] [--delimiter=,] [--bom]
                     [--no-trim] [--no-normalize-numbers] [--no-normalize-dates]
                     [--compact-dates] [--fullwidth] [--force] [--json]
  node scripts/csv.js --selftest`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(2);
  }

  if (opts.selftest) process.exit(runSelftest());

  const [command, file] = opts.rest;
  if (!command || !file) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`错误: 文件不存在 ${file}`);
    process.exit(2);
  }

  if (command === 'inspect') {
    const result = inspect(file, opts);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`文件:        ${result.file}`);
    console.log(`编码:        ${result.encoding}`);
    console.log(`分隔符:      ${result.delimiterName}`);
    console.log(`表头:        ${result.hasHeader ? '有' : '无（首行即数据）'}`);
    console.log(`总行数:      ${result.totalRows}（空行 ${result.emptyRows}）`);
    console.log(`数据行:      ${result.dataRows}`);
    console.log(`列数:        ${result.columnCount}${result.raggedRowCount ? ` ⚠️ ${result.raggedRowCount} 行列数不一致` : ''}`);
    console.log(`重复行:      ${result.duplicateRows}`);
    console.log(`全角单元格:  ${result.fullWidthCells}`);
    console.log(`首尾空白:    ${result.paddedCells}`);
    console.log('\n各列：');
    for (const col of result.columns) {
      const sample = col.samples.length ? `　例：${col.samples.join(' / ')}` : '';
      const warn = col.invalidDates ? ` ⚠️ ${col.invalidDates} 个非法日期` : '';
      console.log(
        `  ${String(col.index).padStart(2)}. ${col.name.padEnd(12)} ${col.type.padEnd(18)} 空 ${col.blankCount}　唯一 ${col.uniqueCount}${warn}${sample}`
      );
    }
    return;
  }

  if (command === 'clean') {
    const { report, csv, rowCount, columnCount } = clean(file, opts);
    let target = opts.output;
    if (!opts.stdout && !target) {
      const ext = path.extname(file);
      target = path.join(path.dirname(file), `${path.basename(file, ext)}.cleaned${ext || '.csv'}`);
    }

    if (!opts.stdout) {
      if (fs.existsSync(target) && !opts.force) {
        console.error(`错误: 输出文件已存在 ${target}（加 --force 覆盖，或用 -o 另存）`);
        process.exit(2);
      }
      // --bom 便于 Excel 直接双击打开；默认不加，避免影响其他工具
      fs.writeFileSync(target, (opts.bom ? '﻿' : '') + csv, 'utf8');
    }

    if (opts.json) {
      console.log(JSON.stringify({ ...report, output: opts.stdout ? null : target, rowCount, columnCount }, null, 2));
    } else {
      console.log(`编码:        ${report.sourceEncoding}`);
      console.log(`分隔符:      ${report.delimiter}`);
      console.log(`去空行:      ${report.removedEmptyRows}`);
      console.log(`去首尾空白:  ${report.trimmedCells} 个单元格`);
      console.log(`数字归一化:  ${report.normalizedNumbers} 个单元格`);
      console.log(`日期标准化:  ${report.normalizedDates} 个单元格`);
      if (opts.fullwidth) console.log(`全角转半角:  ${report.halfWidthCells} 个单元格`);
      if (report.raggedRows.length) {
        console.log(`⚠️ 列数不一致的行已补齐/截断: ${report.raggedRows.slice(0, 10).join(', ')}${report.raggedRows.length > 10 ? ' …' : ''}`);
      }
      console.log(`结果:        ${rowCount} 行 × ${columnCount} 列`);
      console.log(opts.stdout ? '' : `已写入:      ${target}`);
    }
    if (opts.stdout) process.stdout.write(csv);
    return;
  }

  console.error(`错误: 未知子命令 ${command}\n${USAGE}`);
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = { parseCsv, serializeCsv, sniffDelimiter, normalizeNumber, normalizeDate, inferColumnType, decodeBuffer };
