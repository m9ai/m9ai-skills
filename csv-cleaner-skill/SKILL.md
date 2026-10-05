---
name: csv-cleaner-skill
display_name: CSV 清洗
display_name_en: CSV Cleaner
description: CSV 编码检测（含 GBK）、分隔符嗅探、去空行、数字与日期归一化、列级体检报告。触发词：CSV 清洗、CSV 乱码、CSV 格式化、分隔符、CSV 体检、日期格式统一、千分位、GBK 转 UTF-8、CSV 去重。
description_zh: 检测编码与分隔符、去除空行、归一化数字与日期，并输出逐列的体检报告。
description_en: Detect encoding and delimiter, drop blank rows, normalise numbers and dates, and report a per-column health check.
category: data
scenarios: [数据清洗, 编码处理]
roles: [运营, 财务, 销售]
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

# CSV 清洗

把一份"能打开但没法直接用"的 CSV 变成规整的数据：识别编码与分隔符、去掉空行、
把 `1,234.56` 和 `2026/3/5` 这类写法归一成可计算的值，并给出逐列体检报告。

纯本地运行，不联网、不上传。

## 何时使用

- 表格打开是乱码（"这个 CSV 乱码了"、"GBK 转 UTF-8"）
- 分隔符不对（"用 Excel 打开全在一列"、"分号分隔的 CSV"）
- 数字带千分位或货币符号导致没法求和
- 日期写法不统一（"有的是 2026/3/5 有的是 2026年3月5日"）
- 想先看看这份数据有多少空值、多少重复行、哪些行列数不对

## 硬性规则

1. **先 `inspect` 再 `clean`。** 体检报告会暴露列数不一致、非法日期、疑似编号列等问题，
   直接清洗会把问题藏起来。
2. **绝不猜测。** 无法确认的日期（`2026-02-30`、`20260230`）一律原样保留，不修、不补、不推算。
3. **8 位纯数字默认不是日期。** `20260101` 可能是日期也可能是订单号，默认一律不动；
   只有用户明确说"这列是日期"时才加 `--compact-dates`。
4. **不动小数位。** `500.00` 保持 `500.00`，不会变成 `500`——金额场景里两者含义不同。
5. **百分比不擅自转小数。** `12.5%` 保持原样，转换涉及业务口径，要用户确认。
6. **清洗会覆盖输出文件。** 默认写入 `<原名>.cleaned.csv`，已存在时会拒绝，需 `--force`。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/csv.js inspect <文件> [--delimiter=,] [--json]
node scripts/csv.js clean <文件> [-o 输出] [--stdout] [--delimiter=,] [--bom]
                   [--no-trim] [--no-normalize-numbers] [--no-normalize-dates]
                   [--compact-dates] [--fullwidth] [--force] [--json]
node scripts/csv.js --selftest
```

### 参数说明

| 参数 | 说明 |
|---|---|
| `--delimiter=` | 手动指定分隔符，`,` / `;` / `tab` / 竖线；默认自动嗅探 |
| `-o` / `--output` | 输出路径；默认 `<原名>.cleaned.csv` |
| `--stdout` | 打到屏幕而不写文件 |
| `--bom` | 输出带 UTF-8 BOM，便于 Excel 直接双击打开 |
| `--no-trim` | 不去首尾空白 |
| `--no-normalize-numbers` | 不做数字归一化 |
| `--no-normalize-dates` | 不做日期归一化 |
| `--compact-dates` | 把 `20260101` 这类 8 位数字当日期（**需用户确认该列确为日期**） |
| `--fullwidth` | 全角字符转半角 |
| `--force` | 覆盖已存在的输出文件 |

### 常用示例

```bash
# 先看体检报告
node scripts/csv.js inspect ./销售明细.csv

# 清洗并另存
node scripts/csv.js clean ./销售明细.csv -o ./销售明细_已清洗.csv

# 只打印结果，先确认再决定是否落盘
node scripts/csv.js clean ./销售明细.csv --stdout

# 给 Excel 用：带 BOM
node scripts/csv.js clean ./销售明细.csv --bom
```

## 输出解读

`inspect` 的体检报告：

```
编码:        gb18030（推测，已转码为 UTF-8）
分隔符:      逗号
表头:        有
数据行:      3
列数:        4
各列：
   2. 金额   number (可归一)   空 0　唯一 3　例：1,234.56 / (500.00) / １２３
   3. 日期   date (1 个非法)   空 0　唯一 3 ⚠️ 1 个非法日期　例：2026/3/5
```

- **编码**：BOM → 严格 UTF-8 → GB18030 依次试探。判为 GB18030 时会标"推测"。
- **列类型**：`integer` / `decimal` / `number (可归一)` / `date (可归一)` / `string`。
  "可归一"表示清洗后会变成该类型。
- **⚠️ N 个非法日期**：这列看着是日期但校验不过（`2026-02-30`），**清洗时会原样保留**，
  必须报告给用户让其人工确认。
- **列数不一致的行**：清洗时会补齐或截断，报告里会列出行号。

## 已知取舍

| 情形 | 处理 |
|---|---|
| GBK / GB18030 | 用 Node 内置 `TextDecoder` 解码，无需安装任何包 |
| 括号负数 `(500.00)` | 转为 `-500.00`（财务写法） |
| CSV 内的引号与换行 | 按 RFC 4180 解析，字段内的逗号与换行不会破坏结构 |
| 全角字符 | 默认不动，需 `--fullwidth` |
| 文件编码输出 | 始终 UTF-8；要 Excel 直接打开加 `--bom` |

## 回答建议

- 先跑 `inspect`，把"编码、分隔符、列数、非法日期、重复行"这几项结论先讲给用户，再动手清洗。
- 有 ⚠️ 项时必须逐条说明，并给出具体单元格所在行。
- 清洗后给出改动统计（去了几行、归一了多少单元格），并提醒输出文件路径。
- 用户只是想看数据结构时，`inspect` 就够了，不要顺手 `clean`。
