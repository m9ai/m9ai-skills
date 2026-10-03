// 金山铁路时刻表数据
// 数据来源：金山铁路官方微信公众号截图（2026年4月24日起执行）
// 注意：部分模糊数据基于上下文推断，建议与实际运营核对
//
// === 车次记录字段说明 ===
// 必填：
//   no:   车次号，如 "S1007"
//   type: 班次类型，"direct" | "express" | "normal"
//   t:    各站时刻，始发/终到站为 "HH:MM" 字符串，中间站为 { arrive: "HH:MM", depart: "HH:MM" }
//
// 可选（方案过滤）：
//   isWorkdayOnly: true → 仅平日运行，节假日跳过
//   isUnNormal:    true → 临客（临时加开班次）
//   duration:      [开始日期, 结束日期] → 临客有效期（YYYY-MM-DD 格式，兼容旧版）
//
// 可选（时刻表版本管理）：
//   effectiveFrom:  "YYYY-MM-DD" → 该车次从此日期起生效（含当日）
//   effectiveUntil: "YYYY-MM-DD" → 该车次到此日期后失效（含当日）
//
//   示例：S1007 在 7月1日前执行旧时刻，7月1日起执行新时刻
//     { "no": "S1007", "effectiveUntil": "2026-06-30", "t": { ...旧时刻... } }
//     { "no": "S1007", "effectiveFrom":  "2026-07-01", "t": { ...新时刻... } }
//   两条件互斥，同一日期不会同时匹配新旧版本

const STATION_ORDER = [
  'shanghainan', 'xinzhuang', 'chunshen', 'xinqiao',
  'chedun', 'yexie', 'tinglin', 'jinshanyuanqu', 'jinshanwei'
];

const SHANGHAINAN_STATION = {
  id: 'shanghainan', name: '上海南站', shortName: '上海南',
  district: '徐汇区', address: '上海市徐汇区沪闵路9001号',
  latitude: 31.157, longitude: 121.431, isTerminal: true
};

// 班次类型常量
const TRAIN_TYPES = {
  direct: { type: 'direct', name: '直达', color: '#34D399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)' },
  express: { type: 'express', name: '大站停', color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)' },
  normal: { type: 'normal', name: '站站停', color: '#00D4AA', bg: 'rgba(0, 212, 170, 0.15)', border: 'rgba(0, 212, 170, 0.3)' }
};

