# m9ai Skills 目录（每个分类 Top 10）

> 分类与字段定义见 [TAXONOMY.md](./TAXONOMY.md)。
> 本表是**候选清单**，不等于全部实现：按优先级分批落地。

## 优先级说明

| 标记 | 含义 |
| --- | --- |
| **P0** | 首批实现。需求明确、零依赖、价值直观（每分类 3–4 个，共约 25 个） |
| P1 | 第二批。价值明确但实现或数据成本略高 |
| P2 | 备选。可能不做，或等需求验证后再做 |
| ✅ | 已发布 |
| 🚧 | 开发中 |
| ⚠️ | 技术风险较高（如 PDF 需手写 xref 重写），排在本分类最后 |

**依赖列**：`zero` = 仅 Node 内置，零第三方包；`shell` = POSIX shell；`external(...)` = 需外部二进制。

---

## 1. finance 财税计算

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `amount-to-chinese-skill` | 人民币金额转中文大写（发票/合同/票据） | 发票, 记账 | 财务, 行政 | zero | ✅ 已发布 |
| 2 | `invoice-field-checker-skill` | 发票号码校验位、金额税额勾稽、开票日期合理性，批量输出 | 发票, 对账 | 财务 | zero | **P0** |
| 3 | `bank-reconciliation-skill` | 两方账单按金额+日期模糊匹配，输出未达账项与差异 | 对账, 记账 | 财务 | zero | **P0** |
| 4 | `expense-audit-skill` | 报销单必填项、金额合计、超标项、重复票据号检查 | 报销 | 财务, 行政 | zero | **P0** |
| 5 | `iit-calculator-skill` | 累计预扣预缴个税计算（年度税率表，需年更） | 个税, 工资 | 财务, HR | zero | P1 |
| 6 | `loan-calculator-skill` | 等额本息/等额本金/提前还款，输出完整还款计划表 | 贷款, 预算 | 财务, 管理层 | zero | P1 |
| 7 | `payroll-calculator-skill` | 工资表应发/代扣/实发，含社保公积金比例（需年更） | 工资, 社保 | HR, 财务 | zero | P1 |
| 8 | `fx-offline-converter-skill` | 离线汇率快照换算，输出标注数据日期 | 汇率, 报表 | 财务 | zero | P2 |
| 9 | `number-format-checker-skill` | 财务数字规范：千分位、小数位、负数括号、全角数字 | 报表, 记账 | 财务 | zero | P2 |
| 10 | `cost-allocation-skill` | 按比例/人头/面积多维度成本分摊并输出明细 | 成本, 预算 | 财务, 管理层 | zero | P2 |

> 💡 第 5/7 项的税率表与社保比例需**每年更新**，天然构成「更新订阅」的付费理由——
> 脚本本身免费，值钱的是会过期的数据。

---

## 2. legal 法务合规

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `deadline-calculator-skill` | 工作日/自然日推算，含法定节假日与调休（诉讼时效、合同到期） | 期限计算, 合同审查 | 法务, HR | zero | ✅ 已发布 ⚠️ |
| 2 | `pii-redactor-skill` | 手机号/身份证/银行卡/邮箱/住址识别与脱敏 | 脱敏, 合规检查 | 法务, 研发, 行政 | zero | **P0** |
| 3 | `contract-checklist-skill` | 必备条款（主体/标的/金额/期限/违约/争议解决）存在性检查，语义判断交给 Agent | 合同审查, 条款检查 | 法务 | zero | **P0** |
| 4 | `file-evidence-seal-skill` | 对目录生成 SHA-256 清单（含时间戳），可事后核验是否被改动 | 证据固化 | 法务, 合规 | zero | **P0** |
| 5 | `id-number-validator-skill` | 18 位身份证校验位、出生日期、地区码合法性 | 主体核验 | 法务, HR, 行政 | zero | P1 |
| 6 | `uscc-validator-skill` | 统一社会信用代码 GB 32100 校验位与结构校验 | 主体核验 | 法务, 财务 | zero | P1 |
| 7 | `contract-diff-skill` | 两版合同条款级对齐比对，输出新增/删除/修改 | 合同审查 | 法务 | zero | P1 |
| 8 | `confidential-marking-checker-skill` | 检查文档密级标注、页眉页脚、水印字样 | 合规检查 | 法务, 行政 | zero | P2 |
| 9 | `clause-numbering-checker-skill` | 条款编号断号、层级混乱、交叉引用失效检查 | 条款检查 | 法务 | zero | P2 |
| 10 | `labor-contract-checker-skill` | 劳动合同必备条款与试用期/工时合法性检查 | 劳动人事, 合同审查 | 法务, HR | zero | P2 |

