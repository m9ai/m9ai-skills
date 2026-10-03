'use strict';

/**
 * 金山铁路票价表（单位：元）。
 * 数据与微信小程序「服务」页票价表一致，仅按站间距离计价，不分车次类型。
 */

const PRICE_STATIONS = ['上海南', '莘庄', '春申', '新桥', '车墩', '叶榭', '亭林', '金山园区', '金山卫'];

const PRICE_TABLE = [
  [0, 3, 3, 3, 4, 5, 6, 8, 10],
  [3, 0, 3, 3, 3, 4, 5, 7, 9],
  [3, 3, 0, 3, 3, 4, 5, 6, 8],
  [3, 3, 3, 0, 3, 3, 4, 5, 7],
  [4, 3, 3, 3, 0, 3, 3, 4, 6],
  [5, 4, 4, 3, 3, 0, 3, 3, 5],
  [6, 5, 5, 4, 3, 3, 0, 3, 3],
  [8, 7, 6, 5, 4, 3, 3, 0, 3],
  [10, 9, 8, 7, 6, 5, 3, 3, 0],
];

function priceIndex(name) {
  const raw = String(name || '').trim().replace(/站$/, '');
  return PRICE_STATIONS.indexOf(raw);
}

/** 返回两站间票价（元）；任一站无法识别时返回 null */
function getPrice(fromName, toName) {
  const i = priceIndex(fromName);
  const j = priceIndex(toName);
  if (i === -1 || j === -1) return null;
  return PRICE_TABLE[i][j];
}

module.exports = {
  PRICE_STATIONS,
  PRICE_TABLE,
  getPrice,
  priceIndex,
};