// 往金山卫方向（上海南/莘庄 → 金山卫）
const TO_JINSHANWEI = [
        {
            "no": "S1001",
            "type": "direct",
            "t": {
                "shanghainan": "05:20",
                "jinshanwei": "05:54"
            }
        },
        {
            "no": "S1201",
            "type": "normal",
            "t": {
                "shanghainan": "05:50",
                "chunshen": {
                    "arrive": "06:00",
                    "depart": "06:01"
                },
                "xinqiao": {
                    "arrive": "06:09",
                    "depart": "06:10"
                },
                "chedun": {
                    "arrive": "06:17",
                    "depart": "06:18"
                },
                "yexie": {
                    "arrive": "06:25",
                    "depart": "06:26"
                },
                "tinglin": {
                    "arrive": "06:32",
                    "depart": "06:33"
                },
                "jinshanyuanqu": {
                    "arrive": "06:39",
                    "depart": "06:40"
                },
                "jinshanwei": "06:50"
            }
        },
        {
            "no": "S1101",
            "type": "express",
            "t": {
                "shanghainan": "06:18",
                "xinqiao": {
                    "arrive": "06:33",
                    "depart": "06:34"
                },
                "tinglin": {
                    "arrive": "06:47",
                    "depart": "06:48"
                },
                "jinshanwei": "07:01"
            }
        },
        {
            "no": "S1003",
            "type": "direct",
            "isWorkdayOnly": true,
            "t": {
                "shanghainan": "06:45",
                "jinshanwei": "07:21"
            }
        },
        {
            "no": "S1005",
            "type": "direct",
            "t": {
                "shanghainan": "07:15",
                "jinshanwei": "07:49"
            }
        },
        {
            "no": "S1007",
            "type": "direct",
            "effectiveUntil": "2026-06-30",
            "t": {
                "shanghainan": "07:40",
                "jinshanwei": "08:14"
            }
        },
        {
            "no": "S1007",
            "type": "direct",
            "effectiveFrom": "2026-07-01",
            "t": {
                "shanghainan": "07:40",
                "jinshanyuanqu": {
                    "arrive": "08:07",
                    "depart": "08:09"
                },
                "jinshanwei": "08:19"
            }
        },
        {
            "no": "S1601",
            "type": "normal",
            "t": {
                "xinzhuang": "07:55",
                "chunshen": {
                    "arrive": "08:01",
                    "depart": "08:02"
                },
                "xinqiao": {
                    "arrive": "08:10",
                    "depart": "08:11"
                },
                "chedun": {
                    "arrive": "08:18",
                    "depart": "08:19"
                },
                "yexie": {
                    "arrive": "08:26",
                    "depart": "08:27"
                },
                "tinglin": {
                    "arrive": "08:33",
                    "depart": "08:34"
                },
                "jinshanyuanqu": {
                    "arrive": "08:40",
                    "depart": "08:41"
                },
                "jinshanwei": "08:58"
            }
        },
        {
            "no": "S1009",
            "type": "direct",
            "t": {
                "shanghainan": "08:01",
                "jinshanwei": "08:39"
            }
        },
        {
            "no": "S1209",
            "type": "normal",
            "t": {
                "shanghainan": "08:23",
                "chunshen": {
                    "arrive": "08:35",
                    "depart": "08:36"
                },
                "xinqiao": {
                    "arrive": "08:44",
                    "depart": "08:45"
                },
                "chedun": {
                    "arrive": "08:52",
                    "depart": "08:53"
                },
                "yexie": {
                    "arrive": "09:00",
                    "depart": "09:01"
                },
                "tinglin": {
                    "arrive": "09:07",
                    "depart": "09:08"
                },
                "jinshanyuanqu": {
                    "arrive": "09:14",
                    "depart": "09:15"
                },
                "jinshanwei": "09:25"
            }
        },
        {
            "no": "S1203",
            "type": "normal",
            "t": {
                "shanghainan": "08:50",
                "chunshen": {
                    "arrive": "09:01",
                    "depart": "09:02"
                },
                "xinqiao": {
                    "arrive": "09:09",
                    "depart": "09:10"
                },
                "chedun": {
                    "arrive": "09:17",
                    "depart": "09:18"
                },
                "yexie": {
                    "arrive": "09:25",
                    "depart": "09:26"
                },
                "tinglin": {
                    "arrive": "09:32",
                    "depart": "09:33"
                },
                "jinshanyuanqu": {
                    "arrive": "09:39",
                    "depart": "09:40"
                },
                "jinshanwei": "09:50"
            }
        },
        {
            "no": "S1605",
            "type": "normal",
            "t": {
                "xinzhuang": "09:31",
                "chunshen": {
                    "arrive": "09:39",
                    "depart": "09:40"
                },
                "xinqiao": {
                    "arrive": "09:47",
                    "depart": "09:48"
                },
                "chedun": {
                    "arrive": "09:55",
                    "depart": "09:56"
                },
                "yexie": {
                    "arrive": "10:03",
                    "depart": "10:04"
                },
                "tinglin": {
                    "arrive": "10:10",
                    "depart": "10:11"
                },
                "jinshanyuanqu": {
                    "arrive": "10:17",
                    "depart": "10:18"
                },
                "jinshanwei": "10:28"
            }
        },
        {
            "no": "S1607",
            "type": "normal",
            "t": {
                "xinzhuang": "09:49",
                "chunshen": {
                    "arrive": "09:56",
                    "depart": "09:57"
                },
                "xinqiao": {
                    "arrive": "10:06",
                    "depart": "10:07"
                },
                "chedun": {
                    "arrive": "10:14",
                    "depart": "10:15"
                },
                "yexie": {
                    "arrive": "10:21",
                    "depart": "10:22"
                },
                "tinglin": {
                    "arrive": "10:28",
                    "depart": "10:29"
                },
                "jinshanyuanqu": {
                    "arrive": "10:35",
                    "depart": "10:36"
                },
                "jinshanwei": "10:46"
            }
        },
        {
            "no": "S1151",
            "type": "express",
            "t": {
                "shanghainan": "10:30",
                "xinqiao": {
                    "arrive": "10:49",
                    "depart": "10:50"
                },
                "tinglin": {
                    "arrive": "10:59",
                    "depart": "11:00"
                },
                "jinshanwei": "11:13"
            }
        },
        {
            "no": "S1609",
            "type": "normal",
            "t": {
                "xinzhuang": "10:41",
                "chunshen": {
                    "arrive": "10:47",
                    "depart": "10:48"
                },
                "xinqiao": {
                    "arrive": "10:56",
                    "depart": "10:57"
                },
                "chedun": {
                    "arrive": "11:04",
                    "depart": "11:05"
                },
                "yexie": {
                    "arrive": "11:12",
                    "depart": "11:13"
                },
                "tinglin": {
                    "arrive": "11:19",
                    "depart": "11:20"
                },
                "jinshanyuanqu": {
                    "arrive": "11:26",
                    "depart": "11:27"
                },
                "jinshanwei": "11:37"
            }
        },
        {
            "no": "S1635",
            "type": "normal",
            "t": {
                "xinzhuang": "11:26",
                "chunshen": {
                    "arrive": "11:32",
                    "depart": "11:33"
                },
                "xinqiao": {
                    "arrive": "11:41",
                    "depart": "11:42"
                },
                "chedun": {
                    "arrive": "11:49",
                    "depart": "11:50"
                },
                "yexie": {
                    "arrive": "11:58",
                    "depart": "11:59"
                },
                "tinglin": {
                    "arrive": "12:05",
                    "depart": "12:06"
                },
                "jinshanyuanqu": {
                    "arrive": "12:12",
                    "depart": "12:13"
                },
                "jinshanwei": "12:22"
            }
        },
        {
            "no": "S1611",
            "type": "normal",
            "t": {
                "xinzhuang": "12:05",
                "chunshen": {
                    "arrive": "12:11",
                    "depart": "12:12"
                },
                "xinqiao": {
                    "arrive": "12:21",
                    "depart": "12:22"
                },
                "chedun": {
                    "arrive": "12:28",
                    "depart": "12:29"
                },
                "yexie": {
                    "arrive": "12:36",
                    "depart": "12:37"
                },
                "tinglin": {
                    "arrive": "12:43",
                    "depart": "12:44"
                },
                "jinshanyuanqu": {
                    "arrive": "12:50",
                    "depart": "12:51"
                },
                "jinshanwei": "13:01"
            }
        },
        {
            "no": "S1153",
            "type": "express",
            "t": {
                "shanghainan": "12:25",
                "yexie": {
                    "arrive": "12:44",
                    "depart": "12:45"
                },
                "tinglin": {
                    "arrive": "12:54",
                    "depart": "12:55"
                },
                "jinshanwei": "13:08"
            }
        },
        {
            "no": "S1613",
            "type": "normal",
            "t": {
                "xinzhuang": "12:53",
                "chunshen": {
                    "arrive": "12:59",
                    "depart": "13:00"
                },
                "xinqiao": {
                    "arrive": "13:08",
                    "depart": "13:09"
                },
                "chedun": {
                    "arrive": "13:16",
                    "depart": "13:17"
                },
                "yexie": {
                    "arrive": "13:24",
                    "depart": "13:25"
                },
                "tinglin": {
                    "arrive": "13:31",
                    "depart": "13:32"
                },
                "jinshanyuanqu": {
                    "arrive": "13:38",
                    "depart": "13:39"
                },
                "jinshanwei": "13:49"
            }
        },
        {
            "no": "S1643",
            "type": "express",
            "t": {
                "xinzhuang": "13:40",
                "chunshen": {
                    "arrive": "13:51",
                    "depart": "13:52"
                },
                "tinglin": {
                    "arrive": "14:05",
                    "depart": "14:06"
                },
                "jinshanwei": "14:19"
            }
        },
        {
            "no": "S1615",
            "type": "normal",
            "t": {
                "xinzhuang": "14:05",
                "chunshen": {
                    "arrive": "14:11",
                    "depart": "14:12"
                },
                "xinqiao": {
                    "arrive": "14:20",
                    "depart": "14:21"
                },
                "chedun": {
                    "arrive": "14:28",
                    "depart": "14:29"
                },
                "yexie": {
                    "arrive": "14:36",
                    "depart": "14:37"
                },
                "tinglin": {
                    "arrive": "14:43",
                    "depart": "14:44"
                },
                "jinshanyuanqu": {
                    "arrive": "14:50",
                    "depart": "14:51"
                },
                "jinshanwei": "15:01"
            }
        },
        {
            "no": "S1155",
            "type": "express",
            "t": {
                "shanghainan": "14:39",
                "chedun": {
                    "arrive": "14:58",
                    "depart": "14:59"
                },
                "tinglin": {
                    "arrive": "15:08",
                    "depart": "15:09"
                },
                "jinshanwei": "15:22"
            }
        },
        {
            "no": "S1617",
            "type": "normal",
            "t": {
                "xinzhuang": "15:07",
                "chunshen": {
                    "arrive": "15:13",
                    "depart": "15:14"
                },
                "xinqiao": {
                    "arrive": "15:22",
                    "depart": "15:23"
                },
                "chedun": {
                    "arrive": "15:30",
                    "depart": "15:31"
                },
                "yexie": {
                    "arrive": "15:38",
                    "depart": "15:39"
                },
                "tinglin": {
                    "arrive": "15:46",
                    "depart": "15:47"
                },
                "jinshanyuanqu": {
                    "arrive": "15:54",
                    "depart": "15:55"
                },
                "jinshanwei": "16:03"
            }
        },
        {
            "no": "S1637",
            "type": "normal",
            "t": {
                "xinzhuang": "15:35",
                "chunshen": {
                    "arrive": "15:42",
                    "depart": "15:43"
                },
                "xinqiao": {
                    "arrive": "15:50",
                    "depart": "15:51"
                },
                "chedun": {
                    "arrive": "16:00",
                    "depart": "16:01"
                },
                "yexie": {
                    "arrive": "16:08",
                    "depart": "16:09"
                },
                "tinglin": {
                    "arrive": "16:16",
                    "depart": "16:17"
                },
                "jinshanyuanqu": {
                    "arrive": "16:25",
                    "depart": "16:26"
                },
                "jinshanwei": "16:32"
            }
        },
        {
            "no": "S1619",
            "type": "normal",
            "t": {
                "xinzhuang": "15:50",
                "chunshen": {
                    "arrive": "15:56",
                    "depart": "15:57"
                },
                "xinqiao": {
                    "arrive": "16:04",
                    "depart": "16:05"
                },
                "chedun": {
                    "arrive": "16:14",
                    "depart": "16:15"
                },
                "yexie": {
                    "arrive": "16:22",
                    "depart": "16:23"
                },
                "tinglin": {
                    "arrive": "16:29",
                    "depart": "16:30"
                },
                "jinshanyuanqu": {
                    "arrive": "16:36",
                    "depart": "16:37"
                },
                "jinshanwei": "16:46"
            }
        },
        {
            "no": "S1621",
            "type": "normal",
            "t": {
                "xinzhuang": "16:21",
                "chunshen": {
                    "arrive": "16:28",
                    "depart": "16:29"
                },
                "xinqiao": {
                    "arrive": "16:37",
                    "depart": "16:38"
                },
                "chedun": {
                    "arrive": "16:45",
                    "depart": "16:46"
                },
                "yexie": {
                    "arrive": "16:53",
                    "depart": "16:54"
                },
                "tinglin": {
                    "arrive": "17:00",
                    "depart": "17:01"
                },
                "jinshanyuanqu": {
                    "arrive": "17:07",
                    "depart": "17:08"
                },
                "jinshanwei": "17:17"
            }
        },
        {
            "no": "S1157",
            "type": "express",
            "t": {
                "shanghainan": "17:04",
                "chedun": {
                    "arrive": "17:23",
                    "depart": "17:24"
                },
                "tinglin": {
                    "arrive": "17:33",
                    "depart": "17:34"
                },
                "jinshanwei": "17:47"
            }
        },
        {
            "no": "S1623",
            "type": "normal",
            "t": {
                "xinzhuang": "17:16",
                "chunshen": {
                    "arrive": "17:22",
                    "depart": "17:23"
                },
                "xinqiao": {
                    "arrive": "17:31",
                    "depart": "17:32"
                },
                "chedun": {
                    "arrive": "17:39",
                    "depart": "17:40"
                },
                "yexie": {
                    "arrive": "17:47",
                    "depart": "17:48"
                },
                "tinglin": {
                    "arrive": "17:54",
                    "depart": "17:55"
                },
                "jinshanyuanqu": {
                    "arrive": "18:01",
                    "depart": "18:02"
                },
                "jinshanwei": "18:12"
            }
        },
        {
            "no": "S1141",
            "type": "express",
            "t": {
                "shanghainan": "17:35",
                "chunshen": {
                    "arrive": "17:54",
                    "depart": "17:55"
                },
                "xinqiao": {
                    "arrive": "18:02",
                    "depart": "18:03"
                },
                "chedun": {
                    "arrive": "18:02",
                    "depart": "18:03"
                },
                "jinshanwei": "18:22"
            }
        },
        {
            "no": "S1011",
            "type": "direct",
            "isWorkdayOnly": true,
            "t": {
                "shanghainan": "18:10",
                "jinshanwei": "18:45"
            }
        },
        {
            "no": "S1625",
            "type": "normal",
            "t": {
                "xinzhuang": "18:19",
                "chunshen": {
                    "arrive": "18:25",
                    "depart": "18:27"
                },
                "xinqiao": {
                    "arrive": "18:35",
                    "depart": "18:47"
                },
                "chedun": {
                    "arrive": "18:44",
                    "depart": "18:46"
                },
                "yexie": {
                    "arrive": "18:53",
                    "depart": "18:55"
                },
                "tinglin": {
                    "arrive": "19:01",
                    "depart": "19:13"
                },
                "jinshanyuanqu": {
                    "arrive": "19:09",
                    "depart": "19:10"
                },
                "jinshanwei": "19:21"
            }
        },
        {
            "no": "S1143",
            "type": "normal",
            "t": {
                "shanghainan": "18:40",
                "xinqiao": {
                    "arrive": "18:50",
                    "depart": "18:51"
                },
                "chedun": {
                    "arrive": "19:00",
                    "depart": "19:01"
                },
                "yexie": {
                    "arrive": "19:08",
                    "depart": "19:09"
                },
                "tinglin": {
                    "arrive": "19:11",
                    "depart": "19:12"
                },
                "jinshanwei": "19:30"
            }
        },
        {
            "no": "S1013",
            "type": "direct",
            "t": {
                "shanghainan": "19:06",
                "jinshanwei": "19:40"
            }
        },
        {
            "no": "S1627",
            "type": "normal",
            "t": {
                "xinzhuang": "19:20",
                "chunshen": {
                    "arrive": "19:26",
                    "depart": "19:27"
                },
                "xinqiao": {
                    "arrive": "19:38",
                    "depart": "19:39"
                },
                "chedun": {
                    "arrive": "19:47",
                    "depart": "19:48"
                },
                "yexie": {
                    "arrive": "19:55",
                    "depart": "19:56"
                },
                "tinglin": {
                    "arrive": "20:02",
                    "depart": "20:03"
                },
                "jinshanyuanqu": {
                    "arrive": "20:10",
                    "depart": "20:11"
                },
                "jinshanwei": "20:22"
            }
        },
        {
            "no": "S1205",
            "type": "normal",
            "t": {
                "shanghainan": "19:35",
                "chunshen": {
                    "arrive": "19:45",
                    "depart": "19:46"
                },
                "xinqiao": {
                    "arrive": "19:55",
                    "depart": "19:56"
                },
                "chedun": {
                    "arrive": "20:04",
                    "depart": "20:05"
                },
                "yexie": {
                    "arrive": "20:13",
                    "depart": "20:14"
                },
                "tinglin": {
                    "arrive": "20:21",
                    "depart": "20:22"
                },
                "jinshanyuanqu": {
                    "arrive": "20:29",
                    "depart": "20:31"
                },
                "jinshanwei": "20:41"
            }
        },
        {
            "no": "S1629",
            "type": "normal",
            "t": {
                "xinzhuang": "20:05",
                "chunshen": {
                    "arrive": "20:11",
                    "depart": "20:12"
                },
                "xinqiao": {
                    "arrive": "20:20",
                    "depart": "20:21"
                },
                "chedun": {
                    "arrive": "20:28",
                    "depart": "20:29"
                },
                "yexie": {
                    "arrive": "20:36",
                    "depart": "20:37"
                },
                "tinglin": {
                    "arrive": "20:43",
                    "depart": "20:50"
                },
                "jinshanyuanqu": {
                    "arrive": "20:56",
                    "depart": "20:57"
                },
                "jinshanwei": "21:07"
            }
        },
        {
            "no": "S1015",
            "type": "direct",
            "t": {
                "shanghainan": "20:23",
                "jinshanwei": "20:59"
            }
        },
        {
            "no": "S1207",
            "type": "normal",
            "t": {
                "shanghainan": "21:00",
                "chunshen": {
                    "arrive": "21:10",
                    "depart": "21:11"
                },
                "xinqiao": {
                    "arrive": "21:19",
                    "depart": "21:20"
                },
                "chedun": {
                    "arrive": "21:27",
                    "depart": "21:28"
                },
                "yexie": {
                    "arrive": "21:35",
                    "depart": "21:36"
                },
                "tinglin": {
                    "arrive": "21:42",
                    "depart": "21:43"
                },
                "jinshanyuanqu": {
                    "arrive": "21:49",
                    "depart": "21:50"
                },
                "jinshanwei": "22:00"
            }
        },
        {
            "no": "S1633",
            "type": "normal",
            "t": {
                "xinzhuang": "21:49",
                "chunshen": {
                    "arrive": "21:55",
                    "depart": "21:56"
                },
                "xinqiao": {
                    "arrive": "22:04",
                    "depart": "22:05"
                },
                "chedun": {
                    "arrive": "22:12",
                    "depart": "22:13"
                },
                "yexie": {
                    "arrive": "22:20",
                    "depart": "22:21"
                },
                "tinglin": {
                    "arrive": "22:27",
                    "depart": "22:28"
                },
                "jinshanyuanqu": {
                    "arrive": "22:34",
                    "depart": "22:35"
                },
                "jinshanwei": "22:45"
            }
        },
        {
            "no": "S1211",
            "type": "normal",
            "t": {
                "shanghainan": "21:57",
                "chunshen": {
                    "arrive": "22:08",
                    "depart": "22:09"
                },
                "xinqiao": {
                    "arrive": "22:17",
                    "depart": "22:18"
                },
                "chedun": {
                    "arrive": "22:25",
                    "depart": "22:26"
                },
                "yexie": {
                    "arrive": "22:33",
                    "depart": "22:34"
                },
                "tinglin": {
                    "arrive": "22:40",
                    "depart": "22:41"
                },
                "jinshanyuanqu": {
                    "arrive": "22:47",
                    "depart": "22:48"
                },
                "jinshanwei": "22:58"
            }
        }
    ];

