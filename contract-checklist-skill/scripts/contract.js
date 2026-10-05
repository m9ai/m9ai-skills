'use strict';

/**
 * 合同必备条款存在性检查。
 *
 * 只做「有没有提到」的关键词层判断，不做语义判断：
 * 条款写了但写得含糊、前后矛盾、显失公平，脚本一概看不出来，必须由人（或 Agent）读。
 * 所以输出的措辞是「未找到」而不是「缺失/违法」——避免把"没搜到关键词"说成"不合规"。
 *
 * 用法:
 *   node scripts/contract.js check <文本文件> [--type=general|labor|lease] [--json]
 *   node scripts/contract.js --selftest
 */

const fs = require('fs');

// ---------------------------------------------------------------- 条款清单

/**
 * 每项的 keywords 是「提到该条款时通常会出现」的词。
 * required = true 的来自法律明文列举，false 是实务上强烈建议有的。
 */
const PROFILES = {
  general: {
    label: '一般合同',
    basis: '民法典第 470 条',
    items: [
      { key: 'party', label: '当事人名称与住所', required: true, keywords: ['甲方', '乙方', '买方', '卖方', '出租方', '承租方', '委托方', '受托方', '供方', '需方', '发包人', '承包人', '当事人', '住所', '注册地址'] },
      { key: 'subject', label: '标的', required: true, keywords: ['标的', '服务内容', '货物', '产品名称', '项目内容', '工程范围', '工作内容', '采购内容'] },
      { key: 'quantity', label: '数量', required: true, keywords: ['数量', '规格型号', '面积', '件数', '台', '吨', '计量'] },
      { key: 'quality', label: '质量', required: true, keywords: ['质量', '验收', '技术指标', '合格', '标准'] },
      { key: 'price', label: '价款或报酬', required: true, keywords: ['价款', '金额', '报酬', '费用', '单价', '总价', '合同价', '人民币', '付款', '支付', '结算'] },
      { key: 'performance', label: '履行期限、地点和方式', required: true, keywords: ['履行期限', '期限', '交货', '交付', '履行地点', '履行方式', '工期', '服务期限'] },
      { key: 'breach', label: '违约责任', required: true, keywords: ['违约', '违约金', '赔偿', '逾期', '滞纳金'] },
      { key: 'dispute', label: '争议解决方法', required: true, keywords: ['争议', '仲裁', '诉讼', '法院', '管辖'] },
      { key: 'effect', label: '生效与终止', required: false, keywords: ['生效', '终止', '解除', '有效期'] },
      { key: 'signature', label: '签署', required: false, keywords: ['签字', '盖章', '签署', '签订日期', '订立日期'] },
    ],
  },
  labor: {
    label: '劳动合同',
    basis: '劳动合同法第 17 条',
    items: [
      { key: 'employer', label: '用人单位信息', required: true, keywords: ['用人单位', '公司名称', '法定代表人', '主要负责人', '住所', '甲方'] },
      { key: 'employee', label: '劳动者信息', required: true, keywords: ['劳动者', '乙方', '身份证', '住址', '姓名'] },
      { key: 'term', label: '劳动合同期限', required: true, keywords: ['合同期限', '固定期限', '无固定期限', '试用期', '合同期'] },
      { key: 'job', label: '工作内容与工作地点', required: true, keywords: ['工作内容', '工作岗位', '工作地点', '职务', '岗位'] },
      { key: 'hours', label: '工作时间与休息休假', required: true, keywords: ['工作时间', '工时', '休息', '休假', '加班', '年假', '法定节假日'] },
      { key: 'wage', label: '劳动报酬', required: true, keywords: ['劳动报酬', '工资', '薪资', '薪酬', '月薪'] },
      { key: 'insurance', label: '社会保险', required: true, keywords: ['社会保险', '社保', '五险一金', '养老保险', '医疗保险'] },
      { key: 'protection', label: '劳动保护与职业危害防护', required: true, keywords: ['劳动保护', '劳动条件', '职业危害', '安全生产', '职业病'] },
      { key: 'breach', label: '违约责任', required: false, keywords: ['违约', '赔偿', '违约金'] },
      { key: 'signature', label: '签署', required: false, keywords: ['签字', '盖章', '签署', '签订日期'] },
    ],
  },
  lease: {
    label: '租赁合同',
    basis: '民法典第 704 条',
    items: [
      { key: 'property', label: '租赁物', required: true, keywords: ['租赁物', '房屋', '场地', '设备', '坐落', '地址', '商铺'] },
      { key: 'area', label: '数量（面积）', required: true, keywords: ['面积', '平方米', '㎡', '数量', '间'] },
      { key: 'usage', label: '用途', required: true, keywords: ['用途', '用于', '经营', '居住', '办公'] },
      { key: 'term', label: '租赁期限', required: true, keywords: ['租赁期限', '租期', '起租', '止租', '租赁期间'] },
      { key: 'rent', label: '租金及支付方式', required: true, keywords: ['租金', '月租', '押金', '支付', '付款', '保证金'] },
      { key: 'repair', label: '租赁物维修', required: true, keywords: ['维修', '修缮', '维护', '保养'] },
      { key: 'breach', label: '违约责任', required: false, keywords: ['违约', '违约金', '赔偿'] },
      { key: 'dispute', label: '争议解决方法', required: false, keywords: ['争议', '仲裁', '诉讼', '法院'] },
    ],
  },
};

