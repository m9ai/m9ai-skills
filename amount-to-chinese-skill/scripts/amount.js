#!/usr/bin/env node
// 人民币金额转中文大写。
//
// 规则依据：中国人民银行《正确填写票据和结算凭证的基本规定》。
// 该规定对「零」的写法留了几处可选项（如 107000.53 既可写「壹拾万柒仟元伍角叁分」
// 也可写「壹拾万零柒仟元伍角叁分」），本实现固定取其中一种，保证同一输入永远同一输出。
//
// 用法：
//   node scripts/amount.js <金额> [<金额> ...] [--json]
//   node scripts/amount.js --file <路径> [--column=N] [--has-header] [--json]
//   node scripts/amount.js --selftest
//
// 说明：--column 从 1 开始计数，按逗号切分（不解析引号内的逗号，够用即可）。

'use strict';

const fs = require('fs');
const path = require('path');

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
// 组内位权：千、百、十、个
const PLACE_UNITS = ['仟', '佰', '拾', ''];
// 节权：个节无后缀
const SECTION_UNITS = ['', '万', '亿'];

// 支持到 9999亿9999万9999.99，再大已超出票据实际场景
const MAX_CENTS = 1e14;

/** 把各种写法归一成整数「分」。负数返回负值。 */
function toCents(raw) {
  let s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (s === '') throw new Error('金额为空');

  // 全角数字与全角句号转半角
  s = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.');

  // 去掉货币前缀、千分位与空白
  s = s.replace(/^(?:RMB|CNY|rmb|cny|¥|￥)\s*/, '');
  s = s.replace(/[,，\s]/g, '');

  if (!/^-?\d*(?:\.\d*)?$/.test(s) || s === '' || s === '.' || s === '-') {
    throw new Error(`无法解析为金额: ${raw}`);
  }

  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);

  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const decPart = dot === -1 ? '' : s.slice(dot + 1);

  const intVal = intPart === '' ? 0 : Number(intPart);
  if (!Number.isSafeInteger(intVal)) throw new Error(`金额过大: ${raw}`);

  let cents = intVal * 100;

  if (decPart !== '') {
    // 只看到小数点后第 3 位，第 3 位四舍五入（分位之后不继续进位到更多位）
    const padded = (decPart + '000').slice(0, 3);
    let frac = Number(padded.slice(0, 2));
    if (Number(padded[2]) >= 5) frac += 1;
    cents += frac;
  }

  if (!Number.isSafeInteger(cents) || Math.abs(cents) >= MAX_CENTS) {
    throw new Error(`金额超出支持范围（最大 9999亿9999万9999.99）: ${raw}`);
  }

  return negative ? -cents : cents;
}

/** 单节（0–9999）转大写，末尾的零不读。 */
function groupToCapital(group) {
  const ds = [
    Math.floor(group / 1000) % 10,
    Math.floor(group / 100) % 10,
    Math.floor(group / 10) % 10,
    group % 10,
  ];
  let out = '';
  for (let i = 0; i < 4; i++) {
    const d = ds[i];
    if (d === 0) {
      // 连续的零只读一个，且末尾零最终会被裁掉
      if (out !== '' && !out.endsWith('零')) out += '零';
    } else {
      out += DIGITS[d] + PLACE_UNITS[i];
    }
  }
  return out.replace(/零+$/, '');
}

/** 整数部分（0–999999999999）转大写；0 返回空串，由调用方决定写不写「零元」。 */
function integerToCapital(n) {
  if (n === 0) return '';

  // 从低到高每四位一节：个节、万节、亿节
  const groups = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }

  let out = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group === 0) {
      // 整节为零：不读节权，但要留下一个「零」占位
      if (out !== '' && !out.endsWith('零')) out += '零';
      continue;
    }
    // 本节不足四位且前面已有更高节，说明高位节与本节之间断档，补「零」
    if (out !== '' && group < 1000 && !out.endsWith('零')) out += '零';
    out += groupToCapital(group) + SECTION_UNITS[i];
  }
  return out.replace(/零+$/, '');
}

/**
 * 金额（整数分）转大写。
 * @returns {{ negative: boolean, text: string }}
 */
function toCapital(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const frac = abs % 100;
  const jiao = Math.floor(frac / 10);
  const fen = frac % 10;

  const prefix = negative ? '负' : '';

  if (yuan === 0 && jiao === 0 && fen === 0) {
    return { negative, text: prefix + '零元整' };
  }

  const intText = integerToCapital(yuan);
  // 整数部分为零时也必须写出「零元」，角位是 0 而分位不为 0 时「元」后补「零」
  let out = prefix + (intText !== '' ? intText + '元' : '零元');

  let dec = '';
  if (jiao === 0 && fen > 0) {
    out += '零';
    dec = DIGITS[fen] + '分';
  } else if (jiao > 0 && fen === 0) {
    dec = DIGITS[jiao] + '角';
  } else if (jiao > 0 && fen > 0) {
    dec = DIGITS[jiao] + '角' + DIGITS[fen] + '分';
  }

  if (dec === '') {
    // 到「元」为止必须写「整」
    out += '整';
  } else {
    out += dec;
  }

  return { negative, text: out };
}

/** 输出用：把原始输入格式化成便于核对的形式。 */
function formatAmount(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + body + '.' + String(frac).padStart(2, '0');
}