// 往上海南方向（金山卫 → 上海南）
const TO_SHANGHAINAN = [
        {
            "no": "S1212",
            "type": "normal",
            "effectiveUntil": "2026-06-30",
            "t": {
                "jinshanwei": "06:00",
                "jinshanyuanqu": {
                    "arrive": "06:09",
                    "depart": "06:10"
                },
                "tinglin": {
                    "arrive": "06:16",
                    "depart": "06:17"
                },
                "yexie": {
                    "arrive": "06:23",
                    "depart": "06:24"
                },
                "chedun": {
                    "arrive": "06:31",
                    "depart": "06:32"
                },
                "xinqiao": {
                    "arrive": "06:39",
                    "depart": "06:40"
                },
                "chunshen": {
                    "arrive": "06:48",
                    "depart": "06:49"
                },
                "xinzhuang": {
                    "arrive": "06:55",
                    "depart": "06:56"
                },
                "shanghainan": "07:02"
            }
        },{
            "no": "S1212",
            "type": "normal",
            "effectiveFrom": "2026-07-01",
            "t": {
                "jinshanwei": "06:00",
                "jinshanyuanqu": {
                    "arrive": "06:09",
                    "depart": "06:10"
                },
                "tinglin": {
                    "arrive": "06:16",
                    "depart": "06:17"
                },
                "yexie": {
                    "arrive": "06:23",
                    "depart": "06:24"
                },
                "chedun": {
                    "arrive": "06:31",
                    "depart": "06:32"
                },
                "xinqiao": {
                    "arrive": "06:39",
                    "depart": "06:40"
                },
                "chunshen": {
                    "arrive": "06:47",
                    "depart": "06:48"
                },
                "xinzhuang": {
                    "arrive": "06:55",
                    "depart": "06:56"
                },
                "shanghainan": "07:02"
            }
        },
        {
            "no": "S1604",
            "type": "normal",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "06:22",
                "jinshanyuanqu": {
                    "arrive": "06:31",
                    "depart": "06:32"
                },
                "tinglin": {
                    "arrive": "06:38",
                    "depart": "06:39"
                },
                "yexie": {
                    "arrive": "06:45",
                    "depart": "06:46"
                },
                "chedun": {
                    "arrive": "06:53",
                    "depart": "06:54"
                },
                "xinqiao": {
                    "arrive": "07:01",
                    "depart": "07:02"
                },
                "chunshen": {
                    "arrive": "07:10",
                    "depart": "07:11"
                },
                "xinzhuang": "07:16"
            }
        },{
            "no": "S1604",
            "type": "normal",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "06:22",
                "jinshanyuanqu": {
                    "arrive": "06:31",
                    "depart": "06:32"
                },
                "tinglin": {
                    "arrive": "06:38",
                    "depart": "06:39"
                },
                "yexie": {
                    "arrive": "06:45",
                    "depart": "06:46"
                },
                "chedun": {
                    "arrive": "06:53",
                    "depart": "06:54"
                },
                "xinqiao": {
                    "arrive": "07:01",
                    "depart": "07:02"
                },
                "chunshen": {
                    "arrive": "07:10",
                    "depart": "07:11"
                },
                "xinzhuang": "07:18"
            }
        },
        {
            "no": "S1002",
            "type": "direct",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "06:52",
                "shanghainan": "07:26"
            }
        },{
            "no": "S1002",
            "type": "direct",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "06:52",
                "shanghainan": "07:27"
            }
        },
        {
            "no": "S1004",
            "type": "direct",
            "t": {
                "jinshanwei": "07:14",
                "shanghainan": "07:48"
            }
        },
        {
            "no": "S1142",
            "type": "express",
            "t": {
                "jinshanwei": "07:20",
                "chedun": {
                    "arrive": "07:38",
                    "depart": "07:40"
                },
                "xinqiao": {
                    "arrive": "07:47",
                    "depart": "07:49"
                },
                "chunshen": {
                    "arrive": "07:57",
                    "depart": "07:59"
                },
                "shanghainan": "08:10"
            }
        },
        {
            "no": "S1152",
            "type": "normal",
            "t": {
                "jinshanwei": "07:33",
                "tinglin": {
                    "arrive": "07:45",
                    "depart": "07:47"
                },
                "chedun": {
                    "arrive": "07:56",
                    "depart": "07:58"
                },
                "xinqiao": {
                    "arrive": "08:05",
                    "depart": "08:07"
                },
                "chunshen": {
                    "arrive": "08:15",
                    "depart": "08:17"
                },
                "shanghainan": "08:30"
            }
        },
        {
            "no": "S1202",
            "type": "normal",
            "isWorkdayOnly": true,
            "t": {
                "jinshanwei": "07:45",
                "jinshanyuanqu": {
                    "arrive": "07:54",
                    "depart": "07:56"
                },
                "tinglin": {
                    "arrive": "08:00",
                    "depart": "08:02"
                },
                "yexie": {
                    "arrive": "08:10",
                    "depart": "08:12"
                },
                "chedun": {
                    "arrive": "08:19",
                    "depart": "08:21"
                },
                "xinqiao": {
                    "arrive": "08:28",
                    "depart": "08:30"
                },
                "chunshen": {
                    "arrive": "08:38",
                    "depart": "08:40"
                },
                "xinzhuang": {
                    "arrive": "08:47",
                    "depart": "08:50"
                },
                "shanghainan": "08:57"
            }
        },
        {
            "no": "S1606",
            "type": "normal",
            "t": {
                "jinshanwei": "08:10",
                "jinshanyuanqu": {
                    "arrive": "08:21",
                    "depart": "08:22"
                },
                "tinglin": {
                    "arrive": "08:29",
                    "depart": "08:30"
                },
                "yexie": {
                    "arrive": "08:37",
                    "depart": "08:38"
                },
                "chedun": {
                    "arrive": "08:46",
                    "depart": "08:47"
                },
                "xinqiao": {
                    "arrive": "08:55",
                    "depart": "08:56"
                },
                "chunshen": {
                    "arrive": "09:05",
                    "depart": "09:06"
                },
                "xinzhuang": "09:12"
            }
        },
        {
            "no": "S1608",
            "type": "normal",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "08:28",
                "jinshanyuanqu": {
                    "arrive": "08:37",
                    "depart": "08:38"
                },
                "tinglin": {
                    "arrive": "08:45",
                    "depart": "08:46"
                },
                "yexie": {
                    "arrive": "08:53",
                    "depart": "08:54"
                },
                "chedun": {
                    "arrive": "09:02",
                    "depart": "09:03"
                },
                "xinqiao": {
                    "arrive": "09:11",
                    "depart": "09:12"
                },
                "chunshen": {
                    "arrive": "09:21",
                    "depart": "09:22"
                },
                "xinzhuang": "09:30"
            }
        },{
            "no": "S1608",
            "type": "normal",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "08:31",
                "jinshanyuanqu": {
                    "arrive": "08:40",
                    "depart": "08:42"
                },
                "tinglin": {
                    "arrive": "08:48",
                    "depart": "08:49"
                },
                "yexie": {
                    "arrive": "08:55",
                    "depart": "08:56"
                },
                "chedun": {
                    "arrive": "09:03",
                    "depart": "09:04"
                },
                "xinqiao": {
                    "arrive": "09:11",
                    "depart": "09:12"
                },
                "chunshen": {
                    "arrive": "09:21",
                    "depart": "09:22"
                },
                "xinzhuang": "09:30"
            }
        },
        {
            "no": "S1104",
            "type": "express",
            "t": {
                "jinshanwei": "09:03",
                "tinglin": {
                    "arrive": "9:15",
                    "depart": "9:16"
                },
                "xinqiao": {
                    "arrive": "09:30",
                    "depart": "09:31"
                },
                "shanghainan": "09:47"
            }
        },
        {
            "no": "S1610",
            "type": "normal",
            "t": {
                "jinshanwei": "09:34",
                "jinshanyuanqu": {
                    "arrive": "09:43",
                    "depart": "09:44"
                },
                "tinglin": {
                    "arrive": "09:51",
                    "depart": "09:52"
                },
                "yexie": {
                    "arrive": "09:58",
                    "depart": "09:59"
                },
                "chedun": {
                    "arrive": "10:06",
                    "depart": "10:07"
                },
                "xinqiao": {
                    "arrive": "10:14",
                    "depart": "10:15"
                },
                "chunshen": {
                    "arrive": "10:23",
                    "depart": "10:24"
                },
                "xinzhuang": "10:29"
            }
        },
        {
            "no": "S1636",
            "type": "normal",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "10:05",
                "jinshanyuanqu": {
                    "arrive": "10:14",
                    "depart": "10:15"
                },
                "tinglin": {
                    "arrive": "10:21",
                    "depart": "10:22"
                },
                "yexie": {
                    "arrive": "10:29",
                    "depart": "10:30"
                },
                "chedun": {
                    "arrive": "10:37",
                    "depart": "10:38"
                },
                "xinqiao": {
                    "arrive": "10:45",
                    "depart": "10:46"
                },
                "chunshen": {
                    "arrive": "10:54",
                    "depart": "10:55"
                },
                "xinzhuang": "11:00"
            }
        },{
            "no": "S1636",
            "type": "normal",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "10:05",
                "jinshanyuanqu": {
                    "arrive": "10:14",
                    "depart": "10:15"
                },
                "tinglin": {
                    "arrive": "10:21",
                    "depart": "10:22"
                },
                "yexie": {
                    "arrive": "10:29",
                    "depart": "10:30"
                },
                "chedun": {
                    "arrive": "10:37",
                    "depart": "10:38"
                },
                "xinqiao": {
                    "arrive": "10:45",
                    "depart": "10:46"
                },
                "chunshen": {
                    "arrive": "10:54",
                    "depart": "10:55"
                },
                "xinzhuang": "11:01"
            }
        },
        {
            "no": "S1612",
            "type": "normal",
            "t": {
                "jinshanwei": "10:35",
                "jinshanyuanqu": {
                    "arrive": "10:44",
                    "depart": "10:45"
                },
                "tinglin": {
                    "arrive": "10:52",
                    "depart": "10:53"
                },
                "yexie": {
                    "arrive": "10:59",
                    "depart": "11:00"
                },
                "chedun": {
                    "arrive": "11:07",
                    "depart": "11:08"
                },
                "xinqiao": {
                    "arrive": "11:15",
                    "depart": "11:16"
                },
                "chunshen": {
                    "arrive": "11:24",
                    "depart": "11:25"
                },
                "xinzhuang": "11:32"
            }
        },
        {
            "no": "S1106",
            "type": "express",
            "t": {
                "jinshanwei": "11:19",
                "tinglin": {
                    "arrive": "11:31",
                    "depart": "11:32"
                },
                "xinqiao": {
                    "arrive": "11:45",
                    "depart": "11:46"
                },
                "shanghainan": "12:02"
            }
        },
        {
            "no": "S1614",
            "type": "normal",
            "t": {
                "jinshanwei": "11:29",
                "jinshanyuanqu": {
                    "arrive": "11:38",
                    "depart": "11:39"
                },
                "tinglin": {
                    "arrive": "11:46",
                    "depart": "11:47"
                },
                "yexie": {
                    "arrive": "11:52",
                    "depart": "11:53"
                },
                "chedun": {
                    "arrive": "12:00",
                    "depart": "12:01"
                },
                "xinqiao": {
                    "arrive": "12:09",
                    "depart": "12:10"
                },
                "chunshen": {
                    "arrive": "12:17",
                    "depart": "12:18"
                },
                "xinzhuang": "12:25"
            }
        },
        {
            "no": "S1644",
            "type": "express",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "12:30",
                "tinglin": {
                    "arrive": "12:42",
                    "depart": "12:43"
                },
                "chedun": {
                    "arrive": "12:52",
                    "depart": "12:53"
                },
                "xinzhuang": "13:07"
            }
        },
        {
            "no": "S1644",
            "type": "express",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "12:30",
                "tinglin": {
                    "arrive": "12:42",
                    "depart": "12:43"
                },
                "chedun": {
                    "arrive": "12:52",
                    "depart": "12:53"
                },
                "xinzhuang": "13:09"
            }
        },
        {
            "no": "S1616",
            "type": "normal",
            "t": {
                "jinshanwei": "12:42",
                "jinshanyuanqu": {
                    "arrive": "12:51",
                    "depart": "12:52"
                },
                "tinglin": {
                    "arrive": "12:58",
                    "depart": "12:59"
                },
                "yexie": {
                    "arrive": "13:05",
                    "depart": "13:06"
                },
                "chedun": {
                    "arrive": "13:13",
                    "depart": "13:14"
                },
                "xinqiao": {
                    "arrive": "13:22",
                    "depart": "13:23"
                },
                "chunshen": {
                    "arrive": "13:31",
                    "depart": "13:32"
                },
                "xinzhuang": "13:38"
            }
        },
        {
            "no": "S1108",
            "type": "express",
            "t": {
                "jinshanwei": "13:26",
                "tinglin": {
                    "arrive": "13:38",
                    "depart": "13:39"
                },
                "xinqiao": {
                    "arrive": "13:52",
                    "depart": "13:53"
                },
                "shanghainan": "14:09"
            }
        },
        {
            "no": "S1618",
            "type": "normal",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "13:53",
                "jinshanyuanqu": {
                    "arrive": "14:02",
                    "depart": "14:03"
                },
                "tinglin": {
                    "arrive": "14:09",
                    "depart": "14:10"
                },
                "yexie": {
                    "arrive": "14:16",
                    "depart": "14:17"
                },
                "chedun": {
                    "arrive": "14:24",
                    "depart": "14:25"
                },
                "xinqiao": {
                    "arrive": "14:32",
                    "depart": "14:33"
                },
                "chunshen": {
                    "arrive": "14:43",
                    "depart": "14:44"
                },
                "xinzhuang": "14:50"
            }
        },
        {
            "no": "S1618",
            "type": "normal",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "13:53",
                "jinshanyuanqu": {
                    "arrive": "14:02",
                    "depart": "14:03"
                },
                "tinglin": {
                    "arrive": "14:09",
                    "depart": "14:10"
                },
                "yexie": {
                    "arrive": "14:16",
                    "depart": "14:17"
                },
                "chedun": {
                    "arrive": "14:24",
                    "depart": "14:25"
                },
                "xinqiao": {
                    "arrive": "14:32",
                    "depart": "14:34"
                },
                "chunshen": {
                    "arrive": "14:42",
                    "depart": "14:43"
                },
                "xinzhuang": "14:50"
            }
        },
        {
            "no": "S1638",
            "type": "normal",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "14:21",
                "jinshanyuanqu": {
                    "arrive": "14:30",
                    "depart": "14:31"
                },
                "tinglin": {
                    "arrive": "14:37",
                    "depart": "14:38"
                },
                "yexie": {
                    "arrive": "14:45",
                    "depart": "14:46"
                },
                "chedun": {
                    "arrive": "14:53",
                    "depart": "14:54"
                },
                "xinqiao": {
                    "arrive": "15:01",
                    "depart": "15:02"
                },
                "chunshen": {
                    "arrive": "15:11",
                    "depart": "15:12"
                },
                "xinzhuang": "15:17"
            }
        },{
            "no": "S1638",
            "type": "normal",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "14:21",
                "jinshanyuanqu": {
                    "arrive": "14:30",
                    "depart": "14:31"
                },
                "tinglin": {
                    "arrive": "14:37",
                    "depart": "14:38"
                },
                "yexie": {
                    "arrive": "14:45",
                    "depart": "14:46"
                },
                "chedun": {
                    "arrive": "14:53",
                    "depart": "14:54"
                },
                "xinqiao": {
                    "arrive": "15:01",
                    "depart": "15:02"
                },
                "chunshen": {
                    "arrive": "15:09",
                    "depart": "15:10"
                },
                "xinzhuang": "15:17"
            }
        },
        {
            "no": "S1620",
            "type": "normal",
            "t": {
                "jinshanwei": "14:33",
                "jinshanyuanqu": {
                    "arrive": "14:42",
                    "depart": "14:43"
                },
                "tinglin": {
                    "arrive": "14:49",
                    "depart": "14:50"
                },
                "yexie": {
                    "arrive": "14:56",
                    "depart": "14:57"
                },
                "chedun": {
                    "arrive": "15:05",
                    "depart": "15:06"
                },
                "xinqiao": {
                    "arrive": "15:13",
                    "depart": "15:14"
                },
                "chunshen": {
                    "arrive": "15:22",
                    "depart": "15:23"
                },
                "xinzhuang": "15:29"
            }
        },
        {
            "no": "S1622",
            "type": "normal",
            "t": {
                "jinshanwei": "15:02",
                "jinshanyuanqu": {
                    "arrive": "15:11",
                    "depart": "15:12"
                },
                "tinglin": {
                    "arrive": "15:18",
                    "depart": "15:19"
                },
                "yexie": {
                    "arrive": "15:25",
                    "depart": "15:26"
                },
                "chedun": {
                    "arrive": "15:33",
                    "depart": "15:34"
                },
                "xinqiao": {
                    "arrive": "15:41",
                    "depart": "15:42"
                },
                "chunshen": {
                    "arrive": "15:50",
                    "depart": "15:51"
                },
                "xinzhuang": "15:58"
            }
        },
        {
            "no": "S1110",
            "type": "express",
            "t": {
                "jinshanwei": "15:42",
                "tinglin": {
                    "arrive": "15:54",
                    "depart": "15:55"
                },
                "xinqiao": {
                    "arrive": "16:08",
                    "depart": "16:09"
                },
                "shanghainan": "16:25"
            }
        },
        {
            "no": "S1624",
            "type": "normal",
            "t": {
                "jinshanwei": "15:50",
                "jinshanyuanqu": {
                    "arrive": "16:00",
                    "depart": "16:01"
                },
                "tinglin": {
                    "arrive": "16:07",
                    "depart": "16:08"
                },
                "yexie": {
                    "arrive": "16:14",
                    "depart": "16:15"
                },
                "chedun": {
                    "arrive": "16:22",
                    "depart": "16:23"
                },
                "xinqiao": {
                    "arrive": "16:30",
                    "depart": "16:31"
                },
                "chunshen": {
                    "arrive": "16:39",
                    "depart": "16:40"
                },
                "xinzhuang": "16:46"
            }
        },
        {
            "no": "S1006",
            "type": "direct",
            "t": {
                "jinshanwei": "16:40",
                "shanghainan": "17:14"
            }
        },
        {
            "no": "S1626",
            "type": "normal",
            "t": {
                "jinshanwei": "17:00",
                "jinshanyuanqu": {
                    "arrive": "17:10",
                    "depart": "17:11"
                },
                "tinglin": {
                    "arrive": "17:17",
                    "depart": "17:18"
                },
                "yexie": {
                    "arrive": "17:24",
                    "depart": "17:25"
                },
                "chedun": {
                    "arrive": "17:32",
                    "depart": "17:33"
                },
                "xinqiao": {
                    "arrive": "17:40",
                    "depart": "17:41"
                },
                "chunshen": {
                    "arrive": "17:49",
                    "depart": "17:50"
                },
                "xinzhuang": "17:56"
            }
        },
        {
            "no": "S1204",
            "type": "normal",
            "t": {
                "jinshanwei": "17:22",
                "jinshanyuanqu": {
                    "arrive": "17:32",
                    "depart": "17:33"
                },
                "tinglin": {
                    "arrive": "17:39",
                    "depart": "17:40"
                },
                "yexie": {
                    "arrive": "17:47",
                    "depart": "17:48"
                },
                "chedun": {
                    "arrive": "17:54",
                    "depart": "17:55"
                },
                "xinqiao": {
                    "arrive": "18:02",
                    "depart": "18:03"
                },
                "chunshen": {
                    "arrive": "18:11",
                    "depart": "18:12"
                },
                "xinzhuang": {
                    "arrive": "18:18",
                    "depart": "18:19"
                },
                "shanghainan": "18:26"
            }
        },
        {
            "no": "S1628",
            "type": "normal",
            "t": {
                "jinshanwei": "17:50",
                "jinshanyuanqu": {
                    "arrive": "18:00",
                    "depart": "18:01"
                },
                "tinglin": {
                    "arrive": "18:07",
                    "depart": "18:08"
                },
                "yexie": {
                    "arrive": "18:14",
                    "depart": "18:15"
                },
                "chedun": {
                    "arrive": "18:22",
                    "depart": "18:23"
                },
                "xinqiao": {
                    "arrive": "18:29",
                    "depart": "18:30"
                },
                "chunshen": {
                    "arrive": "18:37",
                    "depart": "18:38"
                },
                "xinzhuang": "18:53"
            }
        },
        {
            "no": "S1008",
            "type": "direct",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "18:13",
                "shanghainan": "18:47"
            }
        },{
            "no": "S1008",
            "type": "direct",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "18:08",
                "jinshanyuanqu": {
                    "arrive": "18:17",
                    "depart": "18:19"
                },
                "shanghainan": "18:47"
            }
        },
        {
            "no": "S1010",
            "type": "direct",
            "t": {
                "jinshanwei": "18:38",
                "shanghainan": "19:13"
            }
        },
        {
            "no": "S1630",
            "type": "normal",
            "t": {
                "jinshanwei": "18:43",
                "jinshanyuanqu": {
                    "arrive": "18:52",
                    "depart": "18:53"
                },
                "tinglin": {
                    "arrive": "18:59",
                    "depart": "19:00"
                },
                "yexie": {
                    "arrive": "19:06",
                    "depart": "19:07"
                },
                "chedun": {
                    "arrive": "19:14",
                    "depart": "19:15"
                },
                "xinqiao": {
                    "arrive": "19:22",
                    "depart": "19:23"
                },
                "chunshen": {
                    "arrive": "19:31",
                    "depart": "19:32"
                },
                "xinzhuang": "19:39"
            }
        },
        {
            "no": "S1012",
            "type": "direct",
            "isWorkdayOnly": true,
            "t": {
                "jinshanwei": "19:28",
                "shanghainan": "20:04"
            }
        },
        {
            "no": "S1208",
            "type": "normal",
            "t": {
                "jinshanwei": "19:45",
                "jinshanyuanqu": {
                    "arrive": "19:55",
                    "depart": "19:56"
                },
                "tinglin": {
                    "arrive": "20:01",
                    "depart": "20:02"
                },
                "yexie": {
                    "arrive": "20:08",
                    "depart": "20:09"
                },
                "chedun": {
                    "arrive": "20:16",
                    "depart": "20:17"
                },
                "xinqiao": {
                    "arrive": "20:24",
                    "depart": "20:25"
                },
                "chunshen": {
                    "arrive": "20:33",
                    "depart": "20:34"
                },
                "xinzhuang": {
                    "arrive": "20:40",
                    "depart": "20:41"
                },
                "shanghainan": "20:47"
            }
        },
        {
            "no": "S1206",
            "type": "normal",
            "t": {
                "jinshanwei": "20:10",
                "jinshanyuanqu": {
                    "arrive": "20:19",
                    "depart": "20:20"
                },
                "tinglin": {
                    "arrive": "20:26",
                    "depart": "20:27"
                },
                "yexie": {
                    "arrive": "20:33",
                    "depart": "20:34"
                },
                "chedun": {
                    "arrive": "20:41",
                    "depart": "20:42"
                },
                "xinqiao": {
                    "arrive": "20:49",
                    "depart": "20:50"
                },
                "chunshen": {
                    "arrive": "20:58",
                    "depart": "20:59"
                },
                "xinzhuang": {
                    "arrive": "21:06",
                    "depart": "21:07"
                },
                "shanghainan": "21:14"
            }
        },
        {
            "no": "S1634",
            "type": "normal",
            "t": {
                "jinshanwei": "20:31",
                "jinshanyuanqu": {
                    "arrive": "20:40",
                    "depart": "20:41"
                },
                "tinglin": {
                    "arrive": "20:48",
                    "depart": "20:49"
                },
                "yexie": {
                    "arrive": "20:55",
                    "depart": "20:56"
                },
                "chedun": {
                    "arrive": "21:02",
                    "depart": "21:03"
                },
                "xinqiao": {
                    "arrive": "21:10",
                    "depart": "21:11"
                },
                "chunshen": {
                    "arrive": "21:19",
                    "depart": "21:20"
                },
                "xinzhuang": "21:27"
            }
        },
        {
            "no": "S1160",
            "type": "express",
            "t": {
                "jinshanwei": "20:57",
                "tinglin": {
                    "arrive": "21:09",
                    "depart": "21:10"
                },
                "chedun": {
                    "arrive": "21:19",
                    "depart": "21:20"
                },
                "shanghainan": "21:40"
            }
        },
        {
            "no": "S1210",
            "type": "normal",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "21:19",
                "jinshanyuanqu": {
                    "arrive": "21:28",
                    "depart": "21:29"
                },
                "tinglin": {
                    "arrive": "21:35",
                    "depart": "21:36"
                },
                "yexie": {
                    "arrive": "21:42",
                    "depart": "21:43"
                },
                "chedun": {
                    "arrive": "21:50",
                    "depart": "21:51"
                },
                "xinqiao": {
                    "arrive": "21:58",
                    "depart": "21:59"
                },
                "chunshen": {
                    "arrive": "22:07",
                    "depart": "22:08"
                },
                "xinzhuang": {
                    "arrive": "22:13",
                    "depart": "22:14"
                },
                "shanghainan": "22:21"
            }
        },{
            "no": "S1210",
            "type": "normal",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "21:19",
                "jinshanyuanqu": {
                    "arrive": "21:28",
                    "depart": "21:29"
                },
                "tinglin": {
                    "arrive": "21:35",
                    "depart": "21:36"
                },
                "yexie": {
                    "arrive": "21:42",
                    "depart": "21:43"
                },
                "chedun": {
                    "arrive": "21:50",
                    "depart": "21:51"
                },
                "xinqiao": {
                    "arrive": "21:58",
                    "depart": "21:59"
                },
                "chunshen": {
                    "arrive": "22:07",
                    "depart": "22:08"
                },
                "xinzhuang": {
                    "arrive": "22:15",
                    "depart": "22:16"
                },
                "shanghainan": "22:23"
            }
        },
        {
            "no": "S1016",
            "type": "direct",
            "effectiveUntil":"2026-06-30",
            "t": {
                "jinshanwei": "22:03",
                "shanghainan": "22:39"
            }
        },{
            "no": "S1016",
            "type": "direct",
            "effectiveFrom":"2026-07-01",
            "t": {
                "jinshanwei": "22:03",
                "shanghainan": "22:40"
            }
        },
        {
            "no": "S1014",
            "type": "direct",
            "t": {
                "jinshanwei": "22:30",
                "shanghainan": "23:05"
            }
        }
    ];

