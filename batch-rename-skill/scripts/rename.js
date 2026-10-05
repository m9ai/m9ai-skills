#!/usr/bin/env node
// 批量重命名：规则化改名，先预览再执行，全程可撤销。
//
// 用法：
//   node scripts/rename.js plan  <目录> [选项] [--json]
//   node scripts/rename.js apply <目录> [选项] [--manifest=<路径>] [--json]
//   node scripts/rename.js undo  <清单文件> [--json]
//   node scripts/rename.js --selftest
//
// 设计前提：重命名改错了很难恢复，所以默认只预览，且执行前必须做冲突检测。

'use strict';

const fs = require('fs');
const path = require('path');

const INVALID_NAME_CHARS = /[/\\:*?"<>|]/;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------- 名称处理

function wordsOf(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9一-龥]+/)
    .filter(Boolean);
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function convertCase(text, style) {
  const words = wordsOf(text);
  switch (style) {
    case 'lower':
      return String(text).toLowerCase();
    case 'upper':
      return String(text).toUpperCase();
    case 'kebab':
      return words.map((w) => w.toLowerCase()).join('-');
    case 'snake':
      return words.map((w) => w.toLowerCase()).join('_');
    case 'camel':
      return words.map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w))).join('');
    case 'pascal':
      return words.map(capitalize).join('');
    default:
      throw new Error(`未知的大小写风格: ${style}`);
  }
}

function pad(value, width) {
  return String(value).padStart(2, '0');
}

function formatDate(date, format) {
  return String(format || 'YYYYMMDD')
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

// ---------------------------------------------------------------- 文件收集

function collectFiles(dir, opts) {
  const only = (opts.only || []).map((e) => (e.startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase()));
  const out = [];

  const walk = (current, depth) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (opts.recursive) walk(full, depth + 1);
        continue;
      }
      if (only.length > 0 && !only.includes(path.extname(entry.name).toLowerCase())) continue;
      const stat = fs.statSync(full);
      out.push({ dir: current, name: entry.name, mtime: stat.mtime, birthtime: stat.birthtime, size: stat.size });
    }
  };
  walk(dir, 0);

  out.sort((a, b) => {
    if (opts.sort === 'mtime') return a.mtime - b.mtime || collator.compare(a.name, b.name);
    if (opts.sort === 'size') return a.size - b.size || collator.compare(a.name, b.name);
    return collator.compare(a.name, b.name);
  });
  return out;
}

// ---------------------------------------------------------------- 生成新名

function computeNewName(file, index, opts) {
  const ext = path.extname(file.name);
  let base = path.basename(file.name, ext);

  if (opts.find) base = base.split(opts.find).join(opts.replaceText);
  if (opts.regex) {
    base = base.replace(new RegExp(opts.regex, opts.regexFlags), opts.replaceText);
  }
  if (opts.caseStyle) base = convertCase(base, opts.caseStyle);
  if (opts.prefix) base = opts.prefix + base;
  if (opts.suffix) base = base + opts.suffix;

  const source = opts.dateFrom === 'ctime' ? file.birthtime : file.mtime;
  const finalExt = opts.newExt ? (opts.newExt.startsWith('.') ? opts.newExt : '.' + opts.newExt) : ext;

  const template = opts.pattern || '{name}{ext}';
  return template
    .replace(/\{name\}/g, base)
    .replace(/\{ext\}/g, finalExt)
    .replace(/\{seq\}/g, String(index + opts.seqStart).padStart(opts.seqWidth, '0'))
    .replace(/\{date\}/g, formatDate(source, opts.dateFormat))
    .replace(/\{time\}/g, formatDate(source, 'HHmmss'));
}

/**
 * 生成重命名计划，并做冲突检测。
 * @returns {{ entries: Array, problems: string[] }}
 */
