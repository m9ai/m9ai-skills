// 金山铁路站点信息
// 数据来源：金山铁路官方微信公众号

const STATIONS = [
  {
    id: 'shanghainan',
    name: '上海南站',
    shortName: '上海南',
    district: '徐汇区',
    address: '上海市徐汇区沪闵路9001号',
    phone: '021-51245499',
    latitude: 31.157,
    longitude: 121.431,
    image: 'https://m9ai.work/train/shanghainan.jpg',
    hours: '5:00-23:00',
    hoursNote: '24小时自助售票',
    order: 0,
    isTerminal: true,
    transfers: {
      metro: ['1号线', '3号线', '15号线'],
      bus: [
        { location: '北广场', lines: ['729路', '747路', '763路', '1252路', '虹桥枢纽1路', '301路夜宵线', '303路夜宵线'] },
        { location: '南广场', lines: ['50路', '111路', '156路', '218路', '729路', '747路', '803路', '徐闵线', '上奉专线', '南南线', '上嘉线', '上石线'] }
      ]
    }
  },
  {
    id: 'jinshanwei',
    name: '金山卫站',
    shortName: '金山卫',
    district: '金山区',
    address: '上海市金山区龙胜东路8888号',
    phone: '021-51248281',
    latitude: 30.725,
    longitude: 121.340,
    image: 'https://m9ai.work/train/jinshanwei.jpg',
    hours: '5:30-23:00',
    hoursNote: '22:30-23:00仅办理出站业务',
    order: 1,
    isTerminal: true,
    transfers: {
      metro: [],
      bus: [
        { location: '金山卫南广场东站', lines: ['金山1路', '金山2路', '金山8路', '金山115路', '金张卫支线', '朱钱卫线', '朱石专线', '枫戚快线', '奉卫线', '石南专线', 'DZ乐卫线（周末/节假日）'] },
        { location: '金山卫南广场西站', lines: ['金山11路', '港区227路', '平湖228路'] },
        { location: '金山卫北广场', lines: ['金山4路', '金山7路', '金山10路'] }
      ]
    }
  },
  {
    id: 'jinshanyuanqu',
    name: '金山园区站',
    shortName: '金山园区',
    district: '金山区',
    address: '上海市金山区漕泾镇天工路',
    phone: '021-51248212',
    latitude: 30.830,
    longitude: 121.380,
    image: 'https://m9ai.work/train/jinshanyuanqu.jpg',
    hours: '5:40-22:50',
    hoursNote: '',
    order: 2,
    isTerminal: false,
    transfers: {
      metro: [],
      bus: [
        { location: '站外', lines: ['亭卫专线', '金山工业区3路(1652)', '金山工业区6路(1656)', '金山工业区5路（1655）', '金山工业区5路区间（1658）', '金山中部环线'] }
      ]
    }
  },
  {
    id: 'tinglin',
    name: '亭林站',
    shortName: '亭林',
    district: '金山区',
    address: '上海市金山区亭林镇龙泉路',
    phone: '021-51248251',
    latitude: 30.910,
    longitude: 121.340,
    image: 'https://m9ai.work/train/tinglin.jpg',
    hours: '5:45-22:45',
    hoursNote: '',
    order: 3,
    isTerminal: false,
    transfers: {
      metro: [],
      bus: [
        { location: '站外', lines: ['亭林3路', '浦亭线', '亭卫专线B线', '南金线', '莲亭专线', 'DZ乐南线（周末/节假日）'] }
      ]
    }
  },
  {
    id: 'yexie',
    name: '叶榭站',
    shortName: '叶榭',
    district: '松江区',
    address: '上海市松江区叶榭镇叶权路',
    phone: '021-51248222',
    latitude: 30.965,
    longitude: 121.310,
    image: 'https://m9ai.work/train/yexie.jpg',
    hours: '5:50-22:35',
    hoursNote: '',
    order: 4,
    isTerminal: false,
    transfers: {
      metro: [],
      bus: [
        { location: '站外', lines: ['松江31路', '松江36路', '松江65路', '1826路', '882路'] }
      ]
    }
  },
  {
    id: 'chedun',
    name: '车墩站',
    shortName: '车墩',
    district: '松江区',
    address: '上海市松江区车墩镇车峰路',
    phone: '021-51248263',
    latitude: 31.025,
    longitude: 121.310,
    image: 'https://m9ai.work/train/chedun.jpg',
    hours: '5:45-22:30',
    hoursNote: '',
    order: 5,
    isTerminal: false,
    transfers: {
      metro: [],
      bus: [
        { location: '站外', lines: ['松江60路', '松江61路', '松江6路', '松江53路', '1820路'] }
      ]
    }
  },
  {
    id: 'xinqiao',
    name: '新桥站',
    shortName: '新桥',
    district: '松江区',
    address: '上海市松江区新桥镇新育路',
    phone: '021-51248291',
    latitude: 31.060,
    longitude: 121.320,
    image: 'https://m9ai.work/train/xinqiao.jpg',
    hours: '5:40-22:20',
    hoursNote: '',
    order: 6,
    isTerminal: false,
    transfers: {
      metro: ['松江区有轨电车1号线'],
      bus: [
        { location: '站外', lines: ['125路', '125路B线', '708路', '1812路', '1813路', '松江50路', '松江51路', '松江52路', '松江53路'] }
      ]
    }
  },
  {
    id: 'chunshen',
    name: '春申站',
    shortName: '春申',
    district: '松江区',
    address: '上海市松江区新桥镇站前路',
    phone: '021-51248285',
    latitude: 31.095,
    longitude: 121.340,
    image: 'https://m9ai.work/train/chunshen.jpg',
    hours: '5:30-22:10',
    hoursNote: '',
    order: 7,
    isTerminal: false,
    transfers: {
      metro: [],
      bus: [
        { location: '站外', lines: ['松江68路', '1814路', '松江49路内环', '松江49路外环'] }
      ]
    }
  },
  {
    id: 'xinzhuang',
    name: '莘庄站',
    shortName: '莘庄',
    district: '闵行区',
    address: '上海市闵行区莘庄镇莘朱路272号',
    phone: '021-51246329',
    latitude: 31.111,
    longitude: 121.384,
    image: 'https://m9ai.work/train/xinzhuang.jpg',
    hours: '6:25-22:20',
    hoursNote: '',
    order: 8,
    isTerminal: false,
    transfers: {
      metro: ['1号线', '5号线'],
      bus: [
        { location: '北广场', lines: ['莘庄1路', '莘庄2路', '莘庄3路', '闵行55路', '闵行6路', '闵行1路', '189路', '173路', '708路', '763路', '759路', '莘庄3路B线'] },
        { location: '南广场', lines: ['闵行25路', '闵行30路', '闵行41路', '闵行9路', '143路', '873路', '725路', '莘金专线', '莘南专线', '莘庄工业区1路', '闵行DZ9路'] }
      ]
    }
  }
];

// 线路方向定义
const DIRECTIONS = [
  {
    id: 'to_jinshanwei',
    name: '往金山卫',
    from: '莘庄',
    to: '金山卫',
    fromStationId: 'xinzhuang',
    toStationId: 'jinshanwei',
    color: '#1AAD19'
  },
  {
    id: 'to_xinzhuang',
    name: '往莘庄',
    from: '金山卫',
    to: '莘庄',
    fromStationId: 'jinshanwei',
    toStationId: 'xinzhuang',
    color: '#10AEFF'
  }
];

module.exports = {
  STATIONS,
  DIRECTIONS
};