// 统一读取站点时间：始发/终到站为字符串，中间站为 { arrive, depart } 对象
// 字符串值直接返回（始发站即发车时间、终到站即到达时间，由调用方上下文决定）
function getStationTime(train, stationId, type) {
  const val = train.t[stationId];
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val[type] || null;
}

// 本地存储 key
const TIMETABLE_STORAGE_KEY = 'timetable_data';
const TIMETABLE_VERSION_KEY = 'timetable_version';
const HOLIDAY_STORAGE_KEY = 'holiday_data';
const UNHOLIDAY_STORAGE_KEY = 'unholiday_data';
const SUSPENSION_STORAGE_KEY = 'suspension_data';

// 初始化 Promise，确保数据就绪后再查询
let initPromise = null;
let holidaySet = null; // 内存缓存：Set of date strings
let unHolidaySet = null; // 内存缓存：调休工作日
let suspensionData = null; // 内存缓存：停运数据
const suspensionCallbacks = []; // 停运数据更新回调

function registerSuspensionUpdateCallback(callback) {
  if (typeof callback === 'function' && !suspensionCallbacks.includes(callback)) {
    suspensionCallbacks.push(callback);
  }
  return () => unregisterSuspensionUpdateCallback(callback);
}

function unregisterSuspensionUpdateCallback(callback) {
  const idx = suspensionCallbacks.indexOf(callback);
  if (idx > -1) suspensionCallbacks.splice(idx, 1);
}