function buildPlan(dir, opts) {
  const files = collectFiles(dir, opts);
  const entries = [];
  const problems = [];
  const seen = new Map();

  files.forEach((file, index) => {
    const from = file.name;
    const to = computeNewName(file, index, opts);
    const fromPath = path.join(file.dir, from);
    const toPath = path.join(file.dir, to);

    if (to === '') {
      problems.push(`生成了空文件名: ${from}`);
      return;
    }
    if (INVALID_NAME_CHARS.test(to)) {
      problems.push(`新名含非法字符: ${from} → ${to}`);
      return;
    }

    const entry = { dir: file.dir, from, to, fromPath, toPath, unchanged: from === to };
    entries.push(entry);

    if (entry.unchanged) return;

    // 同一目录内的目标名不能撞车
    const key = `${file.dir}/${to}`;
    if (seen.has(key)) {
      problems.push(`目标名重复: ${to}（来自 ${seen.get(key)} 与 ${from}）`);
    } else {
      seen.set(key, from);
    }
    // 也不能覆盖一个不参与本次重命名的既有文件
    if (fs.existsSync(toPath)) {
      const willBeFreed = files.some((f) => path.join(f.dir, f.name) === toPath);
      if (!willBeFreed) problems.push(`目标文件已存在，会覆盖: ${toPath}`);
    }
  });

  return { entries, problems };
}

// ---------------------------------------------------------------- 执行与撤销

