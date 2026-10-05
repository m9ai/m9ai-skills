'use strict';

/**
 * 密钥扫描（CI 卡口向）。
 *
 * 与 pii-leak-scanner 的分工：
 *   pii-leak-scanner = 扫「当前文件内容」，凭证 + 个人信息，用于人工排查
 *   本工具          = 扫「工作区 + Git 历史 + 暂存区」，只管凭证，用于 CI 卡口
 *
 * Git 历史扫描是关键差异：删除代码里的密钥并不等于密钥没泄露过，
 * 历史提交里仍然在。只扫工作区会漏掉这一大块。
 *
 * 用法:
 *   node scripts/secret.js scan [路径] [--git-history] [--staged] [--json]
 *   node scripts/secret.js --selftest
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------- 规则

/** 占位符不算泄露。每个分支都锚定到末尾，避免误伤真实口令。 */
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|(?:your|my|the|some)(?:[-_]\w*)?|example\w*|placeholder|changeme|<[^>]*>|\{\{?\w*\}?\}?|todo|\.{3,}|null|none|test|dummy|sample|\$\{[^}]*\}|\$[A-Z_]+|process\.env\S*)$/i;

const RULES = [
  { key: 'aws_ak', label: 'AWS Access Key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, test: () => true },
  { key: 'aliyun_ak', label: '阿里云 AccessKey', re: /\bLTAI[A-Za-z0-9]{16,24}\b/g, test: () => true },
  { key: 'tencent_ak', label: '腾讯云 SecretId', re: /\bAKID[A-Za-z0-9]{32}\b/g, test: () => true },
  { key: 'github_token', label: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, test: () => true },
  { key: 'slack_token', label: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, test: () => true },
  { key: 'private_key', label: '私钥', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, test: () => true },
  { key: 'jwt', label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, test: () => true },
  {
    key: 'db_url', label: '含口令的连接串',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi,
    test: (m) => {
      const at = m.indexOf('@');
      const creds = m.slice(m.indexOf('//') + 2, at);
      const pwd = creds.slice(creds.indexOf(':') + 1);
      return pwd.length > 0 && !PLACEHOLDER.test(pwd);
    },
  },
  {
    key: 'generic_secret', label: '硬编码口令',
    re: /\b(password|passwd|secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|token|auth)\b\s*[:=]\s*["']?([^\s"'`,;)]{6,64})/gi,
    test: (m) => {
      const value = (m.match(/[:=]\s*["']?([^\s"'`,;)]{6,64})$/) || [null, ''])[1];
      if (!value || PLACEHOLDER.test(value)) return false;
      if (/[:=]$/.test(value)) return false; // 把下一个键名当成了值
      if (/^\d+$/.test(value)) return false;
      if (/^[a-z]+$/.test(value) && value.length < 12) return false;
      return true;
    },
  },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', '.cache', 'coverage', '__pycache__']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.mp4', '.mp3', '.exe', '.dll', '.so', '.dylib', '.lock']);
const MAX_HISTORY_LINES = 500000;

/** 只留前 4 后 4——报告本身不能成为新的泄露源。 */
function mask(v) {
  const s = String(v);
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

/** 扫一行文本。 */
function scanLine(line, types) {
  const enabled = new Set(types);
  const hits = [];
  for (const rule of RULES) {
    if (!enabled.has(rule.key)) continue;
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(line)) !== null) {
      if (!rule.test(m[0])) continue;
      hits.push({ type: rule.key, label: rule.label, masked: mask(m[0]), column: m.index + 1 });
    }
  }
  return hits;
}

// ---------------------------------------------------------------- 工作区

function collect(target, opts) {
  const excluded = new Set([...SKIP_DIRS, ...(opts.exclude || [])]);
  const files = [];
  if (fs.statSync(target).isFile()) return [target];
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) { if (!excluded.has(e.name)) stack.push(abs); continue; }
      if (!e.isFile() || excluded.has(e.name)) continue;
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.size > 2 * 1024 * 1024) continue;
      files.push(abs);
    }
  }
  return files.sort();
}

function scanFiles(target, opts) {
  const findings = [];
  const files = collect(target, opts);
  for (const file of files) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { continue; }
    if (buf.slice(0, 4096).includes(0)) continue; // 二进制
    let text;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString('utf8', 3);
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = buf.toString('utf8'); }
    }
    text.split('\n').forEach((line, i) => {
      for (const h of scanLine(line, opts.types)) {
        findings.push({ source: 'worktree', file, line: i + 1, ...h });
      }
    });
  }
  return { findings, fileCount: files.length };
}

// ---------------------------------------------------------------- Git

