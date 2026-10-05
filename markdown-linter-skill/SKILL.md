---
name: markdown-linter-skill
display_name: Markdown 规范检查
display_name_en: Markdown Linter
description: Markdown 标题层级、列表符号、代码块围栏、链接、表格对齐检查与自动修复。触发词：Markdown 检查、Markdown 规范、md 格式、表格对齐、标题层级、代码块未闭合、Markdown 修复、md lint。
description_zh: 检查标题层级、列表符号、代码块围栏、链接与表格对齐，并自动修复其中无歧义的问题。
description_en: Check heading levels, list markers, code fences, links and table alignment, and auto-fix the unambiguous issues.
category: document
scenarios: [Markdown, 排版]
roles: [研发, 行政]
industries: [通用]
capability: local
offline: full
runtime: zero
tier: free
privacy: local-only
version: 1.0.0
author: m9ai
allowed-tools: Bash
---

# Markdown 规范检查

检查一份 Markdown 的结构问题（标题跳级、列表符号混用、代码块未闭合、表格列数不一致、
裸 URL、相对链接失效等），并自动修复其中**没有歧义**的那部分。

纯本地运行，不联网、不上传。

## 何时使用

- 写完文档想自查格式（"帮我检查这个 md"、"看看这篇文档有什么格式问题"）
- 表格对不齐、列数乱了
- 标题层级跳级（`##` 直接接 `####`）
- 列表符号 `-` `*` `+` 混用
- 相对链接指向了不存在的文件（文档重构后常见）

## 硬性规则

1. **先 `check` 再 `fix`。** 检查报告里标了「可自动修复」的才动，其余必须交给人决定。
2. **不自动改需要判断的东西。** 标题跳级该补中间层级还是降级？裸 URL 该用什么链接文字？
   这些都取决于作者意图，脚本只报告、不代劳。
3. **`fix` 会另存新文件**（默认 `<原名>.fixed.md`），绝不原地覆盖原文档。
4. **代码块内的内容不参与检查。** 围栏里的 `#`、`-`、URL 都是代码，不是 Markdown 语法。
5. **相对链接失效必须报告给用户**，不要自行删除链接或改指向。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/mdlint.js check <文件或目录> [--json]
node scripts/mdlint.js fix <文件> [-o 输出] [--force] [--json]
node scripts/mdlint.js --selftest
```

### 常用示例

```bash
# 检查单个文件
node scripts/mdlint.js check ./README.md

# 检查整个文档目录
node scripts/mdlint.js check ./docs

# 修复并另存
node scripts/mdlint.js fix ./README.md -o ./README.fixed.md
```

## 检查项

| 代码 | 含义 | 可自动修复 |
|---|---|---|
| MD001 | 标题层级跳级（H2 直接到 H4） | ✗ |
| MD025 | 多个一级标题 | ✗ |
| MD026 | 标题末尾有多余标点 | ✗ |
| MD004 | 无序列表符号混用 | ✓ |
| MD009 | 行尾多余空白 | ✓ |
| MD010 | 制表符缩进 | ✓ |
| MD019 / MD027 | 多余空格 | ✓ |
| MD031 | 代码块围栏未闭合 | ✓ |
| MD040 | 代码块围栏缺语言标注 | ✗ |
| MD034 | 裸 URL | ✗ |
| MD039 | 链接文字为空或首尾有空格 | ✗ / ✓ |
| MD053 | 相对链接指向的文件不存在 | ✗ |
| MD056 | 表格缺分隔行或列数不一致 | ✓ |
| MD047 | 文件末尾缺换行 | ✓ |

## 输出解读

```
README.md
     3  MD001  标题层级跳级：H1 直接到 H3
     6  MD004  无序列表符号混用：上一项用 "-"，这里用 "*"  [可自动修复]
    12  MD056  表格列数不一致：表头 2 列，本行 1 列  [可自动修复]

共 1 个文件，5 个问题（3 个可自动修复）
```

`fix` 之后会列出**剩余**问题，这些就是要用户人工处理的：

```
已写入:      ./README.fixed.md
剩余问题:    2 个（自动修复只处理无歧义项）
     3  MD001  标题层级跳级：H1 直接到 H3
    14  MD034  存在裸 URL，建议用 [文字](url) 包裹
```

## 已知取舍

| 情形 | 处理 |
|---|---|
| 表格对齐 | 按**显示宽度**补空格，中文按 2 个字符宽度计 |
| 表格缺单元格 | 补空单元格，不丢行 |
| 列表符号 | 统一为文档中首个出现的符号 |
| Setext 标题（`===` 下划线式） | 不识别，只认 `#` 形式 |
| 代码块内的 Markdown 语法 | 一律跳过 |
| 中英文之间是否加空格 | **不检查**，风格分歧太大，交给作者 |

## 回答建议

- 先给结论：「共 N 个问题，其中 M 个可以自动修」。
- 可自动修的直接用 `fix`，然后把剩余问题逐条说明**为什么需要人来决定**。
- MD053（相对链接失效）要给出具体文件名，常是文档移动后忘了改链接。
- 问题很多时按代码分组汇报，不要逐行念。
