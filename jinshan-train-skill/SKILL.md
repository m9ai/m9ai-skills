---
name: jinshan-train-skill
display_name: 金山铁路时刻表
display_name_en: Jinshan Railway Schedule
description: 查询上海金山铁路（上海南↔金山卫）列车时刻表、经停站、票价与站点信息。触发词：金山铁路、金山卫、上海南站、莘庄、春申、新桥、车墩、叶榭、亭林、金山园区、S1001、时刻表、下一班车、上海南到金山卫怎么坐车。
description_zh: 查询上海金山铁路沿线（上海南↔金山卫）的列车时刻表、经停站、票价与站点换乘信息。
description_en: Query train schedules, stops, fares and station info for Shanghai Jinshan Railway (Shanghai South ↔ Jinshanwei).
category: travel
version: 1.0.0
author: m9ai
allowed-tools: Bash
---

# 金山铁路时刻表查询

提供上海金山铁路（上海南 ↔ 金山卫，单线 9 站）的班次查询能力。所有结果必须由脚本实时计算得出。

## 何时使用

用户询问以下任一内容时启用本技能：

- 两站之间的班次（"上海南到金山卫有哪些车"、"明天早上从莘庄出发的车"）
- 某趟车次的经停站与到发时刻（"S1001 停哪些站"）
- 某站的下一班车（"现在去金山卫最近的一班"）
- 票价、站点地址、地铁公交换乘、营业时间
- 平日 / 节假日方案、调休日班次安排

## 硬性规则

1. **禁止凭记忆回答班次时刻。** 时刻表会随调图更新，任何具体车次、时间、历时都必须执行脚本获取。
2. **必须如实转述数据状态。** 脚本输出首部带有数据状态行。当状态为「本地缓存（离线，可能过期）」或「内置兜底数据（离线，可能过期）」时，回答中必须明确告知用户"当前未能连接线上数据，结果可能已过期，请以金山铁路官方最新公告为准"。
3. **出现 ⚠️ 警告时照原意转达**，不要自行淡化或省略。
4. **不要编造站点。** 线路仅有 9 站：上海南、莘庄、春申、新桥、车墩、叶榭、亭林、金山园区、金山卫。用户提到的地点不在沿线时，说明该线路不经过，不要虚构班次。
5. **反向查询不要想当然。** 反向班次与正向不同，一律用脚本查询，不要用正向时刻镜像推算。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。首次执行会自动联网同步线上时刻表并写入本地缓存，之后优先使用缓存。

```bash
node scripts/query.js search <出发站> <到达站> [--date=YYYY-MM-DD|today|tomorrow]
                       [--type=直达|大站停|站站停] [--pending] [--from-xinzhuang] [--limit=N] [--json]
node scripts/query.js next <站点> [--direction=to_jinshanwei|to_shanghainan] [--count=N]
node scripts/query.js stops <车次号> [--date=YYYY-MM-DD]
node scripts/query.js station <站点>
node scripts/query.js stations
node scripts/query.js price <出发站> <到达站>
node scripts/query.js date [YYYY-MM-DD]
```

### 参数说明

| 参数 | 说明 |
|---|---|
| `<出发站>` / `<到达站>` | 站名或站名拼音 ID，支持「上海南」「上海南站」「shanghainan」 |
| `--date` | 日期，支持 `YYYY-MM-DD`、`today`、`tomorrow`；省略则为今天 |
| `--type` | 班次类型筛选：`直达`、`大站停`、`站站停`，逗号分隔可多选 |
| `--pending` | 仅显示尚未发车的班次（仅对当天有效） |
| `--from-xinzhuang` | 仅显示停靠莘庄站的班次（仅往金山卫方向有效） |
| `--limit` / `--count` | 限制返回条数 |
| `--json` | 输出 JSON，便于二次处理 |
| `--offline` | 跳过联网同步，直接使用本地缓存或内置数据 |

### 常用示例

```bash
# 上海南到金山卫今天全部班次
node scripts/query.js search 上海南 金山卫

# 明天早上从莘庄出发的直达车
node scripts/query.js search 莘庄 金山卫 --date=tomorrow --type=直达

# 此刻在上海南站，最近 3 班去金山卫的车
node scripts/query.js next 上海南 --count=3

# 某车次经停站
node scripts/query.js stops S1001

# 票价
node scripts/query.js price 上海南 金山卫
```

## 输出解读

脚本输出的第 2 行为日期与数据状态，形如：

```
2026-10-04（周日·节假日方案） | 数据: 在线同步（版本一致） v1.1.4
```

- **节假日方案 / 平日方案**：金山铁路工作日与周末班次不同，且法定假日、调休工作日由线上数据纠正。查询未来日期时务必留意该字段。
- **数据状态**：`在线同步` 表示已与线上核对；`本地缓存` 或 `内置兜底数据` 表示离线，结果可能过期。

排查数据问题可使用：

```bash
node scripts/sync.js            # 查看数据版本、假日同步情况与告警
node scripts/sync.js --clear-cache   # 清空本地缓存后重新联网同步
```

## 领域知识

- 站点地址、营业时间、地铁与公交换乘：见 @references/stations.md
- 常见问题（购票、免票、禁带物品、车次命名规则）：见 @references/faq.md
- 完整票价矩阵：见 @references/prices.md

## 回答建议

- 默认按发车时间升序给出车次、类型、出发/到达时刻与历时；班次较多时优先展示距离当前时间最近的几班，并说明总班次数。
- 主动提示关键信息：直达车最快（约 32-34 分钟）、站站停最慢但停站多；末班车时间务必提醒（上海南往金山卫约 22:00，金山卫往上海南约 21:55）。
- 用户询问换乘、接驳时，结合 @references/stations.md 给出地铁与公交信息。