function gitAvailable(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫描 Git 历史中「新增」的行。删除的行不扫（已经不在了，且扫了噪声大）。
 * @returns {{ findings, commitCount, truncated }}
 */
function scanGitHistory(dir, opts) {
  let out;
  try {
    // format 里的 | 必须放进引号，否则会被 shell 当成管道符拆开
    out = execSync('git log --all -p --no-color --date=short --pretty=format:"__COMMIT__%H|%ad|%an|%s"', {
      cwd: dir,
      maxBuffer: 512 * 1024 * 1024,
      encoding: 'utf8',
    });
  } catch (e) {
    return { findings: [], commitCount: 0, error: `无法读取 Git 历史：${e.message.split('\n')[0]}` };
  }

  const findings = [];
  const lines = out.split('\n');
  const truncated = lines.length > MAX_HISTORY_LINES;
  const limit = Math.min(lines.length, MAX_HISTORY_LINES);

  let commit = null;
  let file = null;
  let lineNo = 0;
  const commits = new Set();

  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (line.startsWith('__COMMIT__')) {
      const [sha, date, author, ...rest] = line.slice(10).split('|');
      commit = { sha: sha.slice(0, 8), date, author, subject: rest.join('|').slice(0, 60) };
      commits.add(sha);
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p.startsWith('b/') ? p.slice(2) : p;
      if (file === '/dev/null') file = null;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!commit || !file) continue;

    if (line.startsWith('+')) {
      for (const h of scanLine(line.slice(1), opts.types)) {
        findings.push({ source: 'history', file, line: lineNo, commit: commit.sha, commitDate: commit.date, author: commit.author, ...h });
      }
      lineNo++;
    } else if (line.startsWith('-')) {
      // 删除行不推进新文件行号
    } else if (line.startsWith(' ')) {
      lineNo++;
    }
  }
  return { findings, commitCount: commits.size, truncated };
}

/** 扫暂存区（git diff --cached）。 */
function scanStaged(dir, opts) {
  let out;
  try {
    out = execSync('git diff --cached --no-color -U0', { cwd: dir, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' });
  } catch (e) {
    return { findings: [], error: `无法读取暂存区：${e.message.split('\n')[0]}` };
  }
  const findings = [];
  let file = null;
  let lineNo = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p.startsWith('b/') ? p.slice(2) : p;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!file) continue;
    if (line.startsWith('+')) {
      for (const h of scanLine(line.slice(1), opts.types)) {
        findings.push({ source: 'staged', file, line: lineNo, ...h });
      }
      lineNo++;
    }
  }
  return { findings };
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const types = RULES.map((r) => r.key);
  const t = (line) => scanLine(line, types).map((h) => h.type);

  console.log('凭证识别');
  check('AWS AK', t('key = AKIAIOSFODNN7EXAMPLE'), ['aws_ak']);
  check('阿里云 AK', t('ak = LTAI5tQxAbCdEfGhIjKlMnOp'), ['aliyun_ak']);
  check('GitHub Token', t('ghp_1234567890abcdefghijklmnopqrstuvwxyz12'), ['github_token']);
  check('私钥', t('-----BEGIN RSA PRIVATE KEY-----'), ['private_key']);
  check('连接串', t('mysql://root:Sup3rP@ssw0rd@127.0.0.1/db'), ['db_url']);
  check('硬编码口令', t('password: MyStr0ngP@ss'), ['generic_secret']);

  console.log('占位符不算泄露');
  check('xxxxx', t('password: xxxxxxx'), []);
  check('your_password', t('password: your_password'), []);
  check('环境变量', t('password: process.env.DB_PASS'), []);

  console.log('打码');
  check('只留前后各四位', mask('AKIAIOSFODNN7EXAMPLE'), 'AKIA************MPLE');
  check('短值全打码', mask('abc'), '***');

  console.log('Git 历史行号解析');
  // 构造一段最小 diff 文本，直接验证解析逻辑的行号推进
  const diff = [
    '__COMMIT__abc1234|2026-01-01|张三|add config',
    'diff --git a/config.js b/config.js',
    '--- /dev/null',
    '+++ b/config.js',
    '@@ -0,0 +1,3 @@',
    '+const a = 1;',
    '+const key = "AKIAIOSFODNN7EXAMPLE";',
    '+const b = 2;',
  ].join('\n');
  const parsed = parseDiffForTest(diff, types);
  check('命中一条', parsed.length, 1);
  check('行号正确', parsed[0].line, 2);
  check('归属提交', parsed[0].commit, 'abc1234');
  check('文件路径', parsed[0].file, 'config.js');

  console.log('diff 行号推进（含上下文与删除行）');
  const diff2 = [
    '__COMMIT__def5678|2026-01-02|李四|update',
    '+++ b/app.js',
    '@@ -10,4 +20,5 @@',
    ' context line',
    '-removed line',
    '+const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz12";',
    ' another context',
  ].join('\n');
  const parsed2 = parseDiffForTest(diff2, types);
  // 同一行可被两类同时命中：ghp_ 模式 + token= 赋值
  check('命中两类', parsed2.length, 2);
  check('含 GitHub Token', parsed2.some((h) => h.type === 'github_token'), true);
  check('起始 20 + 上下文 1 = 21', parsed2[0].line, 21);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

/** 供自测复用真实解析逻辑（与 scanGitHistory 的行号推进规则一致）。 */
function parseDiffForTest(diffText, types) {
  const findings = [];
  let commit = null; let file = null; let lineNo = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('__COMMIT__')) {
      const [sha, date, author, ...rest] = line.slice(10).split('|');
      commit = { sha: sha.slice(0, 8), date, author, subject: rest.join('|') };
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p.startsWith('b/') ? p.slice(2) : p;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!commit || !file) continue;
    if (line.startsWith('+')) {
      for (const h of scanLine(line.slice(1), types)) {
        findings.push({ source: 'history', file, line: lineNo, commit: commit.sha, ...h });
      }
      lineNo++;
    } else if (line.startsWith('-')) {
      // 删除行不推进新文件行号
    } else if (line.startsWith(' ')) {
      lineNo++;
    }
  }
  return findings;
}

