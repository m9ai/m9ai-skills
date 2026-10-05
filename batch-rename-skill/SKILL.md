---
name: batch-rename-skill
display_name: 批量重命名
display_name_en: Batch Rename
description: 按规则批量重命名文件（序号、日期、正则、大小写、前后缀、改扩展名），先预览再执行，带冲突检测与撤销清单。触发词：批量重命名、批量改名、文件改名、按顺序编号、照片重命名、正则改名、改扩展名、文件名大小写。
description_zh: 按规则批量重命名文件，先预览再执行，带冲突检测并可一键撤销。
description_en: Rule-based batch renaming with preview, collision detection and one-command undo.
category: files
scenarios: [批量重命名]
roles: [行政, 设计, 研发]
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

# 批量重命名

按规则批量改文件名：加序号、按拍摄日期命名、正则替换、统一大小写、改扩展名。
**先预览、再执行、可撤销**——重命名改错了很难恢复，所以这三步是硬性流程。

纯本地运行，不联网、不上传。

## 何时使用

- 一堆照片/扫描件要按序号或日期重命名
- 文件名大小写、分隔符不统一（`IMG_0001`、`img-0001`、`IMG 0001`）
- 批量替换文件名里的某段文字（年份、项目代号）
- 批量改扩展名（`.jpeg` → `.jpg`）
- 导出文件要加统一前缀/后缀

## 硬性规则

1. **必须先 `plan`，确认无误后再 `apply`。** 不要跳过预览直接改名。
2. **有问题就中止。** 目标名重复、会覆盖批次外的已有文件、新名含非法字符——
   任何一种都会让 `apply` 拒绝执行，此时要调整规则而不是强行改名。
3. **不要丢掉撤销清单。** `apply` 会生成清单文件，`undo` 靠它还原。
   执行后必须把清单路径告诉用户。
4. **不要猜用户想要的顺序。** 序号依赖排序，默认按文件名自然排序（中文按拼音），
   照片场景常用 `--sort=mtime`，用户没说就按默认并在结果里说明用的是哪种。
5. **只改文件名，不改文件内容，不移动目录。**

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/rename.js plan  <目录> [规则] [--only=.jpg,.png] [-r] [--sort=name|mtime|size]
node scripts/rename.js apply <目录> [规则] [--manifest=<路径>]
node scripts/rename.js undo  <清单文件>
node scripts/rename.js --selftest
```

### 规则参数

| 参数 | 说明 |
|---|---|
| `--pattern='{seq}_{name}{ext}'` | 命名模板，占位符见下 |
| `--find=旧串 --replace=新串` | 字面替换（全部出现处） |
| `--regex='...' --replace='...'` | 正则替换，用 `$1` 引用分组 |
| `--case=lower\|upper\|kebab\|snake\|camel\|pascal` | 大小写/连接符转换 |
| `--prefix=` / `--suffix=` | 加前后缀 |
| `--ext=.jpg` | 改扩展名 |
| `--seq-start=1 --seq-width=3` | 序号起始值与位宽（`1` → `001`） |
| `--date-from=mtime\|ctime --date-format=YYYYMMDD` | `{date}` 的来源与格式 |

**模板占位符**：`{name}` 文件名（不含扩展名）、`{ext}` 扩展名（含点）、`{seq}` 序号、
`{date}` 日期、`{time}` 时间。

**变换顺序**：字面/正则替换 → 大小写 → 前后缀 → 模板展开。

### 常用示例

```bash
# 照片按拍摄日期 + 序号重命名
node scripts/rename.js plan ./照片 --pattern='{date}_{seq}{ext}' --sort=mtime

# 只处理 jpg/png，按文件名编号
node scripts/rename.js plan ./导出 --only=.jpg,.png --pattern='产品图_{seq}{ext}'

# 去掉文件名里的 "副本" 字样
node scripts/rename.js plan ./docs --find='副本' --replace=''

# 正则提取编号：IMG_0001.jpg → img-0001.jpg
node scripts/rename.js plan ./imgs --regex='^IMG_(\d+)$' --replace='img-$1'

# 统一为短横线命名
node scripts/rename.js plan ./docs --case=kebab

# 确认预览后执行
node scripts/rename.js apply ./照片 --pattern='{date}_{seq}{ext}' --sort=mtime
```

## 输出解读

```
预览：共 3 个文件，3 个待改名
  截图 2026-03-05.png  →  照片_001.png
  IMG 0001.jpg  →  照片_002.jpg
  IMG 0002.jpg  →  照片_003.jpg
```

有问题时不会执行任何改名：

```
⚠️ 发现问题，未执行任何改名：
  目标名重复: 同名.jpg（来自 IMG 0001.jpg 与 IMG 0002.jpg）
```

`apply` 成功后：

```
已改名 3 个文件
撤销清单:    ./照片/.rename-manifest-1712345678.json
如需还原:    node scripts/rename.js undo ./照片/.rename-manifest-1712345678.json
```

## 已知取舍

| 情形 | 处理 |
|---|---|
| 默认排序 | 文件名自然排序，中文按拼音 |
| 目标名与现名相同 | 跳过，不计入改名数 |
| 目标名在批次内重复 | 报错中止 |
| 目标名撞批次外的已有文件 | 报错中止 |
| 隐藏文件（点开头） | 不处理 |
| 子目录 | 默认不进子目录，`-r` 才递归 |
| 中文文件名转 kebab/snake | 中文按词保留，不做拼音转换 |

## 回答建议

- 先把预览结果给用户看，**等确认再 `apply`**；文件多时说明总数并展示前几条。
- 执行后必须把撤销命令原样告诉用户。
- 用户说"改错了"时，直接用 `undo` 加清单路径，不要试图再跑一遍反向规则。
- 涉及照片时主动问一句：按文件名排序还是按拍摄时间排序？
