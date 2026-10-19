# X1 任务书（文档批次 · R7）—— 定稿

> 可写文件：`RELEASE-NOTES.md`、`README.md`（其余一律禁碰）。无代码，无需测试。
> 预勘已核实两处原文与 RELEASE-NOTES 全文格式。

## 任务 1：7.1 RELEASE-NOTES.md 补 v0.2.3 段
- 现状 64 行，仅 v0.2.2 段。格式（沿用）：主题句 → `## 本版修复…`（逐缺陷叙述，带 `lib/xxx.js:NNN` 行号引用）→ `## 测试` → `## ✅ 发布结果` → `## 通道说明与踩坑记录`。
- v0.2.3 段要求：**主题句 + 分组列表**（检索与索引 / RAG 管线 / 客户端 UI / 工程化与契约 / 修复），每条一句话 + 关键行号。内容以 `.work/completion-matrix.md` 终态为准。
- **发布注意**：本轮只写 notes。v0.2.2 的「✅ 发布结果（已逐项核验）」小节是历史记录，**原样保留不删**；v0.2.3 段不加发布结果小节（发布与否由用户决定）。
- 文件顶部标题行 `# dsh-obsidian-board v0.2.2 — 发布报告` 改为总标题 `# dsh-obsidian-board 发布报告`，v0.2.2 原标题降为段内二级标题 `## v0.2.2 — AI 模型输出管线全量升级`，v0.2.3 段放在其上（最新在前）。

## 任务 2：7.2 README.md 边界同步（两处原文已核实）
1. 英文 `README.md:91` 原文：`- Panel history lives in localStorage — clearing browser data clears it.`
   改为（示意，可润色）：`- Panel history is namespaced per vault and synced to the host via historyGet/historySet; it survives panel reloads and supports JSON export/import. Host-side history is in-memory (cleared on service restart), with localStorage as the local fallback.`
2. 中文 `README.md:191` 原文：`- 面板历史存 localStorage，清浏览器数据会丢`
   改为（示意）：`- 面板历史按仓库隔离（history:<vaultHash> 键），支持导出/导入 JSON，并与宿主端 historyGet/historySet 同步；宿主端为内存态（服务重启即清），本地 localStorage 兜底。`
3. **DEF-B**：在「Known limits / 已知边界」各加一条——配置以 `lib/index.js` 的 `Config` 为准，`cordis.patch.yml` 只是接入模板（6 键），面板内的 Config 卡可编辑全部字段。
4. 已支持能力补写（放 Features，中英同步，措辞克制不过度承诺）：表格/链接渲染、vault 文件监听自动重建索引、列表分页、会话阶段可见（检索→规划→生成）、vault 路径有效性提示、回答超时可配置。
- 保持双语两段行文风格一致。

## 验收
无测试。主理人人工核对：README 两处 :91/:191 已更新、无「会丢历史」残留表述、RELEASE-NOTES 有完整 v0.2.3 段。
