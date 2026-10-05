#!/usr/bin/env node
// 违禁词扫描：归一化后匹配，能识别出插入空格/符号/全角/同形字等规避写法。
//
// 用法：
//   node scripts/scan.js <文件或目录> [--words=<词表>] [--category=导流,虚假宣传] [--json]
//   node scripts/scan.js --text="待检测文案" [--words=<词表>]
//   node scripts/scan.js --selftest
//
// 归一化会去掉空白与插入符号，所以「微 信」「微-信」「VX」「薇信」都能命中。
// 语义层面的变体（换个说法但意思一样）脚本识别不了，必须交给 Agent 判断。

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WORDS = path.join(__dirname, '..', 'references', 'banned-words.txt');

// 归一化时要丢掉的字符：空白、常见插入符号、零宽字符、装饰性符号
const IGNORED = /[\s　·•●◆★☆▪▫◾◽。．.,、，;；:：!！?？~～\-_—*＊·'"“”‘’()（）\[\]【】<>《》/\\|@＠#＃❤♥♡♠♣♦]/;
const ZERO_WIDTH = /[​-‏﻿‌‍]/g;

/** 全角转半角。 */
function toHalfWidth(input) {
  return input
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/**
 * 归一化，同时记录每个归一化字符对应的原始下标，便于回指原文位置。
 * @returns {{ norm: string, map: number[] }} map[i] = norm[i] 在原文中的下标
 */
function normalizeWithMap(text) {
  const cleaned = text.replace(ZERO_WIDTH, '');
  let norm = '';
  const map = [];

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const converted = toHalfWidth(ch).toLowerCase();
    for (const out of converted) {
      if (IGNORED.test(out)) continue;
      norm += out;
      map.push(i);
    }
  }
  return { norm, map };
}

/** 词表解析：分类|主词|别名... */
function loadWords(file) {
  const entries = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const parts = trimmed.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const [category, main, ...aliases] = parts;
    entries.push({
      category,
      word: main,
      // 别名里也含主词，一并参与匹配
      variants: [main, ...aliases].map((v) => normalizeWithMap(v).norm).filter(Boolean),
      line: i + 1,
    });
  });
  return entries;
}

/** 由原文下标算出行号（1 起）。 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function contextOf(text, start, end) {
  const lines = text.split('\n');
  const line = lineAt(text, start);
  const raw = lines[line - 1] || '';
  const trimmed = raw.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

/**
 * 扫描一段文本。
 * @returns {{ hits: Array, checkedWords: number }}
 */