---

## 3. data 数据统计

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `csv-cleaner-skill` | 编码检测、分隔符嗅探、去空行、类型归一化、日期标准化 | 数据清洗, 编码处理 | 运营, 财务, 销售 | zero | ✅ 已发布 |
| 2 | `csv-aggregator-skill` | 分组聚合、求和/均值/中位数/分位数、TopN | 汇总统计, 报表生成 | 运营, 销售, 管理层 | zero | **P0** |
| 3 | `data-quality-checker-skill` | 空值率/唯一性/异常值/枚举合法性，输出体检报告 | 质量体检 | 运营, 分析 | zero | **P0** |
| 4 | `csv-diff-skill` | 按关键列比对两表，输出新增/删除/变更 | 差异比对, 去重 | 运营, 财务 | zero | **P0** |
| 5 | `log-analyzer-skill` | 常见日志格式解析、时间窗统计、错误码聚合、慢请求 TopN | 日志分析 | 运维, 研发 | zero | P1 |
| 6 | `json-batch-validator-skill` | 批量语法校验 + 简易 schema 字段校验 | 格式转换, 数据清洗 | 研发, 运营 | zero | P1 |
| 7 | `dir-inventory-skill` | 按扩展名/大小/时间统计文件分布，找出大文件与空目录 | 汇总统计 | 行政, 运维 | zero | P1 |
| 8 | `word-frequency-skill` | 文本词频/TF 统计，输出 TopN 词表 | 汇总统计, 数据抽取 | 运营, 市场 | zero | P2 |
| 9 | `report-table-renderer-skill` | 统计结果渲染为对齐的 Markdown/文本表格 | 报表生成 | 运营, 财务 | zero | P2 |
| 10 | `encoding-detector-skill` | 检测乱码、BOM、混合编码并定位到行 | 编码处理, 数据清洗 | 运营, 研发 | zero | P2 |

---

## 4. content 内容合规

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `banned-word-checker-skill` | 平台违禁词命中；脚本做变体检测（全角/空格/拼音/同音/符号插入），语义变体交给 Agent | 违禁词, 合规检查 | 运营, 市场 | zero | ✅ 已发布 |
| 2 | `pii-leak-scanner-skill` | 文本中的手机号/身份证/银行卡/邮箱/密钥/AK 泄露检测 | 敏感信息 | 运营, 法务, 研发 | zero | **P0** |
| 3 | `ad-law-risk-checker-skill` | 「最」「第一」「国家级」等广告法风险词检测 | 极限词, 合规检查 | 市场, 电商 | zero | **P0** |
| 4 | `content-dedupe-skill` | SimHash/Shingle 相似度批量比对，输出重复对 | 查重 | 运营, 市场 | zero | P1 |
| 5 | `copy-length-checker-skill` | 平台字数限制、全角标点替换、标题长度、emoji 计数 | 字数规范, 多平台发布 | 运营 | zero | P1 |
| 6 | `zh-en-typesetting-checker-skill` | 中英文空格、标点、数字与单位格式规范 | 排版规范 | 运营, 市场 | zero | P2 |
| 7 | `html-to-text-skill` | HTML 转纯文本，保留段落与列表结构 | 标签清洗 | 运营, 研发 | zero | P2 |
| 8 | `url-extractor-skill` | 提取文本中的 URL 并做格式校验（不联网） | 标签清洗 | 运营 | zero | P2 |
| 9 | `extractive-summarizer-skill` | 基于词频与位置的抽取式摘要与关键词 | 摘要抽取 | 运营, 市场 | zero | P2 |
| 10 | `multi-platform-adapter-skill` | 按平台字数/格式规则自动截断并给出改写建议 | 多平台发布, 文案适配 | 运营 | zero | P2 |

