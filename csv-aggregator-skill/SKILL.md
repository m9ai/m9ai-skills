---
name: csv-aggregator-skill
display_name: CSV 分组聚合
display_name_en: CSV Aggregator
description: 对 CSV 做分组聚合与单列统计：计数、求和、均值、中位数、P90、极值、去重计数、空值计数，支持 TopN 与排序。触发词：分组汇总、求和、平均值、中位数、分位数、TopN、统计、聚合、透视。
description_zh: 对 CSV 做分组聚合与单列统计概览：计数、求和、均值、中位数、分位数、极值、去重与空值计数。
description_en: Group and aggregate CSV data: count, sum, average, median, percentiles, extremes, distinct and blank counts.
category: data
scenarios: [汇总统计, 报表生成]
roles: [运营, 销售, 管理层]
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

# CSV 分组聚合

对 CSV 做分组汇总与单列统计，输出对齐的文本表格。
纯本地运行，不联网、不上传数据。

## 何时使用

- 按部门/区域/月份汇总金额（"按部门汇总一下销售额"）
- 算均值、中位数、P90（"客单价的中位数是多少"）
- 出 TopN 榜单（"销售额前 10 的客户"）
- 先看看每列的数据分布（"这份数据每列大概什么情况"——用 `describe`）

## 硬性规则

1. **必须执行脚本，不要手工加总。** 尤其涉及空值与千分位时，手工极易算错。
2. **空值不按 0 参与计算。** 求和与均值会跳过无法解析的值，
   所以均值可能与你"除以总行数"的直觉不同——要看 `describe` 里的空值数。
3. **不做多表关联、透视表、窗口函数。** 那是电子表格或数据库的活，
   在这里硬做只会得到一个既慢又容易算错的玩具。需要时建议用户用 SQL 或表格软件。
4. **中位数与分位数只对数值列有意义**，`describe` 会把非数值列单独标出。
5. 分组列的值按原样字符串比较，**不会做归一化**（"华东 " 与 "华东" 算两组）。
   发现疑似重复分组时，建议先用 `csv-cleaner` 清洗。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/agg.js run <CSV> [选项]
node scripts/agg.js describe <CSV> [--col=列]
node scripts/agg.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--group=列名[,列名]` | 分组列，可多个；不填则对整表聚合 |
| `--sum=` `--avg=` `--min=` `--max=` | 求和 / 均值 / 最小 / 最大 |
| `--median=` | 中位数 |
| `--p90=` `--p95=` | 分位数 |
| `--distinct=列名` | 去重计数 |
| `--blank=列名` | 空值计数 |
| `--top=N` | 只显示前 N 组 |
| `--sort=列名:asc\|desc` | 排序，缺省按行数降序 |
| `--delimiter=,` | 强制分隔符 |
| `--json` | 输出 JSON |

列名可填表头文字，也可填列号（1 起）。输出表的列名形如 `金额_合计`。

### 常用示例

```bash
# 按部门汇总
node scripts/agg.js run ./销售.csv --group=部门 --sum=金额 --avg=金额 --count

# Top10 客户
node scripts/agg.js run ./销售.csv --group=客户 --sum=金额 --top=10 --sort=金额_合计:desc

# 多列分组
node scripts/agg.js run ./销售.csv --group=区域,月份 --sum=金额

# 整表一个总数
node scripts/agg.js run ./销售.csv --sum=金额

# 每列概览
node scripts/agg.js describe ./销售.csv
```

## 输出解读

```
部门    行数  金额_合计  金额_均值  金额_中位数  销售员_去重数
------  ----  ---------  ---------  -----------  -------------
销售部     3  23,000.00   7,666.67     8,000.00              2
技术部     2  21,500.00  10,750.00    10,750.00              2
市场部     2   9,500.00   9,500.00     9,500.00              1
```

`describe` 会给出每列的非空数、空值数、去重数，以及数值列的最小值、最大值、均值、中位数、P90，
并把非数值列单独列出——那几列的统计项显示 `—` 是正常的。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 空值 / 无法解析的值 | 跳过，不按 0 计；用 `--blank=` 单独统计 |
| 千分位、货币符号、全角、括号负数 | 能解析 |
| 分组值的空格与全角差异 | **不归一化**，会分成不同组，建议先清洗 |
| 中位数 / 分位数 | 分位数用线性插值 |
| 多表关联、透视表 | **不做** |
| 金额精度 | 用浮点数累加，极大数量级的求和可能有末位误差 |

## 回答建议

- 先说"共几组、合计多少"，再给表格；组数多时用 `--top` 给头部并说明总数。
- 均值与用户预期的"总额 ÷ 行数"不一致时，主动指出存在空值并用 `--blank=` 给出数量。
- 用户要透视表（行列双向展开）时，说明不支持，建议改用表格软件或 SQL。
- 分组结果里有看着重复的名称时，提示可能是空格或全角差异，建议先清洗。