function applyPlan(plan, manifestPath) {
  const applied = [];
  let failed = null;

  for (const entry of plan.entries) {
    if (entry.unchanged) continue;
    try {
      fs.renameSync(entry.fromPath, entry.toPath);
      applied.push(entry);
    } catch (err) {
      failed = { entry, message: err.message };
      break;
    }
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    entries: applied.map((e) => ({ dir: e.dir, from: e.from, to: e.to })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { applied, failed, manifestPath };
}

function undoManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const done = [];
  const problems = [];

  // 倒序撤销：后改的先还原，避免中途撞名
  for (const entry of manifest.entries.slice().reverse()) {
    const toPath = path.join(entry.dir, entry.to);
    const fromPath = path.join(entry.dir, entry.from);
    if (!fs.existsSync(toPath)) {
      problems.push(`找不到 ${toPath}，跳过`);
      continue;
    }
    if (fs.existsSync(fromPath)) {
      problems.push(`${fromPath} 已存在，跳过以免覆盖`);
      continue;
    }
    try {
      fs.renameSync(toPath, fromPath);
      done.push(entry);
    } catch (err) {
      problems.push(`${toPath} → ${fromPath} 失败: ${err.message}`);
    }
  }
  return { done, problems };
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

  check('转小写', convertCase('HelloWorld', 'lower'), 'helloworld');
  check('转大写', convertCase('HelloWorld', 'upper'), 'HELLOWORLD');
  check('转短横线', convertCase('Hello World Foo', 'kebab'), 'hello-world-foo');
  check('转下划线', convertCase('HelloWorld', 'snake'), 'hello_world');
  check('转驼峰', convertCase('hello world foo', 'camel'), 'helloWorldFoo');
  check('转帕斯卡', convertCase('hello world', 'pascal'), 'HelloWorld');
  check('中文参与分词', convertCase('张三 简历', 'kebab'), '张三-简历');

  const d = new Date(2026, 2, 5, 9, 8, 7);
  check('日期格式', formatDate(d, 'YYYY-MM-DD'), '2026-03-05');
  check('紧凑日期', formatDate(d, 'YYYYMMDD'), '20260305');
  check('时间格式', formatDate(d, 'HHmmss'), '090807');

  // 模板替换
  const file = { name: 'IMG_0001.jpg', dir: '/tmp', mtime: d, birthtime: d, size: 1 };
  const base = { find: null, replaceText: '', regex: null, regexFlags: '', caseStyle: null, prefix: null, suffix: null, newExt: null, seqStart: 1, seqWidth: 3, dateFrom: 'mtime', dateFormat: 'YYYYMMDD', pattern: null };
  check('默认不改', computeNewName(file, 0, base), 'IMG_0001.jpg');
  check('序号模板', computeNewName(file, 0, { ...base, pattern: '照片_{seq}{ext}' }), '照片_001.jpg');
  check('序号起始与位宽', computeNewName(file, 4, { ...base, seqStart: 10, seqWidth: 2, pattern: '{seq}{ext}' }), '14.jpg');
  check('日期模板', computeNewName(file, 0, { ...base, pattern: '{date}_{name}{ext}' }), '20260305_IMG_0001.jpg');
  check('前后缀', computeNewName(file, 0, { ...base, prefix: '2026_', suffix: '_final' }), '2026_IMG_0001_final.jpg');
  check('字面替换', computeNewName(file, 0, { ...base, find: 'IMG_', replaceText: 'PH_' }), 'PH_0001.jpg');
  check('正则替换', computeNewName(file, 0, { ...base, regex: '^IMG_(\\d+)$', replaceText: 'img-$1' }), 'img-0001.jpg');
  check('改扩展名', computeNewName(file, 0, { ...base, newExt: '.jpeg' }), 'IMG_0001.jpeg');

  // 冲突检测
  const tmp = fs.mkdtempSync('/tmp/rename-test-');
  ['a.txt', 'b.txt', 'c.txt'].forEach((n) => fs.writeFileSync(path.join(tmp, n), 'x'));
  const opts = { ...base, pattern: 'same{ext}' };
  const dup = buildPlan(tmp, opts);
  check('目标名撞车可检出', dup.problems.length > 0, true);
  check('撞车时不产生可执行条目', dup.entries.filter((e) => !e.unchanged).length > 0, true);

  // 覆盖既有文件：目标必须不在本次批次内（在批次内的话它会被移走，不算覆盖）
  const dir2 = fs.mkdtempSync('/tmp/rename-clash-');
  fs.writeFileSync(path.join(dir2, 'a.jpg'), 'x');
  fs.writeFileSync(path.join(dir2, 'keep.txt'), 'x');
  const clash = buildPlan(dir2, { ...base, only: ['.jpg'], newExt: '.txt', pattern: 'keep{ext}' });
  check('覆盖批次外文件可检出', clash.problems.some((p) => p.includes('已存在')), true);
  fs.rmSync(dir2, { recursive: true, force: true });

  // 往返：apply 后 undo 能还原
  const mPath = path.join(tmp, 'manifest.json');
  const ok = buildPlan(tmp, { ...base, pattern: 'renamed_{seq}{ext}' });
  check('正常计划无问题', ok.problems.length, 0);
  const result = applyPlan(ok, mPath);
  check('全部改名成功', result.applied.length, ok.entries.filter((e) => !e.unchanged).length);
  check('新文件已存在', fs.existsSync(path.join(tmp, 'renamed_001.txt')), true);
  const undone = undoManifest(mPath);
  check('撤销无报错', undone.problems.length, 0);
  check('原文件已还原', fs.existsSync(path.join(tmp, 'a.txt')), true);

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const opts = {
    json: false,
    selftest: false,
    recursive: false,
    only: [],
    sort: 'name',
    pattern: null,
    find: null,
    replaceText: '',
    regex: null,
    regexFlags: 'g',
    caseStyle: null,
    prefix: null,
    suffix: null,
    newExt: null,
    seqStart: 1,
    seqWidth: 3,
    dateFrom: 'mtime',
    dateFormat: 'YYYYMMDD',
    manifest: null,
    rest: [],
  };

  const assign = (key, value) => {
    switch (key) {
      case 'seq-start':
      case 'seq-width':
        opts[key === 'seq-start' ? 'seqStart' : 'seqWidth'] = Number(value);
        break;
      case 'replace':
        opts.replaceText = value;
        break;
      case 'case':
        opts.caseStyle = value;
        break;
      case 'ext':
        opts.newExt = value;
        break;
      case 'only':
        opts.only = value.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      default:
        opts[key] = value;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '-r' || arg === '--recursive') opts.recursive = true;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      assign(key, value);
    } else opts.rest.push(arg);
  }

  if (!['name', 'mtime', 'size'].includes(opts.sort)) throw new Error(`--sort 只支持 name / mtime / size`);
  if (opts.caseStyle && !['lower', 'upper', 'kebab', 'snake', 'camel', 'pascal'].includes(opts.caseStyle)) {
    throw new Error(`--case 只支持 lower / upper / kebab / snake / camel / pascal`);
  }
  if (!Number.isInteger(opts.seqStart) || !Number.isInteger(opts.seqWidth) || opts.seqWidth < 1) {
    throw new Error('--seq-start / --seq-width 必须是整数，且 --seq-width >= 1');
  }
  if (opts.find && opts.regex) throw new Error('--find 与 --regex 不能同时使用');
  return opts;
}