---

## 5. files 文件批处理

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `batch-rename-skill` | 规则重命名（序号/日期/正则/大小写/替换），预览 + 可撤销 | 批量重命名 | 行政, 设计, 研发 | zero | ✅ 已发布 |
| 2 | `duplicate-file-finder-skill` | hash 比对输出重复组，可选清理（预览） | 去重 | 行政, 运维 | zero | **P0** |
| 3 | `dir-fingerprint-skill` | 生成目录 hash 清单，比对两份目录的新增/删除/修改 | 目录比对, 完整性校验 | 运维, 法务 | zero | **P0** |
| 4 | `checksum-verifier-skill` | 计算并校验 MD5/SHA1/SHA256 清单 | 完整性校验 | 运维, 行政 | zero | P1 |
| 5 | `batch-encoding-convert-skill` | 批量检测并转换文件编码（UTF-8/GBK/BOM） | 编码转换 | 行政, 研发 | zero | P1 |
| 6 | `file-type-detector-skill` | 按 magic bytes 判断真实类型，找出扩展名不符的文件 | 类型识别 | 运维, 行政 | zero | P1 |
| 7 | `empty-cleaner-skill` | 查找空文件与空目录并清理（预览） | 清理 | 行政, 运维 | zero | P1 |
| 8 | `batch-archiver-skill` | 按日期/类型分目录批量归档 | 归档 | 行政 | zero | P2 |
| 9 | `file-time-fixer-skill` | 按规则修正 mtime（照片/扫描件整理） | 时间修正 | 设计, 行政 | zero | P2 |
| 10 | `dir-tree-exporter-skill` | 导出目录树为 Markdown/JSON，含大小统计 | 清单导出 | 行政, 运维 | zero | P2 |

---

## 6. document 文档处理

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `markdown-linter-skill` | 标题层级、列表缩进、链接、代码块、表格对齐检查与修复 | Markdown, 排版 | 研发, 行政 | zero | ✅ 已发布 |
| 2 | `markdown-table-builder-skill` | 从 CSV/TSV 生成对齐的 Markdown 表格 | 表格, Markdown | 运营, 研发 | zero | **P0** |
| 3 | `subtitle-converter-skill` | SRT/ASS/VTT 互转 | 字幕, 格式转换 | 运营, 市场 | zero | **P0** |
| 4 | `subtitle-shift-skill` | 字幕时间轴整体偏移 / 按比例缩放 | 字幕 | 运营 | zero | P1 |
| 5 | `png-meta-reader-skill` | 读取 PNG tEXt chunk，提取 SD / ComfyUI prompt | 元数据 | 设计, 市场 | zero | P1 |
| 6 | `pdf-meta-reader-skill` | PDF 元信息、页数、书签（文本层可查部分） | 元数据, PDF | 行政 | zero | P1 ⚠️ |
| 7 | `pdf-text-extractor-skill` | 抽取 PDF 文本层（限未加密、非扫描件） | PDF, 数据抽取 | 法务, 行政 | zero | P1 ⚠️ |
| 8 | `toc-extractor-skill` | 从 Markdown/HTML 提取文档目录 | 目录提取 | 研发, 行政 | zero | P2 |
| 9 | `md-html-converter-skill` | Markdown ↔ HTML 受限子集互转 | 格式转换 | 研发 | zero | P2 |
| 10 | `pdf-splitter-skill` | PDF 按页码切分与合并（限未加密） | PDF | 行政, 法务 | zero | P2 ⚠️ |

