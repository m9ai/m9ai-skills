---
name: subtitle-converter-skill
display_name: 字幕格式互转
display_name_en: Subtitle Converter
description: SRT、WebVTT、ASS 三种字幕格式互转，保留时间轴与多行文本，自动识别输入格式。触发词：字幕转换、SRT 转 VTT、ASS 转 SRT、字幕格式、字幕互转、外挂字幕。
description_zh: SRT、WebVTT、ASS 三种字幕格式互转，保留时间轴与多行文本。
description_en: Convert between SRT, WebVTT and ASS subtitle formats, preserving timings and multi-line text.
category: document
scenarios: [字幕, 格式转换]
roles: [运营, 研发]
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

# 字幕格式互转

SRT / WebVTT / ASS 三种字幕格式互转，保留时间轴与多行文本。
纯本地运行，不联网、不上传字幕内容。

## 何时使用

- 播放器只认某一种格式（"把这个 ASS 转成 SRT"）
- 上传平台要求指定格式（"平台只接受 VTT"）
- 需要在 ASS 里加样式，先从 SRT 转过去
- 拿到一份不知格式的字幕，先识别再处理

## 硬性规则

1. **必须执行脚本，不要手工改时间码。** 三种格式的时间精度不同
   （SRT/VTT 是毫秒，ASS 是百分秒），手工换算极易错位。
2. **转换前必须确认能否接受信息丢失**（见下表），并在回答里明确告诉用户丢了什么。
3. **ASS → SRT/VTT 会丢失全部样式**：字体、颜色、位置、特效、卡拉OK 都保不住，
   只剩纯文本与时间轴。这是格式本身的限制，不是工具的问题。
4. **不要声称"转换后与原文件完全一致"。** 只有 SRT ↔ VTT 的信息损失最小，
   涉及 ASS 的转换必然有损。
5. 转出到非 ASS 格式时默认剥离 `{\...}` 样式标签——留在 SRT 里会原样显示成一堆乱码。
   确实需要保留时加 `--keep-tags`。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/subtitle.js convert <输入> --to=srt|vtt|ass [-o 输出] [--keep-tags]
node scripts/subtitle.js --selftest
```

### 选项

| 选项 | 说明 |
|---|---|
| `--to=<格式>` | **必填**。目标格式：`srt` / `vtt` / `ass` |
| `-o <文件>` | 输出文件；不填则输出到 stdout |
| `--keep-tags` | 转出到非 ASS 格式时保留 `{\...}` 样式标签（默认剥离） |
| `--json` | 输出 JSON（含转换后文本与丢失项说明） |

输入格式自动识别：先看扩展名，再看内容特征（`WEBVTT` 头、`[Events]` 段、`-->` 时间行）。

### 常用示例

```bash
# ASS 转 SRT（最常见）
node scripts/subtitle.js convert ./字幕.ass --to=srt -o ./字幕.srt

# SRT 转 VTT（上传平台）
node scripts/subtitle.js convert ./字幕.srt --to=vtt -o ./字幕.vtt

# SRT 转 ASS（之后在 ASS 里加样式）
node scripts/subtitle.js convert ./字幕.srt --to=ass -o ./字幕.ass

# 直接看结果
node scripts/subtitle.js convert ./字幕.srt --to=vtt
```

## 会丢失什么

| 转换方向 | 丢失内容 |
|---|---|
| ASS → SRT / VTT | 字体、字号、颜色、位置、边距、特效、卡拉OK；只剩纯文本与时间轴 |
| VTT → SRT | cue settings（`position` / `align` / `size` / `line` 等） |
| SRT → VTT | 基本无损（VTT 的头部信息会重新生成） |
| SRT / VTT → ASS | 无样式可继承，只套用默认样式（Arial 20） |
| 任意 → SRT | 说话人标识（ASS 的 Name 字段）、样式名 |

脚本会在结束时把适用的一条列出来，回答时要照实转述。

## 已知取舍

| 情形 | 处理 |
|---|---|
| ASS 文本里的逗号 | 正确还原（Text 是最后字段，按剩余部分拼接） |
| ASS 的 `\N` 换行 | 转成真实换行；反向转换再变回 `\N` |
| 两位毫秒（`,50`） | 按 500ms 处理，不是 5ms |
| 时间超过一小时 | 支持（`1:02:03,040`） |
| VTT 的 NOTE 块 | 跳过，不转进正文 |
| 卡拉OK / 逐字特效 | 不支持，作为文本保留或随标签剥离 |
| 多语言轨道 | 一次只处理一个文件 |
| 编码 | 支持 UTF-8；GBK 编码的字幕可能乱码，需先转码 |

## 回答建议

- 先说"从什么格式转到什么格式、共几条"，再说丢失了什么。
- **涉及 ASS 的转换必须主动说明样式会丢**，不要等用户发现。
- 用户目的是"在视频里烧录字幕"时，提醒转成 ASS 才能保留样式，SRT/VTT 只有纯文本。
- 转换后发现时间轴错位，先确认原文件是否用了非标准时间格式，而不是直接调脚本参数。
- 用户要保留特效时，说明本工具做不到，需要用专业字幕软件（如 Aegisub）手工处理。
