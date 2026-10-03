'use strict';

/**
 * 数据同步与状态诊断。
 *
 * 复用 timetable.js 自带的版本检查逻辑：
 *   1. 拉取 version.json 与本地版本号比对
 *   2. 版本不一致 → 拉取 timetable.json 与 holidays.json
 *   3. 版本一致 → 直接读本地缓存
 *   4. 网络异常 → 有缓存用缓存，无缓存用内置兜底数据
 *
 * 单独运行：node scripts/sync.js [--json] [--offline] [--clear-cache]
 */

const shim = require('./wx-shim.js');

const tt = require('./timetable.js');

const SOURCE_TEXT = {
  'online-updated': '在线同步（已更新）',
  'online-current': '在线同步（版本一致）',
  cache: '本地缓存（离线，可能过期）',
  builtin: '内置兜底数据（离线，可能过期）',
};

async function syncData(options = {}) {
  const { offline = false, waitTimeout = 6000 } = options;

  // 仅吞掉 timetable.js 内部的调试日志，调用方的输出保持正常
  const wasMuted = shim.isMuted();
  shim.mute();
  try {
    return await doSync({ offline, waitTimeout });
  } finally {
    if (!wasMuted) {
      shim.unmute();
      shim.drainLogs();
    }
  }
}

async function doSync({ offline, waitTimeout }) {
  tt.loadSuspensionFromStorage();

  let result = null;
  if (!offline) {
    try {
      result = await tt.checkAndUpdateTimetable();
    } catch (e) {
      result = null;
    }
    await shim.waitIdle(waitTimeout);
    tt.downloadSuspension();
    await shim.waitIdle(waitTimeout);
  }

  const online = !!(result && result.version);
  const stored = tt.getStoredTimetable();

  let source;
  if (online) source = result.updated ? 'online-updated' : 'online-current';
  else source = stored ? 'cache' : 'builtin';

  const holidaySet = tt.getHolidaySet();
  const unHolidaySet = tt.getUnHolidaySet();
  const holidayCount = (holidaySet && holidaySet.size) || 0;
  const unHolidayCount = (unHolidaySet && unHolidaySet.size) || 0;

  // 离线且没有任何假日缓存时，getDateInfo 只能按周六日判断，调休工作日会误判
  const holidaysFresh = online || (holidayCount + unHolidayCount) > 0;

  const warnings = [];
  if (!online) {
    warnings.push('未能连接线上数据接口，结果基于本地缓存或内置兜底数据，可能已过期，务必提醒用户以官方最新时刻表为准。');
  }
  if (!holidaysFresh) {
    warnings.push('法定节假日与调休安排未同步，周末/工作日的班次方案可能判断错误，调休日结果不可靠。');
  }

  return {
    online,
    source,
    sourceText: SOURCE_TEXT[source],
    stale: !online,
    version: (result && result.version) || '',
    updated: !!(result && result.updated),
    holidaysFresh,
    holidays: holidaySet ? Array.from(holidaySet).sort() : [],
    unHolidays: unHolidaySet ? Array.from(unHolidaySet).sort() : [],
    warnings,
    cacheDir: shim.CACHE_DIR,
  };
}

function printStatus(status, asJson) {
  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`数据状态: ${status.sourceText}${status.version ? ` (v${status.version})` : ''}`);
  console.log(`假日数据: ${status.holidaysFresh ? '已同步' : '未同步'}` +
    `（法定假日 ${status.holidays.length} 天，调休工作日 ${status.unHolidays.length} 天）`);
  console.log(`缓存目录: ${status.cacheDir}`);
  if (status.warnings.length) {
    console.log('');
    status.warnings.forEach((w) => console.log(`⚠️  ${w}`));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const offline = args.includes('--offline');

  if (args.includes('--clear-cache')) {
    shim.clearCache();
    if (asJson) console.log(JSON.stringify({ cleared: true }));
    else console.log('已清空本地缓存');
    return;
  }

  const status = await syncData({ offline });
  printStatus(status, asJson);
  shim.unmute();
  process.exitCode = status.stale ? 1 : 0;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('同步失败:', (e && e.message) || e);
    process.exitCode = 2;
  });
}

module.exports = { syncData, printStatus };