---

## 7. devops 研发运维

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `json-toolkit-skill` | 格式化、批量校验、生成 TypeScript interface | 类型生成, 格式转换 | 研发 | zero | ✅ 已发布 |
| 2 | `secret-scanner-skill` | 扫描代码目录中的 AK/SK/私钥/token 特征 | 密钥扫描, 合规检查 | 研发, 运维 | zero | **P0** |
| 3 | `cron-explainer-skill` | 解析 cron 表达式并输出未来 N 次执行时间 | 定时任务 | 运维, 研发 | zero | **P0** |
| 4 | `env-config-checker-skill` | 比对 `.env.example` 与实际环境，找缺失/多余项 | 配置检查 | 研发, 运维 | zero | P1 |
| 5 | `log-error-aggregator-skill` | 按错误模式聚合，输出 TopN 与首次/末次时间 | 日志聚合 | 运维 | zero | P1 |
| 6 | `regex-batch-tester-skill` | 对样本集批量跑正则，输出命中统计 | 正则测试 | 研发 | zero | P1 |
| 7 | `git-repo-checker-skill` | 大文件、陈旧分支、提交规范体检 | 仓库体检 | 研发 | external(git) | P1 |
| 8 | `api-response-diff-skill` | 两份 JSON 响应的结构差异比对 | API 比对 | 研发, 测试 | zero | P2 |
| 9 | `version-consistency-checker-skill` | 多包版本号与依赖声明一致性检查 | 依赖检查 | 研发 | zero | P2 |
| 10 | `port-troubleshooter-skill` | 生成跨平台端口占用排查命令序列 | 环境排查 | 运维, 研发 | shell | P2 |

---

## 8. travel 出行交通

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `jinshan-train-skill` | 金山铁路班次/经停/票价/下一班车查询 | 班次查询, 票价 | 通用 | zero (cache) | ✅ 已发布 |
| 2 | `metro-fare-calculator-skill` | 城市地铁票价与换乘方案（离线线路表） | 票价, 换乘 | 通用 | zero | P1 |
| 3 | `timezone-converter-skill` | 跨时区时间换算与会议时段推荐（`Intl` 内置） | 时区 | 通用, 行政 | zero | P1 |
| 4 | `travel-cost-splitter-skill` | 同行费用分摊（AA / 按权重 / 按天数），输出结算明细 | 费用分摊 | 通用, 财务 | zero | P1 |
| 5 | `distance-calculator-skill` | 两地直线里程估算（内置城市经纬度表） | 里程 | 通用 | zero | P2 |
| 6 | `baggage-allowance-lookup-skill` | 航司行李额规则查询（离线表，需更新） | 行李额 | 通用, 行政 | zero | P2 |
| 7 | `travel-doc-checklist-skill` | 按目的地生成出行证件与材料清单 | 证件清单 | 通用, 行政 | zero | P2 |
| 8 | `itinerary-planner-skill` | 行程时间轴排布与冲突检测，输出可行日程 | 行程规划 | 通用 | zero | P2 |
| 9 | `visa-policy-lookup-skill` | 免签 / 落地签政策查询（离线表，需更新） | 证件清单 | 通用 | zero | P2 |
| 10 | `fuel-cost-calculator-skill` | 自驾油费与过路费估算 | 行程规划, 费用分摊 | 通用 | zero | P2 |

---

## 9. life 生活服务

