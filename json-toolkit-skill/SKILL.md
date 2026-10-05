---
name: json-toolkit-skill
display_name: JSON 工具集
display_name_en: JSON Toolkit
description: JSON 格式化、批量语法校验（定位到行列）、生成 TypeScript interface。触发词：JSON 格式化、JSON 报错、JSON 校验、JSON 语法错误、生成 interface、JSON 转 TS、JSON 转 TypeScript。
description_zh: JSON 格式化、批量语法校验并定位到行列，以及从样例数据生成 TypeScript interface。
description_en: Format JSON, batch-validate syntax with line/column locations, and generate TypeScript interfaces from sample data.
category: devops
scenarios: [类型生成, 格式转换]
roles: [研发]
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

# JSON 工具集

格式化 JSON、批量校验语法并定位到行列、从样例数据生成 TypeScript 类型声明。
纯本地运行，不联网、不上传任何内容。

## 何时使用

- 拿到一段 JSON 想美化 / 压缩（"格式化这个 JSON"、"压成一行"）
- 一堆 `.json` 文件要批量检查有没有语法错误（"这个目录下哪些 JSON 是坏的"）
- 从接口返回的样例 JSON 生成 TS 类型（"把这份响应转成 interface"、"生成 TypeScript 类型"）

## 硬性规则

1. **格式化必须执行脚本，不要手工重排。** 手工缩进极易引入尾随逗号。
2. **报错位置以脚本给出的行列为准**，不要凭肉眼另报一个位置。
3. **生成的 interface 只是推断结果，不是契约。** 必须提醒用户：字段的可选性来自这份样例，
   换一份数据可能不同；涉及金额、时间的字段类型（number 还是 string）要人工确认。
4. **不要声称做了 schema 校验。** 本技能只做语法与结构推断，不做 JSON Schema 校验。
5. `--in-place` 会覆盖原文件，执行前先确认用户是否接受覆盖。

## 执行方式

在**技能根目录**下用 Bash 执行，`node` 需 16 及以上版本。

```bash
node scripts/json.js format <文件> [--indent=2] [--minify] [--sort-keys] [--in-place]
node scripts/json.js check <文件或目录> [--ext=.json] [--json]
node scripts/json.js interface <文件> [--name=Root] [--json]
node scripts/json.js --selftest
```

### 参数说明

| 参数 | 说明 |
|---|---|
| `--indent=N` | 缩进空格数，0–8，默认 2 |
| `--minify` | 压成一行（与 `--indent` 互斥，优先生效） |
| `--sort-keys` | 递归按键名字典序排序 |
| `--in-place` | 写回原文件；不加则输出到 stdout |
| `--ext=` | `check` 用的扩展名，逗号分隔，默认 `.json` |
| `--name=` | 根类型名，默认 `Root` |
| `--json` | 输出 JSON，便于二次处理 |

### 常用示例

```bash
# 格式化并打印
node scripts/json.js format ./data.json

# 排序后写回原文件（会覆盖）
node scripts/json.js format ./data.json --sort-keys --in-place

# 批量校验整个目录，只看结论
node scripts/json.js check ./src

# 从响应样例生成类型
node scripts/json.js interface ./response.json --name=UserResponse
```

## 输出解读

`check` 失败时会给出行列与出错行原文：

```
✗ ./config.json（第 3 行第 1 列）
    Expected double-quoted property name in JSON at position 12 (line 3 column 1)
    3 | }
      | ^
```

最常见的两类问题：**尾随逗号**（对象或数组最后一项多了一个 `,`）与**注释**
（JSON 不支持 `//`，常见于手写的配置文件）。

`interface` 的输出示例：

```ts
export interface Address {
  city: string;
}

export interface Root {
  id: number;
  name: string;
  address: Address;
  orders: Order[];
}
```

- 内层类型声明在前，根类型在最后
- 数组元素缺失的字段会标 `?`（如上面的 `amount?: number`），因为样例里并非每个元素都有
- 空数组推断为 `unknown[]`，混合类型数组推断为联合类型

## 已知取舍

| 情形 | 处理 |
|---|---|
| 同结构对象 | 复用同一个 interface |
| 同名不同结构 | 自动加序号（`Item2`、`Item3`） |
| `null` 字段 | 推断为 `null`，用户可能想改成 `string \| null` |
| 时间字符串 | 一律推断为 `string`，不会自动识别日期格式 |
| 键名不是合法标识符 | 加引号（`"a-b": number`） |

## 回答建议

- `check` 有失败文件时，先说"共 N 个文件、M 个失败"，再逐个给出路径与原因；文件多时先列路径清单。
- `interface` 生成后主动提醒：可选字段与 `null` 类型来自这份样例，落到生产前请对照真实接口文档核一遍。
- 用户只是想看某段 JSON 漂不漂亮时，用 `format` 输出到 stdout，不要建议 `--in-place`。
