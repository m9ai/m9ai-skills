# m9ai Skills 分类标准

> 本文档是 Skill 元数据的**唯一依据**：官网 Skill 市集的筛选、展示、排序都读这套字段。
> 任何新词必须先加进本文档，再写进 `SKILL.md` 的 frontmatter。

## 一、设计原则

1. **按"谁在什么场景下解决什么问题"分类**，不按技术实现分类。
   - ❌ 技术视角：`脚本类` / `解析类` / `转换类`
   - ✅ 职能视角：`财税` / `法务` / `数据统计`
2. **受控词表**：每个维度只能取本文档列出的值，避免同义词扩散导致筛选失效
   （例如不允许同时出现「财税」和「财务」两个分类）。
3. **分类单选，场景与角色多选**。分类决定市集一级导航，场景/角色决定二级筛选。
4. **优先做零依赖、本地可用的能力**——数据不出本地是 B2B 客户（财务/法务/医疗）的硬前提。

## 二、维度定义

| 维度 | 字段 | 基数 | 必填 | 用途 |
| --- | --- | --- | --- | --- |
| 主分类 | `category` | 单选 | ✅ | 市集一级导航 |
| 场景 | `scenarios` | 多选 1–3 | ✅ | 二级筛选 |
| 角色 | `roles` | 多选 1–3 | ✅ | 二级筛选 |
| 行业 | `industries` | 多选 | ➖ 缺省 `通用` | 可选筛选 |
| 能力形态 | `capability` | 单选 | ➖ | 是否需要云端 |
| 离线能力 | `offline` | 单选 | ➖ | B2B 客户关心 |
| 运行时 | `runtime` | 单选 | ➖ | 能否零依赖分发 |
| 收费层级 | `tier` | 单选 | ➖ | 市集展示 |
| 数据边界 | `privacy` | 单选 | ➖ | 合规声明 |

> ✅ = 校验缺失会失败；➖ = 推荐填写，缺失仅告警（见「六、渐进式落地」）。

### 2.1 主分类 `category`

| key | 中文 | 主要角色 | 边界说明 |
| --- | --- | --- | --- |
| `finance` | 财税计算 | 财务、会计、HR | 与钱有关的计算、校验、勾稽、对账 |
| `legal` | 法务合规 | 法务、合规、审计 | 期限、条款、证据固化、合规检查 |
| `data` | 数据统计 | 运营、销售、分析 | 结构化数据（CSV/JSON/日志）的清洗、统计、比对 |
| `content` | 内容合规 | 新媒体、电商、市场 | 文本内容检测与规范校验 |
| `files` | 文件批处理 | 行政、设计、运维 | 文件系统层面的批量操作 |
| `document` | 文档处理 | 行政、文秘、研发 | 单个文档内部的处理与抽取 |
| `devops` | 研发运维 | 研发、运维、测试 | 研发与运维工具 |
| `travel` | 出行交通 | 通用 | 班次、票价、换乘、时区等出行相关 |
| `life` | 生活服务 | 通用 | 本地生活信息（学区、节假日、尺码等） |

**归类仲裁**：一个 Skill 同时沾两个分类时，按「用户会去哪个货架找它」决定。

- 既处理文件又处理内容 → 看主对象是**文件集合**还是**文本内容**：前者 `files`，后者 `content`
- 既算钱又算期限 → 看输出物：金额 → `finance`，日期 → `legal`
- 纯技术玩具、无明确职能 → **不做**

### 2.2 角色 `roles`

```
财务  法务  HR  行政  运营  销售  市场  管理层
研发  运维  测试  设计  教师  医护  通用
```

### 2.3 行业 `industries`

```
通用  金融  医疗  教育  制造  零售电商  政务  物流  房地产
```

### 2.4 场景 `scenarios`（按分类分组）

<details>
<summary>finance 财税计算</summary>

```
发票  报销  对账  工资  个税  社保  贷款  预算  成本  报表  汇率  记账
```

</details>

<details>
<summary>legal 法务合规</summary>

```
合同审查  期限计算  证据固化  脱敏  主体核验  条款检查  合规检查  知识产权  劳动人事  招投标
```

</details>

<details>
<summary>data 数据统计</summary>

```
数据清洗  汇总统计  去重  差异比对  质量体检  日志分析  格式转换  报表生成  编码处理  数据抽取
```

</details>

<details>
<summary>content 内容合规</summary>

