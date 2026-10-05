---
name: pii-leak-scanner-skill
display_name: 敏感信息泄露扫描
display_name_en: PII & Secret Leak Scanner
description: 扫描代码、配置与日志中的密钥凭证（AWS/阿里云/腾讯云 AK、GitHub/Slack token、私钥、JWT、含口令连接串）与个人信息。触发词：密钥扫描、泄露扫描、AK 泄露、私钥泄露、硬编码密码、token 泄露、配置检查。
description_zh: 扫描代码、配置与日志中的密钥凭证与个人信息，报告文件、行号与打码片段。
description_en: Scan code, config and logs for leaked credentials (cloud AKs, tokens, private keys, JWTs, connection strings) and personal data.
category: content
scenarios: [敏感信息, 合规检查]
roles: [运营, 法务, 研发]
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

# 敏感信息泄露扫描

扫描代码、配置、日志里的**密钥凭证**与个人信息，报告文件、行号与打码片段。
纯本地运行，不联网、不上传任何内容，**不修改任何文件**。

## 何时使用

- 提交代码前自查（"帮我看看有没有把密钥写进代码"）
- 排查配置文件（"这个配置里有没有硬编码密码"）
- 日志或导出文件里有没有个人信息（"日志里有没有手机号"）
- 接手一个项目先验一遍（"这个仓库干净吗"）

## 硬性规则

1. **必须执行脚本，不要靠 grep 某一个关键词。** 凭证格式有十几种，逐个 grep 必漏。
2. **未发现不等于没有泄露。** 本工具只找**已知模式**的凭证：
   自定义格式的硬编码口令、被 Base64 或拆分拼接的密钥都扫不出来。
   每次都要如实说明这个边界，不要说"确认安全"。
3. **报告只显示打码片段（前 4 后 4）**，报告本身不能成为新的泄露源。
   不要为了"确认是不是真密钥"而把完整值打印出来。
4. **扫到凭证要先说"吊销/轮换"，再说"删除代码"。**
   仅删除代码无效——Git 历史里仍然在。已进入历史的必须清理历史或强制轮换，二者至少做一个。
5. 默认排除 `node_modules`、`.git`、`dist`、`build` 等目录与二进制文件。
   需要扫描这些目录时用 `--exclude=` 调整（但要注意 `.git` 里可能有历史凭证）。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/leak.js scan <文件或目录> [--exclude=dir] [--types=a,b] [--json]
node scripts/leak.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--exclude=dir[,dir]` | 额外排除的目录名 |
| `--types=a,b` | 只扫指定类别，默认全部 |
| `--json` | 输出 JSON |

### 识别类别

| 类别 | 说明 | 级别 |
|---|---|---|
| `aws_ak` `aliyun_ak` `tencent_ak` | 云厂商 AccessKey | high |
| `github_token` `slack_token` | 平台 token | high |
| `private_key` | PEM 私钥头 | high |
| `db_url` | 含口令的数据库连接串 | high |
| `idcard` `bank` | 身份证号（GB 11643 校验位）、银行卡（Luhn） | high |
| `jwt` `generic_secret` | JWT、硬编码口令 | medium |
| `phone` | 手机号 | medium |
| `email` | 邮箱 | low |

占位符不会误报：`password: xxxxx`、`your_password`、`${DB_PASS}`、`process.env.X`
这类模板写法会被排除——它们不是泄露。

## 输出解读

```
发现 4 处疑似泄露（high 2，medium 2）

/tmp/leakdemo/src/config.js
     1: 29  [high] AWS Access Key AKIA************MPLE
     2: 16  [high] 含口令的连接串    mysq************3306
```

`行:列` 便于直接跳到编辑器定位。
退出码：`0` 未发现，`1` 发现疑似泄露，可用作 CI 或提交前钩子。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 自定义格式的口令 | **扫不出**，无通用特征 |
| Base64 或分段拼接的密钥 | **扫不出** |
| 加密或压缩文件内的凭证 | **扫不出** |
| 超过 2 MB 的文件 | 跳过（多半是构建产物） |
| 二进制文件 | 跳过（含 NUL 字节的） |
| `pwd = 'xxx'` 这种变量名 | 不扫（`pwd` 歧义太大，且易误匹配） |
| Git 历史中的凭证 | **不扫描**，需另行用历史清理工具 |

## 与 pii-redactor 的分工

| | 本工具（`pii-leak-scanner`） | `pii-redactor` |
|---|---|---|
| 目的 | **找出**泄露 | **改写**文本（脱敏） |
| 对象 | 代码、配置、日志 | 一份要交出去的数据 |
| 重点 | 密钥凭证 + 个人信息 | 个人信息 |
| 是否改文件 | 否 | 是（输出到新文件或 stdout） |

要"把敏感信息打码"用 `pii-redactor`；要"看看有没有泄露"用本工具。

## 回答建议

- 先报"发现 N 处（high/medium 各多少）"，再按文件列出行号与打码片段。
- **处置顺序要说清**：先吊销/轮换凭证，再改代码；进了 Git 历史的还要处理历史。
- 未发现时必须补一句：只扫了已知模式，不能证明没有泄露。
- 扫到个人信息（手机号、身份证）与扫到密钥要分开说——前者是合规问题，后者是安全事件。
- 不要建议"把密钥改成环境变量就安全了"而不提轮换：已泄露的密钥必须轮换。
