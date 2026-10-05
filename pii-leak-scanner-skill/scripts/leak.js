'use strict';

/**
 * 泄露扫描：找代码、配置、日志里的密钥与个人信息。
 *
 * 与 pii-redactor 的分工：
 *   pii-redactor = 改写文本（脱敏），对象是一份要交出去的数据
 *   本工具      = 找出泄露（不改文件），对象是代码/配置/日志，重点是密钥凭证
 *
 * 不能证明「没有泄露」：只能找出已知模式的凭证。硬编码但格式自定义的口令、
 * 被 Base64 或环境变量间接包装的密钥，都扫不出来。这点必须如实告诉用户。
 *
 * 用法:
 *   node scripts/leak.js scan <文件或目录> [--exclude=dir] [--types=a,b] [--json]
 *   node scripts/leak.js --selftest
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 凭证特征

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3'];

function idCardValid(s) {
  if (!/^\d{17}[\dXx]$/.test(s)) return false;
  const up = s.toUpperCase();
  const y = Number(up.slice(6, 10)); const mo = Number(up.slice(10, 12)); const d = Number(up.slice(12, 14));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  if (y < 1900 || dt.getTime() > Date.now()) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(up[i]) * ID_WEIGHTS[i];
  return up[17] === ID_CHECK[sum % 11];
}

function luhnValid(s) {
  if (!/^\d{13,19}$/.test(s)) return false;
  let sum = 0; let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = Number(s[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * 占位符不算泄露：password: xxxxx 这种是模板不是密钥。
 * 注意每个分支都要锚定到末尾——否则 your_/my_ 这类前缀会把真实口令
 * （如 MyStr0ngP@ss）误判成占位符，那比漏报更糟。
 */
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|(?:your|my|the|some)(?:[-_]\w*)?|example\w*|placeholder|changeme|<[^>]*>|\{\{?\w*\}?\}?|todo|\.{3,}|null|none|test|dummy|sample|\$\{[^}]*\}|\$[A-Z_]+|process\.env\S*)$/i;

