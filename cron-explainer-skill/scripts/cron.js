'use strict';

/**
 * cron 表达式解析与解释。
 *
 * 支持 5 段（分 时 日 月 周）与 6 段（秒 分 时 日 月 周）。
 * 不支持 Quartz 的 L / W / # 与 7 段（带年）——那些是 Quartz 专有语法，
 * 硬塞进标准 cron 语义只会给出错误答案，所以明确拒绝并提示。
 *
 * 「日」与「周」的 OR 语义（Vixie cron 行为）：
 *   两者都是 *      → 每天都匹配
 *   只有一个受限    → 只按受限的那个匹配
 *   两者都受限      → 满足任一即匹配
 *
 * 用法:
 *   node scripts/cron.js explain "0 9 * * 1-5" [--next=5] [--from=ISO] [--lang=zh] [--json]
 *   node scripts/cron.js next "<表达式>" [--count=5] [--from=ISO]
 *   node scripts/cron.js --selftest
 */

const MONTH_ALIAS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_ALIAS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const FIELDS_5 = [
  { key: 'minute', min: 0, max: 59, label: '分钟' },
  { key: 'hour', min: 0, max: 23, label: '小时' },
  { key: 'day', min: 1, max: 31, label: '日' },
  { key: 'month', min: 1, max: 12, label: '月' },
  { key: 'dow', min: 0, max: 7, label: '星期' },
];
const FIELDS_6 = [{ key: 'second', min: 0, max: 59, label: '秒' }, ...FIELDS_5];

class CronError extends Error {}

/**
 * 解析单段 → 取值集合（升序数组）。
 */
function parseField(raw, field) {
  const s = String(raw).trim();
  const alias = field.key === 'month' ? MONTH_ALIAS : field.key === 'dow' ? DOW_ALIAS : null;
  const values = new Set();

  const resolve = (token) => {
    if (alias && token.toLowerCase() in alias) return alias[token.toLowerCase()];
    if (!/^\d+$/.test(token)) throw new CronError(`${field.label}字段的「${token}」不是合法数字`);
    return Number(token);
  };

  // ? 等价于 *，用于「日」与「周」二选一
  if (s === '*' || s === '?') {
    for (let v = field.min; v <= field.max; v++) values.add(v);
    return { values: [...values].sort((a, b) => a - b), kind: 'any' };
  }

  let kind = 'list';
  for (const part of s.split(',')) {
    if (part === '') throw new CronError(`${field.label}字段有空的分项`);
    const stepMatch = /^(.+)\/(\d+)$/.exec(part);
    const rangePart = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (step < 1) throw new CronError(`${field.label}字段的步长必须大于 0`);

    let lo; let hi;
    if (rangePart === '*' || rangePart === '?') { lo = field.min; hi = field.max; }
    else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = resolve(a); hi = resolve(b);
      if (lo > hi) throw new CronError(`${field.label}字段的范围 ${lo}-${hi} 起止颠倒`);
    } else {
      lo = resolve(rangePart); hi = lo;
    }
    if (lo < field.min || hi > field.max) {
      throw new CronError(`${field.label}字段的 ${lo}-${hi} 超出范围 ${field.min}-${field.max}`);
    }
    if (step > 1) kind = 'step';
    else if (rangePart.includes('-') && kind !== 'step') kind = 'range';
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values: [...values].sort((a, b) => a - b), kind };
}

/**
 * 解析完整表达式。
 * @returns {{ fields, minute, hour, day, month, dow, second, dayRestricted, dowRestricted }}
 */
