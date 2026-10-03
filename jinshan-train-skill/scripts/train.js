const { STATIONS, DIRECTIONS } = require('./stations.js');
const {
  STATION_ORDER,
  SHANGHAINAN_STATION,
  TO_JINSHANWEI,
  TO_SHANGHAINAN,
  TRAIN_TYPES,
  getTrains,
  queryTrains,
  getNextTrain,
  getStationTime,
  getHolidaySet,
  getUnHolidaySet
} = require('./timetable.js');

// 合并站点数据（含上海南站，优先使用 stations.js 中的完整数据）
const shanghainanFromStations = STATIONS.find(s => s.id === 'shanghainan');
const SHANGHAINAN_FULL = shanghainanFromStations || SHANGHAINAN_STATION;
const ALL_STATIONS = [SHANGHAINAN_FULL, ...STATIONS.filter(s => s.id !== 'shanghainan')];

// 站点ID到名称映射
const STATION_MAP = {};
ALL_STATIONS.forEach(s => {
  STATION_MAP[s.id] = s;
});

// 获取列车类型（从数据中直接读取）
function getTrainType(train) {
  return TRAIN_TYPES[train.type] || TRAIN_TYPES.normal;
}

// 判断是否为莘庄站出发/到达的车
function isFromXinzhuang(train) {
  return train.t.hasOwnProperty('xinzhuang');
}

