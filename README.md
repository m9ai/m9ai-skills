# m9ai-skills

WorkBuddy 技能（Skill）monorepo。每个子目录是一个独立的技能包，推送到 `main` 后由 GitHub Actions 自动打包并发布 Release。

## 目录结构

```
m9ai-skills/
├── .github/workflows/build-skills.yml   # 构建流水线
├── scripts/
│   ├── read-meta.sh                     # 读取 SKILL.md frontmatter 字段
│   ├── detect-changed.sh                # 检测本次变更涉及的 skill
│   ├── validate-skill.sh                # 技能包规范校验
│   └── package-skill.sh                 # 打包为 {目录名}-v{版本号}.zip
├── jinshan-train-skill/                 # 金山铁路时刻表
└── shanghai-school-district-skill/      # 上海学区查询（开发中）
```

技能包本身只允许两级目录（根目录/二级目录/文件），`scripts/` 与 `.github/` 属于仓库基础设施，不参与打包。

## 发布一个技能

1. 修改技能目录内容
2. **递增 `SKILL.md` 的 `version`**（语义化版本，如 `1.0.0` → `1.1.0`）
3. 提交并推送到 `main`

CI 会自动完成：检测变更 → 规范校验 → 打包 → 上传 Artifact → 打 tag `{skill}/v{version}` 并发布 Release。

从 Release 下载 zip，提交到 WorkBuddy 技能市场。

## 版本号规则

版本号的唯一来源是 `SKILL.md` 的 frontmatter：

```yaml
---
name: jinshan-train-skill
version: 1.0.0
---
```

- 内容有变更就必须递增版本号，**否则 CI 会失败**
- 同一版本号重复发布会失败（以 git tag 去重）
- 不需要维护 `package.json`

## 本地自检

推送前可先在本地跑一遍校验：

```bash
./scripts/validate-skill.sh jinshan-train-skill     # 校验
./scripts/package-skill.sh jinshan-train-skill dist  # 打包到 dist/
./scripts/read-meta.sh jinshan-train-skill version   # 查看版本号
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

可选子目录：`references/`（参考资料）、`scripts/`（可执行脚本）、`templates/`（模板文件）。