function triggerSuspensionUpdate() {
  suspensionCallbacks.slice().forEach(cb => {
    try {
      cb();
    } catch (e) {
      console.error('[停运] 回调执行失败:', e);
    }
  });
}

// 确保时刻表数据已就绪（等待 checkAndUpdateTimetable 完成）
function ensureTimetableReady() {
  if (!initPromise) {
    initPromise = (async () => {
      const result = await checkAndUpdateTimetable();
      // 确保假日数据已加载（版本匹配时已加载，版本变化时已下载）
      loadHolidayFromStorage();
      // 加载停运数据（远程 + 本地缓存兜底）
      loadSuspensionFromStorage();
      downloadSuspension();
      return result;
    })();
  }
  return initPromise;
}

// 从本地存储加载假日数据到内存 Set
function loadHolidayFromStorage() {
  try {
    const cached = wx.getStorageSync(HOLIDAY_STORAGE_KEY);
    const unh_cached = wx.getStorageSync(UNHOLIDAY_STORAGE_KEY);
    if (Array.isArray(cached) && cached.length > 0) {
      holidaySet = new Set(cached);
    }
    if (Array.isArray(unh_cached) && unh_cached.length > 0) {
      unHolidaySet = new Set(unh_cached);
    }
  } catch (e) { /* ignore */ }
}

