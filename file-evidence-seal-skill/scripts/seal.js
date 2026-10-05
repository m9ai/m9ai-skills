'use strict';

/**
 * 证据固化：对目录生成 SHA-256 清单，事后可核验是否被改动。
 *
 * 关键点：
 * - 内容 hash 用 SHA-256，流式读取，不把整文件读进内存
 * - mtime 变化**不算**篡改：只有 hash 变了才判定为「已修改」，两者分开报
 * - 清单里记相对路径，不记绝对路径，便于移交时也便于不泄露目录结构
 * - 另算一个 rootHash（所有条目按路径排序后拼接再 hash），用于一眼判断整体是否一致
 *
 * 用法:
 *   node scripts/seal.js seal   <目录> [-o 清单.json] [--exclude=a,b] [--no-exclude-system]
 *   node scripts/seal.js verify <目录> <清单.json> [--json]
 *   node scripts/seal.js --selftest
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const ALGORITHM = 'sha256';

// ------------------------------------------------------------------ 遍历

/**
 * 递归收集文件。跳过符号链接（避免越出目录与遍历环）。
 * @returns {Array<string>} 相对路径，按字典序
 */
function walk(dir, rootDir, opts) {
  const out = [];
  const excluded = new Set(opts.exclude || []);
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // 无权限的目录跳过
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      if (excluded.has(e.name) || excluded.has(rel)) continue;
      if (opts.excludeSystem && SYSTEM_FILES.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(abs); continue; }
      if (!e.isFile()) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

/** 流式计算文件 hash。 */
function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(ALGORITHM);
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

/** 全部条目拼成一个字符串再 hash，得到整体摘要。 */
function rootHash(files) {
  const h = crypto.createHash(ALGORITHM);
  for (const f of files) h.update(`${f.path}\0${f.bytes}\0${f.hash}\n`);
  return h.digest('hex');
}

// ------------------------------------------------------------------ 生成

async function buildManifest(dir, opts) {
  const rels = walk(dir, dir, opts);
  const files = [];
  for (const rel of rels) {
    const abs = path.join(dir, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    files.push({
      path: rel,
      bytes: st.size,
      hash: await hashFile(abs),
      mtime: new Date(st.mtimeMs).toISOString(),
    });
  }
  const now = new Date();
  return {
    tool: 'file-evidence-seal',
    schemaVersion: 1,
    algorithm: ALGORITHM,
    root: path.basename(path.resolve(dir)),
    createdAt: now.toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    excludedSystem: opts.excludeSystem ? [...SYSTEM_FILES] : [],
    excluded: opts.exclude || [],
    rootHash: rootHash(files),
    files,
  };
}

// ------------------------------------------------------------------ 核验

/**
 * 比对清单与当前目录。
 * @returns {{ added, removed, modified, mtimeOnly, unchanged }}
 */
async function verify(dir, manifest, opts) {
  const current = await buildManifest(dir, opts);
  const oldMap = new Map(manifest.files.map((f) => [f.path, f]));
  const newMap = new Map(current.files.map((f) => [f.path, f]));

  const added = [];
  const removed = [];
  const modified = [];
  const mtimeOnly = [];
  let unchanged = 0;

  for (const [p, f] of newMap) {
    const old = oldMap.get(p);
    if (!old) { added.push(f); continue; }
    if (old.hash !== f.hash) { modified.push({ path: p, old, now: f }); continue; }
    if (old.mtime !== f.mtime) { mtimeOnly.push({ path: p, oldMtime: old.mtime, nowMtime: f.mtime }); continue; }
    unchanged++;
  }
  for (const [p, f] of oldMap) {
    if (!newMap.has(p)) removed.push(f);
  }

  return {
    added: added.map((f) => ({ path: f.path, bytes: f.bytes })),
    removed: removed.map((f) => ({ path: f.path, bytes: f.bytes })),
    modified: modified.map((m) => ({
      path: m.path,
      oldBytes: m.old.bytes, nowBytes: m.now.bytes,
      oldHash: m.old.hash, nowHash: m.now.hash,
    })),
    mtimeOnly: mtimeOnly.map((m) => ({ path: m.path, oldMtime: m.oldMtime, nowMtime: m.nowMtime })),
    unchanged,
    currentRootHash: current.rootHash,
    manifestRootHash: manifest.rootHash,
  };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  const tmp = fs.mkdtempSync('/tmp/seal-test-');
  const w = (rel, content) => {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const opts = { exclude: [], excludeSystem: true };

  const run = async () => {
    console.log('生成清单');
    w('a.txt', 'hello');
    w('sub/b.txt', 'world');
    w('.DS_Store', 'junk'); // 系统文件应被排除
    let m = await buildManifest(tmp, opts);
    check('文件数（排除系统文件）', m.fileCount, 2);
    check('相对路径', m.files.map((f) => f.path), ['a.txt', 'sub/b.txt']);
    check('整体摘要非空', m.rootHash.length, 64);
    check('排除了系统文件', m.excludedSystem.includes('.DS_Store'), true);

    console.log('未改动时核验');
    let v = await verify(tmp, m, opts);
    check('无新增', v.added.length, 0);
    check('无删除', v.removed.length, 0);
    check('无修改', v.modified.length, 0);
    check('全部未变更', v.unchanged, 2);
    check('整体摘要一致', v.currentRootHash === v.manifestRootHash, true);

    console.log('内容被改');
    w('a.txt', 'hello!');
    v = await verify(tmp, m, opts);
    check('检出修改', v.modified.map((x) => x.path), ['a.txt']);
    check('整体摘要不一致', v.currentRootHash !== v.manifestRootHash, true);

    console.log('只改 mtime 不改内容');
    w('a.txt', 'hello'); // 内容还原，mtime 必然不同
    v = await verify(tmp, m, opts);
    check('不算篡改', v.modified.length, 0);
    check('单列为 mtime 变化', v.mtimeOnly.map((x) => x.path), ['a.txt']);

    console.log('新增与删除');
    w('c.txt', 'new');
    fs.unlinkSync(path.join(tmp, 'sub/b.txt'));
    v = await verify(tmp, m, opts);
    check('检出新增', v.added.map((x) => x.path), ['c.txt']);
    check('检出删除', v.removed.map((x) => x.path), ['sub/b.txt']);

    console.log('排除规则');
    fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules/x.js'), 'x');
    m = await buildManifest(tmp, { exclude: ['node_modules'], excludeSystem: true });
    check('排除目录生效', m.files.some((f) => f.path.startsWith('node_modules')), false);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n通过 ${pass}，失败 ${fail}`);
    if (fail > 0) process.exit(1);
  };

  run();
}

// -------------------------------------------------------------------- 入口

const USAGE = `证据固化：对目录生成 SHA-256 清单并可事后核验

用法:
  node scripts/seal.js seal   <目录> [-o 清单.json] [--exclude=a,b] [--no-exclude-system]
  node scripts/seal.js verify <目录> <清单.json> [--json]
  node scripts/seal.js --selftest

选项:
  -o <文件>          清单输出路径，默认 <目录名>.seal.json（写在目录外，避免自包含）
  --exclude=a,b      排除的文件或目录名，逗号分隔（如 node_modules,.git）
  --no-exclude-system 不排除 .DS_Store / Thumbs.db（默认排除）
  --json             输出 JSON

说明:
  - 只有内容 hash 变了才算「已修改」；仅 mtime 变化会单独列出，不算篡改
  - 跳过符号链接，避免越出目录范围
  - 清单记相对路径，不含绝对路径

退出码: 0 = 一致，1 = 有差异，2 = 用法错误`;

function parseArgs(input) {
  // 把 `-o 值` 归一成 `-o=值`，否则值会被当成位置参数
  const argv = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '-o' && input[i + 1] !== undefined) { argv.push(`-o=${input[i + 1]}`); i++; }
    else argv.push(input[i]);
  }
  const opts = { exclude: [], excludeSystem: true, json: false, out: null };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--no-exclude-system') opts.excludeSystem = false;
    else if (arg.startsWith('-o=')) opts.out = arg.slice(3);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else if (arg.startsWith('--exclude=')) opts.exclude = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else rest.push(arg);
  }
  return { opts, rest };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }

  const cmd = argv[0];
  if (cmd !== 'seal' && cmd !== 'verify') { console.error(`未知子命令: ${cmd}\n\n${USAGE}`); process.exit(2); }
  const { opts, rest } = parseArgs(argv.slice(1));
  const dir = rest[0];
  if (!dir) { console.error('需要目录\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`目录不存在或不是目录: ${dir}`);
    process.exit(2);
  }

  if (cmd === 'seal') {
    const m = await buildManifest(dir, opts);
    const out = opts.out || `${path.basename(path.resolve(dir))}.seal.json`;
    fs.writeFileSync(out, JSON.stringify(m, null, 2));
    if (opts.json) {
      console.log(JSON.stringify({ out, fileCount: m.fileCount, totalBytes: m.totalBytes, rootHash: m.rootHash }, null, 2));
    } else {
      console.log(`已生成清单: ${out}`);
      console.log(`  文件 ${m.fileCount} 个，合计 ${m.totalBytes} 字节`);
      console.log(`  算法 ${m.algorithm}　生成时间 ${m.createdAt}`);
      console.log(`  整体摘要 ${m.rootHash}`);
      if (opts.excludeSystem) console.log(`  已排除系统文件: ${[...SYSTEM_FILES].join(' / ')}`);
      console.log('');
      console.log('核验: node scripts/seal.js verify <目录> ' + out);
    }
    return;
  }

  // verify
  const manifestFile = rest[1];
  if (!manifestFile) { console.error('需要清单文件\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(manifestFile)) { console.error(`清单不存在: ${manifestFile}`); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!manifest.files || !Array.isArray(manifest.files)) {
    console.error('清单格式不对：缺少 files 数组');
    process.exit(2);
  }
  const v = await verify(dir, manifest, opts);
  const diff = v.added.length + v.removed.length + v.modified.length;

  if (opts.json) {
    console.log(JSON.stringify(v, null, 2));
    process.exit(diff ? 1 : 0);
  }

  console.log(`目录:   ${dir}`);
  console.log(`清单:   ${manifestFile}（生成于 ${manifest.createdAt}）`);
  console.log(`未变更 ${v.unchanged} 个，新增 ${v.added.length}，删除 ${v.removed.length}，修改 ${v.modified.length}，仅时间变化 ${v.mtimeOnly.length}`);
  console.log('');

  const list = (title, arr, fmt) => {
    if (!arr.length) return;
    console.log(`--- ${title}（${arr.length}）---`);
    for (const x of arr) console.log(`  ${fmt(x)}`);
    console.log('');
  };

  list('已修改（内容 hash 变化）', v.modified, (x) => `${x.path}　${x.oldBytes} → ${x.nowBytes} 字节`);
  list('新增', v.added, (x) => `${x.path}　${x.bytes} 字节`);
  list('删除', v.removed, (x) => `${x.path}　${x.bytes} 字节`);
  list('仅修改时间变化（内容未变）', v.mtimeOnly, (x) => `${x.path}　${x.oldMtime} → ${x.nowMtime}`);

  if (diff === 0) {
    console.log(`✓ 与清单一致，整体摘要 ${v.currentRootHash}`);
  } else {
    console.log(`✗ 存在差异。清单摘要 ${v.manifestRootHash.slice(0, 16)}…　当前摘要 ${v.currentRootHash.slice(0, 16)}…`);
  }
  console.log('');
  console.log('说明：仅修改时间变化不算篡改（复制、备份都会改 mtime）；只有 hash 变化才是内容真的变了。');

  if (diff) process.exit(1);
}

main();
