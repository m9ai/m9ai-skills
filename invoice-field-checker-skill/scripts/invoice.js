'use strict';

/**
 * 发票要素校验。
 *
 * 只做「能确定性判断」的部分：格式、勾稽、日期、税号校验位、重复票。
 * 不做、也做不到的：发票真伪查验（需联网税局）、发票号码校验位
 * （中国大陆增值税发票的发票代码与号码是流水编号，没有公开的校验位算法，
 * 任何声称能算校验位的说法都是编的）。
 *
 * 用法:
 *   node scripts/invoice.js check <CSV> [--tolerate=0.02] [--json]
 *   node scripts/invoice.js one --amount=1000 --tax=130 --total=1130 [--rate=0.13]
 *                                [--code=] [--no=] [--date=] [--taxno=] [--json]
 *   node scripts/invoice.js --selftest
 */

const fs = require('fs');

// ---------------------------------------------------------------- 基础工具

/** 解码：优先 UTF-8，带 BOM 时说明；UTF-8 失效则退回 GBK。 */
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.toString('utf8', 3), encoding: 'UTF-8 (BOM)' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(buf), encoding: 'GBK' };
    } catch {
      return { text: buf.toString('utf8'), encoding: 'UTF-8 (含无效字节)' };
    }
  }
}

/** RFC4180 解析：支持引号包裹、转义引号、内嵌换行。 */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
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

/** 嗅探分隔符：取首行出现次数最多的候选。 */
function sniffDelimiter(text) {
  const firstLine = text.split('\n')[0];
  const counts = [',', ';', '\t', '|'].map((d) => [d, (firstLine.split(d).length - 1)]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** 转成数字：去千分位、货币符号、全角；失败返回 null。 */
function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[，,]/g, '').replace(/^[¥￥$]/, '').replace(/[（(]/, '-').replace(/[）)]/g, '');
  if (s === '' || s === '-') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 税率归一化：13% / 0.13 / 13 都转成 0.13。 */
function toRate(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const s = String(raw).trim().replace(/[％%]/g, '');
  const n = toNumber(s);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}

/** 日期归一成 YYYY-MM-DD；不合法返回 null。 */
function toDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/[／/.]/g, '-').replace(/[年月]/g, '-').replace(/日/g, '');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const money = (n) => (n === null ? '—' : n.toFixed(2));

// ------------------------------------------------- 统一社会信用代码 GB 32100

const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'; // 去掉 I O S V Z
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

/** 校验 18 位统一社会信用代码的校验位。返回 'ok' | 'bad' | 'na'。 */
function checkUscc(raw) {
  if (!raw) return 'na';
  const s = String(raw).trim().toUpperCase();
  if (s === '') return 'na';
  if (s.length !== 18) return 'na'; // 不是 18 位就不按 USCC 处理（可能是 15 位老税号）
  if (!/^[0-9A-HJ-NP-RT-Y]{18}$/.test(s)) return 'bad';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += USCC_CHARS.indexOf(s[i]) * USCC_WEIGHTS[i];
  const expect = USCC_CHARS[31 - (sum % 31) === 31 ? 0 : 31 - (sum % 31)];
  return s[17] === expect ? 'ok' : 'bad';
}

/** 15 位老税号（地区码 6 位 + 9 位数字）只做结构判断；它没有公开校验位算法。 */
function checkOldTaxNo(raw) {
  if (!raw) return 'na';
  const s = String(raw).trim();
  if (s.length !== 15) return 'na';
  return /^\d{15}$/.test(s) ? 'ok' : 'bad';
}

// ------------------------------------------------------------------ 校验规则

/** 中国大陆增值税常见税率/征收率（含已停用的历史档，仅供判断合理性）。 */
const KNOWN_RATES = [0, 0.01, 0.015, 0.03, 0.05, 0.06, 0.09, 0.1, 0.11, 0.13, 0.16, 0.17];

function near(a, b, tol) {
  return Math.abs(a - b) <= tol + 1e-9;
}

/**
 * 校验一张票。
 * @returns {{ errors: Array, warnings: Array }}
 */