| # | Skill | 能力 | 场景 | 角色 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `shanghai-school-district-skill` | 上海学区对口查询 | 学区 | 通用 | zero (cache) | 🚧 阻塞中（数据准备中，暂不开发） |
| 2 | `holiday-schedule-skill` | 法定节假日与调休安排（年更，为 `deadline-calculator` 提供数据） | 日程 | 行政, HR | zero | P1 |
| 3 | `lunar-calendar-skill` | 公历农历互转、节气、生肖 | 日程 | 通用 | zero | P2 |
| 4 | `id-photo-spec-skill` | 各类证件照尺寸与背景要求 | 政务办事 | 行政, 通用 | zero | P2 |
| 5 | `postal-code-lookup-skill` | 邮编与区号查询（离线表） | 本地查询 | 行政 | zero | P2 |
| 6 | `unit-converter-skill` | 长度/重量/体积/温度单位换算 | 本地查询 | 通用 | zero | P2 |
| 7 | `paper-size-lookup-skill` | A/B/C 系列纸张尺寸查询 | 本地查询 | 行政, 设计 | zero | P2 |
| 8 | `clothing-size-lookup-skill` | 服装尺码对照（离线表） | 本地查询, 尺码 | 通用 | zero | P2 |
| 9 | `waste-sorting-lookup-skill` | 垃圾分类查询（离线表） | 本地查询 | 通用 | zero | P2 |
| 10 | `holiday-ics-exporter-skill` | 把节假日与调休导出为 `.ics` 日历订阅 | 日程 | 行政, HR | zero | P2 |

---

## 汇总

| 分类 | Top 10 中 P0 | 已落地 | 说明 |
| --- | --- | --- | --- |
| finance 财税 | 4 | 1（`amount-to-chinese`） | 发票与对账是最高频刚需 |
| legal 法务合规 | 4 | 1（`deadline-calculator`） | 期限、脱敏、合同、证据四条线 |
| data 数据统计 | 4 | 1（`csv-cleaner`） | CSV 四件套构成完整处理链 |
| content 内容合规 | 3 | 1（`banned-word-checker`） | 违禁词/极限词/敏感信息 |
| files 文件批处理 | 3 | 1（`batch-rename`） | 重命名/去重/指纹 |
| document 文档处理 | 3 | 1（`markdown-linter`） | Markdown / 表格 / 字幕 |
| devops 研发运维 | 3 | 1（`json-toolkit`） | JSON / 密钥扫描 / cron |
| travel 出行交通 | 0 | 1（`jinshan-train`） | 暂不新增 P0 |
| life 生活服务 | 0 | 0（`shanghai-school-district` 数据准备中） | 暂不新增 P0 |
| **合计** | **24 个 P0** | **8 个已发布** | 候选池 90 个 |

## 落地顺序建议

1. **第一批（每个分类各 1 个，共 7 个）——已完成。** 7 个待建分类各填一个，
   验证「分类 → 场景 → 角色」这套元数据跑得通，官网市集有内容可展示：
   `amount-to-chinese` · `deadline-calculator` · `csv-cleaner` · `banned-word-checker` · `batch-rename` · `markdown-linter` · `json-toolkit`
   （travel 与 life 已有存量技能，不占本批名额）
2. **第二批**：补齐各分类剩余 P0（约 17 个）。做完第一批先观察市集的下载数据再决定顺序。
3. **第三批**：按下载/留资数据决定 P1 做哪些，P2 视情况放弃。

> 每批做完先观察市集的下载与留资数据，再决定下一批——**不要一次性把 80 个全做出来**。

## 待补数据

| Skill | 缺什么 | 不补的后果 |
| --- | --- | --- |
| `deadline-calculator` | 国务院办公厅年度放假安排（法定休假日 + 调休上班日） | 自然日能算但**不做顺延判断**；工作日计算直接拒绝执行 |
| `shanghai-school-district` | 学区对口数据 | 整个 Skill 无法开发，已阻塞 |

`deadline-calculator` 的数据文件是 `references/holidays.txt`，填完后用
`node scripts/deadline.js coverage` 确认覆盖年份。**不要凭记忆或推测填**——
期限算错会直接损害权利。
