'use strict';

/**
 * 目录指纹比对：直接比对两份目录（本地 vs 备份、旧版 vs 新版）。
 *
 * 与 file-evidence-seal 的区别：
 *   本工具     = 同时比对两个「现在都存在」的目录
 *   evidence-seal = 先把状态存成清单，日后再核验同一个目录
 * 若要把指纹保存下来过段时间再比，用 file-evidence-seal。
 *
 * 用法:
 *   node scripts/fingerprint.js diff <目录A> <目录B> [--exclude=dir] [--json]
 *   node scripts/fingerprint.js --selftest
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db']);

// ------------------------------------------------------------------ 遍历

function walk(dir, opts) {
  const excluded = new Set(opts.exclude || []);
  const files = new Map();
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (excluded.has(e.name)) continue;
      if (opts.excludeSystem && SYSTEM_FILES.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(abs); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      files.set(rel, { rel, size: st.size, mtime: st.mtimeMs });
    }
  }
  return files;
}

function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

/** 只对两边都存在且体积相同的文件算 hash——体积不同必然内容不同。 */
async function attachHashes(dir, files, rels) {
  for (const rel of rels) {
    const f = files.get(rel);
    try {
      f.hash = await hashFile(path.join(dir, rel));
    } catch {
      f.hash = null; // 读不了就标记为未知，不中断
    }
  }
}

/**
 * @returns {{ same, onlyA, onlyB, different, unknown }}
 */
async function compare(dirA, dirB, opts) {
  const mapA = walk(dirA, opts);
  const mapB = walk(dirB, opts);

  const both = [...mapA.keys()].filter((rel) => mapB.has(rel));
  const needHash = both.filter((rel) => mapA.get(rel).size === mapB.get(rel).size);
  await attachHashes(dirA, mapA, needHash);
  await attachHashes(dirB, mapB, needHash);

  const same = [];
  const different = [];
  const unknown = [];

  for (const rel of both) {
    const a = mapA.get(rel);
    const b = mapB.get(rel);
    if (a.size !== b.size) {
      different.push({ rel, sizeA: a.size, sizeB: b.size, hashA: null, hashB: null, reason: '体积不同' });
      continue;
    }
    if (a.hash === null || b.hash === null) {
      unknown.push({ rel, sizeA: a.size, sizeB: b.size });
      continue;
    }
    if (a.hash === b.hash) same.push({ rel, size: a.size, hash: a.hash });
    else different.push({ rel, sizeA: a.size, sizeB: b.size, hashA: a.hash, hashB: b.hash, reason: '内容不同' });
  }

  const onlyA = [...mapA.keys()].filter((rel) => !mapB.has(rel)).sort()
    .map((rel) => ({ rel, size: mapA.get(rel).size }));
  const onlyB = [...mapB.keys()].filter((rel) => !mapA.has(rel)).sort()
    .map((rel) => ({ rel, size: mapB.get(rel).size }));

  different.sort((x, y) => x.rel.localeCompare(y.rel));

  // 整体摘要：按路径排序后拼接，两边内容一致时必然相同
  const digest = (map) => {
    const h = crypto.createHash('sha256');
    for (const rel of [...map.keys()].sort()) {
      const f = map.get(rel);
      h.update(`${rel}\0${f.size}\0${f.hash || ''}\n`);
    }
    return h.digest('hex');
  };

  return { same, onlyA, onlyB, different, unknown, digestA: digest(mapA), digestB: digest(mapB) };
}