function validateInvoice(inv, opts) {
  const errors = [];
  const warnings = [];
  const tol = opts.tolerate;

  const code = inv.code === undefined ? '' : String(inv.code).trim();
  const no = inv.no === undefined ? '' : String(inv.no).trim();

  // 发票代码：只能是 10 位或 12 位数字
  if (code !== '' && !/^\d{10}$|^\d{12}$/.test(code)) {
    errors.push(`E101 发票代码格式不对：「${code}」应为 10 位或 12 位数字`);
  }
  // 发票号码：只能是 8 位数字
  if (no !== '' && !/^\d{8}$/.test(no)) {
    errors.push(`E102 发票号码格式不对：「${no}」应为 8 位数字`);
  }

  // 未提供的字段统一成 null：undefined !== null 为真，会让下面的判断误进分支
  const amount = inv.amount === undefined ? null : inv.amount;
  const tax = inv.tax === undefined ? null : inv.tax;
  const total = inv.total === undefined ? null : inv.total;
  let rate = inv.rate === undefined ? null : inv.rate;

  // 税率：给了就检查合理性；没给但能算出来就反推
  if (rate === null && amount !== null && tax !== null && amount !== 0) {
    const implied = tax / amount;
    rate = Math.abs(implied) < 1 ? implied : null;
  }
  if (rate !== null) {
    const hit = KNOWN_RATES.some((r) => near(rate, r, 0.0001));
    if (!hit) {
      errors.push(
        `E105 税率 ${(rate * 100).toFixed(2)}% 不在常见税率内（${KNOWN_RATES.map((r) => `${(r * 100).toFixed(0)}%`).join('/')}）`
      );
    }
    // 金额 × 税率 ≈ 税额
    if (amount !== null && tax !== null) {
      const expectTax = Math.round(amount * rate * 100) / 100;
      if (!near(expectTax, tax, tol)) {
        errors.push(
          `E103 金额与税额不符：${money(amount)} × ${(rate * 100).toFixed(0)}% = ${money(expectTax)}，实际税额 ${money(tax)}（差 ${money(tax - expectTax)}）`
        );
      }
    }
  }

  // 价税合计 = 金额 + 税额
  if (amount !== null && tax !== null && total !== null) {
    const expectTotal = Math.round((amount + tax) * 100) / 100;
    if (!near(expectTotal, total, 0.01)) {
      errors.push(
        `E104 价税合计不符：${money(amount)} + ${money(tax)} = ${money(expectTotal)}，实际 ${money(total)}（差 ${money(total - expectTotal)}）`
      );
    }
  }

  // 开票日期
  const date = inv.dateRaw === undefined || inv.dateRaw === null || inv.dateRaw === '' ? null : toDate(inv.dateRaw);
  if (inv.dateRaw !== undefined && String(inv.dateRaw).trim() !== '' && date === null) {
    errors.push(`E106 开票日期无法识别：「${inv.dateRaw}」`);
  } else if (date) {
    const today = new Date().toISOString().slice(0, 10);
    if (date > today) {
      errors.push(`E106 开票日期在未来：${date}（今天 ${today}）`);
    } else {
      const days = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
      if (days > 365) warnings.push(`W302 开票日期距今 ${days} 天（${date}）：确认是否跨期入账`);
    }
  }

  // 购方税号
  const taxNoRaw = inv.taxNo === undefined ? '' : String(inv.taxNo).trim();
  if (taxNoRaw !== '') {
    const uscc = checkUscc(taxNoRaw);
    const old = checkOldTaxNo(taxNoRaw);
    if (uscc === 'bad') errors.push(`E107 购方税号校验位不对：「${taxNoRaw}」（按 GB 32100 计算）`);
    else if (uscc === 'na' && old === 'bad') errors.push(`E107 购方税号格式不对：「${taxNoRaw}」应为 18 位统一社会信用代码或 15 位老税号`);
    else if (uscc === 'na' && old === 'na') warnings.push(`W303 购方税号位数异常：「${taxNoRaw}」（应为 18 位或 15 位）`);
  }

  // 负数：通常是红字发票，提醒确认而非直接判错
  if ((amount !== null && amount < 0) || (total !== null && total < 0)) {
    warnings.push(`W301 金额为负数（${money(amount)} / 合计 ${money(total)}）：确认是否为红字发票`);
  }

  return { errors, warnings, rate, date };
}