function scanText(text, entries) {
  const { norm, map } = normalizeWithMap(text);
  const hits = [];
  const claimed = new Array(norm.length).fill(false);

  for (const entry of entries) {
    for (const variant of entry.variants) {
      if (variant === '') continue;
      let from = 0;
      for (;;) {
        const at = norm.indexOf(variant, from);
        if (at === -1) break;
        from = at + 1;

        // 同一条词在同一位置只报一次（别名互相包含时会重复命中）
        let overlapped = false;
        for (let k = at; k < at + variant.length; k++) {
          if (claimed[k]) {
            overlapped = true;
            break;
          }
        }
        if (overlapped) continue;
        for (let k = at; k < at + variant.length; k++) claimed[k] = true;

        const start = map[at];
        const end = map[at + variant.length - 1] + 1;
        hits.push({
          category: entry.category,
          word: entry.word,
          matched: text.slice(start, end),
          line: lineAt(text, start),
          context: contextOf(text, start, end),
        });
      }
    }
  }

  hits.sort((a, b) => a.line - b.line);
  return { hits, checkedWords: entries.length };
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

  const entries = [
    { category: '导流', word: '微信', variants: ['微信', 'weixin', 'wx', 'vx', '薇信'] },
    { category: '导流', word: 'QQ', variants: ['qq'] },
    { category: '虚假宣传', word: '包过', variants: ['包过', '保过'] },
  ];
  const words = (text) => scanText(text, entries).hits.map((h) => h.word);

  // 变体检测
  check('直接命中', words('加我微信'), ['微信']);
  check('插入空格', words('加我微 信'), ['微信']);
  check('插入符号', words('加我微-信'), ['微信']);
  check('全角', words('加我ＷＸ'), ['微信']);
  check('拼音别名', words('weixin: abc'), ['微信']);
  check('字母别名', words('vx: abc'), ['微信']);
  check('同形字别名', words('加我薇信'), ['微信']);
  check('大小写不敏感', words('加我QQ'), ['QQ']);
  check('零宽字符', words('微​信'), ['微信']);
  check('换行不影响', words('微\n信'), ['微信']);
  check('无命中', words('这是一段正常文案'), []);

  // 命中位置能回指原文
  const hit = scanText('前缀 微 信 后缀', entries).hits[0];
  check('能回指原文片段', hit.matched, '微 信');
  check('行号正确', scanText('第一行\n第二行 微信', entries).hits[0].line, 2);

  // 别名互相包含时不重复报
  check('重叠命中只报一次', words('微信').length, 1);

  // 词表解析
  const parsed = loadWords(DEFAULT_WORDS);
  check('内置词表可解析', parsed.length > 0, true);
  check('内置词表含分类', parsed.every((e) => e.category && e.word), true);
  check('主词参与匹配', scanText('加我微信', parsed).hits.length > 0, true);

  console.log(`\n失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const opts = { json: false, selftest: false, words: DEFAULT_WORDS, categories: null, text: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--words') opts.words = argv[++i];
    else if (arg.startsWith('--words=')) opts.words = arg.slice('--words='.length);
    else if (arg === '--category') opts.categories = argv[++i].split(',').map((s) => s.trim());
    else if (arg.startsWith('--category=')) opts.categories = arg.slice('--category='.length).split(',').map((s) => s.trim());
    else if (arg === '--text') opts.text = argv[++i];
    else if (arg.startsWith('--text=')) opts.text = arg.slice('--text='.length);
    else if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
    else opts.rest.push(arg);
  }
  return opts;
}

function listTextFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(txt|md|markdown|csv|json|html)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(target);
  return out.sort();
}

const USAGE = `用法:
  node scripts/scan.js <文件或目录> [--words=<词表>] [--category=导流,虚假宣传] [--json]
  node scripts/scan.js --text="待检测文案" [--words=<词表>] [--json]
  node scripts/scan.js --selftest`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(2);
  }

  if (opts.selftest) process.exit(runSelftest());

  if (!fs.existsSync(opts.words)) {
    console.error(`错误: 词表不存在 ${opts.words}`);
    process.exit(2);
  }
  let entries = loadWords(opts.words);
  if (opts.categories) entries = entries.filter((e) => opts.categories.includes(e.category));
  if (entries.length === 0) {
    console.error('错误: 词表为空或指定分类下没有词');
    process.exit(2);
  }

  const targets = opts.text !== null ? [{ file: '(直接输入)', text: opts.text }] : null;
  if (!targets && opts.rest.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  const files = targets ? null : listTextFiles(opts.rest[0]);
  if (files && files.length === 0) {
    console.error(`错误: ${opts.rest[0]} 下没有可扫描的文本文件`);
    process.exit(2);
  }

  const results = (targets || files.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }))).map(
    ({ file, text }) => ({ file, ...scanText(text, entries) })
  );

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    let total = 0;
    for (const r of results) {
      if (r.hits.length === 0) {
        console.log(`✓ ${r.file}  未命中`);
        continue;
      }
      console.log(`${r.file}`);
      for (const h of r.hits) {
        console.log(`  L${String(h.line).padStart(3)}  [${h.category}] ${h.word}  命中「${h.matched}」`);
        console.log(`         ${h.context}`);
      }
      total += r.hits.length;
    }
    console.log(`\n检查了 ${entries.length} 个词，共命中 ${total} 处`);
    console.log('注意：脚本只做字形层面的变体识别，语义层面的规避说法需要另行判断。');
  }
  process.exit(results.some((r) => r.hits.length > 0) ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { scanText, loadWords, normalizeWithMap };