// 获取假日日期集合（同步，供 getDateInfo 调用）
function getHolidaySet() {
  if (!holidaySet) {
    loadHolidayFromStorage();
  }
  return holidaySet || new Set();
}

// 获取调休工作日日期集合（同步，供 getDateInfo 调用）
function getUnHolidaySet() {
  if (!unHolidaySet) {
    loadHolidayFromStorage();
  }
  return unHolidaySet || new Set();
}

// 从本地存储读取时刻表数据
function getStoredTimetable() {
  try {
    const data = wx.getStorageSync(TIMETABLE_STORAGE_KEY);
    if (!data) {
      console.log('[时刻表] 本地无数据，将使用硬编码兜底');
      return null;
    }
    if (typeof data !== 'object') {
      console.warn('[时刻表] 本地数据类型异常:', typeof data);
      return null;
    }
    if (!Array.isArray(data.TO_JINSHANWEI) || data.TO_JINSHANWEI.length === 0) {
      console.warn('[时刻表] 本地数据缺少有效的 TO_JINSHANWEI 数组');
      return null;
    }
    if (!Array.isArray(data.TO_SHANGHAINAN) || data.TO_SHANGHAINAN.length === 0) {
      console.warn('[时刻表] 本地数据缺少有效的 TO_SHANGHAINAN 数组');
      return null;
    }
    console.log('[时刻表] 使用本地存储数据，班次数:', data.TO_JINSHANWEI.length + data.TO_SHANGHAINAN.length);
    return data;
  } catch (e) {
    console.error('[时刻表] 读取本地存储失败:', e);
  }
  return null;
}

