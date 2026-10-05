'use strict';

/**
 * 广告法风险词检测。
 *
 * 依据《广告法》第九条第（三）项：不得使用「国家级」「最高级」「最佳」等用语。
 * 词库分三级：
 *   high   = 法律明文列举，或执法实践中几乎必然被认定的绝对化用语
 *   medium = 常见被处罚但需结合语境判断的极限词
 *   low    = 与疗效、绝对承诺相关的警惕词（多见于医疗、保健食品）
 *
 * 只能标记疑似，**不能判定违法**：同一个词在「最佳食用期」「第一层」这类
 * 语境里完全合法。脚本做几条明显的豁免，其余必须人工读上下文判断。
 *
 * 用法:
 *   node scripts/adlaw.js check <文件|-> [--allow=词,词] [--min-level=high] [--json]
 *   node scripts/adlaw.js --selftest
 */

const fs = require('fs');

// ------------------------------------------------------------------ 词库

/** 法律明文列举或实践中几乎必然被认定的。 */
const HIGH_WORDS = [
  '国家级', '最高级', '最佳', '最好', '最优', '最强', '最高', '最低', '最便宜', '最省',
  '最划算', '最先进', '顶级', '顶尖', '极致', '极品', '绝对', '万能',
  '第一品牌', '销量第一', '行业第一', '全国第一', '世界第一', '全球第一', '排名第一', '中国第一',
  '独一无二', '绝无仅有', '史无前例', '前所未有', '前无古人',
  '百分百', '百分之一百', '100%', '全网最低', '史上最低', '最优秀', '最专业',
];

/** 常见被处罚但需结合语境。 */
const MEDIUM_WORDS = [
  '第一', '唯一', '首选', '首创', '独家', '领先', '领导者', '领军',
  '最新', '最热', '最受欢迎', '最优惠', '超值', '超级', '极致体验',
  '最好用', '最靠谱', '销量冠军', '口碑第一', '遥遥领先',
];

/** 医疗、保健食品等场景的警惕词。 */
const LOW_WORDS = [
  '特效', '速效', '根治', '无副作用', '彻底', '完全', '永久', '终身',
  '包治', '药到病除', '神奇', '立竿见影',
];

/**
 * 明显合法的语境，命中即跳过。
 * 只做最有把握的几条——过度豁免会让风险词从报告里消失，比误报更危险。
 */
const EXEMPTIONS = [
  { re: /最佳(?:食用|赏味|保存|使用|饮用|保质)期?/g, note: '最佳食用期等法定/惯用标识' },
  { re: /第[一二三四五六七八九十百千万0-9]+(?:名|次|步|层|章|节|批|轮|天|年|季度|周|版|条|款|项|位|集|季)/g, note: '序数词或名次表述' },
  { re: /最(?:高|低)(?:气温|温度|海拔|气压|水位|时速)/g, note: '客观数值描述' },
  { re: /最大(?:载重|承重|容量|功率|马力|行程|续航)/g, note: '客观规格参数' },
];

const LEVEL_ORDER = { high: 3, medium: 2, low: 1 };
const LEVEL_LABEL = { high: '高', medium: '中', low: '低' };

// ------------------------------------------------------------------ 检测

/** 找出所有豁免区间，命中落在区间内的跳过。 */
function exemptRanges(text) {
  const ranges = [];
  for (const ex of EXEMPTIONS) {
    ex.re.lastIndex = 0;
    let m;
    while ((m = ex.re.exec(text)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, note: ex.note });
    }
  }
  return ranges;
}

/**
 * @returns {Array<{ word, level, index, line, column, context }>}
 */
