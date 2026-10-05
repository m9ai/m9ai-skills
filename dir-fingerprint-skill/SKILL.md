---
name: dir-fingerprint-skill
display_name: 目录指纹比对
display_name_en: Directory Fingerprint
description: 直接比对两份目录的内容差异，输出内容不同、仅一边有的文件与整体摘要。触发词：目录比对、文件夹对比、备份核对、同步校验、两目录差异、版本对比。
description_zh: 直接比对两份目录的内容差异，输出内容不同与仅一边有的文件。
description_en: Compare two directories by content, reporting differing and one-sided files.
category: files
scenarios: [目录比对, 完整性校验]
roles: [运维, 法务]
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

# 目录指纹比对

直接比对**两份目录**（本地 vs 备份、旧版 vs 新版、源 vs 目标），
输出哪些文件内容不同、哪些只存在于一边。纯本地运行，不联网、不上传任何内容。

## 何时使用

- 核对备份是否完整（"备份和原件一样吗"）
- 同步后校验（"同步过去的文件有没有缺、有没有错"）
- 比对两个版本的目录（"新旧版本差了哪些文件"）
- 迁移前后确认（"迁过去的内容对不对"）

## 硬性规则

1. **必须执行脚本，不要靠文件数量与体积对。** 数量一样也可能内容完全不同。
2. **只看内容，不看权限、属主与修改时间。** 权限变化、属主变化不会报差异。
   需要检查权限时另说，别把本工具的结果说成"完全一致"。
3. **路径按相对路径匹配**，两边顶层目录名不同也能比（`项目` vs `项目备份`）。
4. **体积不同的文件直接判为不同**，不读内容（省 IO）。这是正确且高效的判断。
5. 默认排除 `.DS_Store` 与 `Thumbs.db`，避免 macOS/Windows 的系统文件造成假差异。
   确实要比对它们时用 `--no-exclude-system`。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/fingerprint.js diff <目录A> <目录B> [--exclude=dir] [--json]
node scripts/fingerprint.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--exclude=dir[,dir]` | 排除的目录名（如 `node_modules,.git,dist`） |
| `--no-exclude-system` | 不排除 `.DS_Store` / `Thumbs.db` |
| `--json` | 输出 JSON |

### 常用示例

```bash
# 核对备份
node scripts/fingerprint.js diff ./项目 ./备份/项目

# 排除缓存目录
node scripts/fingerprint.js diff ./项目 ./备份/项目 --exclude=node_modules,dist,.git
```

## 输出解读

```
相同 1，仅 A 有 2，仅 B 有 1，内容不同 1

--- 内容不同（1）---
  src/app.js　内容不同　A 7 B → B 7 B

--- 仅 A 有（B 中缺失）（2）---
  docs/old.md　9 B
```

差异原因会标成「体积不同」或「内容不同」——前者是体积就不一样（必然不同），
后者是体积相同但内容 hash 不同（这才是真正需要关注的"改了内容"）。

退出码：`0` 一致，`1` 有差异，可用作同步后的校验卡口。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 文件权限、属主变化 | **不检测** |
| 修改时间变化 | **不检测**（内容相同就算相同） |
| 符号链接 | 跳过，不跟踪 |
| 空目录 | 不记录（只比对文件） |
| 无法读取的文件 | 单列为「无法读取」，不算差异 |
| 顶层目录名不同 | 不影响，按相对路径匹配 |
| 超大目录 | 只对体积相同的文件读内容，但文件极多时仍慢 |

## 与 file-evidence-seal 的分工

| | 本工具 | `file-evidence-seal` |
|---|---|---|
| 比对时机 | 两个目录**现在都在**，当场比 | 先存清单，**日后**核验同一目录 |
| 产出 | 当场输出差异 | 清单文件 + 事后差异报告 |
| 典型场景 | 备份核对、同步校验 | 证据固化、防篡改核验 |

要"现在比两个目录"用本工具；
要"把状态存下来，过段时间看有没有被动过"用 `file-evidence-seal`。

## 回答建议

- 先报四个数：相同、仅 A 有、仅 B 有、内容不同。
- 「内容不同」比「体积不同」更值得关注，可以分开说。
- 备份核对场景下，"仅备份有"通常是历史遗留文件，"仅原件有"可能是备份遗漏——后者更严重。
- 报告一致时要说明：这只代表文件内容一致，不含权限与属主。
- 有「无法读取」的文件时明确提示：那些文件没参与比对，结论不完整。
