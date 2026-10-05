'use strict';

/**
 * 个人信息识别与脱敏（PII redaction）。
 *
 * 只做「有确定算法或强模式」的类别：手机号、身份证（GB 11643 校验位）、
 * 银行卡（Luhn）、邮箱、统一社会信用代码（GB 32100）、IPv4、车牌。
 * 不做姓名与住址的通用识别——中文姓名与地址没有可靠的正则是，
 * 硬做只会产生大量误报，反而让人误以为"已经脱敏干净了"。
 *
 * 报告默认**不回显原始敏感值**，只给类型、位置与脱敏后形态，
 * 否则"输出一份脱敏报告"本身就等于泄露一遍。
 *
 * 用法:
 *   node scripts/pii.js redact <文件|-> [--out=文件] [选项]
 *   node scripts/pii.js scan   <文件|-> [选项]
 *   node scripts/pii.js --selftest
 */

const fs = require('fs');

// ------------------------------------------------------- 各类别的判定与掩码

/** GB 11643-1999 身份证校验位（ISO 7064 MOD 11-2）。 */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3'];

function idCardValid(s) {
  if (!/^\d{17}[\dXx]$/.test(s)) return false;
  const up = s.toUpperCase();
  // 出生日期必须真实存在：这一段能挡掉大量随手编的 18 位数字
  const y = Number(up.slice(6, 10)); const mo = Number(up.slice(10, 12)); const d = Number(up.slice(12, 14));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  if (y < 1900 || dt.getTime() > Date.now()) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(up[i]) * ID_WEIGHTS[i];
  return up[17] === ID_CHECK[sum % 11];
}