// ------------------------------------------------------------------ 检查

const toHalf = (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');

/** 统计关键词命中；返回 { hit, count, first, hits }，first 是首次命中的下标。 */
function findKeywords(text, keywords) {
  const hits = [];
  for (const kw of keywords) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(kw, from);
      if (i < 0) break;
      hits.push({ kw, index: i });
      from = i + kw.length;
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return { hit: hits.length > 0, count: hits.length, first: hits.length ? hits[0].index : -1, hits };
}

function lineOf(text, index) {
  if (index < 0) return null;
  return (text.slice(0, index).match(/\n/g) || []).length + 1;
}

/** 至少要有两方当事人；只有一方时提示。 */
function countParties(text) {
  const pairs = [
    ['甲方', '乙方'], ['买方', '卖方'], ['出租方', '承租方'],
    ['委托方', '受托方'], ['供方', '需方'], ['发包人', '承包人'], ['用人单位', '劳动者'],
  ];
  const found = [];
  for (const [a, b] of pairs) {
    if (text.includes(a) && text.includes(b)) found.push(`${a}/${b}`);
  }
  const single = new Set();
  for (const [a, b] of pairs) {
    if (text.includes(a) && !text.includes(b)) single.add(a);
    if (text.includes(b) && !text.includes(a)) single.add(b);
  }
  return { pairs: found, singles: [...single] };
}

/** 待填占位符：`____`、`（ ）`、`【 】` 这类。 */
const PLACEHOLDER_RE = /[_＿]{2,}|[（(]\s*[）)]|[【\[]\s*[】\]]|待填|TBD|待定/g;

function findPlaceholders(text) {
  const out = [];
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    const start = Math.max(0, m.index - 12);
    const end = Math.min(text.length, m.index + m[0].length + 12);
    out.push({
      index: m.index,
      text: m[0],
      context: text.slice(start, end).replace(/\n/g, ' '),
    });
  }
  return out;
}

/**
 * @returns {{ profile, items: Array, parties, placeholders, missing: Array }}
 */
