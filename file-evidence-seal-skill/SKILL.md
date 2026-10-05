---
name: file-evidence-seal-skill
display_name: 证据固化与核验
display_name_en: File Evidence Seal
description: 对目录生成 SHA-256 完整性与事后核验清单，区分内容篡改与仅修改时间变化。触发词：证据固化、固化证据、防篡改、完整性校验、文件指纹清单、目录校验、电子证据。
description_zh: 对目录生成 SHA-256 清单，事后核验是否被改动，并区分「内容真的变了」与「仅修改时间变化」。
description_en: Seal a directory with a SHA-256 manifest and verify later whether anything changed, separating real content changes from mtime-only changes.
category: legal
scenarios: [证据固化, 完整性校验]
roles: [法务, 合规]
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

# 证据固化与核验

对一个目录生成 SHA-256 清单，之后可以随时核验**内容是否被改动**。
纯本地运行，不联网、不上传任何文件。

## 何时使用

- 电子证据收集后先固化（"把这批聊天记录固化一下"）
- 事后要证明文件没被动过（"这份合同扫描件自取证后有没有被改"）
- 归档目录的完整性自检（"这个归档目录还完整吗"）
- 交接时留一份校验清单（"给对方一份清单，让他们自己验"）

## 硬性规则

1. **必须执行脚本，不要手工记 hash。** 手工 `shasum` 逐个跑既慢又容易漏文件。
2. **只有内容 hash 变了才算"已修改"。** 仅修改时间（mtime）变化会**单独列出**，
   不算篡改——复制、备份、解包都会改 mtime。不要把 mtime 变化说成"文件被改了"。
3. **要如实说明证据力的边界**：
   本工具能证明「当前内容与清单生成时一致」，**不能**证明清单本身没被重新生成。
   要对抗"连清单一起伪造"，需要第三方时间戳（TSA）或公证/存证服务，本工具不提供。
   涉及诉讼证据时，必须提示用户走正规的取证与公证流程。
4. **清单要保存在被固化目录之外**（默认就是这样），否则清单自己会被算进目录内容。
5. 默认排除 `.DS_Store` 与 `Thumbs.db`：它们是系统生成的、无证据价值，
   且会随时间变化导致误报。需要完整记录时用 `--no-exclude-system`。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/seal.js seal   <目录> [-o 清单.json] [--exclude=a,b] [--no-exclude-system]
node scripts/seal.js verify <目录> <清单.json> [--json]
node scripts/seal.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `-o <文件>` | 清单输出路径，默认 `<目录名>.seal.json`（写在当前目录，即被固化目录之外） |
| `--exclude=a,b` | 排除的文件或目录名，逗号分隔 |
| `--no-exclude-system` | 不排除 `.DS_Store` / `Thumbs.db` |
| `--json` | 输出 JSON |

### 常用示例

```bash
# 固化一个证据目录
node scripts/seal.js seal ./证据材料 -o ./证据材料.seal.json

# 事后核验
node scripts/seal.js verify ./证据材料 ./证据材料.seal.json

# 排除缓存目录
node scripts/seal.js seal ./项目 --exclude=node_modules,.git,dist
```

## 清单内容

```json
{
  "tool": "file-evidence-seal",
  "schemaVersion": 1,
  "algorithm": "sha256",
  "createdAt": "2026-10-05T07:50:53.537Z",
  "fileCount": 3,
  "totalBytes": 34,
  "rootHash": "3fc343ad…",
  "files": [{ "path": "合同.txt", "bytes": 16, "hash": "…", "mtime": "…" }]
}
```

- `rootHash`：所有条目按路径排序后拼接再算 hash，一眼就能判断整体是否一致
- 路径记**相对路径**，不含绝对路径，便于移交
- 跳过符号链接，避免越出目录范围或陷入遍历环

## 输出解读

```
未变更 0 个，新增 1，删除 1，修改 1，仅时间变化 1

--- 已修改（内容 hash 变化）（1）---
  合同.txt　16 → 31 字节

--- 仅修改时间变化（内容未变）（1）---
  扫描件/001.png　2026-10-05T07:50:53.516Z → 2026-10-05T07:51:15.575Z
```

退出码：`0` 与清单一致，`1` 存在差异，可直接用作定期检查的卡口。

## 已知取舍

| 情形 | 处理 |
|---|---|
| 只改了 mtime | 单列，**不算篡改** |
| 文件名改了但内容没变 | 会报「新增 + 删除」，不会识别为重命名 |
| 文件内容没变、属主或权限变了 | 不检测，清单只记内容 hash、大小与 mtime |
| 空目录 | 不记录（清单只含文件） |
| 超大目录 | 逐文件流式读，不占内存，但耗时长 |
| 清单本身被重新生成 | **检测不了**，需第三方时间戳或公证 |
| 无读取权限的文件 | 跳过，不报错 |

## 回答建议

- 固化后说清三个数：文件数、总字节、整体摘要（rootHash）。
- 核验后先说"是否一致"，再分类列出差异；**有 mtime 变化时单独说明那不算篡改**。
- 用户是取证或诉讼场景时，主动提示：本工具只做完整性校验，
  要形成有证明力的证据还需公证、第三方时间戳或区块链存证。
- 建议用户把清单单独保管（如发到邮箱、存到另一个介质），
  与数据放在一起时，清单与数据可以一起被替换。
