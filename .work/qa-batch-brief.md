# QA 批次任务书（定稿 · 待全部工程批次收尾后派发）

> 状态：FINAL（T-1/T-2/T-3 已裁决）。派发前置：I3/C3/I4/C4/C5/B7 全部交付。**X1 在 QA 之后**（X1 要写矩阵终态，需含 QA 修复结果与新测试通过数）。
> 人设原文：`C:\Users\LENOVO\.dsh\wb-market\experts\teams\software-company\software-qa-engineer.md`（137 行，Edward）
> 上游：全部批次交付报告 + `.work/completion-matrix.md` 终态。

## 已裁决的必修项（均为测试侧陈旧断言，QA 自修，路由 = QA/self）

### T-1（thinking.test.mjs:26）
- 断言旧映射字面 `/planEffort === "high" ? "low" : planEffort/`，I1 已落 `PLAN_EFFORT_MAP` high→medium。
- 修法：改断言为新映射实际写法（读 `lib/index.js` 的 `PLAN_EFFORT_MAP` 逐字匹配）。
- 保留项：`:34` ThinkBlock 正则与 `:41` 切片（`visibleDelta→mapHasVaultPath`）一字不动。

### T-2（recall-and-source.test.mjs:34）—— I4 裁决新增
- 断言 `(host.match(/const pushPair = \(provider, model\)/g) || []).length >= 2`。
- OPT-2.6 下线非流式 chat 后实测只剩 1 处（chatStart）；成对守卫属性由 `:35`（`/if \(!p \|\| !m\) return;/`）完整保留。
- 修法：`>= 2` 改 `>= 1`，断言名可加「（非流式管线已下线，仅存流式回退链一处）」注释。
- 已实测佐证：`pushPair` count=1、`buildMessages…route` count=2（:31 断言不受影响）、`async chat(` count=0。

### T-3（stop-cycle.test.mjs:73）—— C3 复核裁决新增（2026-10-19 20:45 实测复现）
- 现象：`node --test test/stop-cycle.test.mjs` → 49 pass / 1 fail，唯一红 = 「净化清掉 pending 与 isThinking」。
- 根因：断言字面 `/const next = \{ \.\.\.m, pending: false, isThinking: false \};/`。C3 的 OPT-4.3 合法重构 `sanitizeHistory`（client.js:188-205）：因要给缺 id 的 assistant 消息补稳定 id，原 `const next = {...}` 改为 `let next = m;` + `if (m.pending || m.isThinking) { next = { ...m, pending: false, isThinking: false }; … }` + `next = { ...next, id: … }`。
- **行为等价已核实**：pending/isThinking 照清、无正文 assistant 照标 interrupted（`:74`、`:75` 断言仍绿）；sanitize 属性无回归。
- 修法：断言改为不带 `const` 的字面 `/next = \{ \.\.\.m, pending: false, isThinking: false \};/`（或叠加 `/let next = m;/` 双断言）。**不得**改 lib/client.js 回退旧写法——那会破坏 OPT-4.3 的 id 补齐。

### T-4（model-picker.test.mjs:43）—— B7 交付隔离复现新增（2026-10-19 22:21）
- 现象：`FAIL 选择按钮显示 模型 · 档位（与主对话页同构）`，断言找 `defaultEffort || '默认'`。
- 根因：C5 的 OPT-3.7 把该字面量收编为 `t('effortDefault')`（值仍为『默认』，UI 行为等价）。B7 用 preB7 快照隔离复现出完全相同的红 → 纯测试陈旧断言，与工程批次无关。
- 修法：断言改匹配终态写法（`t('effortDefault')` 或 sourceLocation 前的按钮组装行），**不得**回退 lib/client.js。

### 清单 §6.3 建议新增测试（与优化项一一对应）
| 优化项 | 建议测试 | 状态位 |
|---|---|---|
| 2.1 refs YAML | saveNote 2+ 引用 → YAML 列表解析通过、refs 为列表 | （I3 落地后补） |
| 2.2 回退不持久化 | mock 回退成功后 state.json 无 provider/model 写入 | （I4 落地后补） |
| 2.5 listModels 并行 | 3 个慢 provider 总耗时 < 单个超时 + ε | （I3 落地后补，可选） |
| 3.1 表格/链接 | smoke-render：管道表格渲染为 table 元素 | （C1 已有真执行验证，QA 落成持久断言） |
| 3.2 IME | 合成 keydown(isComposing) 不触发 send | （C2 落地后补） |
| 3.3 跟随滚动 | 内容增长后 scrollTop 贴底；上滚后暂停 | （C2 落地后补，可静态断言降级） |
| 4.1 vault 命名空间 | 切 vault 后历史键隔离 | （C4 落地后补） |

### 新测试命名铁律（INV-6）
- 一律新文件 `test/opt-<batch>.test.mjs`，**禁止**往既有 16 个套件里塞（除了 T-1 属于"修断言"而非"加用例"）。
- 复用既有套件的文本切片 + `new Function` 模式；锚点以终态源码为准，任务书里给的行号可能漂移。

## QA 铁律（沿用 batch-hard-rules A/B/C/D/E/F/G/H/I，另有 QA 专属三条）

1. **禁止边写测试边跑全量**：QA 开跑时三个 lib 文件都已冻结，可全量；但新增测试文件必须逐个跑绿后再并入全量。
2. **智能路由判定**（人设原文）：源码 Bug → 报告主理人转工程师（不要自己改 lib/）；测试 Bug → 自修；全绿 → 报告。
3. **最多 2 轮**：第 1 轮发现 → 路由修复 → 第 2 轮回归；仍不过 → 报告列 Known Issues，不得开第 3 轮。

## 派发前置检查（主理人填，定稿时确认）
- [ ] 全部工程批次已收尾（I3/C3/I4/C4/C5/B7；X1 排 QA 之后）
- [ ] 全量基线数字已刷新（当前 28 pass / 1 fail-T1，终态数字待更新）
- [ ] `.work/completion-matrix.md` 终态已同步
- [ ] 验收命令定稿：`cd "D:\桌面\AI Port\DSH plugins\dsh-obsidian-board"; node --test`（Node 24 无参自动发现）
