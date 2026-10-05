#!/usr/bin/env node
// JSON 工具集：格式化、批量语法校验、生成 TypeScript interface。
//
// 用法：
//   node scripts/json.js format <文件> [--indent=2] [--minify] [--sort-keys] [--in-place]
//   node scripts/json.js check <文件或目录> [--ext=.json] [--json]
//   node scripts/json.js interface <文件> [--name=Root] [--json]
//   node scripts/json.js --selftest

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 读取与解析

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 从 V8 的报错信息里抠出出错位置。不同 Node 版本文案不同，两种都兼容。 */
function extractPosition(message) {
  let m = /\(line (\d+) column (\d+)\)/.exec(message);
  if (m) return { line: Number(m[1]), column: Number(m[2]), position: null };
  m = /position (\d+)/.exec(message);
  if (m) return { line: null, column: null, position: Number(m[1]) };
  return null;
}

function positionToLineCol(text, position) {
  const head = text.slice(0, position);
  const lines = head.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * 解析文本，失败时给出行列与出错行原文。
 * @returns {{ ok: true, value: * } | { ok: false, message: string, line: number|null, column: number|null, snippet: string|null }}
 */
function parseJson(input) {
  // 去掉 UTF-8 BOM，否则 JSON.parse 会在第 1 行第 1 列报 "Unexpected token"
  const text = stripBom(input);
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const pos = extractPosition(err.message);
    let line = null;
    let column = null;
    let snippet = null;
    if (pos) {
      if (pos.line !== null) {
        line = pos.line;
        column = pos.column;
      } else {
        const lc = positionToLineCol(text, pos.position);
        line = lc.line;
        column = lc.column;
      }
      const lines = text.split('\n');
      if (line >= 1 && line <= lines.length) {
        const src = lines[line - 1];
        const caret = ' '.repeat(Math.max(0, Math.min(column - 1, src.length))) + '^';
        snippet = `${line} | ${src}\n${' '.repeat(String(line).length)} | ${caret}`;
      }
    }
    return { ok: false, message: err.message, line, column, snippet };
  }
  return { ok: true, value };
}

// ------------------------------------------------------------------ 目录遍历

function listFiles(target, exts) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.includes(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(target);
  return out.sort();
}

// ------------------------------------------------------------------ 格式化

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

function cmdFormat(file, opts) {
  const text = readText(file);
  const parsed = parseJson(text);
  if (!parsed.ok) {
    console.error(`错误: ${file}`);
    console.error(`  ${parsed.message}`);
    if (parsed.snippet) console.error(`  ${parsed.snippet.split('\n').join('\n  ')}`);
    process.exit(1);
  }
  const value = opts.sortKeys ? sortKeysDeep(parsed.value) : parsed.value;
  const out = opts.minify
    ? JSON.stringify(value)
    : JSON.stringify(value, null, opts.indent) + '\n';

  if (opts.inPlace) {
    fs.writeFileSync(file, out, 'utf8');
    console.log(`已写入 ${file}`);
  } else {
    process.stdout.write(out);
  }
}

// ------------------------------------------------------------------ 校验

function cmdCheck(target, opts) {
  let files;
  try {
    files = listFiles(target, opts.exts);
  } catch (err) {
    console.error(`错误: 无法读取 ${target}（${err.message}）`);
    process.exit(2);
  }

  if (files.length === 0) {
    console.error(`错误: ${target} 下没有找到 ${opts.exts.join(' / ')} 文件`);
    process.exit(2);
  }

  const results = files.map((file) => {
    let text;
    try {
      text = readText(file);
    } catch (err) {
      return { file, ok: false, message: `读取失败: ${err.message}`, line: null, column: null, snippet: null };
    }
    const parsed = parseJson(text);
    return parsed.ok
      ? { file, ok: true, bytes: text.length }
      : { file, ok: false, message: parsed.message, line: parsed.line, column: parsed.column, snippet: parsed.snippet };
  });

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      if (r.ok) {
        console.log(`✓ ${r.file}`);
      } else {
        const where = r.line ? `（第 ${r.line} 行第 ${r.column} 列）` : '';
        console.log(`✗ ${r.file}${where}`);
        console.log(`    ${r.message}`);
        if (r.snippet) console.log(`    ${r.snippet.split('\n').join('\n    ')}`);
      }
    }
    const bad = results.filter((r) => !r.ok).length;
    console.log(`\n共 ${results.length} 个文件，失败 ${bad} 个`);
  }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

// ------------------------------------------------- TypeScript interface 生成

