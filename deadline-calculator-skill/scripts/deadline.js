#!/usr/bin/env node
// 期间与期限计算：自然日 / 工作日推算，届满日顺延。
//
// 用法：
//   node scripts/deadline.js add --from=YYYY-MM-DD --days=N   [--mode=civil|natural] [--json]
//   node scripts/deadline.js add --from=YYYY-MM-DD --months=N [--mode=civil|natural]
//   node scripts/deadline.js add --from=YYYY-MM-DD --years=N
//   node scripts/deadline.js workdays --from=YYYY-MM-DD --days=N [--mode=civil|natural]
//   node scripts/deadline.js coverage
//   node scripts/deadline.js --selftest
//
// 设计前提：期限算错会直接损害权利（上诉期、诉讼时效），
// 所以缺数据时宁可拒绝计算，也不做任何推测。

'use strict';

const fs = require('fs');
const path = require('path');

const HOLIDAYS = path.join(__dirname, '..', 'references', 'holidays.txt');

// ---------------------------------------------------------------- 日期工具

function parseDate(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input).trim());
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD: ${input}`);
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    throw new Error(`日期不存在: ${input}`);
  }
  return date;
}

function fmt(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

/** 加月并夹到月末：1 月 31 日 + 1 个月 = 2 月 28/29 日。 */
function addMonths(date, n) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + n;
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)));
}

function addYears(date, n) {
  return addMonths(date, n * 12);
}

function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function weekdayName(date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getUTCDay()];
}

// ---------------------------------------------------------------- 节假日数据

/**
 * 读取节假日数据。
 * @returns {{ map: Map<string,'holiday'|'workday'>, years: Set<number>, count: number }}
 */
function loadHolidays(file) {
  const map = new Map();
  const years = new Set();
  if (!fs.existsSync(file)) return { map, years, count: 0 };

  fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) return;
      const [datePart, typePart] = trimmed.split('|').map((s) => s.trim());
      if (!datePart || !typePart) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;
      const type = typePart === 'workday' ? 'workday' : typePart === 'holiday' ? 'holiday' : null;
      if (!type) return;
      map.set(datePart, type);
      years.add(Number(datePart.slice(0, 4)));
    });

  return { map, years, count: map.size };
}

/**
 * 判断某日性质。年份未被数据覆盖时返回 unknown —— 此时任何推算都必须停下来。
 * @returns {{ kind: 'workday'|'weekend'|'holiday'|'unknown', reason: string }}
 */
function dayKind(date, data) {
  const key = fmt(date);
  if (data.map.has(key)) {
    const type = data.map.get(key);
    return type === 'workday'
      ? { kind: 'workday', reason: '调休上班日' }
      : { kind: 'holiday', reason: '法定休假日' };
  }
  const year = date.getUTCFullYear();
  if (!data.years.has(year)) {
    return { kind: 'unknown', reason: `${year} 年无节假日数据` };
  }
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6
    ? { kind: 'weekend', reason: '周休息日' }
    : { kind: 'workday', reason: '工作日' };
}

function isRestDay(kind) {
  return kind === 'weekend' || kind === 'holiday';
}

// ---------------------------------------------------------------- 计算

/**
 * 计算届满日，并按民法典顺延规则调整。
 * @returns {{ start: Date, nominal: Date, actual: Date, postponed: boolean, postponeReasons: string[], warning: string|null }}
 */
function computeDeadline(from, amount, unit, mode, data) {
  // 民法典第 201 条：按年、月、日计算期间的，开始的当日不计入，自下一日开始计算
  const start = mode === 'civil' ? addDays(from, 1) : from;

  let nominal;
  if (unit === 'days') {
    nominal = addDays(start, amount - 1);
  } else if (unit === 'months') {
    nominal = addMonths(start, amount - 1);
  } else {
    nominal = addYears(start, amount);
    nominal = addDays(nominal, -1);
  }

  // 民法典第 203 条：期间的最后一日是法定休假日的，以法定休假日结束的次日为届满日
  let actual = nominal;
  const reasons = [];
  let warning = null;

  for (let guard = 0; guard < 30; guard++) {
    const info = dayKind(actual, data);
    if (info.kind === 'unknown') {
      warning = `未能判断 ${fmt(actual)} 是否为休假日（${info.reason}），未做顺延调整`;
      break;
    }
    if (!isRestDay(info.kind)) break;
    reasons.push(`${fmt(actual)}（${weekdayName(actual)}·${info.reason}）`);
    actual = addDays(actual, 1);
  }

  return { start, nominal, actual, postponed: reasons.length > 0, postponeReasons: reasons, warning };
}

/** 按工作日顺推 N 个工作日（遇休假日跳过）。缺数据直接抛错。 */
function computeWorkdays(from, amount, mode, data) {
  if (data.count === 0) {
    throw new Error('没有节假日数据，无法计算工作日。请先填写 references/holidays.txt（依据国务院办公厅年度放假安排）。');
  }
  const start = mode === 'civil' ? addDays(from, 1) : from;
  let cursor = start;
  let remaining = amount;
  const skipped = [];

  for (let guard = 0; guard < 3650 && remaining > 0; guard++) {
    const info = dayKind(cursor, data);
    if (info.kind === 'unknown') {
      throw new Error(`推进到 ${fmt(cursor)} 时缺少 ${cursor.getUTCFullYear()} 年节假日数据，无法继续。请补充数据后重试。`);
    }
    if (isRestDay(info.kind)) {
      skipped.push(`${fmt(cursor)}（${info.reason}）`);
      cursor = addDays(cursor, 1);
      continue;
    }
    remaining--;
    if (remaining > 0) cursor = addDays(cursor, 1);
  }

  return { start, actual: cursor, skipped };
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

  // 日期运算
  check('加天数', fmt(addDays(parseDate('2026-01-01'), 14)), '2026-01-15');
  check('跨月加天数', fmt(addDays(parseDate('2026-01-31'), 1)), '2026-02-01');
  check('闰年 2 月', fmt(addDays(parseDate('2028-02-28'), 1)), '2028-02-29');
  check('加月夹到月末', fmt(addMonths(parseDate('2026-01-31'), 1)), '2026-02-28');
  check('闰年加月', fmt(addMonths(parseDate('2026-01-31'), 13)), '2027-02-28');
  check('加月正常', fmt(addMonths(parseDate('2026-03-15'), 1)), '2026-04-15');
  check('非法日期报错', (() => { try { parseDate('2026-02-30'); return 'no-throw'; } catch (e) { return 'throw'; } })(), 'throw');
  check('格式错误报错', (() => { try { parseDate('2026/01/01'); return 'no-throw'; } catch (e) { return 'throw'; } })(), 'throw');

  const empty = { map: new Map(), years: new Set(), count: 0 };

  // 无数据时：自然日仍可算，但明确提示未做顺延
  const noData = computeDeadline(parseDate('2026-01-01'), 15, 'days', 'civil', empty);
  check('无数据仍算出名义届满日', fmt(noData.nominal), '2026-01-16');
  check('无数据时不顺延', noData.postponed, false);
  check('无数据时给出警告', noData.warning !== null, true);

  // 有数据时：周末顺延
  const data = {
    map: new Map([
      ['2026-01-16', 'holiday'],
      ['2026-01-17', 'holiday'],
      ['2026-01-19', 'workday'], // 周一本就是工作日，这里测调休标记不误伤
    ]),
    years: new Set([2026]),
    count: 3,
  };
  // 01-16、01-17 是法定休假日，01-18 又恰是周日，所以要连顺三天到 01-19
  const withData = computeDeadline(parseDate('2026-01-01'), 15, 'days', 'civil', data);
  check('休假日与周末连顺', fmt(withData.actual), '2026-01-19');
  check('顺延被标记', withData.postponed, true);
  check('逐日记录顺延原因', withData.postponeReasons.length, 3);
  check('有数据无警告', withData.warning, null);

  // 民法典：开始的当日不计入
  const civil = computeDeadline(parseDate('2026-03-01'), 10, 'days', 'civil', empty);
  const natural = computeDeadline(parseDate('2026-03-01'), 10, 'days', 'natural', empty);
  check('民法起算日为次日', fmt(civil.start), '2026-03-02');
  check('民法届满日', fmt(civil.nominal), '2026-03-11');
  check('自然日起算日为当日', fmt(natural.start), '2026-03-01');
  check('自然日届满日', fmt(natural.nominal), '2026-03-10');

  // 工作日计算
  const workdayData = {
    map: new Map([['2026-03-07', 'workday']]), // 周六调休上班
    years: new Set([2026]),
    count: 1,
  };
  // 2026-03-02 是周一
  const wd = computeWorkdays(parseDate('2026-03-01'), 5, 'civil', workdayData);
  check('工作日顺推 5 天', fmt(wd.actual), '2026-03-06');
  // 从 3-05(周四) 起算：周五 06 算第 1 个，周六 07 调休上班算第 2 个，
  // 周日 08 跳过，周一 09 是第 3 个
  const wd2 = computeWorkdays(parseDate('2026-03-05'), 3, 'civil', workdayData);
  check('工作日跨周末与调休', fmt(wd2.actual), '2026-03-09');
  check('调休上班日被计入', wd2.skipped.some((s) => s.includes('2026-03-07')), false);

  // 缺数据必须拒绝
  check(
    '无数据拒绝算工作日',
    (() => { try { computeWorkdays(parseDate('2026-03-01'), 5, 'civil', empty); return 'no-throw'; } catch (e) { return 'throw'; } })(),
    'throw'
  );

  console.log(`\n失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const opts = { json: false, selftest: false, from: null, days: null, months: null, years: null, mode: 'civil', rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      opts[key === 'mode' ? 'mode' : key] = value;
    } else opts.rest.push(arg);
  }
  if (!['civil', 'natural'].includes(opts.mode)) throw new Error('--mode 只支持 civil（民法典：开始当日不计入）或 natural');
  return opts;
}

