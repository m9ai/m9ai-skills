---
name: secret-scanner-skill
display_name: 密钥扫描（CI 卡口）
display_name_en: Secret Scanner
description: 扫描工作区、Git 历史与暂存区中的密钥凭证，适合 CI 卡口与 pre-commit 钩子。触发词：密钥扫描、CI 检查、Git 历史密钥、pre-commit、凭证泄露、提交前检查、AK 扫描。
description_zh: 扫描工作区、Git 历史与暂存区中的密钥凭证，适合 CI 卡口与提交前钩子。
description_en: Scan worktree, Git history and staged changes for leaked credentials; built for CI gates and pre-commit hooks.
category: devops
scenarios: [敏感信息, 合规检查]
roles: [研发, 运维]
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

# 密钥扫描（CI 卡口向）

扫描**工作区 / Git 历史 / 暂存区**里的密钥凭证，用于 CI 卡口与提交前检查。
纯本地运行，不联网、不上传任何内容，**不修改任何文件**。

## 何时使用

- 提交前自查（"提交前帮我看看有没有密钥"）
- CI 流水线里做卡口（"有密钥就不让合并"）
- **排查历史泄露**（"以前是不是提交过密钥"——用 `--git-history`）
- 接手项目先验一遍历史

## 硬性规则

1. **必须执行脚本。** 尤其历史扫描——人不可能手工翻完所有提交。
2. **删了代码不等于密钥没泄露过。** Git 历史里仍然在。
   改完代码必须用 `--git-history` 再扫一遍，确认历史上有没有残留。
3. **扫到密钥先说"吊销/轮换"，再说"改代码"。** 已泄露的凭证必须轮换，
   仅删除无效。已进入历史的还要清理历史，或强制轮换——二者至少做一个。
4. **未发现不等于没有泄露。** 只找已知模式的凭证；
   自定义格式、编码或拆分拼接的密钥扫不出来。
5. **报告只显示打码片段（前 4 后 4）**，不要为了"确认是不是真密钥"打印完整值。
6. 默认只扫工作区。**历史必须显式加 `--git-history`**——它更慢，不该默认开。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本，历史扫描需要 `git`。

```bash
node scripts/secret.js scan [路径] [--git-history] [--staged] [--json]
node scripts/secret.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--git-history` | 扫描 Git 历史中**新增**的行（需在 Git 仓库内） |
| `--staged` | 只扫暂存区（`git diff --cached`），适合 pre-commit 钩子 |
| `--exclude=dir` | 额外排除的目录名 |
| `--types=a,b` | 只扫指定类别 |
| `--json` | 输出 JSON |

默认扫工作区文件，已排除 `node_modules`、`.git`、`dist`、`build` 等目录与二进制文件。

### 识别类别

AWS AccessKey、阿里云 AccessKey、腾讯云 SecretId、GitHub Token、Slack Token、
PEM 私钥、JWT、含口令的数据库连接串、硬编码口令（`password:` / `secret:` / `api_key:` 等）。

占位符不会误报：`xxxxx`、`your_password`、`${DB_PASS}`、`process.env.X` 会被排除。

### 常用示例

```bash
# 扫工作区
node scripts/secret.js scan .

# 连历史一起扫（排查历史泄露）
node scripts/secret.js scan . --git-history

# pre-commit 钩子：只扫暂存区
node scripts/secret.js scan . --staged

# CI 里用 JSON 输出
node scripts/secret.js scan . --git-history --json
```

## 输出解读

```
工作区：扫描 1 个文件，1 处
Git 历史：2 个提交，2 处

发现 3 处疑似密钥

  config.js:1  [6fdf49e4 2026-10-05 t]
      AWS Access Key  AKIA************MPLE
```

历史条目带 `提交号 日期 作者`，便于定位是哪次提交引入的。
退出码：`0` 未发现，`1` 发现疑似密钥——可直接用作 CI 卡口或钩子。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 历史中被删除的行 | 不扫（已不在当前代码里，扫了噪声大且无处置意义） |
| 历史过大 | 超过 50 万行截断，并在报告里说明 |
| 自定义格式的口令 | **扫不出** |
| Base64 或拼接的密钥 | **扫不出** |
| 二进制文件、超过 2MB 的文件 | 跳过 |
| `pwd = 'xxx'` 这种变量名 | 不扫（`pwd` 歧义太大） |
| Git 子模块 / 其他分支 | `--git-history` 用 `--all`，覆盖所有分支 |

## 与 pii-leak-scanner 的分工

| | 本工具（`secret-scanner`） | `pii-leak-scanner` |
|---|---|---|
| 扫什么 | 工作区 + **Git 历史** + **暂存区** | 当前文件内容 |
| 管什么 | 只管凭证 | 凭证 + 个人信息 |
| 用途 | CI 卡口、提交前检查 | 人工排查、代码体检 |
| 是否默认扫历史 | 需 `--git-history` | 不支持 |

**注意两者有重叠**：都扫凭证。选哪个取决于场景——
要放进 CI 或查历史用本工具；要查个人信息、做一次性排查用 `pii-leak-scanner`。
日常用其中一个就够，不必两个都跑。

## 回答建议

- 先说"工作区几处、历史几处、涉及几个提交"。
- 历史里发现的要单独强调：**那意味着改代码没用，必须轮换凭证**。
- 处置顺序：吊销/轮换 → 改代码 → 清理历史（或至少强制轮换）。
- 未发现时补一句：只扫了已知模式，且默认不含历史（若没加 `--git-history`）。
- 不要建议"改成环境变量就安全了"而不提轮换。
