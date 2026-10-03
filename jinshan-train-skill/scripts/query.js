#!/usr/bin/env node
'use strict';

/**
 * 金山铁路时刻表查询入口。
 *
 * 用法：
 *   node scripts/query.js search <出发站> <到达站> [--date=YYYY-MM-DD|today|tomorrow]
 *                         [--type=直达|大站停|站站停] [--pending] [--from-xinzhuang] [--limit=N] [--json]
 *   node scripts/query.js next <站点> [--direction=to_jinshanwei|to_shanghainan] [--count=N] [--json]
 *   node scripts/query.js stops <车次号> [--date=YYYY-MM-DD] [--direction=...] [--json]
 *   node scripts/query.js station <站点> [--json]
 *   node scripts/query.js stations
 *   node scripts/query.js price <出发站> <到达站> [--json]
 *   node scripts/query.js date [YYYY-MM-DD] [--json]
 */

const shim = require('./wx-shim.js');

const tt = require('./timetable.js');
const train = require('./train.js');
const prices = require('./prices.js');
const { STATIONS } = require('./stations.js');
const { syncData } = require('./sync.js');

// 全程静音模块内部日志，正式输出一律走这两个函数
const say = shim.rawLog;
const sayErr = shim.rawError;

const TYPE_ALIAS = {
  直达: 'direct', direct: 'direct', 直达车: 'direct',
  大站停: 'express', express: 'express',
  站站停: 'normal', normal: 'normal', 普通: 'normal',
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ---------- 工具 ----------

function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    w += /[ᄀ-￿]/.test(ch) ? 2 : 1;
  }
  return w;
}

function pad(str, n) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, n - displayWidth(s)));
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  argv.forEach((a) => {
    if (a.startsWith('--')) {
      const idx = a.indexOf('=');
      if (idx === -1) flags[a.slice(2)] = true;
      else flags[a.slice(2, idx)] = a.slice(idx + 1);
    } else {
      positional.push(a);
    }
  });
  return { positional, flags };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return train.formatDate(d);
}