function scanText(text, opts) {
  const ranges = exemptRanges(text);
  const allow = new Set(opts.allow || []);
  const hits = [];

  const addWord = (word, level) => {
    if (allow.has(word)) return;
    let from = 0;
    for (;;) {
      const i = text.indexOf(word, from);
      if (i < 0) break;
      from = i + word.length;
      // 落在豁免区间内的跳过
      if (ranges.some((r) => i >= r.start && i < r.end)) continue;
      // 已被更长的词覆盖（如「第一」是「第一品牌」的一部分）则跳过
      if (hits.some((h) => h.index <= i && i < h.index + h.word.length)) continue;
      const before = text.slice(0, i);
      const line = (before.match(/\n/g) || []).length + 1;
      const column = i - (before.lastIndexOf('\n') + 1) + 1;
      const ctxStart = Math.max(0, i - 12);
      const ctxEnd = Math.min(text.length, i + word.length + 12);
      hits.push({
        word, level, index: i, line, column,
        context: text.slice(ctxStart, ctxEnd).replace(/\n/g, ' '),
      });
    }
  };

  // 长的先匹配，避免「第一」抢掉「第一品牌」
  const byLength = (arr) => arr.slice().sort((a, b) => b.length - a.length);
  for (const w of byLength(HIGH_WORDS)) addWord(w, 'high');
  for (const w of byLength(MEDIUM_WORDS)) addWord(w, 'medium');
  for (const w of byLength(LOW_WORDS)) addWord(w, 'low');

  hits.sort((a, b) => a.index - b.index);
  return opts.minLevel ? hits.filter((h) => LEVEL_ORDER[h.level] >= LEVEL_ORDER[opts.minLevel]) : hits;
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const s = (text, opts) => scanText(text, opts || {}).map((h) => `${h.level}:${h.word}`);
  const O = (extra) => ({ allow: [], minLevel: null, ...extra });

  console.log('高风险词');
  check('国家级', s('荣获国家级奖项'), ['high:国家级']);
  check('最佳', s('最佳选择'), ['high:最佳']);
  check('顶级', s('顶级配置'), ['high:顶级']);
  check('第一品牌', s('打造第一品牌'), ['high:第一品牌']);
  check('行业第一', s('行业第一的口碑'), ['high:行业第一']);
  check('100%', s('100%有效'), ['high:100%']);

  console.log('中风险词');
  check('第一', s('我们是第一'), ['medium:第一']);
  check('首选', s('消费者的首选'), ['medium:首选']);
  check('领先', s('技术领先'), ['medium:领先']);

  console.log('低风险词');
  check('根治', s('根治失眠'), ['low:根治']);
  check('无副作用', s('无副作用'), ['low:无副作用']);

  console.log('长词优先（第一品牌 不被 第一 抢走）');
  check('长词优先', s('第一品牌'), ['high:第一品牌']);

  console.log('豁免语境');
  check('最佳食用期豁免', s('最佳食用期至 2027 年'), []);
  check('序数词豁免', s('这是第一层'), []);
  check('名次表述豁免', s('获得第一名'), []);
  check('客观参数豁免', s('最大载重 500kg'), []);
  check('气温描述豁免', s('最低气温零下 5 度'), []);

  console.log('用户豁免');
  check('--allow 生效', s('国家级', O({ allow: ['国家级'] })), []);
  check('未豁免的仍报', s('国家级和最佳', O({ allow: ['国家级'] })), ['high:最佳']);

  console.log('级别过滤');
  check('只看高风险', s('顶级材料，消费者的首选，根治失眠', O({ minLevel: 'high' })), ['high:顶级']);
  check('中风险以上', s('顶级材料，消费者的首选，根治失眠', O({ minLevel: 'medium' })), ['high:顶级', 'medium:首选']);

  console.log('定位');
  const hits = scanText('abc\n荣获国家级奖项', O());
  check('行号', hits[0].line, 2);
  check('列号', hits[0].column, 3);
  check('上下文', hits[0].context.includes('国家级'), true);

  console.log('干净文案');
  check('无风险词', s('本产品采用优质材料，做工精细，欢迎选购。'), []);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `广告法风险词检测

用法:
  node scripts/adlaw.js check <文件|-> [--allow=词,词] [--min-level=high] [--json]
  node scripts/adlaw.js --selftest

选项:
  --allow=词,词      豁免指定词（如 --allow=第一 用于确实需要保留的语境）
  --min-level=high   只报告该级别及以上，可选 high / medium / low
  --json             输出 JSON

依据:
  《广告法》第九条第（三）项：不得使用「国家级」「最高级」「最佳」等用语。
  high   = 明文列举或实践中几乎必然被认定
  medium = 常见被处罚但需结合语境
  low    = 疗效与绝对承诺类警惕词

说明:
  只能标记疑似，不能判定违法。「最佳食用期」「第一层」这类合法用法已做豁免，
  其余必须结合上下文人工判断。

退出码: 0 = 未发现，1 = 发现 high 级，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { allow: [], minLevel: null, json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--allow=')) opts.allow = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--min-level=')) opts.minLevel = arg.slice(12);
    else rest.push(arg);
  }
  return { opts, rest };
}

function readInput(file) {
  if (file === '-' || file === undefined) return fs.readFileSync(0, 'utf8');
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return buf.toString('utf8'); }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'check') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const file = rest[0];
  const text = readInput(file);
  const hits = scanText(text, opts);

  const counts = { high: 0, medium: 0, low: 0 };
  for (const h of hits) counts[h.level]++;

  if (opts.json) {
    console.log(JSON.stringify({
      file: file || '<stdin>',
      counts,
      total: hits.length,
      hits: hits.map((h) => ({ word: h.word, level: h.level, line: h.line, column: h.column, context: h.context })),
    }, null, 2));
    process.exit(counts.high ? 1 : 0);
  }

  console.log(`文件: ${file || '<stdin>'}`);
  if (!hits.length) {
    console.log('未发现风险词。');
    console.log('');
    console.log('注意：未发现不等于合规——词库只覆盖常见的绝对化用语与疗效承诺，');
    console.log('虚假宣传、数据无依据、贬低同行等问题本工具查不出来。');
    return;
  }

  console.log(`发现 ${hits.length} 处风险词（高 ${counts.high} / 中 ${counts.medium} / 低 ${counts.low}）`);
  console.log('');
  for (const h of hits) {
    console.log(`  ${String(h.line).padStart(4)}:${String(h.column).padStart(3)}  [${LEVEL_LABEL[h.level]}] ${h.word.padEnd(6)} …${h.context}…`);
  }
  console.log('');

  const tally = new Map();
  for (const h of hits) tally.set(`${h.level}:${h.word}`, (tally.get(`${h.level}:${h.word}`) || 0) + 1);
  console.log('汇总');
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    const [level, word] = k.split(':');
    console.log(`  [${LEVEL_LABEL[level]}] ${word} ${n}`);
  }
  console.log('');
  console.log('已自动豁免：最佳食用期等法定标识、序数词与名次表述、客观数值（最低气温、最大载重等）。');
  console.log('其余仍需人工读上下文判断——同一个词在「第一层」和「行业第一」里性质完全不同。');

  if (counts.high) process.exit(1);
}

main();
