'use strict';

/**
 * 重复文件查找：按内容 hash 分组，输出重复组与可释放空间。
 *
 * 两步走以避开无谓的 IO：先按文件大小分组，只有大小相同的才读内容算 hash
 * （大小不同的文件不可能内容相同）。
 *
 * 不直接删除任何文件。需要清理时生成待删清单，由用户确认后自行执行——
 * 批量删除是不可逆操作，脚本替用户做这个决定不合适。
 *
 * 用法:
 *   node scripts/dup.js scan <目录> [--min-size=0] [--exclude=dir] [--out=清单.txt] [--json]
 *   node scripts/dup.js --selftest
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db']);

// ------------------------------------------------------------------ 遍历

function walk(dir, opts) {
  const excluded = new Set(opts.exclude || []);
  const files = [];
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
      if (st.size < opts.minSize) continue;
      files.push({ path: abs, size: st.size, mtime: st.mtimeMs });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
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

/**
 * 找重复组。
 * @returns {{ groups: Array, scanned: number, totalBytes: number }}
 */
/**
 * 组内排序：第一个是「建议保留」的那个。
 * 默认按路径字典序——这个规则是确定的、可复现的，但不一定符合直觉
 * （可能保留到「备份/xxx 副本.jpg」而把原件列为待删），
 * 所以另外提供 oldest / newest / shortest 供选择。
 */
function sortByKeep(group, keep) {
  const g = group.slice();
  const byPath = (a, b) => a.path.localeCompare(b.path);
  if (keep === 'oldest') g.sort((a, b) => a.mtime - b.mtime || byPath(a, b));
  else if (keep === 'newest') g.sort((a, b) => b.mtime - a.mtime || byPath(a, b));
  else if (keep === 'shortest') g.sort((a, b) => a.path.length - b.path.length || byPath(a, b));
  else g.sort(byPath);
  return g;
}

