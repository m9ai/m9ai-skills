---
name: deadline-calculator-skill
display_name: 期限计算
display_name_en: Deadline Calculator
description: 按民法典口径推算自然日与工作日期限，含届满日顺延（诉讼时效、上诉期、答辩期、合同到期）。触发词：期限计算、诉讼时效、上诉期、答辩期、15 日、工作日计算、届满日、截止日期、顺延、哪天到期。
description_zh: 按民法典口径推算期限的届满日，含休假日顺延；也支持按工作日计算。
description_en: Compute statutory deadlines under the Civil Code, including rollover when the last day falls on a public holiday.
category: legal
scenarios: [期限计算, 合同审查]
roles: [法务, HR]
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

# 期限计算

推算法律与合同期限的届满日：按日/按月/按年，含**民法典顺延规则**；也支持按工作日计算。

纯本地运行，不联网、不上传。

## 何时使用

- 上诉期、答辩期、举证期限一类"收到之日起 N 日内"
- 诉讼时效是否届满（"这笔款什么时候过诉讼时效"）
- 合同里"签署后 30 个工作日交付"到底是哪天
- 某个截止日落在周末或节假日，是否顺延、顺延到哪天

## 硬性规则

1. **缺节假日数据时必须如实说，不许蒙。** 没有数据的年份：
   - 自然日计算仍可用，但会明确标注"未做顺延判断"
   - **工作日计算直接拒绝执行**，不要改用例外推，也不要按"周末=休息日"硬算
   （调休会让某些周末上班，硬算必错）
2. **必须说清用的是哪种起算口径。** 默认 `civil`（民法典：开始当日不计入，自次日起算）。
   合同另有约定的用 `natural`。两者相差一天，民事诉讼里这一天决定权利存亡。
3. **不要把结果说成法律意见。** 输出的是日期推算，不是权利是否存续的判断。
   涉及具体案件，提示以受案法院/仲裁机构的认定为准。
4. **跨年计算要逐年确认数据。** 期间跨了没有数据的年份，脚本会停下来并说明停在哪天。
5. **不要替用户填节假日数据。** 数据只能来自国务院办公厅的年度放假安排通知。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/deadline.js add --from=YYYY-MM-DD --days=N   [--mode=civil|natural] [--json]
node scripts/deadline.js add --from=YYYY-MM-DD --months=N [--mode=civil|natural]
node scripts/deadline.js add --from=YYYY-MM-DD --years=N
node scripts/deadline.js workdays --from=YYYY-MM-DD --days=N [--mode=civil|natural]
node scripts/deadline.js coverage
node scripts/deadline.js --selftest
```

### 参数说明

| 参数 | 说明 |
|---|---|
| `--from=` | 起算基准日（收到日、签署日、届满起算日） |
| `--days=` / `--months=` / `--years=` | 期间长度，三选一 |
| `--mode=civil` | **默认。** 民法典口径：开始当日不计入，自次日起算 |
| `--mode=natural` | 自然口径：开始当日计入第一日（合同常有此约定） |

### 常用示例

```bash
# 10 月 5 日收到判决，15 日上诉期，哪天届满
node scripts/deadline.js add --from=2026-10-05 --days=15

# 合同签署后 30 个工作日交付
node scripts/deadline.js workdays --from=2026-10-05 --days=30

# 合同用"含当日"口径
node scripts/deadline.js add --from=2026-10-05 --days=15 --mode=natural

# 先看数据覆盖了哪些年份
node scripts/deadline.js coverage
```

## 输出解读

```
起算日:        2026-10-06（周二）  [民法典：开始当日不计入]
期间:          15 日
名义届满日:    2026-10-20（周二）
实际届满日:    2026-10-20（周二）
顺延:          否
⚠️ 未能判断 2026-10-20 是否为休假日（2026 年无节假日数据），未做顺延调整
距今:          15 天
```

- **名义届满日**：按期间长度直接算出来的那天，还没有考虑顺延
- **实际届满日**：顺延调整后的日期，这才是要盯的日期
- **顺延**：列出逐日跳过的原因（法定休假日 / 周休息日），便于复核
- **⚠️ 行**：数据缺失导致没做顺延判断，**必须原样转达给用户**

## 计算规则

依据《民法典》第 200–204 条：

| 规则 | 实现 |
|---|---|
| 开始的当日不计入，自次日起算 | `--mode=civil`（默认） |
| 最后一日是法定休假日的，顺延至休假日结束的次日 | 逐日顺延，周末与法定节假日都算休假日 |
| 期间最后一日截止时间为 24 时 | 输出日期，时刻按此理解 |
| 按月计算，该月无对应日的取月末 | 1 月 31 日 + 1 个月 = 2 月 28/29 日 |

## 节假日数据

数据文件 `references/holidays.txt`，格式：

```
# 日期|类型
#   holiday = 法定休假日（放假）
#   workday = 调休上班日（本该休息但要上班的周末）
2026-01-01|holiday
2026-01-04|workday
```

**当前该文件未填写任何数据**，来源应为国务院办公厅年度放假安排通知，每年更新一次。
填完后用 `coverage` 确认覆盖年份。

> 年度节假日数据的另一个来源 skill 是 `holiday-schedule-skill`（life 分类，P1）。
> 它落地后可以共享同一份数据文件。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 年份无数据 | 自然日仍算但标注未顺延；工作日拒绝执行 |
| 期间跨到无数据年份 | 工作日推进到该年时停下并说明停在哪天 |
| 调休上班的周末 | 数据里标 `workday` 才计入，否则按周休息日跳过 |
| 时刻与时区 | 一律按日期（UTC 日界）计算，不处理具体到小时的期间 |
| 各地特殊安排 | 不区分地区，只有全国性安排 |

## 回答建议

- 先说结论日期，再说这个日期是怎么来的（起算口径 + 是否顺延）。
- 有 ⚠️ 时必须把警告原话告诉用户，并说明"要确认顺延需先补 YYYY 年节假日数据"。
- 涉及上诉期、诉讼时效时，主动提醒"以受案法院认定为准"，并建议留出提前量。
- `civil` 与 `natural` 差一天，用户没说时按 `civil` 并在回答里点明用的是民法典口径。