function parseArgs(argv) {
  const opts = { json: false, selftest: false, file: null, column: 1, hasHeader: false, values: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--has-header') opts.hasHeader = true;
    else if (arg === '--file') opts.file = argv[++i];
    else if (arg.startsWith('--file=')) opts.file = arg.slice('--file='.length);
    else if (arg === '--column') opts.column = Number(argv[++i]);
    else if (arg.startsWith('--column=')) opts.column = Number(arg.slice('--column='.length));
    else if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
    else opts.values.push(arg);
  }
  if (!Number.isInteger(opts.column) || opts.column < 1) {
    throw new Error('--column 必须是 >= 1 的整数');
  }
  return opts;
}

function runSelftest() {
  // 前 5 条取自《正确填写票据和结算凭证的基本规定》示例，其余覆盖边界
  const cases = [
    ['1409.50', '壹仟肆佰零玖元伍角'],
    ['6007.14', '陆仟零柒元壹角肆分'],
    ['1680.32', '壹仟陆佰捌拾元叁角贰分'],
    ['107000.53', '壹拾万柒仟元伍角叁分'],
    ['16409.02', '壹万陆仟肆佰零玖元零贰分'],
    ['325.04', '叁佰贰拾伍元零肆分'],
    ['0', '零元整'],
    ['0.00', '零元整'],
    ['1', '壹元整'],
    ['10', '壹拾元整'],
    ['100', '壹佰元整'],
    ['1000', '壹仟元整'],
    ['10000', '壹万元整'],
    ['100000', '壹拾万元整'],
    ['1000000', '壹佰万元整'],
    ['10000000', '壹仟万元整'],
    ['100000000', '壹亿元整'],
    ['100000001', '壹亿零壹元整'],
    ['100010000', '壹亿零壹万元整'],
    ['100700', '壹拾万零柒佰元整'],
    ['1010', '壹仟零壹拾元整'],
    ['1009', '壹仟零玖元整'],
    ['0.5', '零元伍角'],
    ['0.05', '零元零伍分'],
    ['0.55', '零元伍角伍分'],
    ['1234.56', '壹仟贰佰叁拾肆元伍角陆分'],
    ['-100', '负壹佰元整'],
    ['999999999999.99', '玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分'],
  ];

  let failed = 0;
  for (const [input, expected] of cases) {
    let actual;
    try {
      actual = toCapital(toCents(input)).text;
    } catch (err) {
      actual = `ERROR: ${err.message}`;
    }
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${input.padEnd(18)} ${actual}${ok ? '' : `  (期望 ${expected})`}`);
  }

  // 千分位 / 货币符号 / 全角 / 四舍五入
  const normalize = [
    ['1,234.56', '1,234.56'],
    ['¥1,234.56', '1,234.56'],
    ['１２３４．５６', '1,234.56'],
    ['1234.565', '1,234.57'],
  ];
  for (const [input, expected] of normalize) {
    const actual = formatAmount(toCents(input));
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${input.padEnd(18)} ${actual}${ok ? '' : `  (期望 ${expected})`}`);
  }

  console.log(`\n${cases.length + normalize.length} 条用例，失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(2);
  }

  if (opts.selftest) {
    process.exit(runSelftest());
  }

  if (opts.file) {
    const file = opts.file;
    if (!fs.existsSync(file)) {
      console.error(`错误: 文件不存在 ${file}`);
      process.exit(2);
    }
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    const results = [];
    let lineNo = 0;
    let skippedHeader = false;
    for (const line of lines) {
      lineNo++;
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (opts.hasHeader && !skippedHeader) {
        skippedHeader = true;
        continue;
      }

      const cell = opts.column > 1 ? trimmed.split(',')[opts.column - 1] : trimmed.split(',')[0];
      const source = cell === undefined ? '' : cell.trim();
      try {
        const cents = toCents(source);
        results.push({ line: lineNo, source, amount: formatAmount(cents), capital: toCapital(cents).text });
      } catch (err) {
        results.push({ line: lineNo, source, amount: null, capital: null, error: err.message });
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        if (r.error) {
          console.log(`行 ${r.line}: ${r.source} → ⚠️ ${r.error}`);
        } else {
          console.log(`行 ${r.line}: ${r.amount} → ${r.capital}`);
        }
      }
      const bad = results.filter((r) => r.error).length;
      console.log(`\n共 ${results.length} 条，失败 ${bad} 条`);
    }
    process.exit(results.some((r) => r.error) ? 1 : 0);
  }

  if (opts.values.length === 0) {
    console.error('用法: node scripts/amount.js <金额> [...金额] | --file <路径> | --selftest');
    process.exit(2);
  }

  const results = [];
  let bad = 0;
  for (const value of opts.values) {
    try {
      const cents = toCents(value);
      results.push({ source: value, amount: formatAmount(cents), capital: toCapital(cents).text });
    } catch (err) {
      bad++;
      results.push({ source: value, amount: null, capital: null, error: err.message });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(opts.values.length === 1 ? results[0] : results, null, 2));
  } else {
    for (const r of results) {
      if (r.error) {
        console.log(`${r.source} → ⚠️ ${r.error}`);
      } else {
        console.log(`${r.amount} → ${r.capital}`);
      }
    }
  }
  process.exit(bad > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { toCents, toCapital, integerToCapital, groupToCapital, formatAmount };