async function findDuplicates(files, opts) {
  const keep = (opts && opts.keep) || 'first';
  // 第一刀：按大小分组，大小唯一的不可能重复
  const bySize = new Map();
  for (const f of files) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }
  const candidates = [...bySize.values()].filter((g) => g.length > 1);

  // 第二刀：对候选算内容 hash
  const byHash = new Map();
  for (const group of candidates) {
    for (const f of group) {
      let hash;
      try {
        hash = await hashFile(f.path);
      } catch {
        continue; // 读不了的文件跳过，不中断整体
      }
      f.hash = hash;
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(f);
    }
  }

  const groups = [...byHash.values()]
    .filter((g) => g.length > 1)
    .map((g) => sortByKeep(g, keep))
    .sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));

  return {
    groups,
    scanned: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
  };
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

  console.log('保留策略');
  const g = [
    { path: '/backup/a copy.jpg', mtime: 200, size: 10, hash: 'h' },
    { path: '/a.jpg', mtime: 100, size: 10, hash: 'h' },
  ];
  check('oldest 保留最早修改的', sortByKeep(g, 'oldest')[0].path, '/a.jpg');
  check('newest 保留最近修改的', sortByKeep(g, 'newest')[0].path, '/backup/a copy.jpg');
  check('shortest 保留路径最短的', sortByKeep(g, 'shortest')[0].path, '/a.jpg');
  check('first 按字典序', sortByKeep(g, 'first')[0].path, '/a.jpg');

  console.log('体积格式');
  check('字节', humanSize(512), '512 B');
  check('KB', humanSize(2048), '2.0 KB');
  check('MB', humanSize(5 * 1024 * 1024), '5.0 MB');

  const tmp = fs.mkdtempSync('/tmp/dup-test-');
  const w = (rel, content) => {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  const run = async () => {
    console.log('重复检测');
    w('a.txt', 'same content');
    w('sub/b.txt', 'same content');
    w('c.txt', 'different');
    let files = walk(tmp, { exclude: [], excludeSystem: true, minSize: 0 });
    check('收集到 3 个文件', files.length, 3);
    let r = await findDuplicates(files);
    check('一组重复', r.groups.length, 1);
    check('组内 2 个文件', r.groups[0].length, 2);
    check('可释放一个的体积', r.groups[0][0].size * (r.groups[0].length - 1), 12);

    console.log('内容不同不算重复');
    w('d.txt', 'another one');
    files = walk(tmp, { exclude: [], excludeSystem: true, minSize: 0 });
    r = await findDuplicates(files);
    check('仍是一组', r.groups.length, 1);

    console.log('三份相同');
    w('e.txt', 'same content');
    files = walk(tmp, { exclude: [], excludeSystem: true, minSize: 0 });
    r = await findDuplicates(files);
    check('组内 3 个', r.groups[0].length, 3);

    console.log('系统文件排除');
    w('.DS_Store', 'junk');
    w('.DS_Store2', 'junk');
    files = walk(tmp, { exclude: [], excludeSystem: true, minSize: 0 });
    check('.DS_Store 被排除', files.some((f) => f.path.endsWith('.DS_Store')), false);

    console.log('最小体积过滤');
    w('small.txt', 'x');
    files = walk(tmp, { exclude: [], excludeSystem: true, minSize: 10 });
    check('小文件被跳过', files.some((f) => f.path.endsWith('small.txt')), false);

    console.log('目录排除');
    fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules/x.js'), 'x');
    files = walk(tmp, { exclude: ['node_modules'], excludeSystem: true, minSize: 0 });
    check('排除目录生效', files.some((f) => f.path.includes('node_modules')), false);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n通过 ${pass}，失败 ${fail}`);
    if (fail > 0) process.exit(1);
  };

  run();
}

// -------------------------------------------------------------------- 入口

const USAGE = `重复文件查找：按内容 hash 分组，输出重复组与可释放空间

用法:
  node scripts/dup.js scan <目录> [--min-size=0] [--exclude=dir] [--out=清单.txt] [--json]
  node scripts/dup.js --selftest

选项:
  --min-size=0      小于该字节数的文件跳过，默认 0（不跳过）
  --exclude=dir     排除的目录名，逗号分隔
  --out=<文件>      把「建议保留之外的文件」路径写成清单（不执行删除）
  --keep=first      每组保留哪一个：first（路径字典序，默认）
                    oldest 最早修改 / newest 最近修改 / shortest 路径最短
  --no-exclude-system 不排除 .DS_Store / Thumbs.db
  --json            输出 JSON

说明:
  - 先按体积分组，只有体积相同的才读内容算 hash，避免无谓 IO
  - 本脚本不删除任何文件；--out 只生成待删清单，是否删除由你决定
  - 默认按路径字典序保留第一个，可能保留到「备份/xxx 副本」而把原件列为待删；
    想保留原件时用 --keep=oldest 或 --keep=shortest

退出码: 0 = 未发现重复，1 = 发现重复，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { minSize: 0, exclude: [], out: null, excludeSystem: true, json: false, keep: 'first' };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--no-exclude-system') opts.excludeSystem = false;
    else if (arg.startsWith('--keep=')) opts.keep = arg.slice(7);
    else if (arg.startsWith('--min-size=')) opts.minSize = Number(arg.slice(11)) || 0;
    else if (arg.startsWith('--exclude=')) opts.exclude = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else rest.push(arg);
  }
  return { opts, rest };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'scan') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const dir = rest[0];
  if (!dir) { console.error('需要目录\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`目录不存在或不是目录: ${dir}`);
    process.exit(2);
  }

  const files = walk(dir, opts);
  if (!files.length) { console.error('目录里没有符合条件的文件'); process.exit(2); }
  const r = await findDuplicates(files, opts);

  const dupFileCount = r.groups.reduce((n, g) => n + g.length, 0);
  const reclaimable = r.groups.reduce((n, g) => n + g[0].size * (g.length - 1), 0);

  if (opts.json) {
    console.log(JSON.stringify({
      dir, scanned: r.scanned, totalBytes: r.totalBytes,
      groupCount: r.groups.length, duplicateFileCount: dupFileCount, reclaimableBytes: reclaimable,
      groups: r.groups.map((g) => ({
        hash: g[0].hash, size: g[0].size,
        keep: g[0].path, duplicates: g.slice(1).map((f) => f.path),
      })),
    }, null, 2));
    process.exit(r.groups.length ? 1 : 0);
  }

  console.log(`目录: ${dir}`);
  console.log(`扫描 ${r.scanned} 个文件，合计 ${humanSize(r.totalBytes)}`);
  console.log('');

  if (!r.groups.length) {
    console.log('✓ 未发现内容重复的文件。');
    return;
  }

  console.log(`发现 ${r.groups.length} 组重复，涉及 ${dupFileCount} 个文件，可释放 ${humanSize(reclaimable)}`);
  console.log('');

  const showCount = Math.min(r.groups.length, 20);
  for (let i = 0; i < showCount; i++) {
    const g = r.groups[i];
    console.log(`组 ${i + 1}（${g.length} 个，每个 ${humanSize(g[0].size)}，可释放 ${humanSize(g[0].size * (g.length - 1))}）`);
    console.log(`  sha256 ${g[0].hash.slice(0, 16)}…`);
    console.log(`  保留  ${g[0].path}`);
    for (const f of g.slice(1)) console.log(`  重复  ${f.path}`);
    console.log('');
  }
  if (r.groups.length > showCount) {
    console.log(`…还有 ${r.groups.length - showCount} 组未显示，加 --json 查看全部。`);
    console.log('');
  }

  if (opts.out) {
    const list = r.groups.flatMap((g) => g.slice(1).map((f) => f.path));
    fs.writeFileSync(opts.out, list.join('\n') + '\n');
    console.log(`待删清单已写出: ${opts.out}（${list.length} 个文件）`);
    console.log('脚本不会替你删除。确认清单无误后，可自行执行：');
    console.log('');
    for (const p of list.slice(0, 3)) console.log(`  rm "${p}"`);
    if (list.length > 3) console.log(`  …（共 ${list.length} 个）`);
    console.log('');
    console.log('删除前建议先核对：同名不同内容的文件不会被判为重复（比对的是内容 hash）。');
  } else {
    console.log('需要清理时加 --out=清单.txt 生成待删清单（脚本不会直接删除）。');
  }

  process.exit(1);
}

main();
