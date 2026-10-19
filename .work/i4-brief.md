# I4 任务书草稿（index.js · R4 批次）

> 状态：DRAFT——行号基于 I3 前的快照，**派发前必须重新 grep 核实**（I3 正在写 index.js）。
> 只许写 `lib/index.js`。快照：`.work/snapshots/index-preI3-195036.js`。

## 任务项

### 2.2 回退链不落盘（P1，宿主 + 客户端跨批次，宿主半在 I4）
- 病灶：流式回退成功后把 pair 写进持久层——`this.config.provider = pair.provider`、`this.config.model = pair.model`、`await this._saveState({ provider, model })`（原 :1181-1183）。
- 非流式 `chat()` 同款（原 :974-975）。
- 修法：**删除全部三行落盘**。回退结果只存在 state（内存）里，`state.provider/model` 已在成功分支同步，保留。
- 契约：chatPoll 返回 `+fallback:{provider,model}`（回退成功时带上，供客户端显示「本次由 X 模型兜底回答」）。

### 2.6 非流式 chat() 下线（P1）
- 原 :865-995（I3 后漂移到约 :1026 起），`async chat(payload)` 整段删除。
- **Q7 已关闭**：test/ 无任何调用非流式 chat 的用例；唯一文本引用 `const effortExplicit = payload?.effort !== undefined` 在 model-picker.test.mjs:29 是全文子串断言，chatStart 体内（:1177）那份足以命中 → 删除安全。
- 契约：descriptor 保留一版 deprecated（B7 才动 typert.js，本批只删实现不动 typert）。

### 4.2 宿主半：historyGet / historySet 新 RPC
```js
async historyGet(payload) { /* payload: {vaultId} → { items, updatedAt }，无则 { items: [], updatedAt: 0 } */ }
async historySet(payload) { /* payload: {vaultId, items, updatedAt} → { ok: true }，容量上限 40 条（对齐客户端 sanitizeHistory(-40)） */ }
```
- 存储位置：宿主 Config 之外的新内存 Map + JSON 文件落盘（路径 `join(vaultPath, ".dsh-obsidian-history.json")`？→ **待明确：落盘 vs 纯内存**。若落盘，注意 2.11 的 stat 校验路径模式；若纯内存，服务重启即丢，需在返回值标注）。**主理人决策：先纯内存 Map（重启丢失可接受，客户端 localStorage 已有本地兜底），返回 `{ items, updatedAt }`。**
- 四条硬禁令沿用（不新增 export class / export default 最后 / import 追加尾部 / Config 单语句）。

## 验收
`node --test test/llm-contract.test.mjs test/planner.test.mjs test/model-picker.test.mjs test/cold-start.test.mjs test/mojibake.test.mjs test/stop-cycle.test.mjs` 全绿 + 全量 `node --test`。

## 交付格式（I）
改动清单 / 契约变更 / 验收摘要原文 / 风险遗留。