/** Luhn 校验，用于银行卡号。 */
function luhnValid(s) {
  if (!/^\d{13,19}$/.test(s)) return false;
  let sum = 0; let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = Number(s[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** GB 32100 统一社会信用代码校验位。 */
const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
function usccValid(s) {
  const up = s.toUpperCase();
  if (up.length !== 18) return false;
  if (!/^[0-9A-HJ-NP-RT-Y]{18}$/.test(up)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += USCC_CHARS.indexOf(up[i]) * USCC_WEIGHTS[i];
  const expect = USCC_CHARS[31 - (sum % 31) === 31 ? 0 : 31 - (sum % 31)];
  return up[17] === expect;
}

/** 18 位数字若既是身份证又满足 Luhn，优先按身份证处理。 */
const TYPES = [
  {
    key: 'idcard',
    label: '身份证号',
    re: /\d{17}[\dXx]/g,
    test: (m) => idCardValid(m),
    mask: (m, o) => (o.idLevel === 'keep6'
      ? m.slice(0, 6) + '*'.repeat(8) + m.slice(-4)
      : '*'.repeat(14) + m.slice(-4)),
  },
  {
    key: 'phone',
    label: '手机号',
    re: /1[3-9]\d{9}/g,
    test: () => true,
    mask: (m) => m.slice(0, 3) + '****' + m.slice(-4),
  },
  {
    key: 'bank',
    label: '银行卡号',
    re: /\d{16,19}/g,
    test: (m) => luhnValid(m),
    mask: (m) => '*'.repeat(m.length - 4) + m.slice(-4),
  },
  {
    key: 'uscc',
    label: '统一社会信用代码',
    re: /[0-9A-HJ-NP-RT-Ya-hj-np-rt-y]{18}/g,
    test: (m) => usccValid(m),
    mask: (m) => m.slice(0, 2) + '*'.repeat(12) + m.slice(-4),
  },
  {
    key: 'email',
    label: '邮箱',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    test: () => true,
    mask: (m) => {
      const i = m.indexOf('@');
      const local = m.slice(0, i);
      const domain = m.slice(i);
      return local.slice(0, 1) + '***' + domain;
    },
  },
  {
    key: 'plate',
    label: '车牌号',
    re: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,6}/g,
    test: () => true,
    mask: (m) => m.slice(0, 2) + '***' + m.slice(-2),
  },
  {
    key: 'ipv4',
    label: 'IPv4 地址',
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    test: (m) => m.split('.').every((p) => Number(p) <= 255),
    mask: (m) => {
      const p = m.split('.');
      return `${p[0]}.${p[1]}.*.*`;
    },
  },
];

// ------------------------------------------------------------------ 扫描

/**
 * 扫描文本，返回命中列表。重叠时保留先出现且更靠前的那个。
 * @returns {Array<{ type, label, start, end, value, masked }>}
 */
function scan(text, opts) {
  const enabled = new Set(opts.types);
  const candidates = [];
  for (const t of TYPES) {
    if (!enabled.has(t.key)) continue;
    t.re.lastIndex = 0;
    let m;
    while ((m = t.re.exec(text)) !== null) {
      const value = m[0];
      if (!t.test(value)) continue;
      candidates.push({
        type: t.key, label: t.label,
        start: m.index, end: m.index + value.length,
        value, masked: t.mask(value, opts),
      });
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  const hits = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start < lastEnd) continue; // 与已命中区间重叠，丢弃
    hits.push(c);
    lastEnd = c.end;
  }
  return hits;
}

/** 用命中列表改写文本。 */
function redact(text, hits) {
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    out += text.slice(cursor, h.start) + h.masked;
    cursor = h.end;
  }
  out += text.slice(cursor);
  return out;
}

/** 行号 + 列号，便于定位。 */
function locate(text, index) {
  const before = text.slice(0, index);
  const line = (before.match(/\n/g) || []).length + 1;
  const col = index - (before.lastIndexOf('\n') + 1) + 1;
  return { line, col };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const allTypes = TYPES.map((t) => t.key);
  const opts = { types: allTypes, idLevel: 'last4' };
  // GB 11643-1999 标准文档中的示例号码，校验位为 X
  const ID_OK = '11010519491231002X';
  const hitTypes = (text) => scan(text, opts).map((h) => h.type);
  const one = (text) => scan(text, opts)[0];

  console.log('身份证（GB 11643 校验位）');
  check('标准示例号通过', idCardValid(ID_OK), true);
  check('校验位错一位不认', idCardValid('110105194912310021'), false);
  check('出生日期不合法不认', idCardValid('11010519491331002X'), false);
  check('位数不足不认', idCardValid('11010519491231'), false);

  console.log('银行卡（Luhn）');
  check('Luhn 通过', luhnValid('4111111111111111'), true);
  check('Luhn 不通过', luhnValid('4111111111111112'), false);
  check('位数不足', luhnValid('4111'), false);

  console.log('统一社会信用代码');
  check('校验位正确', usccValid('91330100799655058B'), true);
  check('校验位错误', usccValid('91330100799655058C'), false);

  console.log('识别');
  check('手机号', hitTypes('联系我 13812345678'), ['phone']);
  check('手机号掩码', one('13812345678').masked, '138****5678');
  check('邮箱', hitTypes('邮箱 test.user@example.com'), ['email']);
  check('邮箱掩码', one('a@example.com').masked, 'a***@example.com');
  check('银行卡', hitTypes('卡号 4111111111111111'), ['bank']);
  check('银行卡只留后四位', one('4111111111111111').masked, '************1111');
  check('IPv4', hitTypes('来源 192.168.1.100'), ['ipv4']);
  check('IPv4 掩码', one('192.168.1.100').masked, '192.168.*.*');
  check('长订单号默认不误判', scan('订单号 1234567890123456789', { types: DEFAULT_TYPES, idLevel: 'last4' }).length, 0);
  check('13 位订单号不误判', hitTypes('单号 1234567890123'), []);
  check('身份证号不被切出手机号', hitTypes(`身份证 ${ID_OK}`), ['idcard']);

  console.log('统一社会信用代码（默认不启用）');
  check('默认不命中 18 位业务号', scan('单号 123456789012345678', { types: DEFAULT_TYPES, idLevel: 'last4' }).length, 0);
  check('显式启用才识别', scan('税号 91330100799655058B', { types: ['uscc'], idLevel: 'last4' }).map((h) => h.type), ['uscc']);

  console.log('身份证掩码级别');
  const idOpts = { types: allTypes, idLevel: 'keep6' };
  check('keep6 保留前六后四', scan(ID_OK, idOpts)[0].masked, '110105********002X');
  check('last4 只留后四位', one(ID_OK).masked, '**************002X');

  console.log('脱敏改写');
  const src = '张三 13812345678 邮箱 a@example.com';
  const out = redact(src, scan(src, opts));
  check('改写结果', out, '张三 138****5678 邮箱 a***@example.com');
  check('非敏感内容不变', redact('你好世界', scan('你好世界', opts)), '你好世界');

  console.log('定位');
  check('行号列号', locate('abc\ndefg', 5), { line: 2, col: 2 });

  console.log('类型过滤');
  check('只识别手机号', scan('13812345678 a@example.com', { types: ['phone'], idLevel: 'last4' }).map((h) => h.type), ['phone']);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

/** 默认启用的类别。
 *  uscc 不在此列：18 位纯数字（订单号、流水号）有 1/31 的概率恰好通过校验位，
 *  默认启用会在业务数据里产生难以解释的误报。需要时显式 --types=uscc。 */
const DEFAULT_TYPES = ['phone', 'idcard', 'bank', 'email', 'plate', 'ipv4'];

const USAGE = `个人信息识别与脱敏（离线）

用法:
  node scripts/pii.js redact <文件|-> [--out=文件] [选项]
  node scripts/pii.js scan   <文件|-> [选项]
  node scripts/pii.js --selftest

选项:
  --types=a,b,...    识别类别，默认全部。可选:
                     phone 手机 / idcard 身份证 / bank 银行卡 / email 邮箱
                     plate 车牌 / ipv4 IP 地址 / uscc 统一社会信用代码
                     默认不含 uscc（18 位订单号有 1/31 概率误命中），填 all 启用全部
  --id-level=last4   身份证掩码：last4（默认，只留后四位）或 keep6（保留前六位地区码）
  --json             输出 JSON
  --stats-only       只输出统计，不输出原文（scan 专用）
  --show-original    报告里回显原始值（默认不回显，避免报告本身泄露）

说明:
  只识别有确定算法或强模式的类别。中文姓名与住址没有可靠正则，
  本脚本不做通用识别——硬做只会产生大量误报，让人误以为已经脱敏干净。

退出码: 0 = 未发现或处理完成，1 = 发现敏感信息，2 = 用法错误`;

function parseArgs(argv) {
  const opts = {
    types: DEFAULT_TYPES.slice(),
    idLevel: 'last4', json: false, statsOnly: false, showOriginal: false, out: null,
  };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--stats-only') opts.statsOnly = true;
    else if (arg === '--show-original') opts.showOriginal = true;
    else if (arg.startsWith('--types=')) {
      const list = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
      opts.types = list.includes('all') ? TYPES.map((t) => t.key) : list;
    }
    else if (arg.startsWith('--id-level=')) opts.idLevel = arg.slice(11);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else rest.push(arg);
  }
  return { opts, rest };
}

function readInput(file) {
  if (file === '-' || file === undefined) return fs.readFileSync(0, 'utf8');
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return buf.toString('utf8'); }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }

  const cmd = argv[0];
  if (cmd !== 'redact' && cmd !== 'scan') { console.error(`未知子命令: ${cmd}\n\n${USAGE}`); process.exit(2); }
  const { opts, rest } = parseArgs(argv.slice(1));
  const file = rest[0];
  const text = readInput(file);
  const hits = scan(text, opts);

  if (cmd === 'scan') {
    if (opts.json) {
      console.log(JSON.stringify({
        file: file || '<stdin>',
        count: hits.length,
        byType: [...hits.reduce((m, h) => m.set(h.type, (m.get(h.type) || 0) + 1), new Map())],
        hits: hits.map((h) => {
          const { line, col } = locate(text, h.start);
          const o = { type: h.type, label: h.label, line, col, masked: h.masked };
          if (opts.showOriginal) o.value = h.value;
          return o;
        }),
      }, null, 2));
    } else {
      console.log(`共发现 ${hits.length} 处`);
      const byType = new Map();
      for (const h of hits) byType.set(h.label, (byType.get(h.label) || 0) + 1);
      for (const [label, n] of [...byType].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${label.padEnd(12)} ${n}`);
      }
      if (hits.length && !opts.statsOnly) {
        console.log('');
        for (const h of hits) {
          const { line, col } = locate(text, h.start);
          const shown = opts.showOriginal ? `${h.value} → ${h.masked}` : h.masked;
          console.log(`  ${String(line).padStart(4)}:${String(col).padStart(3)}  ${h.label.padEnd(12)} ${shown}`);
        }
      }
      console.log('');
      console.log('报告默认不回显原始值（回显等于再泄露一遍）。需要原文对照时加 --show-original。');
    }
    if (hits.length) process.exit(1);
    return;
  }

  // redact
  const out = redact(text, hits);
  if (opts.out) { fs.writeFileSync(opts.out, out); } else if (!opts.json) { process.stdout.write(out); }

  if (opts.json) {
    console.log(JSON.stringify({
      file: file || '<stdin>',
      count: hits.length,
      byType: [...hits.reduce((m, h) => m.set(h.type, (m.get(h.type) || 0) + 1), new Map())],
      outFile: opts.out || null,
      text: opts.out ? undefined : out,
    }, null, 2));
  } else if (opts.out) {
    console.error(`已写出: ${opts.out}（脱敏 ${hits.length} 处）`);
    const byType = new Map();
    for (const h of hits) byType.set(h.label, (byType.get(h.label) || 0) + 1);
    for (const [label, n] of [...byType].sort((a, b) => b[1] - a[1])) {
      console.error(`  ${label.padEnd(12)} ${n}`);
    }
  }
}

main();
