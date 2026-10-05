# m9ai-skills

[English](README.md) | 简体中文

Agent Skills monorepo。每个子目录是一个独立的技能包：推送到 `main` 后，GitHub Actions 会自动
检测变更、规范校验、打包 zip、打 tag `{skill}/v{version}` 并发布 Release。

## 安装

```bash
# 安装单个技能（交互式选择要装到哪个客户端）
npx skills add m9ai/m9ai-skills --skill amount-to-chinese-skill

# 指定客户端安装
npx skills add m9ai/m9ai-skills --skill amount-to-chinese-skill -a claude-code

# 只看有哪些技能，不安装
npx skills add m9ai/m9ai-skills --list
```

每个 Release 同时提供 `{skill}-v{version}.zip`。不想用命令行的话，从
[Releases](https://github.com/m9ai/m9ai-skills/releases) 页面下载后解压到客户端的技能目录即可。

## 技能清单

共 25 个技能。下表第一列是目录名，也就是 `--skill` 参数要填的值。

### 财税计算

| 目录 | 技能 |
|---|---|
| `amount-to-chinese-skill` | 金额转大写 |
| `bank-reconciliation-skill` | 银行对账 |
| `expense-audit-skill` | 报销单审计 |
| `invoice-field-checker-skill` | 发票要素校验 |

### 法务合规

| 目录 | 技能 |
|---|---|
| `contract-checklist-skill` | 合同必备条款检查 |
| `deadline-calculator-skill` | 期限计算 |
| `file-evidence-seal-skill` | 证据固化与核验 |
| `pii-redactor-skill` | 个人信息脱敏 |

### 数据统计

| 目录 | 技能 |
|---|---|
| `csv-aggregator-skill` | CSV 分组聚合 |
| `csv-cleaner-skill` | CSV 清洗 |
| `csv-diff-skill` | CSV 差异比对 |
| `data-quality-checker-skill` | 数据质量体检 |

### 内容合规

| 目录 | 技能 |
|---|---|
| `ad-law-risk-checker-skill` | 广告法风险词检测 |
| `banned-word-checker-skill` | 违禁词扫描 |
| `pii-leak-scanner-skill` | 敏感信息泄露扫描 |

### 文件批处理

| 目录 | 技能 |
|---|---|
| `batch-rename-skill` | 批量重命名 |
| `dir-fingerprint-skill` | 目录指纹比对 |
| `duplicate-file-finder-skill` | 重复文件查找 |

### 文档处理

| 目录 | 技能 |
|---|---|
| `markdown-linter-skill` | Markdown 规范检查 |
| `markdown-table-builder-skill` | Markdown 表格生成 |
| `subtitle-converter-skill` | 字幕格式互转 |

### 研发运维

| 目录 | 技能 |
|---|---|
| `cron-explainer-skill` | cron 表达式解析 |
| `json-toolkit-skill` | JSON 工具集 |
| `secret-scanner-skill` | 密钥扫描（CI 卡口） |

### 出行交通

| 目录 | 技能 |
|---|---|
| `jinshan-train-skill` | 金山铁路时刻表 |

`shanghai-school-district-skill` 是尚未就绪的占位目录，没有 `SKILL.md`，CI 会跳过它。

## 目录结构

```
m9ai-skills/
├── .github/workflows/build-skills.yml   # 构建流水线：检测 → 校验 → 打包 → 发布
├── docs/
│   ├── TAXONOMY.md                      # category / scenarios / roles 受控词表
│   └── CATALOG.md                       # 每个分类 Top 10 候选清单
├── scripts/
│   ├── read-meta.sh                     # 读取 SKILL.md frontmatter 字段
│   ├── detect-changed.sh                # 检测本次变更涉及的 skill
│   ├── validate-skill.sh                # 技能包规范校验
│   └── package-skill.sh                 # 打包为 {目录名}-v{版本号}.zip
├── <name>-skill/                        # 每个技能一个目录
└── LICENSE                              # MIT
```

技能包本身只允许两级目录（根目录/二级目录/文件）。`scripts/`、`.github/` 与 `docs/` 属于仓库
基础设施，不参与打包。

## 发布一个技能

1. 修改技能目录内容
2. **递增 `SKILL.md` 的 `version`**（语义化版本，如 `1.0.0` → `1.1.0`）
3. 提交并推送到 `main`

CI 会自动完成：检测变更 → 规范校验 → 打包 → 上传 Artifact → 打 tag `{skill}/v{version}`
并发布 Release。

从 Release 下载 zip，提交到 WorkBuddy 技能市场。

## 版本号规则

版本号的唯一来源是 `SKILL.md` 的 frontmatter：

```yaml
---
name: amount-to-chinese-skill
version: 1.0.0
---
```

- 内容有变更就必须递增版本号，**否则 CI 会失败**
- 同一版本号重复发布会失败（以 git tag 去重）
- 不需要维护 `package.json`

## 本地自检

推送前可先在本地跑一遍校验：

```bash
./scripts/validate-skill.sh amount-to-chinese-skill      # 校验
./scripts/package-skill.sh amount-to-chinese-skill dist  # 打包到 dist/
./scripts/read-meta.sh amount-to-chinese-skill version   # 查看版本号
```

## 新建一个技能

创建目录并放置 `SKILL.md`，frontmatter 必填字段：

| 字段 | 说明 |
|---|---|
| `name` | 技能标识，建议与目录名一致 |
| `description` | 用途与触发词 |
| `description_zh` / `description_en` | 中英文简介 |
| `version` | 语义化版本号 |
| `author` | 合作方名称 |

推荐字段——官网市集筛选依赖它们，新增前先读 [docs/TAXONOMY.md](docs/TAXONOMY.md)：

| 字段 | 说明 |
|---|---|
| `category` | 取自 `docs/TAXONOMY.md` 的受控词表 |
| `scenarios` | 使用场景 |
| `roles` | 适用角色 |

可选子目录：`references/`（参考资料）、`scripts/`（可执行脚本）、`templates/`（模板文件）。

## 脚本自测

带脚本的技能都内置了 `--selftest`，改完脚本先跑一遍：

```bash
node amount-to-chinese-skill/scripts/amount.js --selftest
node json-toolkit-skill/scripts/json.js --selftest
node csv-cleaner-skill/scripts/csv.js --selftest
node subtitle-converter-skill/scripts/subtitle.js --selftest
```

新增脚本时请一并补用例。目前全部自测通过，这是本仓库唯一的回归保障。

## 许可证

[MIT](LICENSE) —— 可自由使用、修改与二次分发，保留版权与许可声明即可。

本仓库为公开仓库，`--selftest` 用例里出现的身份证号、银行卡号、AKIA / ghp_ 等字符串都是
公开的示例值，不是真实凭证。新增用例时请沿用这一约定，不要写入任何真实数据。
