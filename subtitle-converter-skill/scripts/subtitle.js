'use strict';

/**
 * 字幕格式互转：SRT / WebVTT / ASS(SSA)。
 *
 * 内部统一表示 { start, end, text, style }，时间一律用毫秒整数，避免反复换算出错。
 *
 * 会丢什么（必须在回答里说清楚）：
 *   ASS → SRT/VTT：字体、颜色、位置、特效、卡拉OK 全丢，只剩纯文本与时间轴
 *   VTT → SRT：cue settings（position/align/size 等）丢弃
 *   SRT → ASS：只有默认样式，原文件没有样式可继承
 *
 * 用法:
 *   node scripts/subtitle.js convert <输入> --to=srt|vtt|ass [-o 输出] [--keep-tags]
 *   node scripts/subtitle.js --selftest
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 时间

/** "00:00:01,000" / "00:00:01.000" → 毫秒。 */
function parseHMS(s) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1] || 0);
  const mi = Number(m[2]);
  const sec = Number(m[3]);
  let ms = Number(m[4]);
  // 补齐到三位：".5" 应读作 500ms 而不是 5ms
  if (m[4].length === 1) ms *= 100;
  else if (m[4].length === 2) ms *= 10;
  return ((h * 60 + mi) * 60 + sec) * 1000 + ms;
}

/** ASS 的 H:MM:SS.cc（百分秒）。 */
function parseAssTime(s) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]); const sec = Number(m[3]);
  let cs = Number(m[4]);
  if (m[4].length === 1) cs *= 10;
  return ((h * 60 + mi) * 60 + sec) * 1000 + cs * 10;
}

const pad2 = (n) => String(n).padStart(2, '0');

function formatSrtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const mi = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msec = ms % 1000;
  return `${pad2(h)}:${pad2(mi)}:${pad2(s)},${String(msec).padStart(3, '0')}`;
}

function formatVttTime(ms) {
  return formatSrtTime(ms).replace(',', '.');
}

function formatAssTime(ms) {
  const h = Math.floor(ms / 3600000);
  const mi = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${pad2(mi)}:${pad2(s)}.${pad2(cs)}`;
}

// ------------------------------------------------------------------ SRT

function parseSrt(text) {
  const cues = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    const timing = lines.find((l) => l.includes('-->'));
    if (!timing) continue;
    const m = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/.exec(timing);
    if (!m) continue;
    const start = parseHMS(m[1]);
    const end = parseHMS(m[2]);
    if (start === null || end === null) continue;
    const textLines = lines.slice(lines.indexOf(timing) + 1);
    cues.push({ start, end, text: textLines.join('\n'), style: null });
  }
  return cues;
}

function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`).join('\n');
}

// ------------------------------------------------------------------ VTT

function parseVtt(text) {
  const cues = [];
  const body = text.replace(/\r\n/g, '\n');
  const blocks = body.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE/i.test(lines[0])) continue;
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const m = /^(.+?)\s*-->\s*(.+?)(?:\s+(.*))?$/.exec(lines[timingIdx]);
    if (!m) continue;
    const start = parseHMS(m[1]);
    const end = parseHMS(m[2]);
    if (start === null || end === null) continue;
    const textLines = lines.slice(timingIdx + 1);
    cues.push({ start, end, text: textLines.join('\n'), style: null });
  }
  return cues;
}

function toVtt(cues) {
  const head = 'WEBVTT\n';
  const body = cues.map((c) => `${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\n${c.text}\n`).join('\n');
  return head + '\n' + body;
}

// ------------------------------------------------------------------ ASS

/** 按 Format 行确定字段下标，不硬编码列序。 */
function parseAss(text) {
  const cues = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inEvents = false;
  let fields = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      fields = null;
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const parts = line.slice(line.indexOf(':') + 1).split(',');
    if (!fields) continue;
    const get = (name) => {
      const i = fields.indexOf(name);
      return i >= 0 && i < parts.length ? parts[i].trim() : '';
    };
    const start = parseAssTime(get('start'));
    const end = parseAssTime(get('end'));
    if (start === null || end === null) continue;
    // Text 是最后一个字段，可能自带逗号，所以要把剩余部分拼回去
    const textIdx = fields.indexOf('text');
    const rawText = textIdx >= 0 ? parts.slice(textIdx).join(',').trim() : '';
    cues.push({
      start, end,
      text: rawText.replace(/\\N/gi, '\n'),
      style: get('style') || null,
      actor: get('name') || null,
    });
  }
  return cues;
}

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function toAss(cues) {
  const body = cues.map((c) => {
    const text = String(c.text).replace(/\r?\n/g, '\\N');
    const style = c.style || 'Default';
    return `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},${style},,0,0,0,,${text}`;
  }).join('\n');
  return ASS_HEADER + body + '\n';
}

// ------------------------------------------------------------------ 清洗

/** 剥离 ASS 的样式覆盖标签 {\...}（默认剥离，--keep-tags 保留）。 */
function stripTags(text) {
  return String(text).replace(/\{[^}]*\}/g, '');
}

