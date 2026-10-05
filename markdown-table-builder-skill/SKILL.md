---
name: markdown-table-builder-skill
display_name: Markdown 表格生成
display_name_en: Markdown Table Builder
description: 从 CSV/TSV 生成对齐的 Markdown 表格，自动右对齐数字列、转义管道符、按显示宽度对齐中文。触发词：生成表格、Markdown 表格、CSV 转表格、表格对齐、制表、数据转表格。
description_zh: 从 CSV/TSV 生成对齐的 Markdown 表格，自动右对齐数字列并转义管道符。
description_en: Generate aligned Markdown tables from CSV/TSV, right-aligning numeric columns and escaping pipes.
category: document
scenarios: [表格, Markdown]
roles: [运营, 研发]
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

# Markdown 表格生成

从 CSV / TSV 生成对齐的 Markdown 表格。纯本地运行，不联网、不上传数据。

## 何时使用

- 把统计数据贴进文档（"把这个 CSV 变成 Markdown 表格"）
- 写 README 或报告要放表格
- 表格里中文对不齐，想重新排版
- 从表格软件导出后转 Markdown

## 硬性规则

1. **必须执行脚本，不要手工敲表格。** 手工对齐中文列几乎不可能一次到位。
2. **单元格里的 `|` 必须转义成 `\|`**，否则表格会被截断。脚本已自动处理，
   不要为了"看起来干净"再手工改回去。
3. **对齐按显示宽度算**（中文按 2 个字符宽）。只在等宽字体下才看得出对齐效果，
   在比例字体里对不齐是正常的，不要因此反复调整。
4. **无表头的 CSV 会自动补一行空表头**——Markdown 表格语法要求必须有表头行。
   需要真实表头时，先在 CSV 第一行补列名。
5. 单元格里的换行会转成 `<br>`，因为 Markdown 表格不支持单元格内换行。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/mdtable.js build <CSV> [选项]
node scripts/mdtable.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--align=auto` | 对齐方式，默认 `auto`（数字列右对齐） |
| `--delimiter=,` | 强制分隔符（默认自动嗅探，支持 CSV 与 TSV） |
| `--no-header` | 首行也是数据，不把它当表头 |
| `-o <文件>` | 写到文件；不填则输出到 stdout |
| `--json` | 输出 JSON |

### 对齐方式

| 值 | 效果 |
|---|---|
| `auto`（默认） | 该列除表头外全是数字 → 右对齐，否则左对齐 |
| `left` | 全部左对齐 |
| `right` | 全部右对齐 |
| `center` | 全部居中 |

### 常用示例

```bash
# 直接输出
node scripts/mdtable.js build ./销售数据.csv

# 写到文件
node scripts/mdtable.js build ./销售数据.csv -o ./表格.md

# TSV（制表符分隔，自动识别）
node scripts/mdtable.js build ./数据.tsv

# 全部居中
node scripts/mdtable.js build ./数据.csv --align=center
```

## 输出解读

```
| 部门   | 销售员 | 区域 |  金额 | 数量 |
| ------ | ------ | ---- | ----: | ---: |
| 销售部 | 张三   | 华东 | 12000 |   15 |
| 市场部 | 钱七   | 华东 |       |    0 |
```

- 数字列的分隔符是 `---:`（右对齐），文本列是 `---`（左对齐）
- 空单元格留白，不会被填成 `0` 或 `-`
- 列数不齐的短行会补空单元格

## 已知取舍

| 情形 | 处理 |
|---|---|
| 单元格含 `\|` | 转义成 `\\|` |
| 单元格含换行 | 转成 `<br>` |
| 中文对齐 | 按显示宽度（全角 2）计算，等宽字体下对齐 |
| 无表头 CSV | 自动补空表头行 |
| 合并单元格 / 跨行列 | Markdown 不支持，本工具也不做 |
| 单元格内列表、代码块 | Markdown 表格不支持，会挤成一行 |
| 超宽表格 | 不换行，列多时建议拆成多个表 |

## 回答建议

- 直接把表格贴给用户，并说明数字列已右对齐（如需统一左对齐可加 `--align=left`）。
- 用户抱怨"对不齐"时，先确认是在等宽字体环境（代码编辑器、终端）里看；
  在聊天窗口等比例字体里对不齐属正常现象。
- 表格列很多时建议拆分，并提示 Markdown 表格不适合超过 7–8 列。
- 数据来自 CSV 且需要统计时，先用 `csv-aggregator` 汇总再转表格，比整表贴出更可读。
