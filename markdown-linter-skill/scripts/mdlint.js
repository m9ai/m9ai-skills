#!/usr/bin/env node
// Markdown 规范检查与修复：标题层级、列表、代码块围栏、链接、表格对齐。
//
// 用法：
//   node scripts/mdlint.js check <文件或目录> [--json]
//   node scripts/mdlint.js fix <文件> [-o 输出] [--force] [--json]
//   node scripts/mdlint.js --selftest

'use strict';

const fs = require('fs');
const path = require('path');

const LIST_MARKERS = ['-', '*', '+'];

// ---------------------------------------------------------------- 工具

/** 显示宽度：CJK 按 2 计，否则对齐会在中文表格里错乱。 */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

function padEnd(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/** 按未转义的 | 切分单元格。 */
function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

// ---------------------------------------------------------------- 检查

/**
 * @returns {{ line: number, code: string, message: string, fixable: boolean }[]}
 */
function lint(text, options) {
  const issues = [];
  const lines = text.split('\n');
  const add = (line, code, message, fixable) => issues.push({ line: line + 1, code, message, fixable });

  let inFence = false;
  let fenceMarker = '';
  let fenceStartLine = 0;
  let fenceHasLanguage = false;

  const headings = [];
  let previousListMarker = null;

  lines.forEach((raw, i) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceStartLine = i;
        fenceHasLanguage = fenceMatch[1].length > 3 || /^\s*(```|~~~)\s*\S/.test(raw);
        // 围栏起始行允许直接跟语言，这里只看是否有内容
        const info = raw.slice(raw.indexOf(marker) + fenceMatch[1].length).trim();
        if (info === '') add(i, 'MD040', '代码块围栏缺少语言标注', false);
        return;
      }
      if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      return;
    }
    if (inFence) return;

    // 行尾空白
    if (/[ \t]+$/.test(raw)) add(i, 'MD009', '行尾有多余空白', true);

    // 制表符缩进
    if (/^\t/.test(raw)) add(i, 'MD010', '使用制表符缩进，建议改为空格', true);

    // 标题
    const heading = /^(#{1,6})(\s+)(.*)$/.exec(raw);
    if (heading) {
      const level = heading[1].length;
      const title = heading[3].trim();
      headings.push({ line: i, level, title });

      if (heading[2].length > 1) add(i, 'MD019', '井号与标题文字之间有多个空格', true);
      if (title === '') add(i, 'MD021', '标题内容为空', false);
      if (/[。！？，；：]$/.test(title)) add(i, 'MD026', '标题末尾有多余标点', false);

      const previous = headings[headings.length - 2];
      if (previous && level > previous.level + 1) {
        add(i, 'MD001', `标题层级跳级：H${previous.level} 直接到 H${level}`, false);
      }
      return;
    }

    // 无序列表符号统一
    const list = /^(\s*)([-*+])(\s+)\S/.exec(raw);
    if (list) {
      const marker = list[2];
      if (previousListMarker && marker !== previousListMarker) {
        add(i, 'MD004', `无序列表符号混用：上一项用 "${previousListMarker}"，这里用 "${marker}"`, true);
      }
      previousListMarker = marker;
      if (list[3].length > 1) add(i, 'MD027', '列表符号与内容之间有多个空格', true);
      return;
    }
    if (raw.trim() !== '' && !/^\s*[0-9]/.test(raw)) previousListMarker = null;

    // 空链接文本
    if (/\[\s*\]\([^)]*\)/.test(raw)) add(i, 'MD039', '链接文字为空', false);

    // 链接文字首尾空格
    if (/\[\s+[^\]]|\S[^\]]*\s+\]\(/.test(raw)) add(i, 'MD039', '链接文字首尾有多余空格', true);

    // 裸 URL
    if (/(^|[\s(])https?:\/\/\S+/.test(raw) && !/<https?:\/\//.test(raw) && !/\]\(https?:/.test(raw)) {
      add(i, 'MD034', '存在裸 URL，建议用 [文字](url) 包裹', false);
    }
  });

  if (inFence) {
    add(fenceStartLine, 'MD031', '代码块围栏未闭合', true);
  }

  // 多个 H1
  const h1 = headings.filter((h) => h.level === 1);
  if (h1.length > 1) {
    h1.slice(1).forEach((h) => add(h.line, 'MD025', `文档中有多个一级标题（共 ${h1.length} 个）`, false));
  }

  // 表格
  findTableRanges(lines).forEach((range) => checkTable(lines, range, add));

  // 文件末尾换行
  if (text.length > 0 && !text.endsWith('\n')) {
    add(lines.length - 1, 'MD047', '文件末尾缺少换行', true);
  }
  if (text.endsWith('\n\n')) {
    add(lines.length - 1, 'MD012', '文件末尾有多个空行', true);
  }

  // 相对链接指向的文件是否存在
  if (options && options.baseDir) {
    lines.forEach((raw, i) => {
      const links = raw.matchAll(/\]\(([^)]+)\)/g);
      for (const m of links) {
        const target = m[1].trim();
        if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
        const clean = target.split('#')[0];
        if (clean === '') continue;
        const resolved = path.resolve(options.baseDir, decodeURIComponent(clean));
        if (!fs.existsSync(resolved)) {
          add(i, 'MD053', `相对链接指向的文件不存在: ${target}`, false);
        }
      }
    });
  }

  return issues.sort((a, b) => a.line - b.line);
}

function findTableRanges(lines) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const inside = i < lines.length && /^\s*\|/.test(lines[i]);
    if (inside && start === -1) start = i;
    if (!inside && start !== -1) {
      if (i - start >= 2) ranges.push({ start, end: i - 1 });
      start = -1;
    }
  }
  return ranges;
}

function checkTable(lines, range, add) {
  const rows = [];
  for (let i = range.start; i <= range.end; i++) rows.push({ line: i, cells: splitRow(lines[i]) });

  const headerCells = rows[0].cells;
  const columnCount = headerCells.length;

  // 分隔行必须在第二行
  if (!isSeparatorRow(rows[1].cells)) {
    add(rows[0].line, 'MD056', '表格缺少分隔行（| --- | ...）', true);
  }

  const bodyStart = isSeparatorRow(rows[1].cells) ? 2 : 1;
  for (let r = bodyStart; r < rows.length; r++) {
    if (rows[r].cells.length !== columnCount) {
      add(rows[r].line, 'MD056', `表格列数不一致：表头 ${columnCount} 列，本行 ${rows[r].cells.length} 列`, true);
    }
  }
}

// ---------------------------------------------------------------- 修复

/**
 * 只修确定无歧义的问题：空白、列表符号、表格对齐、围栏闭合。
 * 标题层级跳级、裸 URL、空链接文字这类需要人来定夺，不自动改。
 */
function fix(text) {
  let lines = text.split('\n');

  // 1. 行尾空白与制表符缩进
  lines = lines.map((line) => line.replace(/[ \t]+$/, '').replace(/^\t+/, (m) => '  '.repeat(m.length)));

  // 2. 代码块围栏未闭合
  let fenceCount = 0;
  let marker = '';
  lines.forEach((line) => {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (!m) return;
    const ch = m[1][0];
    if (fenceCount === 0) {
      marker = ch;
      fenceCount = 1;
    } else if (ch === marker) {
      fenceCount = 0;
      marker = '';
    }
  });
  if (fenceCount === 1) {
    lines.push(fenceCount === 1 && marker === '`' ? '```' : marker.repeat(3));
  }

  // 3. 无序列表符号统一为首个出现的符号
  let target = null;
  lines = lines.map((line) => {
    const m = /^(\s*)([-*+])(\s+)(\S.*)$/.exec(line);
    if (!m) return line;
    if (target === null) target = m[2];
    return `${m[1]}${target} ${m[4]}`;
  });

  // 4. 表格对齐（含补缺失的分隔行）
  const ranges = findTableRanges(lines);
  // 从后往前改，避免行号偏移
  for (let k = ranges.length - 1; k >= 0; k--) {
    const range = ranges[k];
    const rows = [];
    for (let i = range.start; i <= range.end; i++) rows.push(splitRow(lines[i]));

    const columnCount = Math.max(...rows.map((r) => r.length));
    const hasSeparator = rows.length > 1 && isSeparatorRow(rows[1]);
    const bodyRows = hasSeparator ? rows.slice(2) : rows.slice(1);

    const all = [rows[0], ...bodyRows].map((r) => {
      const copy = r.slice(0, columnCount);
      while (copy.length < columnCount) copy.push('');
      return copy;
    });

    const widths = Array(columnCount).fill(3);
    all.forEach((row) => row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], displayWidth(cell));
    }));

    const render = (cells) => `| ${cells.map((c, i) => padEnd(c, widths[i])).join(' | ')} |`;
    const rebuilt = [
      render(all[0]),
      `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
      ...all.slice(1).map(render),
    ];
    lines.splice(range.start, range.end - range.start + 1, ...rebuilt);
  }

  let out = lines.join('\n');
  // 5. 文件末尾恰好一个换行
  out = out.replace(/\n+$/, '') + '\n';
  return out;
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
  const codes = (text, opts) => lint(text, opts).map((i) => i.code);

  // 以下输入都带上末尾换行，避免把 MD047（缺末尾换行）也算进来
  check('标题跳级', codes('# A\n### B\n'), ['MD001']);
  check('多个 H1', codes('# A\n# B\n'), ['MD025']);
  check('标题末尾标点', codes('## 说明。\n'), ['MD026']);
  check('代码块缺语言', codes('```\nx\n```\n'), ['MD040']);
  check('围栏未闭合', codes('```js\nx'), ['MD031', 'MD047']);
  check('行尾空白', codes('abc   \n'), ['MD009']);
  check('列表符号混用', codes('- a\n* b\n'), ['MD004']);
  check('空链接文字', codes('[](https://a.com)\n'), ['MD039']);
  check('裸 URL', codes('见 https://a.com 说明\n'), ['MD034']);
  check('末尾缺换行', codes('abc'), ['MD047']);
  check('正常文档无问题', codes('# 标题\n\n正文\n\n- 项目\n'), []);

  // 代码块内的内容不参与检查
  check('代码块内不误报', codes('```\n# 这不是标题。\n```\n'), ['MD040']);
  // 表格
  check('表格缺分隔行', codes('| a | b |\n| 1 | 2 |\n'), ['MD056']);
  check('表格列数不一致', codes('| a | b |\n| --- | --- |\n| 1 |\n'), ['MD056']);
  check('表格正常', codes('| a | b |\n| --- | --- |\n| 1 | 2 |\n'), []);

  // 修复
  check('修行尾空白', fix('abc   \n'), 'abc\n');
  check('修列表符号', fix('- a\n* b\n+ c\n'), '- a\n- b\n- c\n');
  check('补围栏', fix('```js\nx'), '```js\nx\n```\n');
  check('修表格对齐', fix('|a|b|\n|---|---|\n|1|222|\n'), '| a   | b   |\n| --- | --- |\n| 1   | 222 |\n');
  check('修后不再报错', lint(fix('|a|b|\n|1|222|\n')).filter((i) => i.code === 'MD056').length, 0);
  check('制表符转空格', fix('\tabc\n'), '  abc\n');

  // 相对链接（MD047 先入列：它是在文件末尾检查阶段加的，早于链接检查）
  check('相对链接失效可检出', codes('[x](./nope.md)\n', { baseDir: __dirname }), ['MD053']);

  // 显示宽度
  check('CJK 宽度按 2 计', displayWidth('中文'), 4);
  check('ASCII 宽度按 1 计', displayWidth('ab'), 2);

  console.log(`\n失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const opts = { json: false, selftest: false, output: null, force: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '-o' || arg === '--output') opts.output = argv[++i];
    else if (arg.startsWith('--output=')) opts.output = arg.slice('--output='.length);
    else if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
    else opts.rest.push(arg);
  }
  return opts;
}

function listMarkdown(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|mdx|markdown)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(target);
  return out.sort();
}

const USAGE = `用法:
  node scripts/mdlint.js check <文件或目录> [--json]
  node scripts/mdlint.js fix <文件> [-o 输出] [--force] [--json]
  node scripts/mdlint.js --selftest`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(2);
  }

  if (opts.selftest) process.exit(runSelftest());

  const [command, target] = opts.rest;
  if (!command || !target) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!fs.existsSync(target)) {
    console.error(`错误: 路径不存在 ${target}`);
    process.exit(2);
  }

  if (command === 'check') {
    const files = listMarkdown(target);
    if (files.length === 0) {
      console.error(`错误: ${target} 下没有 Markdown 文件`);
      process.exit(2);
    }
    const results = files.map((file) => ({
      file,
      issues: lint(fs.readFileSync(file, 'utf8'), { baseDir: path.dirname(file) }),
    }));

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      let total = 0;
      for (const r of results) {
        if (r.issues.length === 0) {
          console.log(`✓ ${r.file}`);
          continue;
        }
        console.log(`${r.file}`);
        for (const issue of r.issues) {
          console.log(`  ${String(issue.line).padStart(4)}  ${issue.code}  ${issue.message}${issue.fixable ? '  [可自动修复]' : ''}`);
        }
        total += r.issues.length;
      }
      const fixable = results.reduce((n, r) => n + r.issues.filter((i) => i.fixable).length, 0);
      console.log(`\n共 ${results.length} 个文件，${total} 个问题（${fixable} 个可自动修复）`);
    }
    process.exit(results.some((r) => r.issues.length > 0) ? 1 : 0);
  }

  if (command === 'fix') {
    const original = fs.readFileSync(target, 'utf8');
    const fixed = fix(original);
    const remaining = lint(fixed, { baseDir: path.dirname(target) });

    let out = opts.output;
    if (!out) {
      const ext = path.extname(target);
      out = path.join(path.dirname(target), `${path.basename(target, ext)}.fixed${ext || '.md'}`);
    }
    if (fs.existsSync(out) && !opts.force) {
      console.error(`错误: 输出文件已存在 ${out}（加 --force 覆盖，或用 -o 另存）`);
      process.exit(2);
    }
    fs.writeFileSync(out, fixed, 'utf8');

    if (opts.json) {
      console.log(JSON.stringify({ file: target, output: out, remaining }, null, 2));
    } else {
      console.log(`已写入:      ${out}`);
      console.log(`剩余问题:    ${remaining.length} 个（自动修复只处理无歧义项）`);
      for (const issue of remaining) {
        console.log(`  ${String(issue.line).padStart(4)}  ${issue.code}  ${issue.message}`);
      }
    }
    return;
  }

  console.error(`错误: 未知子命令 ${command}\n${USAGE}`);
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = { lint, fix, displayWidth, splitRow };