// ------------------------------------------------------------------ 分发

const FORMATS = {
  srt: { parse: parseSrt, render: toSrt, label: 'SubRip (SRT)' },
  vtt: { parse: parseVtt, render: toVtt, label: 'WebVTT' },
  ass: { parse: parseAss, render: toAss, label: 'Advanced SubStation (ASS)' },
};

/** 先按扩展名，再按内容特征判断。 */
function detectFormat(file, text) {
  const ext = path.extname(file).toLowerCase().slice(1);
  if (FORMATS[ext]) return ext;
  if (/^WEBVTT/i.test(text.trim())) return 'vtt';
  if (/\[Events\]/i.test(text) || /^Dialogue:/im.test(text)) return 'ass';
  if (/\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) return 'srt';
  return null;
}

/** 转成目标格式时先做必要的清洗。 */
function prepare(cues, from, to, keepTags) {
  return cues.map((c) => {
    let text = c.text;
    if (from === 'ass' && to !== 'ass' && !keepTags) text = stripTags(text);
    if (to === 'srt' || to === 'vtt') {
      // 这两种格式不认 ASS 的样式名与说话人，丢弃即可
      return { start: c.start, end: c.end, text, style: null };
    }
    return { start: c.start, end: c.end, text, style: c.style || 'Default' };
  });
}

// ------------------------------------------------------------------- 自测

function selftest() {
  let pass = 0; let fail = 0;
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a === b) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      期望 ${b}\n      实际 ${a}`); }
  };

  console.log('时间解析');
  check('SRT 时间', parseHMS('00:00:01,500'), 1500);
  check('VTT 时间', parseHMS('00:01:02.250'), 62250);
  check('带小时', parseHMS('01:00:00,000'), 3600000);
  check('两位毫秒补零', parseHMS('00:00:01,50'), 1500);
  check('ASS 时间', parseAssTime('0:00:01.50'), 1500);
  check('ASS 带小时', parseAssTime('1:02:03.04'), 3723040);
  check('非法时间', parseHMS('abc'), null);

  console.log('时间格式化');
  check('SRT 格式', formatSrtTime(1500), '00:00:01,500');
  check('VTT 格式', formatVttTime(1500), '00:00:01.500');
  check('ASS 格式', formatAssTime(1500), '0:00:01.50');
  check('超一小时', formatSrtTime(3723040), '01:02:03,040');

  console.log('SRT 解析');
  const srt = '1\n00:00:01,000 --> 00:00:04,000\nHello\nworld\n\n2\n00:00:05,000 --> 00:00:07,000\nSecond\n';
  let cues = parseSrt(srt);
  check('两条字幕', cues.length, 2);
  check('首条时间', [cues[0].start, cues[0].end], [1000, 4000]);
  check('多行文本', cues[0].text, 'Hello\nworld');

  console.log('SRT 生成');
  const out = toSrt(cues);
  check('含序号与时间', out.includes('00:00:01,000 --> 00:00:04,000'), true);
  check('两条', (out.match(/^\d+$/gm) || []).length, 2);

  console.log('VTT 解析');
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n\nNOTE this is a note\n\n00:00:05.000 --> 00:00:07.000\nSecond\n';
  cues = parseVtt(vtt);
  check('两条（跳过 NOTE）', cues.length, 2);
  check('时间正确', [cues[0].start, cues[0].end], [1000, 4000]);

  console.log('VTT 生成');
  check('有 WEBVTT 头', toVtt(cues).startsWith('WEBVTT'), true);

  console.log('ASS 解析');
  const ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello\\NWorld
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Second
`;
  cues = parseAss(ass);
  check('两条', cues.length, 2);
  check('时间正确', [cues[0].start, cues[0].end], [1000, 4000]);
  check('\\N 转换行', cues[0].text, 'Hello\nWorld');
  check('保留样式名', cues[0].style, 'Default');

  console.log('ASS 生成');
  const assOut = toAss(cues);
  check('含 Events 段', assOut.includes('[Events]'), true);
  check('含 Dialogue', assOut.includes('Dialogue: 0,0:00:01.00,0:00:04.00'), true);
  check('换行转回 \\N', assOut.includes('Hello\\NWorld'), true);

  console.log('样式标签剥离');
  check('剥离 {}', stripTags('{\\i1}Hello{\\i0}'), 'Hello');
  const tagged = [{ start: 0, end: 1000, text: '{\\i1}Hello', style: null }];
  check('默认剥离标签', prepare(tagged, 'ass', 'srt', false)[0].text, 'Hello');
  check('--keep-tags 保留', prepare(tagged, 'ass', 'srt', true)[0].text, '{\\i1}Hello');
  check('留在 ASS 内不改', prepare(tagged, 'ass', 'ass', false)[0].text, '{\\i1}Hello');

  console.log('互转');
  const srt2vtt = toVtt(prepare(parseSrt(srt), 'srt', 'vtt', false));
  check('SRT→VTT 时间点', srt2vtt.includes('00:00:01.000'), true);
  const ass2srt = toSrt(prepare(parseAss(ass), 'ass', 'srt', false));
  check('ASS→SRT 剥离标签', !ass2srt.includes('{'), true);
  const vtt2srt = toSrt(prepare(parseVtt(vtt), 'vtt', 'srt', false));
  check('VTT→SRT 有序号', /\n1\n00:00:01,000/.test('\n' + vtt2srt), true);

  console.log('往返一致性（SRT → ASS → SRT）');
  const round = toSrt(prepare(parseAss(toAss(prepare(parseSrt(srt), 'srt', 'ass', false))), 'ass', 'srt', false));
  check('时间轴不变', round.includes('00:00:01,000 --> 00:00:04,000'), true);
  check('文本不变', round.includes('Hello'), true);

  console.log('格式检测');
  check('按扩展名', detectFormat('a.srt', ''), 'srt');
  check('按内容 VTT', detectFormat('a.txt', 'WEBVTT\n'), 'vtt');
  check('按内容 ASS', detectFormat('a.txt', '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,x'), 'ass');
  check('按内容 SRT', detectFormat('a.txt', '1\n00:00:01,000 --> 00:00:02,000\nx'), 'srt');

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