// 辅助函数：获取某方向全部车次（优先级：本地存储 > 硬编码）
function getTrains(direction) {
  const stored = getStoredTimetable();
  const key = direction === 'to_jinshanwei' ? 'TO_JINSHANWEI' : 'TO_SHANGHAINAN';
  if (stored && stored[key] && Array.isArray(stored[key]) && stored[key].length > 0) {
    return stored[key];
  }
  return direction === 'to_jinshanwei' ? TO_JINSHANWEI : TO_SHANGHAINAN;
}

// 从远程下载并保存时刻表数据
function downloadAndSaveTimetable(remoteVersion) {
  return new Promise((resolve) => {
    wx.request({
      url: 'https://m9ai.work/train/timetable.json?' + Date.now(),
      method: 'GET',
      timeout: 15000,
      success: (timetableRes) => {
        if (timetableRes.statusCode === 200 && timetableRes.data) {
          const data = timetableRes.data;
          if (data.TO_JINSHANWEI && data.TO_SHANGHAINAN &&
              Array.isArray(data.TO_JINSHANWEI) && Array.isArray(data.TO_SHANGHAINAN) &&
              data.TO_JINSHANWEI.length > 0 && data.TO_SHANGHAINAN.length > 0) {
            try {
              wx.setStorageSync(TIMETABLE_STORAGE_KEY, data);
              wx.setStorageSync(TIMETABLE_VERSION_KEY, remoteVersion);
              console.log('[时刻表] 已更新到版本:', remoteVersion);
              resolve({ updated: true, version: remoteVersion });
            } catch (e) {
              console.error('[时刻表] 保存到本地存储失败:', e);
              resolve({ updated: false, error: '保存失败' });
            }
          } else {
            console.error('[时刻表] 在线数据格式不正确');
            resolve({ updated: false, error: '数据格式不正确' });
          }
        } else {
          console.error('[时刻表] 获取时刻表失败，状态码:', timetableRes.statusCode);
          resolve({ updated: false, error: '获取时刻表失败' });
        }
      },
      fail: (err) => {
        console.error('[时刻表] 请求时刻表失败:', err);
        resolve({ updated: false, error: err });
      }
    });
  });
}