function parse(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new CronError(`cron 表达式应有 5 段或 6 段，收到 ${parts.length} 段`);
  }
  if (parts.length === 7) throw new CronError('不支持 7 段（带年）表达式，那是 Quartz 专有语法');
  for (const p of parts) {
    if (/[LW#]/.test(p)) throw new CronError('不支持 L / W / # ，那是 Quartz 专有语法');
  }
  const defs = parts.length === 6 ? FIELDS_6 : FIELDS_5;
  const out = { fields: {}, hasSeconds: parts.length === 6 };
  parts.forEach((raw, i) => {
    out.fields[defs[i].key] = parseField(raw, defs[i]);
  });
  out.second = out.fields.second ? out.fields.second.values : [0];
  out.minute = out.fields.minute.values;
  out.hour = out.fields.hour.values;
  out.day = out.fields.day.values;
  out.month = out.fields.month.values;
  // 星期的 7 与 0 都是周日
  out.dow = [...new Set(out.fields.dow.values.map((v) => v % 7))].sort((a, b) => a - b);
  out.dayRestricted = out.fields.day.kind !== 'any';
  out.dowRestricted = out.fields.dow.kind !== 'any';
  return out;
}

/** 日与周的 OR 语义。 */
function dayMatches(cron, date) {
  const dom = date.getDate();
  const dow = date.getDay();
  const domOk = cron.day.includes(dom);
  const dowOk = cron.dow.includes(dow);
  if (!cron.dayRestricted && !cron.dowRestricted) return true;
  if (cron.dayRestricted && !cron.dowRestricted) return domOk;
  if (!cron.dayRestricted && cron.dowRestricted) return dowOk;
  return domOk || dowOk;
}

/**
 * 计算下一次执行时间（严格晚于 from）。
 * 按字段跳跃推进，不做逐秒遍历。
 */
function nextAfter(cron, from) {
  const t = new Date(from.getTime());
  t.setMilliseconds(0);
  if (cron.hasSeconds) t.setSeconds(t.getSeconds() + 1);
  else { t.setSeconds(0); t.setMinutes(t.getMinutes() + 1); }

  let guard = 0;
  const secondsSet = new Set(cron.second);
  const minutesSet = new Set(cron.minute);
  const hoursSet = new Set(cron.hour);
  const monthsSet = new Set(cron.month);

  while (guard++ < 200000) {
    if (!monthsSet.has(t.getMonth() + 1)) {
      t.setDate(1); t.setHours(0, 0, 0, 0);
      t.setMonth(t.getMonth() + 1);
      continue;
    }
    if (!dayMatches(cron, t)) {
      t.setDate(t.getDate() + 1); t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hoursSet.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minutesSet.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    if (cron.hasSeconds && !secondsSet.has(t.getSeconds())) {
      t.setSeconds(t.getSeconds() + 1);
      continue;
    }
    return t;
  }
  throw new CronError('在可预见的范围内找不到匹配时间，请检查表达式是否自相矛盾（如 2 月 30 日）');
}

function nextTimes(cron, count, from) {
  const out = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const n = nextAfter(cron, cursor);
    out.push(n);
    cursor = n;
  }
  return out;
}

const p2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

const DOW_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 把取值集合压缩成可读片段。 */
function describeSet(values, unitZh, unitEn) {
  if (values.length === 1) return { zh: `${values[0]}${unitZh}`, en: `${values[0]}` };
  const contiguous = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  if (contiguous) {
    return { zh: `${values[0]}-${values[values.length - 1]}${unitZh}`, en: `${values[0]}-${values[values.length - 1]}` };
  }
  return { zh: values.join('、') + unitZh, en: values.join(', ') };
}

/**
 * 生成人类可读描述。
 * @param {object} cron parse() 的结果
 * @param {'zh'|'en'} lang
 */
function describe(cron, lang) {
  const zh = lang !== 'en';
  const min = cron.minute;
  const hour = cron.hour;
  const isEveryMinute = min.length === 60 && !cron.hasSeconds;
  const isEveryHour = hour.length === 24;
  const minuteStep = cron.fields.minute.kind === 'step' && min.length > 1 ? (min[1] - min[0]) : null;
  const hourStep = cron.fields.hour.kind === 'step' && hour.length > 1 ? (hour[1] - hour[0]) : null;

  // 每 N 分钟
  if (minuteStep && isEveryHour && !cron.dayRestricted && !cron.dowRestricted && cron.month.length === 12) {
    // 步长从 0 开始才叫「每 N 分钟」
    const everyN = min[0] === 0 ? minuteStep : null;
    if (everyN) return zh ? `每 ${everyN} 分钟执行一次` : `Every ${everyN} minutes`;
  }
  // 每 N 小时
  if (hourStep && min.length === 1 && !cron.dayRestricted && !cron.dowRestricted && cron.month.length === 12) {
    const everyN = hour[0] === 0 ? hourStep : null;
    if (everyN) {
      return zh
        ? `每 ${everyN} 小时，在第 ${p2(min[0])} 分执行`
        : `Every ${everyN} hours at minute ${min[0]}`;
    }
  }

  // 时间部分
  const timePart = min.length === 1 && hour.length === 1
    ? `${p2(hour[0])}:${p2(min[0])}`
    : null;
  const timeZh = timePart || (isEveryHour && min.length === 1
    ? `每小时第 ${min[0]} 分`
    : `${describeSet(hour, '时', 'h').zh} 的 ${describeSet(min, '分', 'm').zh}`);

  // 日期部分
  let dateZh; let dateEn;
  if (!cron.dayRestricted && !cron.dowRestricted && cron.month.length === 12) {
    dateZh = '每天';
    dateEn = 'every day';
  } else if (cron.dowRestricted && !cron.dayRestricted) {
    const d = cron.dow;
    const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
    if (contiguous && d.length > 1) {
      dateZh = `${DOW_ZH[d[0]]}至${DOW_ZH[d[d.length - 1]]}`;
      dateEn = `${DOW_EN[d[0]]} to ${DOW_EN[d[d.length - 1]]}`;
    } else {
      dateZh = d.map((x) => DOW_ZH[x]).join('、');
      dateEn = d.map((x) => DOW_EN[x]).join(', ');
    }
  } else if (cron.dayRestricted && !cron.dowRestricted) {
    dateZh = `每月 ${cron.day.join('、')} 日`;
    dateEn = `day ${cron.day.join(', ')} of the month`;
  } else {
    dateZh = `每月 ${cron.day.join('、')} 日，或${cron.dow.map((x) => DOW_ZH[x]).join('、')}`;
    dateEn = `day ${cron.day.join(', ')} of the month, or ${cron.dow.map((x) => DOW_EN[x]).join(', ')}`;
  }

  // 月份限制
  if (cron.month.length !== 12) {
    const m = describeSet(cron.month, '月', 'month');
    dateZh = `${m.zh}的 ${dateZh.replace(/^每月 /, '')}`;
    dateEn = `${dateEn} in ${m.en}`;
  }

  if (zh) {
    return timePart ? `${dateZh} ${timePart}` : `${dateZh}的 ${timeZh}`;
  }
  return timePart ? `At ${timePart} ${dateEn}` : `At ${timeZh} ${dateEn}`;
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const at = (y, mo, d, h, mi, s) => new Date(y, mo - 1, d, h || 0, mi || 0, s || 0);
  const nextOf = (expr, from, n) => nextTimes(parse(expr), n || 1, from).map(fmtDate);

  console.log('字段解析');
  check('星号', parseField('*', FIELDS_5[0]).values.length, 60);
  check('单值', parseField('5', FIELDS_5[0]).values, [5]);
  check('范围', parseField('1-5', FIELDS_5[0]).values, [1, 2, 3, 4, 5]);
  check('列表', parseField('0,30', FIELDS_5[0]).values, [0, 30]);
  check('步长', parseField('*/15', FIELDS_5[0]).values, [0, 15, 30, 45]);
  check('范围步长', parseField('10-30/10', FIELDS_5[0]).values, [10, 20, 30]);
  check('问号等同星号', parseField('?', FIELDS_5[2]).values.length, 31);
  check('月份别名', parseField('JAN,MAR', FIELDS_5[3]).values, [1, 3]);
  check('星期别名', parseField('MON-FRI', FIELDS_5[4]).values, [1, 2, 3, 4, 5]);

  console.log('表达式解析');
  check('5 段', parse('0 9 * * *').hasSeconds, false);
  check('6 段带秒', parse('0 0 9 * * *').hasSeconds, true);
  check('星期 7 归一为 0', parse('0 0 * * 7').dow, [0]);

  console.log('非法表达式');
  const bad = (expr) => {
    try { parse(expr); return 'no-error'; } catch (e) { return e instanceof CronError ? 'error' : 'other'; }
  };
  check('段数不对', bad('* * *'), 'error');
  check('越界', bad('0 0 * * 9'), 'error');
  check('范围颠倒', bad('5-1 * * * *'), 'error');
  check('Quartz L', bad('0 0 L * *'), 'error');
  check('Quartz 7 段', bad('0 0 0 1 1 * 2026'), 'error');
  check('合法不报错', bad('0 9 * * 1-5'), 'no-error');

  console.log('下次执行时间');
  check('每天 9 点', nextOf('0 9 * * *', at(2026, 3, 5, 8, 0)), ['2026-03-05 09:00:00']);
  check('已过当天则次日', nextOf('0 9 * * *', at(2026, 3, 5, 10, 0)), ['2026-03-06 09:00:00']);
  check('每 15 分', nextOf('*/15 * * * *', at(2026, 3, 5, 8, 2)), ['2026-03-05 08:15:00']);
  check('工作日', nextOf('0 9 * * 1-5', at(2026, 3, 6, 0, 0)), ['2026-03-06 09:00:00']);
  // 2026-03-07 是周六
  check('跳过周末', nextOf('0 9 * * 1-5', at(2026, 3, 7, 0, 0)), ['2026-03-09 09:00:00']);
  check('每月 1 日', nextOf('0 0 1 * *', at(2026, 3, 5)), ['2026-04-01 00:00:00']);
  check('跨年', nextOf('0 0 1 1 *', at(2026, 3, 5)), ['2027-01-01 00:00:00']);
  check('带秒', nextOf('30 0 9 * * *', at(2026, 3, 5, 8, 0), 1), ['2026-03-05 09:00:30']);

  console.log('多次');
  const many = nextOf('0 9 * * *', at(2026, 3, 5), 3);
  check('三次', many, ['2026-03-05 09:00:00', '2026-03-06 09:00:00', '2026-03-07 09:00:00']);

  console.log('日与周的 OR 语义');
  // 1 日 或 周一，取先到者
  check('日或周取先到', nextOf('0 0 1 * 1', at(2026, 3, 5), 2), ['2026-03-09 00:00:00', '2026-03-16 00:00:00']);

  console.log('描述');
  check('每 5 分钟', describe(parse('*/5 * * * *'), 'zh'), '每 5 分钟执行一次');
  check('每天 9 点', describe(parse('0 9 * * *'), 'zh'), '每天 09:00');
  check('工作日', describe(parse('0 9 * * 1-5'), 'zh'), '周一至周五 09:00');
  check('每月 1 日', describe(parse('0 0 1 * *'), 'zh'), '每月 1 日 00:00');
  check('英文描述', describe(parse('0 9 * * *'), 'en'), 'At 09:00 every day');
  check('每 2 小时', describe(parse('0 */2 * * *'), 'zh'), '每 2 小时，在第 00 分执行');

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `cron 表达式解析与解释

用法:
  node scripts/cron.js explain "<表达式>" [--next=5] [--from=<ISO>] [--lang=zh|en] [--json]
  node scripts/cron.js next "<表达式>" [--count=5] [--from=<ISO>]
  node scripts/cron.js --selftest

选项:
  --next=N / --count=N  输出接下来 N 次执行时间，默认 5
  --from=<ISO>          起始时间，默认当前时间（如 2026-03-05T09:00:00）
  --lang=zh|en          描述语言，默认 zh
  --json                输出 JSON

支持:
  *  ,  -  /  ?          以及 JAN-DEC、SUN-SAT 别名
  5 段（分 时 日 月 周）与 6 段（秒 分 时 日 月 周）

不支持（明确拒绝，不会给出错误答案）:
  Quartz 的 L / W / # 与 7 段带年语法

说明:
  - 「日」与「周」都受限时按 OR 匹配（满足任一即触发），这是 Vixie cron 的行为
  - 时间按系统本地时区计算
  - 星期 0 与 7 都表示周日

退出码: 0 = 正常，2 = 表达式非法或用法错误`;

function parseArgs(argv) {
  const opts = { count: 5, from: null, lang: 'zh', json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--next=')) opts.count = Number(arg.slice(7)) || 5;
    else if (arg.startsWith('--count=')) opts.count = Number(arg.slice(8)) || 5;
    else if (arg.startsWith('--from=')) opts.from = arg.slice(7);
    else if (arg.startsWith('--lang=')) opts.lang = arg.slice(7);
    else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }

  const cmd = argv[0];
  if (cmd !== 'explain' && cmd !== 'next') { console.error(`未知子命令: ${cmd}\n\n${USAGE}`); process.exit(2); }
  const { opts, rest } = parseArgs(argv.slice(1));
  const expr = rest[0];
  if (!expr) { console.error('需要 cron 表达式（记得加引号）\n\n' + USAGE); process.exit(2); }

  let cron;
  try {
    cron = parse(expr);
  } catch (e) {
    console.error(`表达式无法解析：${e.message}`);
    process.exit(2);
  }

  const from = opts.from ? new Date(opts.from) : new Date();
  if (Number.isNaN(from.getTime())) { console.error(`--from 不是合法时间: ${opts.from}`); process.exit(2); }

  let times;
  try {
    times = nextTimes(cron, opts.count, from);
  } catch (e) {
    console.error(`无法计算执行时间：${e.message}`);
    process.exit(2);
  }

  const desc = describe(cron, opts.lang);

  if (opts.json) {
    console.log(JSON.stringify({
      expression: expr,
      description: desc,
      hasSeconds: cron.hasSeconds,
      fields: Object.fromEntries(Object.entries(cron.fields).map(([k, v]) => [k, v.values])),
      from: fmtDate(from),
      next: times.map(fmtDate),
    }, null, 2));
    return;
  }

  if (cmd === 'next') {
    for (const t of times) console.log(fmtDate(t));
    return;
  }

  const names = cron.hasSeconds
    ? ['秒', '分', '时', '日', '月', '周']
    : ['分', '时', '日', '月', '周'];
  const values = cron.hasSeconds
    ? [cron.second, cron.minute, cron.hour, cron.day, cron.month, cron.dow]
    : [cron.minute, cron.hour, cron.day, cron.month, cron.dow];

  console.log(`表达式: ${expr}`);
  console.log(`含义:   ${desc}`);
  console.log('');
  console.log('各字段');
  names.forEach((n, i) => {
    const v = values[i];
    const shown = v.length > 12 ? `${v.slice(0, 12).join(',')}…（${v.length} 个）` : v.join(', ');
    console.log(`  ${n.padEnd(2)} ${shown}`);
  });
  console.log('');
  console.log(`接下来 ${times.length} 次执行（从 ${fmtDate(from)} 起，本地时区）`);
  for (const t of times) console.log(`  ${fmtDate(t)}  ${DOW_ZH[t.getDay()]}`);
  if (cron.dayRestricted && cron.dowRestricted) {
    console.log('');
    console.log('注意：「日」与「周」都受限，按 OR 匹配——满足任一即触发。');
  }
}

main();