// -------------------------------------------------------------------- 入口

const USAGE = `字幕格式互转：SRT / WebVTT / ASS

用法:
  node scripts/subtitle.js convert <输入> --to=srt|vtt|ass [-o 输出] [--keep-tags]
  node scripts/subtitle.js --selftest

选项:
  --to=<格式>     目标格式，必填：srt / vtt / ass
  -o <文件>       输出文件；不填则输出到 stdout
  --keep-tags     转出到非 ASS 格式时保留 {\\...} 样式标签（默认剥离）
  --json          输出 JSON（含转换后的文本与统计）

输入格式自动识别：先看扩展名，再看内容特征。

会丢失的内容（转换前请确认能否接受）:
  ASS → SRT/VTT  字体、颜色、位置、特效、卡拉OK 全部丢失，只剩纯文本与时间轴
  VTT → SRT      cue settings（position / align / size 等）丢失
  SRT → ASS      只套用默认样式，原文件本就没有样式可继承

退出码: 0 = 正常，2 = 用法错误`;

function parseArgs(argv) {
  // 把 `-o 值` 归一成 `-o=值`，否则值会被当成位置参数
  const normalized = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' && argv[i + 1] !== undefined) { normalized.push(`-o=${argv[i + 1]}`); i++; }
    else normalized.push(argv[i]);
  }
  const opts = { to: null, out: null, keepTags: false, json: false };
  const rest = [];
  for (const arg of normalized) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--keep-tags') opts.keepTags = true;
    else if (arg.startsWith('--to=')) opts.to = arg.slice(5).toLowerCase();
    else if (arg.startsWith('-o=')) opts.out = arg.slice(3);
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else rest.push(arg);
  }
  return { opts, rest };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return; }
  if (argv[0] === '--selftest') { selftest(); return; }
  if (argv[0] !== 'convert') { console.error(`未知子命令: ${argv[0]}\n\n${USAGE}`); process.exit(2); }

  const { opts, rest } = parseArgs(argv.slice(1));
  const file = rest[0];
  if (!file) { console.error('需要输入文件\n\n' + USAGE); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(2); }
  if (!opts.to || !FORMATS[opts.to]) {
    console.error(`--to 必须是 ${Object.keys(FORMATS).join(' / ')} 之一\n\n${USAGE}`);
    process.exit(2);
  }

  const buf = fs.readFileSync(file);
  let text;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString('utf8', 3);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = buf.toString('utf8'); }
  }

  const from = detectFormat(file, text);
  if (!from) { console.error(`无法识别输入格式: ${file}（支持 srt / vtt / ass）`); process.exit(2); }

  const cues = FORMATS[from].parse(text);
  if (!cues.length) { console.error('没有解析到任何字幕条目'); process.exit(2); }
  const converted = FORMATS[opts.to].render(prepare(cues, from, opts.to, opts.keepTags));

  const lost = [];
  if (from === 'ass' && opts.to !== 'ass' && !opts.keepTags) lost.push('ASS 样式与特效标签已剥离');
  if (from === 'vtt' && opts.to !== 'vtt') lost.push('VTT cue settings 已丢弃');
  if (from === 'srt' && opts.to === 'ass') lost.push('目标 ASS 只套用默认样式');

  if (opts.json) {
    console.log(JSON.stringify({
      file, from, to: opts.to, cueCount: cues.length, lost, text: converted,
    }, null, 2));
  } else if (opts.out) {
    fs.writeFileSync(opts.out, converted);
    console.error(`已写出: ${opts.out}`);
  } else {
    process.stdout.write(converted);
  }

  if (!opts.json && !opts.out) return;
  console.error(`${FORMATS[from].label} → ${FORMATS[opts.to].label}　${cues.length} 条字幕`);
  for (const l of lost) console.error(`  注意：${l}`);
}

main();