const humanSize = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  const tmp = fs.mkdtempSync('/tmp/fp-test-');
  const A = path.join(tmp, 'a');
  const B = path.join(tmp, 'b');
  fs.mkdirSync(A); fs.mkdirSync(B);
  const w = (base, rel, content) => {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const opts = { exclude: [], excludeSystem: true };

  const run = async () => {
    console.log('完全一致');
    w(A, 'x.txt', 'same'); w(B, 'x.txt', 'same');
    w(A, 'sub/y.txt', 'same2'); w(B, 'sub/y.txt', 'same2');
    let r = await compare(A, B, opts);
    check('全部相同', [r.same.length, r.onlyA.length, r.onlyB.length, r.different.length], [2, 0, 0, 0]);
    check('整体摘要一致', r.digestA === r.digestB, true);

    console.log('内容不同');
    w(B, 'x.txt', 'changed');
    r = await compare(A, B, opts);
    check('检出差异', r.different.map((d) => d.rel), ['x.txt']);
    check('摘要不一致', r.digestA !== r.digestB, true);

    console.log('体积不同（不必算 hash）');
    w(A, 'z.txt', 'short'); w(B, 'z.txt', 'a much longer content');
    r = await compare(A, B, opts);
    check('体积不同也报差异', r.different.some((d) => d.rel === 'z.txt' && d.reason === '体积不同'), true);

    console.log('仅一边有');
    w(A, 'only-a.txt', 'a');
    w(B, 'only-b.txt', 'b');
    r = await compare(A, B, opts);
    check('仅 A 有', r.onlyA.map((x) => x.rel), ['only-a.txt']);
    check('仅 B 有', r.onlyB.map((x) => x.rel), ['only-b.txt']);

    console.log('系统文件排除');
    w(A, '.DS_Store', 'j1'); w(B, '.DS_Store', 'j2');
    r = await compare(A, B, opts);
    check('.DS_Store 不参与比对', r.different.some((d) => d.rel === '.DS_Store'), false);

    console.log('目录排除');
    fs.mkdirSync(path.join(A, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(A, 'node_modules/p.js'), 'p');
    r = await compare(A, B, { exclude: ['node_modules'], excludeSystem: true });
    check('排除生效', r.onlyA.some((x) => x.rel.startsWith('node_modules')), false);

    console.log('相对路径');
    r = await compare(A, B, opts);
    check('路径用 / 分隔', r.same.every((s) => !s.rel.includes('\\')), true);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n通过 ${pass}，失败 ${fail}`);
    if (fail > 0) process.exit(1);
  };

  run();
}

// -------------------------------------------------------------------- 入口

const USAGE = `目录指纹比对：直接比对两份目录（本地 vs 备份、旧版 vs 新版）

用法:
  node scripts/fingerprint.js diff <目录A> <目录B> [--exclude=dir] [--json]
  node scripts/fingerprint.js --selftest

选项:
  --exclude=dir[,dir]  排除的目录名（如 node_modules,.git,dist）
  --no-exclude-system  不排除 .DS_Store / Thumbs.db（默认排除）
  --json               输出 JSON

说明:
  - 比对的是相对路径 + 体积 + 内容 SHA-256
  - 体积不同的文件直接判为不同，不读内容（省 IO）
  - 路径按相对路径匹配，两边顶层目录名不同也能比

  若要把指纹存下来、过段时间再核验同一个目录，请用 file-evidence-seal。

退出码: 0 = 一致，1 = 有差异，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { exclude: [], excludeSystem: true, json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--no-exclude-system') opts.excludeSystem = false;
    else if (arg.startsWith('--exclude=')) opts.exclude = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else rest.push(arg);
  }
  return { opts, rest };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'diff') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const [dirA, dirB] = rest;
  if (!dirA || !dirB) { console.error('需要两个目录\n\n' + USAGE); process.exit(2); }
  for (const d of [dirA, dirB]) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
      console.error(`目录不存在或不是目录: ${d}`);
      process.exit(2);
    }
  }

  const r = await compare(dirA, dirB, opts);
  const total = r.onlyA.length + r.onlyB.length + r.different.length + r.unknown.length;

  if (opts.json) {
    console.log(JSON.stringify({
      dirA, dirB,
      summary: {
        same: r.same.length, onlyA: r.onlyA.length, onlyB: r.onlyB.length,
        different: r.different.length, unknown: r.unknown.length,
      },
      digestA: r.digestA, digestB: r.digestB,
      onlyA: r.onlyA, onlyB: r.onlyB, different: r.different, unknown: r.unknown,
    }, null, 2));
    process.exit(total ? 1 : 0);
  }

  console.log(`目录 A: ${dirA}（${r.same.length + r.onlyA.length + r.different.length + r.unknown.length} 个文件）`);
  console.log(`目录 B: ${dirB}（${r.same.length + r.onlyB.length + r.different.length + r.unknown.length} 个文件）`);
  console.log('');
  console.log(`相同 ${r.same.length}，仅 A 有 ${r.onlyA.length}，仅 B 有 ${r.onlyB.length}，内容不同 ${r.different.length}${r.unknown.length ? `，无法读取 ${r.unknown.length}` : ''}`);
  console.log('');

  const list = (title, arr, fmt) => {
    if (!arr.length) return;
    console.log(`--- ${title}（${arr.length}）---`);
    for (const x of arr) console.log(`  ${fmt(x)}`);
    console.log('');
  };

  list('内容不同', r.different, (x) => `${x.rel}　${x.reason}　A ${humanSize(x.sizeA)} → B ${humanSize(x.sizeB)}`);
  list('仅 A 有（B 中缺失）', r.onlyA, (x) => `${x.rel}　${humanSize(x.size)}`);
  list('仅 B 有（A 中缺失）', r.onlyB, (x) => `${x.rel}　${humanSize(x.size)}`);
  list('无法读取（权限或占用）', r.unknown, (x) => `${x.rel}`);

  if (total === 0) console.log(`✓ 两目录内容一致，整体摘要 ${r.digestA.slice(0, 16)}…`);
  else {
    console.log(`存在差异。A 摘要 ${r.digestA.slice(0, 16)}…　B 摘要 ${r.digestB.slice(0, 16)}…`);
    console.log('');
    console.log('注意：只比较文件内容，不比较文件权限、属主与修改时间。');
  }

  if (total) process.exit(1);
}

main();
