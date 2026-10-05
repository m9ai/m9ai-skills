---
name: duplicate-file-finder-skill
display_name: 重复文件查找
display_name_en: Duplicate File Finder
description: 按内容 SHA-256 找出目录中的重复文件，输出重复组、可释放空间与待删清单。触发词：重复文件、文件去重、找重复、清理重复、占用空间、冗余文件。
description_zh: 按内容 hash 找出目录中的重复文件，输出重复组、可释放空间与待删除清单。
description_en: Find duplicate files by content hash, reporting groups, reclaimable space and a deletion candidate list.
category: files
scenarios: [去重, 清理]
roles: [行政, 运维]
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

# 重复文件查找

按**文件内容**找出重复文件，输出重复组、可释放空间与待删清单。
纯本地运行，不联网、不上传任何内容。

## 何时使用

- 磁盘满了想找冗余（"哪些文件是重复的"）
- 备份目录与原件混在一起（"备份里有多少是重复的"）
- 整理照片、下载目录（"这些照片有没有重复"）
- 清理前先量化收益（"能腾出多少空间"）

## 硬性规则

1. **必须执行脚本，不要靠文件名判断。** `报告.docx` 与 `报告(1).docx` 内容可能完全不同，
   反之文件名毫无关系的文件可能内容一模一样。
2. **本脚本不删除任何文件。** `--out=` 只生成待删清单，是否删除由用户决定。
   批量删除不可逆，脚本替用户做这个决定不合适。
3. **先核对清单再删。** 尤其注意：
   - 硬链接与符号链接（脚本跳过符号链接，不跟踪）
   - 被程序依赖的重复文件（如依赖库的多份副本，删了会出问题）
   - 系统目录与正在使用的文件
4. **`--keep=oldest` 不一定可靠。** 复制文件时修改时间常被重置为当前时间，
   "最早修改"未必就是原件。想保留原件时更推荐 `--keep=shortest`（路径更短通常更接近原始位置）。
5. 默认排除 `.DS_Store` 与 `Thumbs.db`：它们是系统生成的，没有清理价值。
   需要完整统计时用 `--no-exclude-system`。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/dup.js scan <目录> [--min-size=0] [--exclude=dir] [--out=清单.txt] [--json]
node scripts/dup.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--min-size=0` | 小于该字节数的文件跳过，默认 0（不跳过） |
| `--exclude=dir` | 排除的目录名，逗号分隔 |
| `--keep=first` | 每组保留哪一个，见下 |
| `--out=<文件>` | 生成待删清单（不执行删除） |
| `--no-exclude-system` | 不排除 `.DS_Store` / `Thumbs.db` |
| `--json` | 输出 JSON |

### 保留策略 `--keep=`

| 值 | 保留哪一个 |
|---|---|
| `first`（默认） | 路径字典序最靠前 |
| `oldest` | 修改时间最早（复制常重置 mtime，**结果可能不符合直觉**） |
| `newest` | 修改时间最近 |
| `shortest` | 路径最短（通常最接近原始位置） |

默认按路径字典序，规则确定且可复现，但可能保留到 `备份/xxx 副本.jpg` 而把原件列为待删。
想保留原件时用 `--keep=shortest` 或 `--keep=oldest`。

### 常用示例

```bash
# 扫描一个目录
node scripts/dup.js scan ./照片

# 想保留原件
node scripts/dup.js scan ./照片 --keep=shortest

# 只看大文件（跳过小于 1MB 的）
node scripts/dup.js scan ./照片 --min-size=1048576

# 生成待删清单
node scripts/dup.js scan ./照片 --keep=shortest --out=./待删.txt

# 排除缓存目录
node scripts/dup.js scan ./项目 --exclude=node_modules,.git,dist
```

## 输出解读

```
发现 2 组重复，涉及 4 个文件，可释放 34 B

组 1（2 个，每个 18 B，可释放 18 B）
  sha256 62cfec889fb2545c…
  保留  /tmp/dupdemo/照片/a.jpg
  重复  /tmp/dupdemo/备份/a副本.jpg
```

「可释放」= 组内单份体积 × (份数 − 1)，即删掉除保留项以外所有副本能腾出的空间。
组按可释放空间从大到小排序，前 20 组直接显示，其余用 `--json` 查看。

退出码：`0` 未发现重复，`1` 发现重复。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 符号链接 | 跳过，不跟踪（避免循环与重复统计） |
| 硬链接 | 视为两个独立文件，会报为重复 |
| 空文件 | 体积相同、内容相同，会归为一组；可用 `--min-size=1` 排除 |
| 只读或无权限的文件 | 跳过，不中断整体 |
| 超大目录 | 只对体积相同的文件读内容，IO 已优化；但文件极多时仍慢 |
| 部分重复（文件头相同） | 不算重复，比对的是完整内容 |

## 与 file-evidence-seal 的分工

| | 本工具 | `file-evidence-seal` |
|---|---|---|
| 目的 | 找**重复**文件 | 记录目录完整性并**事后核验** |
| 比对对象 | 目录内各文件之间 | 同一目录的前后两次状态 |
| 输出 | 重复组 + 待删清单 | 清单文件 + 差异报告 |

要"清理冗余"用本工具；要"证明文件没被动过"用 `file-evidence-seal`。

## 回答建议

- 先报三个数：扫描了多少文件、多少组重复、能释放多少空间。
- 组数多时只报头部几组并说明总数，引导用 `--json` 看全部。
- **不要替用户执行删除**，只给清单与命令示例，并提示先核对。
- 待删清单里出现依赖库、系统文件时，主动提示删除风险。
- 可释放空间很小（如几十 KB）时直接说明"清理收益不大，可以不折腾"。