function pickAmount(opts) {
  const given = ['days', 'months', 'years'].filter((k) => opts[k] !== null && opts[k] !== undefined);
  if (given.length === 0) throw new Error('必须指定 --days / --months / --years 其中之一');
  if (given.length > 1) throw new Error('--days / --months / --years 只能指定一个');
  const unit = given[0];
  const amount = Number(opts[unit]);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`--${unit} 必须是正整数`);
  return { unit, amount };
}

const USAGE = `用法:
  node scripts/deadline.js add --from=YYYY-MM-DD --days=N [--mode=civil|natural] [--json]
  node scripts/deadline.js workdays --from=YYYY-MM-DD --days=N [--mode=civil|natural]
  node scripts/deadline.js coverage
  node scripts/deadline.js --selftest

--mode=civil    民法典口径：开始的当日不计入，自次日起算（默认）
--mode=natural  自然口径：开始当日计入第一日`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(2);
  }

  if (opts.selftest) process.exit(runSelftest());

  const data = loadHolidays(HOLIDAYS);
  const [command] = opts.rest;

  if (command === 'coverage') {
    const years = Array.from(data.years).sort();
    if (opts.json) {
      console.log(JSON.stringify({ entries: data.count, years }, null, 2));
    } else if (years.length === 0) {
      console.log(`节假日数据: 未填写（${HOLIDAYS}）`);
      console.log('影响: 自然日计算可用但无法判断顺延；工作日计算会被拒绝。');
    } else {
      console.log(`节假日数据: ${data.count} 条，覆盖年份 ${years.join(', ')}`);
    }
    return;
  }

  if (!opts.from) {
    console.error(USAGE);
    process.exit(2);
  }

  let from;
  try {
    from = parseDate(opts.from);
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(2);
  }

  if (command === 'add') {
    const { unit, amount } = pickAmount(opts);
    const r = computeDeadline(from, amount, unit, opts.mode, data);
    const remain = Math.round((r.actual - today()) / 86400000);

    if (opts.json) {
      console.log(JSON.stringify({
        from: fmt(from), mode: opts.mode, unit, amount,
        start: fmt(r.start), nominal: fmt(r.nominal), deadline: fmt(r.actual),
        postponed: r.postponed, postponeReasons: r.postponeReasons,
        warning: r.warning, daysFromToday: remain,
      }, null, 2));
    } else {
      console.log(`起算日:        ${fmt(r.start)}（${weekdayName(r.start)}）${opts.mode === 'civil' ? '  [民法典：开始当日不计入]' : '  [自然口径：当日计入]'}`);
      console.log(`期间:          ${amount} ${unit === 'days' ? '日' : unit === 'months' ? '个月' : '年'}`);
      console.log(`名义届满日:    ${fmt(r.nominal)}（${weekdayName(r.nominal)}）`);
      console.log(`实际届满日:    ${fmt(r.actual)}（${weekdayName(r.actual)}）`);
      if (r.postponed) {
        console.log(`顺延:          是，因最后一日为休假日，已顺延至休假日结束的次日`);
        for (const reason of r.postponeReasons) console.log(`               跳过 ${reason}`);
      } else {
        console.log(`顺延:          否`);
      }
      if (r.warning) console.log(`⚠️ ${r.warning}`);
      console.log(`距今:          ${remain} 天${remain < 0 ? '（已过期）' : ''}`);
    }
    return;
  }

  if (command === 'workdays') {
    const amount = Number(opts.days);
    if (!Number.isInteger(amount) || amount <= 0) {
      console.error('错误: workdays 需要 --days=<正整数>');
      process.exit(2);
    }
    let r;
    try {
      r = computeWorkdays(from, amount, opts.mode, data);
    } catch (err) {
      console.error(`错误: ${err.message}`);
      process.exit(1);
    }
    const remain = Math.round((r.actual - today()) / 86400000);
    if (opts.json) {
      console.log(JSON.stringify({ from: fmt(from), mode: opts.mode, workdays: amount, start: fmt(r.start), deadline: fmt(r.actual), skipped: r.skipped, daysFromToday: remain }, null, 2));
    } else {
      console.log(`起算日:        ${fmt(r.start)}（${weekdayName(r.start)}）`);
      console.log(`工作日数:      ${amount}`);
      console.log(`届满日:        ${fmt(r.actual)}（${weekdayName(r.actual)}）`);
      console.log(`跳过的休假日:  ${r.skipped.length} 天`);
      for (const s of r.skipped) console.log(`               ${s}`);
      console.log(`距今:          ${remain} 天${remain < 0 ? '（已过期）' : ''}`);
    }
    return;
  }

  console.error(`错误: 未知子命令 ${command || '(未指定)'}\n${USAGE}`);
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = { parseDate, fmt, addDays, addMonths, addYears, computeDeadline, computeWorkdays, loadHolidays, dayKind };