// ------------------------------------------------------------------ CSV 处理

const ALIASES = {
  code: ['发票代码', '代码', 'fpdm'],
  no: ['发票号码', '号码', 'fphm'],
  amount: ['不含税金额', '不含税', '金额', 'je'],
  tax: ['税额', 'se'],
  total: ['价税合计', '合计金额', '合计', 'jshj'],
  date: ['开票日期', '日期', 'kprq'],
  rate: ['税率', 'sl'],
  taxNo: ['纳税人识别号', '购方税号', '购方纳税人识别号', '税号'],
};

const norm = (s) => String(s).replace(/[\s（）()【】\[\]：:]/g, '').toLowerCase();

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

/** 从 CSV 文本构建待校验记录。 */
function loadCsv(text, delimiter) {
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0];
  const idx = {};
  for (const key of Object.keys(ALIASES)) idx[key] = findColumn(header, ALIASES[key]);

  const hasHeader = idx.amount >= 0 || idx.total >= 0 || idx.no >= 0;
  const body = hasHeader ? rows.slice(1) : rows;

  const records = body.map((row, i) => ({
    line: hasHeader ? i + 2 : i + 1,
    row,
    code: idx.code >= 0 ? row[idx.code] : '',
    no: idx.no >= 0 ? row[idx.no] : '',
    amount: idx.amount >= 0 ? toNumber(row[idx.amount]) : null,
    tax: idx.tax >= 0 ? toNumber(row[idx.tax]) : null,
    total: idx.total >= 0 ? toNumber(row[idx.total]) : null,
    rate: idx.rate >= 0 ? toRate(row[idx.rate]) : null,
    dateRaw: idx.date >= 0 ? row[idx.date] : '',
    taxNo: idx.taxNo >= 0 ? row[idx.taxNo] : '',
  }));
  return { header, records, idx, hasHeader };
}

/** 重复票检测：同一「代码+号码」出现多次。 */
function findDuplicates(records) {
  const seen = new Map();
  for (const r of records) {
    const key = `${r.code}|${r.no}`;
    if (key === '|') continue; // 两列都空就无从判断
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r.line);
  }
  const dup = new Map();
  for (const [key, lines] of seen) if (lines.length > 1) dup.set(key, lines);
  return dup;
}

// -------------------------------------------------------------------- 命令

function cmdCheck(args, opts) {
  const file = args[0];
  if (!file) {
    console.error('用法: node scripts/invoice.js check <CSV文件> [--delimiter=,] [--tolerate=0.02] [--json]');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`文件不存在: ${file}`);
    process.exit(1);
  }
  const { text, encoding } = decode(fs.readFileSync(file));
  const delimiter = opts.delimiter || sniffDelimiter(text);
  const { records, hasHeader } = loadCsv(text, delimiter);

  const seenKeys = new Set();
  const results = [];
  for (const r of records) {
    const v = validateInvoice(r, opts);
    results.push({ ...r, ...v });
  }

  // 重复票（跨行，只在全部记录算完后做）
  const dup = findDuplicates(records);
  for (const r of results) {
    const key = `${r.code}|${r.no}`;
    if (dup.has(key) && !seenKeys.has(key)) {
      seenKeys.add(key);
      r.errors.push(`E201 发票重复：代码 ${r.code || '—'} 号码 ${r.no || '—'} 出现在第 ${dup.get(key).join('、')} 行`);
    }
  }

  const bad = results.filter((r) => r.errors.length || r.warnings.length);
  const errCount = results.reduce((n, r) => n + r.errors.length, 0);
  const warnCount = results.reduce((n, r) => n + r.warnings.length, 0);

  if (opts.json) {
    console.log(JSON.stringify({
      file, encoding, delimiter, hasHeader,
      total: results.length,
      clean: results.length - bad.length,
      problems: bad.length,
      errorCount: errCount,
      warningCount: warnCount,
      items: bad.map((r) => ({
        line: r.line, code: r.code, no: r.no,
        amount: r.amount, tax: r.tax, total: r.total,
        errors: r.errors, warnings: r.warnings,
      })),
    }, null, 2));
    return { errCount, warnCount };
  }

  console.log(`文件:   ${file}`);
  console.log(`编码:   ${encoding}　分隔符: ${JSON.stringify(delimiter)}`);
  console.log(`共 ${results.length} 张，无误 ${results.length - bad.length} 张，有问题 ${bad.length} 张（错误 ${errCount} / 提醒 ${warnCount}）`);
  console.log('');
  for (const r of bad) {
    const title = [r.code, r.no].filter(Boolean).join('/') || '（无代码号码）';
    console.log(`第 ${r.line} 行　${title}`);
    if (r.amount !== null || r.tax !== null || r.total !== null) {
      console.log(`  金额 ${money(r.amount)}　税额 ${money(r.tax)}　价税合计 ${money(r.total)}`);
    }
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    for (const w of r.warnings) console.log(`  ⚠ ${w}`);
    console.log('');
  }
  if (bad.length === 0) console.log('未发现问题。');
  else {
    console.log('汇总');
    const tally = new Map();
    for (const r of bad) for (const m of [...r.errors, ...r.warnings]) {
      const code = m.slice(0, 4);
      tally.set(code, (tally.get(code) || 0) + 1);
    }
    for (const [code, n] of [...tally].sort()) console.log(`  ${code}: ${n}`);
    console.log('');
    console.log('说明：E1xx/E2xx 是确定性错误，W3xx 需人工确认。本工具不做发票真伪查验。');
  }
  return { errCount, warnCount };
}

