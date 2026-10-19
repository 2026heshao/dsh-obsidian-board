# C4 任务书草稿（client.js · R4 批次）

> 状态：DRAFT——行号基于 C2/C3 前快照，**派发前必须重新 grep 核实**（C3 正在写 client.js）。
> 只许写 `lib/client.js`。C3 交付前不得开工（INV-1）。

## 任务项

### 1.9 客户端半：侧栏分页（配 I2 的 listNotes offset/hasMore/nextOffset 契约）
- 侧栏笔记列表触底加载下一页（`listNotes({ offset, limit })`）。
- 保留 sort 切换与搜索过滤行为。

### 4.1 历史键按 vault 命名空间（P1）
- localStorage 键：`dsh-obsidian-board/history` → `dsh-obsidian-board/history:<vaultHash>`。
- `vaultHash`：vaultPath 的简单哈希（如 djb2 hex），不得含路径分隔符。
- 旧键读取一次 → 写入新键 → 旧键保留一版（迁移，不删除）。
- 换仓库后：旧 vault 的消息引用仍在旧命名空间，不在当前会话渲染；若历史里出现当前 vault 已不存在的笔记引用，打标「来源笔记已不存在」且不可点（查 status.vaultFingerprint 或 readNote 探测，**简化：直接按 4.2 的 historySet 客户端模式处理，打标逻辑用 notePath 在 status 后探测**——细化留给派发时定）。

### 4.2 客户端半：导出/导入对话 JSON
- 导出：当前 vault 命名空间的全量历史 → 下载/复制 JSON。
- 导入：读 JSON → 合并或替换（UI 二选）→ 写回 localStorage + `try { historySet } catch {}` 尽力而为（typert 尚未声明该方法，静默降级——B7 前 historySet 的调用必须 try/catch 包死）。

### 2.11 客户端半：configure 错误展示
- I3 落地后 configure 校验失败 → 宿主 RPC 包装层返回 `{ ok:false, error:'目录不存在: ...' }`。
- 客户端：configure 调用处已有 `if (res && res.ok)` 模式（:1003/:811 等），补 else 分支把 `res.error` 展示到既有错误区（discoverError 模式 :1103-1104 的同款），并用 vaultPathValid/status 区分「路径无效」与「没有笔记」。

### 2.12 客户端半：pollDeadline 动态化
- `const pollDeadline = Date.now() + 330000`（:695）→ `Date.now() + (status?.timeoutMs || 300000) + 30000`（30000 是宽限不是超时）。

## 验收
`node --test test/note-tree.test.mjs test/render-stress.test.mjs test/smoke-render.test.mjs test/stream-update.test.mjs` 全绿（不动 send/轮询区 :820-960 一行）。

## 交付格式（I）
改动清单 / 契约变更 / 验收摘要原文 / 风险遗留。