function pascalCase(raw) {
  const parts = String(raw)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return 'Item';
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/** 极简单数化：只处理最常见的 s/es/ies 结尾，够用即可，不做英文词典。 */
function singularize(word) {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, 'y');
  if (/(ch|sh|ss|x|s)es$/i.test(word)) return word.replace(/es$/i, '');
  if (/[^s]s$/i.test(word)) return word.replace(/s$/i, '');
  return word;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function quoteKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/** 从一组对象里合并出字段表：某些对象缺失的字段标为可选。 */
function mergeObjectFields(objects) {
  const order = [];
  const seen = new Map();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.set(key, { key, values: [], count: 0 });
        order.push(key);
      }
      const entry = seen.get(key);
      entry.values.push(obj[key]);
      entry.count++;
    }
  }
  return order.map((key) => {
    const entry = seen.get(key);
    return { key, values: entry.values, optional: entry.count < objects.length };
  });
}

/**
 * 递归推断 TS 类型，过程中把需要单独声明的 interface 收集进 ctx.interfaces。
 * @returns {string} TS 类型表达式
 */
function inferType(value, nameHint, ctx) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    if (value.every(isPlainObject)) {
      const fields = mergeObjectFields(value);
      const itemName = declareInterface(fields, pascalCase(singularize(nameHint)), ctx);
      ctx.referenced.add(itemName);
      return `${itemName}[]`;
    }
    const kinds = new Set(value.map((v) => inferType(v, nameHint, ctx)));
    const inner = Array.from(kinds).sort().join(' | ');
    return kinds.size > 1 ? `(${inner})[]` : `${inner}[]`;
  }
  if (isPlainObject(value)) {
    const name = declareInterface(Object.keys(value).map((key) => ({ key, values: [value[key]], optional: false })), pascalCase(nameHint), ctx);
    ctx.referenced.add(name);
    return name;
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** 声明一个 interface（同名同结构会复用，同名不同结构会加序号）。 */
function declareInterface(fields, baseName, ctx) {
  const body = fields
    .map((field) => {
      const type = inferType(field.values[0], field.key, ctx);
      return `  ${quoteKey(field.key)}${field.optional ? '?' : ''}: ${type};`;
    })
    .join('\n');
  const signature = `${baseName}\n${body}`;

  const existing = ctx.shapes.get(signature);
  if (existing) return existing;

  let name = baseName;
  if (ctx.used.has(name)) {
    let n = 2;
    while (ctx.used.has(`${name}${n}`)) n++;
    name = `${name}${n}`;
  }
  ctx.used.add(name);
  ctx.shapes.set(signature, name);
  ctx.interfaces.push({ name, body });
  return name;
}

/** 由 JSON 值生成 TypeScript 类型声明文本。 */
function generateInterfaces(value, rootName) {
  const alias = pascalCase(rootName);
  const ctx = { interfaces: [], used: new Set(), shapes: new Map(), referenced: new Set() };

  // 根是数组时，元素类型的名字要避开根别名，否则 interface Root 与 type Root 会撞名
  let hint = rootName;
  if (Array.isArray(value)) {
    const singular = pascalCase(singularize(alias));
    hint = singular === alias ? alias + 'Item' : singular;
  }

  const root = inferType(value, hint, ctx);

  // declareInterface 先声明子结构再声明自己，所以这里的天然顺序就是「内层在前、根在最后」
  const lines = [];
  for (const block of ctx.interfaces) {
    lines.push(`export interface ${block.name} {`);
    lines.push(block.body);
    lines.push('}');
    lines.push('');
  }
  // 根本身就是对象时，上面的 interface 已经用了别名，不再重复导出 type
  if (root !== alias) lines.push(`export type ${alias} = ${root};`);
  return lines.join('\n') + '\n';
}

function cmdInterface(file, opts) {
  const text = readText(file);
  const parsed = parseJson(text);
  if (!parsed.ok) {
    console.error(`错误: ${file}`);
    console.error(`  ${parsed.message}`);
    if (parsed.snippet) console.error(`  ${parsed.snippet.split('\n').join('\n  ')}`);
    process.exit(1);
  }
  const out = generateInterfaces(parsed.value, opts.name);
  if (opts.json) {
    console.log(JSON.stringify({ file, code: out }, null, 2));
  } else {
    process.stdout.write(out);
  }
}

// ------------------------------------------------------------------ 自测

function runSelftest() {
  let failed = 0;
  const check = (label, actual, expected) => {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) console.log(`    实际: ${JSON.stringify(actual)}\n    期望: ${JSON.stringify(expected)}`);
  };

  // 1. 语法错误能定位到行列
  const bad = parseJson('{\n  "a": 1,\n}');
  check('语法错误可定位', bad.ok === false && bad.line === 3, true);

  // 2. BOM 不影响解析
  check('BOM 可解析', parseJson('﻿{"a":1}').ok, true);

  // 3. interface 生成
  const sample = {
    id: 1,
    name: '张三',
    active: true,
    tags: ['a', 'b'],
    address: { city: '上海', zip: '200000' },
    orders: [{ no: 'A001', amount: 12.5 }, { no: 'A002', amount: 3 }],
    remark: null,
  };
  const code = generateInterfaces(sample, 'Root');
  check('根为对象时用 interface 且不与 type 撞名', /export interface Root \{/.test(code) && !/export type Root =/.test(code), true);
  check('基础字段', code.includes('id: number;'), true);
  check('字符串数组', code.includes('tags: string[];'), true);
  check('嵌套对象', code.includes('city: string;'), true);
  check('对象数组命名', /orders: \w+\[\];/.test(code), true);
  check('null 字段', code.includes('remark: null;'), true);

  // 4. 数组内对象字段不一致 → 可选字段
  const partial = generateInterfaces({ items: [{ a: 1 }, { a: 2, b: 'x' }] }, 'Root');
  check('缺失字段标可选', partial.includes('b?: string;'), true);
  check('共有字段必填', partial.includes('a: number;'), true);

  // 5. 空数组与混合数组
  check('空数组', generateInterfaces({ x: [] }, 'Root').includes('x: unknown[];'), true);
  check('混合数组', generateInterfaces({ x: [1, 'a'] }, 'Root').includes('x: (number | string)[];'), true);

  // 6. 需转义的键名
  check('非法标识符键名', generateInterfaces({ 'a-b': 1 }, 'Root').includes('"a-b": number;'), true);

  // 7. 根为数组：元素类型不得与根别名撞名
  const arrCode = generateInterfaces([{ no: 'A001' }], 'UserList');
  check('数组根导出 type 别名', /export type UserList = \w+\[\];/.test(arrCode), true);
  check('数组根元素不撞名', !/export interface UserList \{/.test(arrCode), true);

  // 8. 格式化
  check('压缩输出', JSON.stringify(sortKeysDeep({ b: 1, a: 2 })), '{"a":2,"b":1}');

  console.log(`\n失败 ${failed} 条`);
  return failed === 0 ? 0 : 1;
}

// ------------------------------------------------------------------ 入口

function parseArgs(argv) {
  const opts = {
    indent: 2,
    minify: false,
    sortKeys: false,
    inPlace: false,
    name: 'Root',
    json: false,
    selftest: false,
    exts: ['.json'],
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--minify') opts.minify = true;
    else if (arg === '--sort-keys') opts.sortKeys = true;
    else if (arg === '--in-place') opts.inPlace = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--indent') opts.indent = Number(argv[++i]);
    else if (arg.startsWith('--indent=')) opts.indent = Number(arg.slice('--indent='.length));
    else if (arg === '--name') opts.name = argv[++i];
    else if (arg.startsWith('--name=')) opts.name = arg.slice('--name='.length);
    else if (arg === '--ext') opts.exts = argv[++i].split(',').map((e) => (e.startsWith('.') ? e : '.' + e));
    else if (arg.startsWith('--ext=')) {
      opts.exts = arg.slice('--ext='.length).split(',').map((e) => (e.startsWith('.') ? e : '.' + e));
    } else if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
    else opts.rest.push(arg);
  }
  if (!Number.isInteger(opts.indent) || opts.indent < 0 || opts.indent > 8) {
    throw new Error('--indent 必须是 0–8 的整数');
  }
  return opts;
}

const USAGE = `用法:
  node scripts/json.js format <文件> [--indent=2] [--minify] [--sort-keys] [--in-place]
  node scripts/json.js check <文件或目录> [--ext=.json] [--json]
  node scripts/json.js interface <文件> [--name=Root] [--json]
  node scripts/json.js --selftest`;

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

  if (command === 'format') cmdFormat(target, opts);
  else if (command === 'check') cmdCheck(target, opts);
  else if (command === 'interface') cmdInterface(target, opts);
  else {
    console.error(`错误: 未知子命令 ${command}\n${USAGE}`);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseJson, generateInterfaces, sortKeysDeep, positionToLineCol };