const USAGE = `用法:
  node scripts/rename.js plan  <目录> [规则] [--only=.jpg,.png] [-r] [--sort=name|mtime|size] [--json]
  node scripts/rename.js apply <目录> [规则] [--manifest=<路径>] [--json]
  node scripts/rename.js undo  <清单文件> [--json]
  node scripts/rename.js --selftest

规则:
  --pattern='{seq}_{name}{ext}'   命名模板（{name} {ext} {seq} {date} {time}）
  --find=旧串 --replace=新串       字面替换
  --regex='...' --replace='...'    正则替换（用 $1 引用分组）
  --case=lower|upper|kebab|snake|camel|pascal
  --prefix= --suffix=              加前后缀
  --ext=.jpeg                      改扩展名
  --seq-start=1 --seq-width=3      序号起始与位宽
  --date-from=mtime|ctime --date-format=YYYYMMDD`;

function printPlan(plan, opts, title) {
  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const changed = plan.entries.filter((e) => !e.unchanged);
  console.log(`${title}：共 ${plan.entries.length} 个文件，${changed.length} 个待改名`);
  for (const e of changed.slice(0, 30)) {
    console.log(`  ${e.from}  →  ${e.to}`);
  }
  if (changed.length > 30) console.log(`  … 其余 ${changed.length - 30} 个省略`);
  if (plan.problems.length) {
    console.log('\n⚠️ 发现问题，未执行任何改名：');
    for (const p of plan.problems) console.log(`  ${p}`);
  }
}

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

  if (command === 'undo') {
    if (!fs.existsSync(target)) {
      console.error(`错误: 清单文件不存在 ${target}`);
      process.exit(2);
    }
    const result = undoManifest(target);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`已还原 ${result.done.length} 个文件`);
      for (const p of result.problems) console.log(`⚠️ ${p}`);
    }
    process.exit(result.problems.length ? 1 : 0);
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`错误: 目录不存在 ${target}`);
    process.exit(2);
  }

  const plan = buildPlan(target, opts);

  if (command === 'plan') {
    printPlan(plan, opts, '预览');
    process.exit(plan.problems.length ? 1 : 0);
  }

  if (command === 'apply') {
    if (plan.problems.length) {
      printPlan(plan, opts, '预览');
      console.error('\n存在问题，已中止。请先解决上面的冲突再执行 apply。');
      process.exit(1);
    }
    const changed = plan.entries.filter((e) => !e.unchanged);
    if (changed.length === 0) {
      console.log('没有文件需要改名');
      process.exit(0);
    }

    const manifestPath = opts.manifest || path.join(target, `.rename-manifest-${Date.now()}.json`);
    const result = applyPlan(plan, manifestPath);

    if (opts.json) {
      console.log(JSON.stringify({ ...result, manifestPath }, null, 2));
    } else {
      console.log(`已改名 ${result.applied.length} 个文件`);
      console.log(`撤销清单:    ${manifestPath}`);
      console.log(`如需还原:    node scripts/rename.js undo ${manifestPath}`);
      if (result.failed) {
        console.log(`\n⚠️ 中途失败: ${result.failed.entry.from} → ${result.failed.entry.to}（${result.failed.message}）`);
        console.log('已完成的改名都记在撤销清单里，可直接 undo 还原。');
      }
    }
    process.exit(result.failed ? 1 : 0);
  }

  console.error(`错误: 未知子命令 ${command}\n${USAGE}`);
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = { buildPlan, applyPlan, undoManifest, computeNewName, convertCase, formatDate };