// 下载假日数据（时刻表版本号变更时调用）
function downloadHolidays(version) {
  wx.request({
    url: 'https://m9ai.work/train/holidays.json?' + Date.now(),
    method: 'GET',
    timeout: 10000,
    success: (res) => {
      if (res.statusCode === 200 && res.data) {
        if(Array.isArray(res.data.holidays)) {
          try {
            wx.setStorageSync(HOLIDAY_STORAGE_KEY, res.data.holidays);
            holidaySet = new Set(res.data.holidays);
            // console.log('[假日] 已更新，版本:', version, '条数:', res.data.holidays.length);
          } catch (e) {
            console.error('[假日] 缓存失败:', e);
          }
        }
        if(Array.isArray(res.data.unHolidays)) {
          try {
            wx.setStorageSync(UNHOLIDAY_STORAGE_KEY, res.data.unHolidays);
            unHolidaySet = new Set(res.data.unHolidays);
            console.log('[调休工作日] 已更新，版本:', version, '条数:', res.data.unHolidays.length);
          } catch (e) {
            console.error('[调休工作日] 缓存失败:', e);
          }
        }
      } else {
        console.warn('[假日] 接口返回异常，状态码:', res.statusCode);
      }
    },
    fail: () => {
      console.warn('[假日] 下载失败，使用本地缓存');
    }
  });
}

// 检查并更新时刻表（小程序启动时调用）
// 优先级：本地存储 > 在线获取 > 硬编码
// 时刻表与假日共用同一版本号
function checkAndUpdateTimetable() {
  return new Promise((resolve) => {
    wx.request({
      url: 'https://m9ai.work/train/version.json?' + Date.now(),
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.version) {
          const remoteVersion = String(res.data.version);
          let localVersion = '';
          try {
            localVersion = wx.getStorageSync(TIMETABLE_VERSION_KEY) || '';
          } catch (e) {
            console.error('[时刻表] 读取本地版本号失败:', e);
          }

          // 版本一致时，仍需验证本地数据实际存在（防止用户清除存储后只剩版本号）
          if (remoteVersion === localVersion) {
            const localData = getStoredTimetable();
            if (localData) {
              console.log('[时刻表] 版本一致且本地数据有效，版本号:', remoteVersion);
              loadHolidayFromStorage();
              resolve({ updated: false, version: remoteVersion });
              return;
            }
            // 版本号存在但数据丢失，强制重新下载
            console.warn('[时刻表] 版本号存在但本地数据缺失，强制重新下载，版本号:', remoteVersion);
            downloadAndSaveTimetable(remoteVersion).then((result) => {
              downloadHolidays(remoteVersion);
              resolve(result);
            });
            return;
          }

          console.log('[时刻表] 版本不一致，远程:', remoteVersion, '本地:', localVersion);
          downloadAndSaveTimetable(remoteVersion).then((result) => {
            downloadHolidays(remoteVersion);
            resolve(result);
          });
        } else {
          console.error('[时刻表] 获取版本号失败，状态码:', res.statusCode);
          resolve({ updated: false, error: '获取版本号失败' });
        }
      },
      fail: (err) => {
        console.error('[时刻表] 请求版本号失败:', err);
        resolve({ updated: false, error: err });
      }
    });
  });
}

// 辅助函数：查询两站之间的车次
function queryTrains(from, to, direction) {
  const trains = getTrains(direction);
  const result = [];
  trains.forEach(train => {
    const fromTime = getStationTime(train, from, 'depart');
    const toTime = getStationTime(train, to, 'arrive');
    if (fromTime && toTime) {
      result.push({
        trainNo: train.no,
        from: { station: from, time: fromTime },
        to: { station: to, time: toTime }
      });
    }
  });
  return result.sort((a, b) => a.from.time.localeCompare(b.from.time));
}

// 辅助函数：查询某站出发的下一班车
function getNextTrain(station, direction, currentTime) {
  const trains = getTrains(direction);
  const now = currentTime || new Date();
  const timeStr = typeof now === 'string' ? now : `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  for (const train of trains) {
    const depTime = getStationTime(train, station, 'depart');
    if (depTime && depTime > timeStr) {
      return {
        trainNo: train.no,
        departure: { station, time: depTime },
        schedule: train.t
      };
    }
  }
  return null;
}

// ========== 停运数据管理 ==========

// 从远程下载停运数据
function downloadSuspension() {
  wx.request({
    url: 'https://m9ai.work/train/suspension.json?' + Date.now(),
    method: 'GET',
    timeout: 8000,
    success: (res) => {
      if (res.statusCode === 200 && res.data && Array.isArray(res.data.suspensions)) {
        try {
          wx.setStorageSync(SUSPENSION_STORAGE_KEY, res.data);
          suspensionData = res.data;
          console.log('[停运] 已更新，条数:', res.data.suspensions.length);
        } catch (e) {
          console.error('[停运] 缓存失败:', e);
        }
      } else {
        console.log('[停运] 无停运数据或格式异常');
        suspensionData = { suspensions: [] };
      }
      // 通知监听页面刷新（无论是否有停运，都以最新远程结果为准）
      triggerSuspensionUpdate();
    },
    fail: () => {
      console.warn('[停运] 下载失败，使用本地缓存');
    }
  });
}

// 从本地存储加载停运数据
function loadSuspensionFromStorage() {
  try {
    const cached = wx.getStorageSync(SUSPENSION_STORAGE_KEY);
    if (cached && Array.isArray(cached.suspensions)) {
      suspensionData = cached;
    }
  } catch (e) { /* ignore */ }
}

// 获取指定日期的停运信息
// 返回 null 表示该日期无停运；返回对象表示有停运
// { reason: "受台风影响", trains: ["*"] | ["S1007","S1008"] }
function getSuspensionForDate(date) {
  if (!suspensionData || !suspensionData.suspensions) return null;
  return suspensionData.suspensions.find(s => s.date === date) || null;
}

// 检查指定车次在指定日期是否停运
function isTrainSuspended(trainNo, date) {
  const susp = getSuspensionForDate(date);
  if (!susp) return false;
  // trains 为 ["*"] 表示全线停运
  if (susp.trains && susp.trains.length === 1 && susp.trains[0] === '*') return true;
  // 指定车次停运
  return susp.trains && susp.trains.includes(trainNo);
}

module.exports = {
  STATION_ORDER,
  SHANGHAINAN_STATION,
  TO_JINSHANWEI,
  TO_SHANGHAINAN,
  TRAIN_TYPES,
  TIMETABLE_STORAGE_KEY,
  TIMETABLE_VERSION_KEY,
  SUSPENSION_STORAGE_KEY,
  getTrains,
  queryTrains,
  getNextTrain,
  getStationTime,
  getStoredTimetable,
  checkAndUpdateTimetable,
  ensureTimetableReady,
  getHolidaySet,
  getUnHolidaySet,
  downloadSuspension,
  loadSuspensionFromStorage,
  getSuspensionForDate,
  isTrainSuspended,
  registerSuspensionUpdateCallback,
  unregisterSuspensionUpdateCallback
};