const RULES = [
  {
    key: 'aws_ak', label: 'AWS Access Key', severity: 'high',
    re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    test: () => true,
  },
  {
    key: 'aliyun_ak', label: '阿里云 AccessKey', severity: 'high',
    re: /\bLTAI[A-Za-z0-9]{16,24}\b/g,
    test: () => true,
  },
  {
    key: 'tencent_ak', label: '腾讯云 SecretId', severity: 'high',
    re: /\bAKID[A-Za-z0-9]{32}\b/g,
    test: () => true,
  },
  {
    key: 'github_token', label: 'GitHub Token', severity: 'high',
    re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    test: () => true,
  },
  {
    key: 'slack_token', label: 'Slack Token', severity: 'high',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    test: () => true,
  },
  {
    key: 'private_key', label: '私钥', severity: 'high',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    test: () => true,
  },
  {
    key: 'jwt', label: 'JWT', severity: 'medium',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    test: () => true,
  },
  {
    key: 'db_url', label: '含口令的连接串', severity: 'high',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi,
    test: (m) => {
      const at = m.indexOf('@');
      const creds = m.slice(m.indexOf('//') + 2, at);
      const pwd = creds.slice(creds.indexOf(':') + 1);
      return pwd.length > 0 && !PLACEHOLDER.test(pwd);
    },
  },
  {
    key: 'generic_secret', label: '硬编码口令', severity: 'medium',
    // 不收 pwd：它既指 shell 命令也常作变量名，且会在 `pwd = 'password: xxx'`
    // 这类写法里抢先匹配，把后面的键名当成值，反而漏掉真正的口令
    re: /\b(password|passwd|secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|token|auth)\b\s*[:=]\s*["']?([^\s"'`,;)]{6,64})/gi,
    test: (m) => {
      const value = (m.match(/[:=]\s*["']?([^\s"'`,;)]{6,64})$/) || [null, ''])[1];
      if (!value) return false;
      if (PLACEHOLDER.test(value)) return false;
      // 值本身以冒号/等号结尾，多半是把下一个键名当成了值
      if (/[:=]$/.test(value)) return false;
      // 纯数字或纯小写英文单词多半不是密钥
      if (/^\d+$/.test(value)) return false;
      if (/^[a-z]+$/.test(value) && value.length < 12) return false;
      return true;
    },
  },
  {
    key: 'idcard', label: '身份证号', severity: 'high',
    re: /\b\d{17}[\dXx]\b/g,
    test: idCardValid,
  },
  {
    key: 'phone', label: '手机号', severity: 'medium',
    re: /\b1[3-9]\d{9}\b/g,
    test: () => true,
  },
  {
    key: 'bank', label: '银行卡号', severity: 'high',
    re: /\b\d{16,19}\b/g,
    test: luhnValid,
  },
  {
    key: 'email', label: '邮箱', severity: 'low',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    test: (m) => !/@(example|test|localhost|domain)\./i.test(m),
  },
];

const DEFAULT_TYPES = RULES.map((r) => r.key);
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next', 'vendor', '.cache', 'coverage', '__pycache__']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.mp4', '.mp3', '.exe', '.dll', '.so', '.dylib', '.lock']);

// ------------------------------------------------------------------ 扫描

/** 只留前 4 与后 4，中间打码——报告本身不能成为新的泄露源。 */
function mask(v) {
  const s = String(v);
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

function scanText(text, types) {
  const enabled = new Set(types);
  const lines = text.split('\n');
  const hits = [];
  for (const rule of RULES) {
    if (!enabled.has(rule.key)) continue;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        const value = m[0];
        if (!rule.test(value)) continue;
        hits.push({
          type: rule.key, label: rule.label, severity: rule.severity,
          line: li + 1, column: m.index + 1,
          masked: mask(value),
        });
      }
    }
  }
  return hits;
}

/** 递归收集待扫描文件。 */
function collect(target, opts) {
  const excluded = new Set([...SKIP_DIRS, ...(opts.exclude || [])]);
  const files = [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  const stack = [target];
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
      if (e.isDirectory()) {
        if (excluded.has(e.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      if (excluded.has(e.name)) continue;
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (e.name === 'package-lock.json' || e.name === 'pnpm-lock.yaml') continue;
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.size > 2 * 1024 * 1024) continue; // 跳过超大文件（多半是产物）
      files.push(abs);
    }
  }
  return files.sort();
}

/** 二进制文件（含 NUL 字节）跳过，避免扫出一堆噪声。 */
function isBinary(buf) {
  const slice = buf.slice(0, 4096);
  return slice.includes(0);
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };
  const types = (text) => scanText(text, DEFAULT_TYPES).map((h) => h.type);

  console.log('凭证识别');
  check('AWS Access Key', types('aws_key = AKIAIOSFODNN7EXAMPLE'), ['aws_ak']);
  check('阿里云 AccessKey', types('ak = LTAI5tQxAbCdEfGhIjKlMnOp'), ['aliyun_ak']);
  check('GitHub Token', types('token ghp_1234567890abcdefghijklmnopqrstuvwxyz12'), ['github_token']);
  check('私钥', types('-----BEGIN RSA PRIVATE KEY-----'), ['private_key']);
  check('JWT', types('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), ['jwt']);
  check('连接串含口令', types('mysql://root:Sup3rP@ssw0rd@127.0.0.1:3306/db'), ['db_url']);
  check('硬编码口令', types('password: MyStr0ngP@ss'), ['generic_secret']);

  console.log('占位符不算泄露');
  check('password: xxxxx', types('password: xxxxxxx'), []);
  check('password: your_password', types('password: your_password'), []);
  check('引用环境变量', types('password: process.env.DB_PASS'), []);
  check('占位符连接串', types('mysql://root:${DB_PASS}@localhost/db'), []);
  check('模板占位', types('password: <your-password>'), []);

  console.log('个人信息');
  check('身份证（校验位正确）', types('身份证 11010519491231002X'), ['idcard']);
  check('身份证（校验位错误不认）', types('身份证 110105194912310021'), []);
  check('手机号', types('电话 13812345678'), ['phone']);
  check('银行卡（Luhn）', types('卡 4111111111111111'), ['bank']);
  check('普通长数字不算卡号', types('订单 12345678901234'), []);

  console.log('打码');
  check('只留前后各四位', mask('AKIAIOSFODNN7EXAMPLE'), 'AKIA************MPLE');
  check('短值全打码', mask('abc'), '***');

  console.log('行号');
  const hits = scanText('line1\nAKIAIOSFODNN7EXAMPLE', DEFAULT_TYPES);
  check('行号正确', hits[0].line, 2);
  check('列号正确', hits[0].column, 1);

  console.log('类型过滤');
  check('只扫手机号', scanText('13812345678', ['phone']).length, 1);
  check('关闭后不扫', scanText('13812345678', ['aws_ak']).length, 0);

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `泄露扫描：找代码、配置、日志里的密钥凭证与个人信息（只报告，不改文件）

用法:
  node scripts/leak.js scan <文件或目录> [--exclude=dir] [--types=a,b] [--json]
  node scripts/leak.js --selftest

选项:
  --exclude=dir[,dir]  额外排除的目录名（默认已排除 node_modules/.git/dist 等）
  --types=a,b          只扫指定类别，默认全部：
                       aws_ak aliyun_ak tencent_ak github_token slack_token
                       private_key jwt db_url generic_secret
                       idcard phone bank email
  --json               输出 JSON

说明:
  - 报告只显示打码后的片段（前 4 后 4），报告本身不会成为新的泄露源
  - 只能找出已知模式的凭证，不能证明「没有泄露」

退出码: 0 = 未发现，1 = 发现疑似泄露，2 = 用法错误`;

function parseArgs(argv) {
  const opts = { types: DEFAULT_TYPES.slice(), exclude: [], json: false };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--types=')) {
      const list = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
      opts.types = list.includes('all') ? DEFAULT_TYPES.slice() : list;
    } else if (arg.startsWith('--exclude=')) {
      opts.exclude = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    } else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'scan') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const target = rest[0];
  if (!target) { console.error('需要文件或目录\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(target)) { console.error(`路径不存在: ${target}`); process.exit(2); }

  const files = collect(target, opts);
  const findings = [];
  let scanned = 0;
  let skippedBinary = 0;

  for (const file of files) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { continue; }
    if (isBinary(buf)) { skippedBinary++; continue; }
    let text;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString('utf8', 3);
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = buf.toString('utf8'); }
    }
    scanned++;
    const hits = scanText(text, opts.types);
    if (hits.length) findings.push({ file, hits });
  }

  const total = findings.reduce((n, f) => n + f.hits.length, 0);

  if (opts.json) {
    console.log(JSON.stringify({
      target, scannedFiles: scanned, skippedBinary,
      findings: findings.map((f) => ({
        file: f.file,
        hits: f.hits.map((h) => ({ type: h.type, label: h.label, severity: h.severity, line: h.line, column: h.column, masked: h.masked })),
      })),
      total,
    }, null, 2));
    process.exit(total ? 1 : 0);
  }

  const isDir = fs.statSync(target).isDirectory();
  console.log(`扫描: ${target}${isDir ? `（${scanned} 个文件${skippedBinary ? `，跳过 ${skippedBinary} 个二进制` : ''}）` : ''}`);
  console.log('');

  if (!total) {
    console.log('✓ 未发现已知模式的凭证或个人信息。');
    console.log('');
    console.log('注意：这只能说明没扫到已知模式，不代表一定没有泄露——');
    console.log('自定义格式的硬编码口令、被编码或拆分拼接的密钥都扫不出来。');
    return;
  }

  const bySeverity = new Map();
  for (const f of findings) for (const h of f.hits) bySeverity.set(h.severity, (bySeverity.get(h.severity) || 0) + 1);
  console.log(`发现 ${total} 处疑似泄露（${[...bySeverity].map(([s, n]) => `${s} ${n}`).join('，')}）`);
  console.log('');

  for (const f of findings) {
    console.log(`${f.file}`);
    for (const h of f.hits) {
      console.log(`  ${String(h.line).padStart(4)}:${String(h.column).padStart(3)}  [${h.severity}] ${h.label.padEnd(10)} ${h.masked}`);
    }
    console.log('');
  }

  console.log('处置建议：');
  console.log('  1. 已泄露的凭证要立即吊销/轮换，仅删除代码无效（Git 历史里仍在）');
  console.log('  2. 改完把凭证挪到环境变量或密钥管理服务，不要提交进仓库');
  console.log('  3. 若已进入 Git 历史，需清理历史或强制轮换，二者至少要做一个');
  console.log('');
  console.log('报告只显示打码片段。未发现不等于没有泄露。');

  process.exit(1);
}

main();
