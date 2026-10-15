# dsh-obsidian-board v0.2.2 — 发布报告

本轮主题：**AI 模型输出管线全量升级**（用户反馈「AI 模型输出这一块 bug 太多了」）。

## 本版修复的四个输出管线缺陷

### 1. 输出错乱 / 整段回答被吞（最严重）

宿主回退链在切换 provider 时会 `state.text = ""` 重置缓冲，但客户端一直按**绝对偏移** `received` 取增量 → 切片错位。后果二选一：

- 新回答长度 ≤ 旧偏移 → **新正文永远显示不出来**（表现为"没反应"）
- 新回答长度 > 旧偏移 → 把上一路线的残文与新正文**拼接成重复/错乱输出**

修复：给每次流式尝试打 `attempt` 序号（宿主 `lib/index.js:1026` 初始化、`lib/index.js:1174` 递增、`lib/index.js:1237` 随 chatPoll 下发）；客户端在 `lib/client.js:712-719` 检测到 `attempt` 变化即把 `received`/`receivedThink` 归零重新对齐。

### 2. 停止后气泡永久转圈

根因是**瞬时态被持久化**：`lib/client.js:577` 把 `messages`（含 `pending: true`）写进 localStorage，流被中断（停止/刷新/HMR/切面板）后组件重挂载，存储里仍留着 `pending` 的气泡，而没有任何流会再来更新它。

第二个来源：客户端只在 `poll.done` 时停止轮询，而宿主 `chatStop` 只置 abort/error，后台段可能正卡在没有 chunk 的 `await` 里。

修复：
- 新增 `sanitizeHistory()`（`lib/client.js:179`）：载入即净化，清掉 `pending`/`isThinking`；assistant 无正文且无 error 的标记 `interrupted`
- 宿主 `chatPoll` 新增 `stopped` 字段（`lib/index.js:1227-1239`，`state.stopping || signal.aborted`），并把 `done`、`error`、`thinking` 一并对齐
- 客户端消费 `stopped`（`lib/client.js:732-733`）：宿主一进停止终态就立刻收尾，不再等 `done`

### 3. 被中断的回答显示为空白

渲染层从二态扩为三态（`lib/client.js:1230`）：`m.stopped` → 「已停止」／`m.interrupted` → 「已中断——面板被刷新或流被切换打断，可重试」／否则「模型没有输出内容」。被中断/被停止的回答补上「重试」按钮（`lib/client.js:1263`、`lib/client.js:1270`，无正文时也给独立重试行，避免死胡同）。

### 4. 输出归属不透明

每条回答的动作条现在标注真正产出它的模型（`lib/client.js:1255`）与 token 用量，回退链换过模型时一眼可见，而不是让人以为"还是刚才那个模型"。

## 测试

15 个测试套件全绿（含本轮扩充的 `test/stop-cycle.test.mjs`，+24 行覆盖停止终态与 attempt 对齐）。

## 发布

- **npm**：`dsh-obsidian-board@0.2.2`（`dist-tags.latest`）
- **GitHub**：远端 `main` 更新至本轮提交
- **介绍同步**：README 中英文各新增一条特性（🧵 输出不再错乱、不再卡死）、`locale/zh.json` + `locale/en.json` 的 `meta.description`、`package.json` description

## 通道说明

本机 `github.com:443` 表现为「TCP 握手可过、真实传输被重置」：`Test-NetConnection` 返回 True，但 `git fetch` / `git ls-remote` 均失败（`Recv failure: Connection was reset`）。因此 GitHub 推送继续走 **Git Data API**（`api.github.com` 可达）的 blob→tree→commit→ref 四步重建通道。