function cmdOne(_args, opts) {
  const inv = {
    code: opts.code || '',
    no: opts.no || '',
    amount: opts.amount === undefined ? null : toNumber(opts.amount),
    tax: opts.tax === undefined ? null : toNumber(opts.tax),
    total: opts.total === undefined ? null : toNumber(opts.total),
    rate: opts.rate === undefined ? null : toRate(opts.rate),
    dateRaw: opts.date || '',
    taxNo: opts.taxno || '',
  };
  const v = validateInvoice(inv, opts);
  if (opts.json) {
    console.log(JSON.stringify(inv, null, 2));
    console.log(JSON.stringify({ errors: v.errors, warnings: v.warnings }, null, 2));
  } else {
    console.log(`金额 ${money(inv.amount)}　税额 ${money(inv.tax)}　价税合计 ${money(inv.total)}`);
    if (inv.rate !== null) console.log(`税率 ${(inv.rate * 100).toFixed(2)}%`);
    if (v.rate !== null && inv.rate === null) console.log(`反推税率 ${(v.rate * 100).toFixed(2)}%`);
    if (v.date) console.log(`开票日期 ${v.date}`);
    if (inv.taxNo) console.log(`购方税号 ${inv.taxNo} → ${checkUscc(inv.taxNo) === 'ok' ? '校验位正确' : checkUscc(inv.taxNo) === 'bad' ? '校验位错误' : '非 18 位，未做校验位计算'}`);
    console.log('');
    if (v.errors.length === 0 && v.warnings.length === 0) console.log('✓ 未发现问题。');
    for (const e of v.errors) console.log(`✗ ${e}`);
    for (const w of v.warnings) console.log(`⚠ ${w}`);
  }
  return { errCount: v.errors.length, warnCount: v.warnings.length };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  console.log('数字与税率');
  check('千分位', toNumber('1,234.56'), 1234.56);
  check('货币符号', toNumber('¥1130.00'), 1130);
  check('括号负数', toNumber('(500.00)'), -500);
  check('非法数字', toNumber('abc'), null);
  check('税率 13%', toRate('13%'), 0.13);
  check('税率 0.13', toRate('0.13'), 0.13);
  check('税率 13', toRate('13'), 0.13);

  console.log('日期');
  check('ISO', toDate('2026-03-05'), '2026-03-05');
  check('斜杠', toDate('2026/3/5'), '2026-03-05');
  check('中文', toDate('2026年3月5日'), '2026-03-05');
  check('非法日期不猜', toDate('2026-02-30'), null);

  console.log('统一社会信用代码（GB 32100，样本为公开可查的企业税号）');
  check('校验位正确', checkUscc('91330100799655058B'), 'ok');
  check('校验位正确 2', checkUscc('91110000802100433B'), 'ok');
  check('校验位错误', checkUscc('91330100799655058C'), 'bad');
  check('位数不足不判定', checkUscc('12345'), 'na');
  check('15 位走老税号', checkOldTaxNo('310101790101123'), 'ok');

  const opts = { tolerate: 0.02 };
  const codes = (r) => [...r.errors, ...r.warnings].map((s) => s.slice(0, 4));

  console.log('单张票校验');
  check('正常票', codes(validateInvoice({ amount: 1000, tax: 130, total: 1130, rate: 0.13 }, opts)), []);
  check('税额不符', codes(validateInvoice({ amount: 1000, tax: 100, total: 1100, rate: 0.13 }, opts)), ['E103']);
  check('价税合计不符', codes(validateInvoice({ amount: 1000, tax: 130, total: 1135 }, opts)), ['E104']);
  check('代码位数错', codes(validateInvoice({ code: '123' }, opts)), ['E101']);
  check('号码位数错', codes(validateInvoice({ no: '123' }, opts)), ['E102']);
  check('未来日期', codes(validateInvoice({ dateRaw: '2099-01-01' }, opts)), ['E106']);
  check('税号校验位错', codes(validateInvoice({ taxNo: '91330100799655058C' }, opts)), ['E107']);
  check('负数提醒', codes(validateInvoice({ amount: -500, tax: -65, total: -565 }, opts)), ['W301']);
  check('税率反推并判错', codes(validateInvoice({ amount: 1000, tax: 77, total: 1077 }, opts)), ['E105']);

  console.log('重复票');
  const rows = [
    ['发票代码', '发票号码', '金额', '税额', '价税合计'],
    ['033001800111', '12345678', '1000.00', '130.00', '1130.00'],
    ['033001800111', '12345678', '1000.00', '130.00', '1130.00'],
  ];
  const csvText = rows.map((r) => r.join(',')).join('\n');
  const loaded = loadCsv(csvText, ',');
  const dups = findDuplicates(loaded.records);
  check('检出 1 组重复', dups.size, 1);
  check('重复行号', [...dups.values()][0], [2, 3]);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

function parseArgs(argv) {
  const opts = { tolerate: 0.02, json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--tolerate=')) opts.tolerate = Number(arg.slice(11)) || 0.02;
    else if (arg.startsWith('--delimiter=')) opts.delimiter = arg.slice(12);
    else if (arg === '--delimiter') opts.delimiter = ',';
    else if (arg.startsWith('--') && arg.includes('=')) {
      const i = arg.indexOf('=');
      opts[arg.slice(2, i)] = arg.slice(i + 1);
    } else rest.push(arg);
  }
  return { opts, rest };
}

const USAGE = `发票要素校验（离线，不联网、不做真伪查验）

用法:
  node scripts/invoice.js check <CSV文件> [--delimiter=,] [--tolerate=0.02] [--json]
  node scripts/invoice.js one [--code=] [--no=] [--amount=] [--tax=] [--total=]
                              [--rate=0.13] [--date=2026-03-05] [--taxno=] [--json]
  node scripts/invoice.js --selftest

CSV 列名（自动识别，大小写与空格不敏感）:
  发票代码/代码  发票号码/号码  不含税金额/金额  税额  价税合计/合计
  开票日期/日期  税率  纳税人识别号/购方税号

退出码: 0 = 无错误，1 = 存在 E 级错误，2 = 用法错误`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return;
  }
  if (argv[0] === '--selftest') { selftest(); return; }
  const { opts, rest } = parseArgs(argv.slice(1));
  const cmd = argv[0];

  let r = { errCount: 0, warnCount: 0 };
  if (cmd === 'check') r = cmdCheck(rest, opts);
  else if (cmd === 'one') r = cmdOne(rest, opts);
  else { console.error(`未知子命令: ${cmd}\n\n${USAGE}`); process.exit(2); }

  if (r.errCount > 0) process.exit(1);
}

main();