function resolveDate(input) {
  const today = train.formatDate(new Date());
  if (!input || input === 'today' || input === '今天') return today;
  if (input === 'tomorrow' || input === '明天') return addDays(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(input);
  if (m) {
    return `${new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return today;
}

function resolveStation(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const bare = raw.replace(/站$/, '');
  const lower = raw.toLowerCase();
  const cands = [raw, bare, lower, bare.toLowerCase()];
  for (const c of cands) {
    const hit = STATIONS.find((s) => s.id === c || s.shortName === c
      || s.name === c || s.name.replace(/站$/, '') === c);
    if (hit) return hit;
  }
  const fuzzy = STATIONS.find((s) => s.shortName.includes(bare) || bare.includes(s.shortName));
  return fuzzy || null;
}

function parseTypes(value) {
  if (!value) return [];
  return String(value).split(',').map((v) => TYPE_ALIAS[v.trim()] || v.trim())
    .filter((v) => ['direct', 'express', 'normal'].includes(v));
}

function currentTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function describeDate(dateStr) {
  const info = train.getDateInfo(dateStr);
  const d = new Date(dateStr);
  return `${dateStr}（${WEEKDAYS[d.getDay()]}·${info.schemeName}方案）`;
}

function metaBlock(status) {
  const line = `数据: ${status.sourceText}${status.version ? ` v${status.version}` : ''}`;
  return line;
}

function printWarnings(status) {
  if (status.warnings && status.warnings.length) {
    say('');
    status.warnings.forEach((w) => say(`⚠️  ${w}`));
  }
}

function emit(payload, flags, render) {
  if (flags.json) {
    say(JSON.stringify(payload, null, 2));
    return;
  }
  render(payload);
}

// ---------- 子命令 ----------

async function cmdSearch(pos, flags, status) {
  const from = resolveStation(pos[0]);
  const to = resolveStation(pos[1]);
  if (!from || !to) {
    sayErr(`无法识别站点：${!from ? pos[0] : pos[1]}。可用站点：${STATIONS.map((s) => s.shortName).join('、')}`);
    process.exitCode = 2;
    return;
  }
  if (from.id === to.id) {
    sayErr('出发站与到达站相同。');
    process.exitCode = 2;
    return;
  }

  const date = resolveDate(flags.date);
  const scheme = train.getDateInfo(date).scheme;
  const list = train.searchTrains(from.id, to.id, {
    date,
    scheme,
    trainTypes: parseTypes(flags.type),
    fromXinzhuang: !!flags['from-xinzhuang'],
    onlyNotDeparted: !!flags.pending,
  });
  const limit = Number(flags.limit) > 0 ? Number(flags.limit) : list.length;
  const shown = list.slice(0, limit);
  const suspension = tt.getSuspensionForDate(date);

  const payload = {
    from: { id: from.id, name: from.shortName },
    to: { id: to.id, name: to.shortName },
    date,
    scheme,
    schemeName: train.getDateInfo(date).schemeName,
    total: list.length,
    suspension,
    dataSource: { source: status.source, version: status.version, stale: status.stale },
    warnings: status.warnings,
    trains: shown,
  };

  emit(payload, flags, () => {
    say(`金山铁路 · ${from.shortName} → ${to.shortName}`);
    say(`${describeDate(date)} | ${metaBlock(status)}`);
    if (suspension) {
      say(`停运公告: ${suspension.reason || '该日有班次停运'}` +
        `${Array.isArray(suspension.trains) && !suspension.trains.includes('*') ? `（${suspension.trains.join('、')}）` : '（全线停运）'}`);
    }
    say('');
    if (!shown.length) {
      say('未找到符合条件的班次。可尝试去掉 --type / --pending 筛选，或确认两站之间是否有直达车次。');
      printWarnings(status);
      return;
    }
    say(`${pad('车次', 8)}${pad('类型', 8)}${pad('出发', 7)}${pad('到达', 7)}历时`);
    shown.forEach((t) => {
      say(`${pad(t.trainNo, 8)}${pad(t.typeName, 8)}${pad(t.from.time, 7)}${pad(t.to.time, 7)}${t.durationText}`);
    });
    say('');
    say(`共 ${list.length} 班` + (limit < list.length ? `，已显示前 ${shown.length} 班` : ''));
    printWarnings(status);
  });
}

async function cmdNext(pos, flags, status) {
  const station = resolveStation(pos[0]);
  if (!station) {
    sayErr(`无法识别站点：${pos[0]}。可用站点：${STATIONS.map((s) => s.shortName).join('、')}`);
    process.exitCode = 2;
    return;
  }
  let direction = flags.direction === 'to_shanghainan' ? 'to_shanghainan' : 'to_jinshanwei';
  let terminalId = direction === 'to_jinshanwei' ? 'jinshanwei' : 'shanghainan';
  if (station.id === terminalId) {
    direction = direction === 'to_jinshanwei' ? 'to_shanghainan' : 'to_jinshanwei';
    terminalId = direction === 'to_jinshanwei' ? 'jinshanwei' : 'shanghainan';
  }

  const date = resolveDate(flags.date);
  const scheme = train.getDateInfo(date).scheme;
  const list = train.searchTrains(station.id, terminalId, {
    date, scheme, onlyNotDeparted: true, trainTypes: parseTypes(flags.type),
  });
  const count = Number(flags.count) > 0 ? Number(flags.count) : 1;
  const shown = list.slice(0, count);
  const terminal = resolveStation(terminalId);

  const payload = {
    station: { id: station.id, name: station.shortName },
    direction,
    terminal: { id: terminal.id, name: terminal.shortName },
    date,
    now: currentTimeStr(),
    dataSource: { source: status.source, version: status.version, stale: status.stale },
    warnings: status.warnings,
    trains: shown,
  };

  emit(payload, flags, () => {
    say(`${station.shortName} → ${terminal.shortName} 的后续班次`);
    say(`当前 ${currentTimeStr()} | ${describeDate(date)} | ${metaBlock(status)}`);
    say('');
    if (!shown.length) {
      say('当日已无后续班次（或全部班次已发车）。');
      printWarnings(status);
      return;
    }
    shown.forEach((t) => {
      say(`${pad(t.trainNo, 8)}${pad(t.typeName, 8)}${pad(t.from.time, 7)}→ ${pad(t.to.time, 7)}${t.durationText}`);
    });
    printWarnings(status);
  });
}

async function cmdStops(pos, flags, status) {
  const no = String(pos[0] || '').trim().toUpperCase();
  if (!no) {
    sayErr('请提供车次号，例如 S1001。');
    process.exitCode = 2;
    return;
  }
  const date = resolveDate(flags.date);
  const directions = flags.direction
    ? [flags.direction]
    : ['to_jinshanwei', 'to_shanghainan'];

  let found = null;
  for (const d of directions) {
    const hit = tt.getTrains(d).find((t) => t.no === no && train.isTrainEffective(t, date));
    if (hit) {
      found = { train: hit, direction: d };
      break;
    }
  }
  if (!found) {
    for (const d of directions) {
      const hit = tt.getTrains(d).find((t) => t.no === no);
      if (hit) {
        found = { train: hit, direction: d, notEffective: true };
        break;
      }
    }
  }
  if (!found) {
    sayErr(`未找到车次 ${no}。可先用 search 命令确认当日开行车次。`);
    process.exitCode = 2;
    return;
  }

  const stops = train.getTrainStops(found.train, found.direction);
  const payload = {
    trainNo: found.train.no,
    type: found.train.type,
    typeName: train.getTrainType(found.train).name,
    direction: found.direction,
    date,
    notEffective: !!found.notEffective,
    dataSource: { source: status.source, version: status.version, stale: status.stale },
    warnings: status.warnings,
    stops,
  };

  emit(payload, flags, () => {
    say(`${found.train.no} ${train.getTrainType(found.train).name}` +
      ` · ${stops[0].stationName} → ${stops[stops.length - 1].stationName}`);
    say(`${describeDate(date)} | ${metaBlock(status)}`);
    if (found.notEffective) {
      say('⚠️  该车次在所选日期不生效（可能已过期或尚未启用），结果仅供参考。');
    }
    say('');
    stops.forEach((s) => {
      const t = s.isDeparture ? `${s.departureTime} 发`
        : s.isArrival ? `${s.arrivalTime} 到`
          : `${s.arrivalTime} 到 / ${s.departureTime} 发`;
      say(`${pad(`${s.order}.`, 4)}${pad(s.stationName, 12)}${t}`);
    });
    printWarnings(status);
  });
}

async function cmdStation(pos, flags, status) {
  const station = resolveStation(pos[0]);
  if (!station) {
    sayErr(`无法识别站点：${pos[0]}。可用站点：${STATIONS.map((s) => s.shortName).join('、')}`);
    process.exitCode = 2;
    return;
  }
  const payload = {
    ...station,
    dataSource: { source: status.source, version: status.version, stale: status.stale },
  };
  emit(payload, flags, () => {
    say(`${station.name}（${station.district}）`);
    say(`地址: ${station.address}`);
    say(`电话: ${station.phone || '—'}`);
    say(`营业时间: ${station.hours}${station.hoursNote ? `（${station.hoursNote}）` : ''}`);
    const metro = (station.transfers && station.transfers.metro) || [];
    say(`地铁换乘: ${metro.length ? metro.join('、') : '—'}`);
    const bus = (station.transfers && station.transfers.bus) || [];
    if (bus.length) {
      say('公交换乘:');
      bus.forEach((b) => say(`  ${b.location}: ${b.lines.join('、')}`));
    } else {
      say('公交换乘: —');
    }
  });
}

async function cmdStations(flags) {
  const list = STATIONS.slice().sort((a, b) => train.STATION_ORDER.indexOf(a.id) - train.STATION_ORDER.indexOf(b.id));
  emit({ stations: list }, flags, () => {
    say('金山铁路沿线站点（上海南 → 金山卫方向）:');
    list.forEach((s) => say(`  ${pad(s.shortName, 12)}${s.district}`));
  });
}

async function cmdPrice(pos, flags) {
  const price = prices.getPrice(pos[0] || '', pos[1] || '');
  if (price === null) {
    sayErr(`无法计算票价，可用站点：${prices.PRICE_STATIONS.join('、')}`);
    process.exitCode = 2;
    return;
  }
  const payload = { from: pos[0], to: pos[1], price };
  emit(payload, flags, () => {
    say(`${pos[0]} → ${pos[1]}：${price} 元`);
  });
}

async function cmdDate(pos, flags, status) {
  const date = resolveDate(pos[0]);
  const info = train.getDateInfo(date);
  const payload = {
    ...info,
    holidays: status.holidays,
    unHolidays: status.unHolidays,
    holidaysFresh: status.holidaysFresh,
    dataSource: { source: status.source, version: status.version, stale: status.stale },
    warnings: status.warnings,
  };
  emit(payload, flags, () => {
    say(`${describeDate(date)}`);
    say(`${metaBlock(status)}`);
    printWarnings(status);
  });
}

// ---------- 主流程 ----------

const USAGE = `金山铁路时刻表查询

用法:
  node scripts/query.js search <出发站> <到达站> [--date=YYYY-MM-DD|today|tomorrow]
                         [--type=直达|大站停|站站停] [--pending] [--from-xinzhuang] [--limit=N] [--json]
  node scripts/query.js next <站点> [--direction=to_jinshanwei|to_shanghainan] [--count=N] [--json]
  node scripts/query.js stops <车次号> [--date=YYYY-MM-DD] [--json]
  node scripts/query.js station <站点> [--json]
  node scripts/query.js stations
  node scripts/query.js price <出发站> <到达站> [--json]
  node scripts/query.js date [YYYY-MM-DD] [--json]

示例:
  node scripts/query.js search 上海南 金山卫
  node scripts/query.js search 莘庄 金山卫 --date=tomorrow --type=直达
  node scripts/query.js next 上海南 --count=3
  node scripts/query.js stops S1001
  node scripts/query.js price 上海南 金山卫
`;

async function main() {
  shim.mute();
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || flags.help) {
    say(USAGE);
    return;
  }

  if (command === 'stations') return cmdStations(flags);
  if (command === 'price') return cmdPrice(positional.slice(1), flags);

  // 其余命令都依赖时刻表，先同步
  const status = await syncData({ offline: !!flags.offline });

  switch (command) {
    case 'search': return cmdSearch(positional.slice(1), flags, status);
    case 'next': return cmdNext(positional.slice(1), flags, status);
    case 'stops': return cmdStops(positional.slice(1), flags, status);
    case 'station': return cmdStation(positional.slice(1), flags, status);
    case 'date': return cmdDate(positional.slice(1), flags, status);
    default:
      sayErr(`未知命令: ${command}\n`);
      say(USAGE);
      process.exitCode = 2;
      return undefined;
  }
}

main()
  .catch((e) => {
    sayErr('查询失败:', (e && e.message) || e);
    process.exitCode = 2;
  })
  .finally(() => {
    shim.unmute();
    shim.drainLogs();
  });
