'use strict';

/**
 * 从 CSV / TSV 生成对齐的 Markdown 表格。
 *
 * 两件必须做对的事：
 *   1. 单元格里的 `|` 要转义成 `\|`，否则表格会被截断
 *   2. 对齐用「显示宽度」算，中文字符按 2 个字符宽，
 *      否则在等宽字体下中文列会参差不齐
 *
 * 用法:
 *   node scripts/mdtable.js build <CSV> [--align=auto] [--delimiter=,] [--no-header] [-o 文件]
 *   node scripts/mdtable.js --selftest
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
  const counts = [',', '\t', ';', '|'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** 显示宽度：中日韩全角字符按 2 计。 */
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    const wide = (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

/** 单元格里的管道符必须转义，否则会截断表格。 */
function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function isNumericish(s) {
  const t = String(s).trim().replace(/[，,]/g, '');
  if (t === '') return false;
  return /^-?\d+(\.\d+)?$/.test(t) || /^-?[¥￥$]\d+(\.\d+)?$/.test(t) || /^-?\d+(\.\d+)?%$/.test(t);
}

// ------------------------------------------------------------------ 生成

/**
 * @returns {string} Markdown 表格
 */
function buildTable(rows, opts) {
  if (!rows.length) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => {
    const cells = [];
    for (let i = 0; i < colCount; i++) cells.push(escapeCell(r[i] === undefined ? '' : r[i]));
    return cells;
  });

  // 每列的对齐方向
  const aligns = [];
  for (let c = 0; c < colCount; c++) {
    if (opts.align === 'left') aligns.push('left');
    else if (opts.align === 'right') aligns.push('right');
    else if (opts.align === 'center') aligns.push('center');
    else {
      // auto：该列（除表头外）全是数字则右对齐
      const body = opts.hasHeader ? grid.slice(1) : grid;
      const filled = body.map((r) => r[c]).filter((v) => String(v).trim() !== '');
      aligns.push(filled.length && filled.every(isNumericish) ? 'right' : 'left');
    }
  }

  // 每列宽度：分隔符至少要 3 个字符宽
  const widths = [];
  for (let c = 0; c < colCount; c++) {
    let w = 3;
    for (const row of grid) w = Math.max(w, dispWidth(row[c]));
    widths.push(w);
  }

  const pad = (text, width, align) => {
    const fill = width - dispWidth(text);
    if (fill <= 0) return text;
    if (align === 'right') return ' '.repeat(fill) + text;
    if (align === 'center') {
      const l = Math.floor(fill / 2);
      return ' '.repeat(l) + text + ' '.repeat(fill - l);
    }
    return text + ' '.repeat(fill);
  };

  const line = (cells) => `| ${cells.map((c, i) => pad(c, widths[i], aligns[i])).join(' | ')} |`;
  const sep = () => `| ${aligns.map((a, i) => {
    if (a === 'right') return `${'-'.repeat(widths[i] - 1)}:`;
    if (a === 'center') return `:${'-'.repeat(widths[i] - 2)}:`;
    return '-'.repeat(widths[i]);
  }).join(' | ')} |`;

  const out = [];
  if (opts.hasHeader) {
    out.push(line(grid[0]));
    out.push(sep());
    for (const row of grid.slice(1)) out.push(line(row));
  } else {
    // 无表头时先补一行占位表头，Markdown 表格必须有表头行
    out.push(line(grid.map ? Array(colCount).fill('') : grid[0]));
    out.push(sep());
    for (const row of grid) out.push(line(row));
  }
  return out.join('\n');
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  console.log('显示宽度');
  check('中文按 2 计', dispWidth('部门'), 4);
  check('英文按 1 计', dispWidth('abc'), 3);
  check('混排', dispWidth('a部'), 3);

  console.log('转义');
  check('管道符转义', escapeCell('a|b'), 'a\\|b');
  check('换行转 <br>', escapeCell('a\nb'), 'a<br>b');

  console.log('数字识别');
  check('整数', isNumericish('123'), true);
  check('小数', isNumericish('1.5'), true);
  check('千分位', isNumericish('1,234'), true);
  check('货币', isNumericish('¥120'), true);
  check('百分比', isNumericish('12.5%'), true);
  check('文本', isNumericish('销售部'), false);
  check('空', isNumericish(''), false);

  console.log('生成表格');
  const rows = [['姓名', '部门', '金额'], ['张三', '销售部', '1200'], ['李四', '技术部', '3000']];
  const t = buildTable(rows, { align: 'auto', hasHeader: true });
  const lines = t.split('\n');
  check('行数（表头+分隔+2 行数据）', lines.length, 4);
  check('表头行', lines[0].startsWith('| 姓名'), true);
  check('分隔符行含右对齐标记', lines[1].includes('---:'), true);
  check('中文列已对齐', dispWidth(lines[0]) === dispWidth(lines[2]), true);

  console.log('对齐方式');
  check('全左对齐', buildTable(rows, { align: 'left', hasHeader: true }).split('\n')[1].includes('---:'), false);
  check('全右对齐', (buildTable(rows, { align: 'right', hasHeader: true }).split('\n')[1].match(/---:/g) || []).length, 3);

  console.log('无表头');
  const noHeader = buildTable([['a', '1'], ['b', '2']], { align: 'auto', hasHeader: false });
  check('补了空表头行', noHeader.split('\n')[0].includes('|'), true);
  check('共 4 行', noHeader.split('\n').length, 4);

  console.log('管道符转义进表格');
  const withPipe = buildTable([['表达式', '结果'], ['a|b', 'true']], { align: 'left', hasHeader: true });
  check('已转义', withPipe.includes('a\\|b'), true);

  console.log('列数不齐');
  check('短行补空', buildTable([['a', 'b', 'c'], ['1']], { align: 'left', hasHeader: true }).split('\n')[2].includes('|'), true);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `从 CSV / TSV 生成对齐的 Markdown 表格

用法:
  node scripts/mdtable.js build <CSV> [选项]
  node scripts/mdtable.js --selftest

选项:
  --align=auto     对齐方式：auto（数字列右对齐，默认）/ left / right / center
  --delimiter=,    强制分隔符（默认自动嗅探，支持 CSV 与 TSV）
  --no-header      首行也是数据，不把它当表头（会自动补一行空表头）
  -o <文件>        写到文件；不填则输出到 stdout
  --json           输出 JSON（含表格文本）

说明:
  - 单元格里的 | 会转义成 \\|，避免截断表格
  - 对齐按显示宽度计算，中文按 2 个字符宽，等宽字体下才能对齐

退出码: 0 = 正常，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { align: 'auto', delimiter: null, hasHeader: true, out: null, json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--no-header') opts.hasHeader = false;
    else if (arg.startsWith('--align=')) opts.align = arg.slice(8);
    else if (arg.startsWith('--delimiter=')) opts.delimiter = arg.slice(12);
    else if (arg === '-o') opts.out = null;
    else if (arg.startsWith('-o=')) opts.out = arg.slice(3);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'build') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const file = rest[0];
  if (!file) { console.error('需要 CSV 文件\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }

  const text = decode(fs.readFileSync(file));
  const delim = opts.delimiter || sniffDelimiter(text);
  const rows = parseCsv(text, delim);
  if (!rows.length) { console.error('文件里没有内容'); process.exit(2); }

  const table = buildTable(rows, opts);

  if (opts.json) {
    console.log(JSON.stringify({ file, delimiter: delim, rowCount: rows.length, table }, null, 2));
    return;
  }
  if (opts.out) {
    fs.writeFileSync(opts.out, table + '\n');
    console.error(`已写出: ${opts.out}（${rows.length} 行）`);
    return;
  }
  console.log(table);
}

main();