```
违禁词  极限词  敏感信息  查重  字数规范  排版规范  文案适配  标签清洗  摘要抽取  多平台发布
```

</details>

<details>
<summary>files 文件批处理</summary>

```
批量重命名  去重  完整性校验  目录比对  归档  编码转换  类型识别  时间修正  清理  清单导出
```

</details>

<details>
<summary>document 文档处理</summary>

```
Markdown  PDF  字幕  元数据  目录提取  表格  格式转换  批量导出  排版  书签
```

</details>

<details>
<summary>devops 研发运维</summary>

```
配置检查  密钥扫描  日志聚合  定时任务  依赖检查  仓库体检  API 比对  正则测试  环境排查  类型生成
```

</details>

<details>
<summary>travel 出行交通</summary>

```
班次查询  票价  换乘  路径规划  证件清单  行李额  时区  里程  费用分摊  行程规划
```

</details>

<details>
<summary>life 生活服务</summary>

```
学区  政务办事  本地查询  日程  天气  尺码
```

</details>

### 2.5 其余枚举

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `capability` | `local` | 纯本地脚本，无服务端 |
| | `hybrid` | 本地壳 + 云端增强 |
| | `cloud` | 纯云端能力 |
| `offline` | `full` | 完全离线可用 |
| | `cache` | 联网同步 + 本地缓存 + 内置兜底（同 `jinshan-train-skill` 模式） |
| | `no` | 必须联网 |
| `runtime` | `zero` | 仅 Node 内置（`fs`/`crypto`/`zlib`/`path`），零第三方包 |
| | `shell` | POSIX shell |
| | `external` | 需外部二进制，**必须在 SKILL.md 列明依赖与安装方式** |
| `tier` | `free` | 完全免费 |
| | `trial` | 免费试用，超出需授权 |
| | `licensed` | 需授权后使用 |
| `privacy` | `local-only` | 数据不出本地（默认，推荐） |
| | `no-upload` | 会联网但不上传内容 |
| | `upload` | 需上传内容，**必须在 SKILL.md 明示上传什么、存多久** |

## 三、frontmatter 规范

沿用 WorkBuddy 必填字段（`name` / `description` / `description_zh` / `description_en` / `version` / `author`），
新增分类相关字段：

```yaml
---
name: invoice-amount-checker
display_name: 发票要素校验
display_name_en: Invoice Field Validator
description: 校验发票代码号码校验位、金额与税额勾稽关系、开票日期合理性，批量输出结果。触发词：发票校验、发票要素、税号校验、金额勾稽、发票查验。
description_zh: 批量校验发票的号码校验位、金额税额勾稽与开票日期合理性。
description_en: Batch-validate invoice number check digits, amount/tax consistency and issue dates.
category: finance
scenarios: [发票, 对账]
roles: [财务, 行政]
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
```

**字段填写约定**

- `description`：用途 + **触发词**（触发词直接决定 Agent 能否正确唤起本技能，必写）
- `scenarios` / `roles`：从受控词表取，各 1–3 个，按相关性降序
- `runtime`：能用 `zero` 就不要用 `external`；确需外部依赖时必须在正文首部列明
- `offline: cache` 的技能必须像 `jinshan-train-skill` 那样实现「本地缓存 + 内置兜底」并在输出中标注数据状态

## 四、目录与命名

- 目录名：`kebab-case` + `-skill` 后缀，如 `invoice-amount-checker-skill`
- 目录名必须与 `name` 一致（不一致时 CI 仅告警，产物以目录名为准）
- 包内只允许两级：`SKILL.md`、`scripts/*`、`references/*`、`templates/*`
- 版本号唯一来源是 frontmatter 的 `version`，**内容变更必须递增**，否则 CI 失败

## 五、不做清单

以下类型明确不做，避免市集被稀释：

- 联网查询类（IP/手机号归属地/whois/实时汇率）——违背本地优先
- 需要重量级 parser 的（SQL/JS/CSS 格式化、代码反混淆）
- 需要图像编解码的（JPEG/GIF/WebP 处理）
- 纯娱乐、无明确职能场景的
- **单次使用比批量使用更方便的**（网页工具更快，做 Skill 没有价值）——
  这是最重要的一条否决标准

## 六、渐进式落地

新字段先按「推荐」执行：`scripts/validate-skill.sh` 对缺失的
`category` / `scenarios` / `roles` 只发**警告**，不阻断 CI。
存量技能补齐字段后再改为必填（`err`），届时需同步递增版本号。