function check(text, type) {
  const profile = PROFILES[type] || PROFILES.general;
  const body = toHalf(text);
  const items = profile.items.map((it) => {
    const r = findKeywords(body, it.keywords);
    return {
      key: it.key, label: it.label, required: it.required,
      hit: r.hit, count: r.count, line: lineOf(body, r.first),
      sample: r.hits.slice(0, 3).map((h) => h.kw),
    };
  });
  return {
    profile: { label: profile.label, basis: profile.basis },
    items,
    parties: countParties(body),
    placeholders: findPlaceholders(body),
    missing: items.filter((i) => i.required && !i.hit),
  };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const checkEq = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  const full = [
    '甲方：某某科技有限公司，住所：上海市。',
    '乙方：某某贸易公司。',
    '一、标的：乙方提供服务器设备，数量 10 台，规格型号见附件。',
    '二、质量标准：符合国家相关标准，验收合格后付款。',
    '三、价款：合同总价人民币 100000 元，付款方式为转账。',
    '四、履行期限：2026 年 3 月 1 日前交货至甲方指定地点。',
    '五、违约责任：逾期交付按日支付违约金。',
    '六、争议解决：提交上海仲裁委员会仲裁。',
    '七、本合同自双方签字盖章之日起生效。',
    '甲方（盖章）：　　乙方（盖章）：',
  ].join('\n');

  console.log('完整合同');
  let r = check(full, 'general');
  checkEq('必备条款全命中', r.missing.map((i) => i.key), []);
  checkEq('识别出双方', r.parties.pairs, ['甲方/乙方']);
  checkEq('无占位符', r.placeholders.length, 0);

  console.log('缺条款');
  const partial = '甲方：A公司。乙方：B公司。标的：咨询服务。价款：人民币 5000 元。';
  r = check(partial, 'general');
  checkEq('缺失项被列出', r.missing.map((i) => i.key).sort(), ['breach', 'dispute', 'performance', 'quality', 'quantity']);

  console.log('单方当事人');
  r = check('甲方：A公司。标的：设备。', 'general');
  checkEq('只有一方时提示', r.parties.singles, ['甲方']);

  console.log('占位符');
  r = check('价款：人民币 ______ 元，交付日期：____年__月', 'general');
  checkEq('检出 3 处占位符', r.placeholders.length, 3);
  r = check('本合同金额为人民币 10000 元。', 'general');
  checkEq('正常文本无占位符', r.placeholders.length, 0);

  console.log('劳动合同');
  const labor = [
    '用人单位：某某公司，法定代表人：张三。',
    '劳动者：李四，身份证号：11010519491231002X。',
    '劳动合同期限：三年，其中试用期六个月。',
    '工作内容：软件开发工程师，工作地点：上海。',
    '工作时间：标准工时制，依法享受休息休假与年假。',
    '劳动报酬：月薪 20000 元。',
    '社会保险：依法缴纳五险一金。',
    '劳动保护：提供符合国家规定的劳动条件与职业危害防护。',
  ].join('\n');
  r = check(labor, 'labor');
  checkEq('劳动法必备条款齐全', r.missing.map((i) => i.key), []);
  r = check('用人单位：某某公司。劳动者：李四。', 'labor');
  checkEq('缺社保等被列出', r.missing.map((i) => i.key).includes('insurance'), true);

  console.log('租赁合同');
  const lease = '租赁物：上海市某商铺，面积 200 平方米，用途为餐饮经营。租赁期限三年，月租金 50000 元，押金三个月。维修由出租方负责。';
  r = check(lease, 'lease');
  checkEq('租赁必备条款齐全', r.missing.map((i) => i.key), []);

  console.log('位置定位');
  checkEq('行号', lineOf('abc\ndef', 4), 2);
  checkEq('未命中返回 null', lineOf('abc', -1), null);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `合同必备条款存在性检查（只做关键词层判断，不做语义判断）

用法:
  node scripts/contract.js check <文本文件> [--type=general|labor|lease] [--json]
  node scripts/contract.js --selftest

选项:
  --type=general  合同类型，默认 general
                  general 一般合同（民法典第 470 条）
                  labor   劳动合同（劳动合同法第 17 条）
                  lease   租赁合同（民法典第 704 条）
  --json          输出 JSON

输入是纯文本。.docx / .pdf 需先转成文本再检查。

说明:
  本脚本判断的是「有没有提到这类内容」，不是「条款是否完备或合法」。
  条款写了但含糊、前后矛盾、显失公平，脚本一概看不出来，必须由人阅读判断。

退出码: 0 = 必备条款均有提及，1 = 有必备条款未找到，2 = 用法错误`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'check') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  let type = 'general'; let json = false; let file = null;
  for (const arg of argv.slice(1)) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--type=')) type = arg.slice(7);
    else if (!arg.startsWith('--')) file = arg;
  }
  if (!file) { console.error('需要文本文件\n\n' + USAGE); process.exit(2); }
  if (!PROFILES[type]) { console.error(`未知合同类型: ${type}（可选 ${Object.keys(PROFILES).join(' / ')}）`); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }

  const buf = fs.readFileSync(file);
  let text;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString('utf8', 3);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = buf.toString('utf8'); }
  }

  const r = check(text, type);

  if (json) {
    console.log(JSON.stringify({
      file, type, profile: r.profile,
      items: r.items,
      parties: r.parties,
      placeholders: r.placeholders,
      missing: r.missing.map((i) => i.key),
    }, null, 2));
    process.exit(r.missing.length ? 1 : 0);
  }

  console.log(`文件: ${file}`);
  console.log(`类型: ${r.profile.label}（依据 ${r.profile.basis}）`);
  console.log('');

  console.log('--- 条款检查 ---');
  for (const it of r.items) {
    const mark = it.hit ? '✓' : (it.required ? '✗' : '·');
    const level = it.required ? '必备' : '建议';
    const where = it.hit ? `命中 ${it.count} 处，首次在第 ${it.line} 行（${it.sample.join('、')}）` : '未找到相关表述';
    console.log(`  ${mark} [${level}] ${it.label.padEnd(14)} ${where}`);
  }
  console.log('');

  console.log('--- 当事人 ---');
  if (r.parties.pairs.length) console.log(`  ✓ 找到双方称谓：${r.parties.pairs.join('，')}`);
  else console.log('  ✗ 未找到成对的当事人称谓（甲方/乙方 等）');
  for (const s of r.parties.singles) console.log(`  ⚠ 只写了「${s}」，未见对应另一方`);
  console.log('');

  if (r.placeholders.length) {
    console.log(`--- 待填占位符（${r.placeholders.length} 处）---`);
    for (const p of r.placeholders) {
      console.log(`  第 ${lineOf(toHalf(text), p.index)} 行  …${p.context}…`);
    }
    console.log('');
  }

  if (r.missing.length) {
    console.log(`未找到的必备条款 ${r.missing.length} 项：${r.missing.map((i) => i.label).join('、')}`);
    console.log('');
    console.log('注意：这只是「文本里没有提到」，不等于条款缺失或合同不合规——');
    console.log('可能是用了别的措辞，也可能写在附件里。请结合原文与附件人工确认。');
  } else {
    console.log('✓ 各项必备条款均有提及。仍需人工确认措辞是否完备、前后是否一致。');
  }

  if (r.missing.length) process.exit(1);
}

main();