// -------------------------------------------------------------------- 入口

const USAGE = `密钥扫描（CI 卡口向）：工作区 + Git 历史 + 暂存区

用法:
  node scripts/secret.js scan [路径] [--git-history] [--staged] [--json]
  node scripts/secret.js --selftest

选项:
  --git-history   扫描 Git 历史中新增的行（关键：删了代码不等于密钥没泄露过）
  --staged        只扫暂存区（git diff --cached），适合 pre-commit 钩子
  --exclude=dir   额外排除的目录名
  --types=a,b     只扫指定类别
  --json          输出 JSON

默认扫工作区文件（已排除 node_modules / .git / dist 等）。

与 pii-leak-scanner 的分工:
  本工具          工作区 + Git 历史 + 暂存区，只管凭证，用于 CI 卡口
  pii-leak-scanner 只扫当前文件内容，凭证 + 个人信息，用于人工排查

退出码: 0 = 未发现，1 = 发现疑似密钥，2 = 用法错误`;

function parseArgs(argv) {
  const opts = {
    types: RULES.map((r) => r.key), exclude: [],
    gitHistory: false, staged: false, json: false,
  };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--git-history') opts.gitHistory = true;
    else if (arg === '--staged') opts.staged = true;
    else if (arg.startsWith('--types=')) opts.types = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--exclude=')) opts.exclude = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'scan') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const target = rest[0] || '.';
  if (!fs.existsSync(target)) { console.error(`路径不存在: ${target}`); process.exit(2); }

  const isDir = fs.statSync(target).isDirectory();
  const all = [];

  if (opts.staged) {
    if (!gitAvailable(isDir ? target : path.dirname(target))) {
      console.error('--staged 需要在 Git 仓库里运行');
      process.exit(2);
    }
    const r = scanStaged(isDir ? target : path.dirname(target), opts);
    if (r.error) { console.error(r.error); process.exit(2); }
    all.push(...r.findings);
    if (!opts.json) console.log(`暂存区：${r.findings.length} 处`);
  } else {
    const r = scanFiles(target, opts);
    all.push(...r.findings);
    if (!opts.json) console.log(`工作区：扫描 ${r.fileCount} 个文件，${r.findings.length} 处`);

    if (opts.gitHistory) {
      if (!gitAvailable(isDir ? target : path.dirname(target))) {
        console.error('--git-history 需要在 Git 仓库里运行');
        process.exit(2);
      }
      const h = scanGitHistory(isDir ? target : path.dirname(target), opts);
      if (h.error) { console.error(h.error); process.exit(2); }
      all.push(...h.findings);
      if (!opts.json) {
        console.log(`Git 历史：${h.commitCount} 个提交，${h.findings.length} 处${h.truncated ? '（历史过大，已截断）' : ''}`);
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ target, total: all.length, findings: all }, null, 2));
    process.exit(all.length ? 1 : 0);
  }

  console.log('');
  if (!all.length) {
    console.log('✓ 未发现已知模式的密钥。');
    console.log('');
    console.log('注意：只扫了已知模式。自定义格式的口令、编码或拆分拼接的密钥扫不出来；');
    console.log('只扫工作区时，历史提交里的密钥也扫不到——加 --git-history 再跑一次。');
    return;
  }

  console.log(`发现 ${all.length} 处疑似密钥`);
  console.log('');
  for (const f of all) {
    const where = f.source === 'history'
      ? `${f.file}:${f.line}  [${f.commit} ${f.commitDate} ${f.author}]`
      : `${f.file}:${f.line}`;
    console.log(`  ${where}`);
    console.log(`      ${f.label}  ${f.masked}`);
  }
  console.log('');
  console.log('处置：先吊销/轮换凭证，再改代码；已进入 Git 历史的还需清理历史或强制轮换。');
  console.log('报告只显示打码片段。');

  process.exit(1);
}

main();