// 计算两站之间历时（分钟）
function calcDuration(fromTime, toTime) {
  const [fh, fm] = fromTime.split(':').map(Number);
  const [th, tm] = toTime.split(':').map(Number);
  let diff = (th * 60 + tm) - (fh * 60 + fm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

// 格式化历时
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

// 获取某车次的经停站列表（按顺序）
function getTrainStops(train, direction) {
  const order = direction === 'to_jinshanwei' ? STATION_ORDER : [...STATION_ORDER].reverse();
  const stops = [];
  // 先收集所有实际停靠的索引，以准确判断首末站
  const stopIndices = [];
  order.forEach((stationId, index) => {
    if (train.t[stationId]) {
      stopIndices.push(index);
    }
  });
  const firstIndex = stopIndices[0];
  const lastIndex = stopIndices[stopIndices.length - 1];

  order.forEach((stationId, index) => {
    if (train.t[stationId]) {
      const isFirst = index === firstIndex;
      const isLast = index === lastIndex;
      const timeVal = train.t[stationId];

      let arrivalTime = null;
      let departureTime = null;

      if (typeof timeVal === 'string') {
        if (isFirst) {
          departureTime = timeVal;
        } else if (isLast) {
          arrivalTime = timeVal;
        } else {
          // 中间站单值（大站停途经站），既是到达又是发车
          arrivalTime = timeVal;
          departureTime = timeVal;
        }
      } else {
        if (isFirst) {
          departureTime = timeVal.depart;
        } else if (isLast) {
          arrivalTime = timeVal.arrive;
        } else {
          arrivalTime = timeVal.arrive;
          departureTime = timeVal.depart;
        }
      }

      stops.push({
        order: index + 1,
        stationId,
        stationName: STATION_MAP[stationId]?.shortName || stationId,
        time: timeVal,
        arrivalTime,
        departureTime,
        isDeparture: isFirst,
        isArrival: isLast
      });
    }
  });
  return stops;
}

// 判断某车次在指定日期是否有效
// 生效规则（按优先级）：
//   1. 停运检查（可跳过）: 该日期该车次被标记停运 → 返回 false
//   2. effectiveFrom:  若存在且 date < effectiveFrom  → 尚未生效，返回 false
//   3. effectiveUntil: 若存在且 date > effectiveUntil → 已失效，返回 false
//   4. isUnNormal + duration: 临客有效期（兼容旧格式）
// 若无任何日期限制字段，则始终有效
function isTrainEffective(train, date, checkSuspension = true) {
  if (!date) return true;

  // 停运检查（临时停运，优先级最高；详情页等场景可传入 false 忽略）
  if (checkSuspension) {
    const { isTrainSuspended } = require('./timetable.js');
    if (isTrainSuspended(train.no, date)) return false;
  }

  // 通用生效日期区间（新版机制）
  if (train.effectiveFrom && date < train.effectiveFrom) return false;
  if (train.effectiveUntil && date > train.effectiveUntil) return false;

  // 临客有效期（兼容旧格式 isUnNormal + duration）
  if (train.isUnNormal && Array.isArray(train.duration) && train.duration.length === 2) {
    const [startDate, endDate] = train.duration;
    if (date < startDate || date > endDate) return false;
  }

  return true;
}

// 查询两站间车次（增强版）
function searchTrains(from, to, options = {}) {
  const { trainTypes = [], fromXinzhuang = false, onlyNotDeparted = false, date = null, scheme = null } = options;

  // 判断方向
  const fromIndex = STATION_ORDER.indexOf(from);
  const toIndex = STATION_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return [];

  const direction = fromIndex < toIndex ? 'to_jinshanwei' : 'to_shanghainan';
  const trains = getTrains(direction);

  // 未发车筛选：仅当查询日期为今天时生效
  const todayStr = formatDate(new Date());
  const isToday = date === todayStr;
  const now = new Date();
  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const result = [];
  trains.forEach(train => {
    const fromTime = getStationTime(train, from, 'depart');
    const toTime = getStationTime(train, to, 'arrive');
    if (!fromTime || !toTime) return;

    // 生效日期过滤（统一处理 effectiveFrom/effectiveUntil 及旧 isUnNormal+duration）
    if (!isTrainEffective(train, date)) return;

    // 平日/节假日方案过滤
    if (scheme && train.isWorkdayOnly && scheme === 'holiday') return;

    const trainType = getTrainType(train);

    // 筛选车次类型
    if (trainTypes && trainTypes.length > 0 && !trainTypes.includes(trainType.type)) return;

    // 筛选莘庄站出发（仅往金山卫方向有效）
    if (fromXinzhuang && direction === 'to_jinshanwei' && !train.t.xinzhuang) return;

    // 筛选未发车（仅今天生效）
    if (onlyNotDeparted && isToday && fromTime <= currentTimeStr) return;

    const travelDuration = calcDuration(fromTime, toTime);

    result.push({
      trainNo: train.no,
      from: { stationId: from, stationName: STATION_MAP[from]?.shortName || from, time: fromTime },
      to: { stationId: to, stationName: STATION_MAP[to]?.shortName || to, time: toTime },
      duration: travelDuration,
      durationText: formatDuration(travelDuration),
      type: trainType.type,
      typeName: trainType.name,
      typeColor: trainType.color,
      typeBg: trainType.bg,
      typeBorder: trainType.border,
      isDirect: train.type === 'direct',
      direction,
      schedule: train.t
    });
  });

  return result.sort((a, b) => a.from.time.localeCompare(b.from.time));
}

// 获取日期信息（平日/节假日）
// 基础逻辑：周六日 → 节假日；周一至五 → 平日
// 特殊日期由远程 holidays.json 接口覆盖，本地缓存读取
function getDateInfo(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const formatted = dateStr || formatDate(date);
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;

  // 远程假日列表覆盖（配置为假日则始终按节假日处理）
  const holidays = getHolidaySet();
  if (holidays.has(formatted)) {
    return {
      date: formatted,
      isWeekend: true,
      scheme: 'holiday',
      schemeName: '节假日'
    };
  }

  // 远程调休工作日覆盖（配置为调休工作日始终按平日处理）
  const unHolidays = getUnHolidaySet();
  if (unHolidays.has(formatted)) {
    return {
      date: formatted,
      isWeekend: false,
      scheme: 'weekday',
      schemeName: '平日'
    };
  }

  return {
    date: formatted,
    isWeekend,
    scheme: isWeekend ? 'holiday' : 'weekday',
    schemeName: isWeekend ? '节假日' : '平日'
  };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(dateStr) {
  const date = new Date(dateStr);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${m}月${d}日 ${weekdays[date.getDay()]}`;
}

// 获取近N天日期列表
function getRecentDays(n = 3) {
  const days = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = formatDate(d);
    const info = getDateInfo(dateStr);
    days.push({
      date: dateStr,
      label: i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `${d.getMonth() + 1}-${d.getDate()}`,
      week: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()],
      isWeekend: info.isWeekend,
      scheme: info.scheme
    });
  }
  return days;
}

module.exports = {
  ALL_STATIONS,
  STATION_MAP,
  STATION_ORDER,
  getTrains,
  getTrainType,
  getStationTime,
  isFromXinzhuang,
  isTrainEffective,
  calcDuration,
  formatDuration,
  getTrainStops,
  searchTrains,
  getDateInfo,
  formatDate,
  formatShortDate,
  getRecentDays
};
