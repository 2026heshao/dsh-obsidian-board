# dsh-obsidian-board 发布报告

## v0.2.5 — 输入框与模型菜单对齐主对话页，监听改定向重建

本轮主题：**把「问」和「等」做扎实**——客户端输入区按宿主 InputBar 重做、模型选择菜单直接移植宿主 `ModelSelect` 实现；同时收口上一批未发布的三项：召回与引用口径分离、回退过程可视化、文件监听定向重建（并把三类重建统一进互斥锁）。测试：25 个文件 / `node --test` 51 项全绿，自定义断言合计 554 条 0 fail。

### 客户端输入区（`lib/client.js`）

- 输入卡几何与主对话页同源：`--dsw-specific-input-major` 卡底 + `--dsw-radius-panel` 圆角 + `--dsw-elevation-soft` 阴影，输入区 14px/24px、底行 28px 控件、34px 圆形主按钮（发送↑ / 停止■ 与宿主同款图标）。
- 发送与停止共用主按钮：`showStop = busy && !draft.trim()`（与宿主 `primaryStops = running && (empty || blocked)` 同语义，本面板无 blocked 态）。
- 生成中 Enter 排队：队列条目快照当轮路由（provider/model/effort），列在输入卡上方、可单条移除；本轮回答结束后 60ms 自动发下一条；显式停止时清空队列并把待发文本退回输入框，不静默丢内容。
- 停止链路加固：`busyRef` 同步镜像覆盖「chatStart 已发、setBusy 未提交」的窗口；`interrupted()` 同时覆盖显式停止与新轮取代；页面任意位置双击 Esc（500ms 内）停止；消费 `poll.stopped` 立即收尾，不再等宿主后台段自己收敛（历史 bug：气泡永久转圈）。
- 输入法三重守卫：`nativeEvent.isComposing` / `e.isComposing` / `keyCode === 229`——选词回车只选词不发送；Shift/Ctrl/Alt/Meta+Enter 换行。
- 输入框自动增高（36–200px）、发送后焦点回归输入框（否则下一次 Enter 会误触停止）、清空对话同时清队列。
- 焦点环贴合形状：宿主 ui-theme 的全局 `:focus-visible` 用 `:not(:read-write)` 把可编辑元素排除在「指针输入隐藏焦点环」之外，而 textarea 自身无圆角 → 点进输入框会浮出一个和圆角卡片不贴合的直角蓝框。改为压制 composer 子树 outline（`!important` + textarea 圆角双保险），焦点态由 `.ob-composer-card:focus-within` 的描边变色 + 3px 半透明光环表达（与宿主 `wrap:focus-within` 同构）。
- placeholder 收敛为宿主同款克制文案（`基于知识库提问…` / `Ask your knowledge base…`），快捷键说明回到按钮 tooltip，不再塞进占位文本。
- 索引重建与生成解耦：独立 `indexing` 态，重建期间输入框不再误显示停止/排队。

### 模型选择（`lib/client.js` + `lib/index.js`）

- 移植宿主 `ModelSelect`（不是照画）：「模型 / 推理档位」两级面板、provider 分组 + 吸顶分组头（`observeStickyMenuGroups`）、超过 4 条自动出搜索框（`rankByName`）、↑↓ / Tab / Shift+Tab / Escape 焦点流、`MenuSurface` + `createPortal(document.body)` 向上弹出、首帧 `MEASURE_STYLE` 隐藏测量、上方留 8px 四边留 12px 的视口钳制、滚动与 resize 重新定位、外点 mousedown 关闭、`onMouseDown` preventDefault、选中态与焦点回归。
- 行内富信息：免费 / credits / badges / 上下文窗口 / 可用档位；触发器与页头显示「模型 · 档位」。
- 宿主半 `listModels` 新增 `providerNames`（路由 id → 显示名，只服务分组标题；`providers` 保持 id 数组，消息级 override 必须用 id）。
- 未显式选择时触发器与页头显示宿主配置的**真实默认模型**，不再是笼统的「默认模型」；档位显示与实际下发共用 `resolveRowEffort`，与宿主半 `resolveEffort` 同序（显式值 → 宿主配置默认（模型支持时）→ 模型默认）。
- 选择只作用于本面板：写 localStorage `dsh-obsidian-board/model`，随消息下发 provider/model/effort 覆盖，不调 `configure`、不改宿主全局默认；当前走宿主默认路由时选档位，会把默认模型与档位一起钉成消息级覆盖。

### 口径与检索（上一批未发布项）

- 引用与召回分离：底部 chips 按「正文是否真标了 `[n]`」分成**引用** / **相关片段**两组，判据与正文渲染 `[n]` 同源（`CITED_MARK_RE` 与 `renderInline` 的 `[n]` 组用断言锁死）；`.md` 导出同样分两节，不再把 topK 召回一律冒充引用。
- 回退可视化：宿主 `chatPoll.fallback` 被客户端消费，走备用通道重生成的回答额外标「备用通道」，绕路可见。
- Config 描述与 README 口径同步：`topK` / `chunkLimit` 改为「召回片段」措辞，明确「索引与 BM25 召回零网络，planner 查询改写与回答生成走 DSH 模型通道」。

### 索引与监听（`lib/vault.js`）

- 定向增量重建：`fs.watch` 事件能定位到具体 .md 时只重建那一篇（`_onWatchEvent` → `_watchPending` → `_scheduleWatchTargeted`），10k 库端到端约 1.5s → **0.2–0.26s**；null 文件名、解析越界、rename 歧义一律退回全量对账（`_watchNeedFull`，合并窗口 1200ms），不猜。
- 防抖窗口 500ms → 150ms（定向重建本身约 50ms，窗口没必要更长）。
- 竞态封堵：`ensureIndexed` 的全量 / 增量 / 定向三类重建统一进 `scanning` 互斥锁——原「已建过就走轻量增量」快捷分支不进锁，监听器与查询路径可并发跑两份 `_incremental`，交替 drop/commit + `_recomputeStats` 压实 chunks 时会互相踩索引。
- 头注释口径修正：写清 50ms 只是单篇「构建 + 提交 + 重算统计」，端到端增量含目录扫描与逐文件 stat 约 0.9–1.0s；同时去掉指向未入库基准日志的文件引用。

### 测试

- 新增 `test/opt-cited-chips.test.mjs`、`test/opt-fallback-chip.test.mjs`、`test/opt-watch-targeted.test.mjs`。
- 重写 `test/model-picker.test.mjs`、`test/opt-ime.test.mjs`、`test/stop-cycle.test.mjs`、`test/smoke-render.test.mjs` 以对齐新契约（两级菜单 / 队列 / 短按停止 / 宿主 primitives / 焦点环形状），并把纯函数与事件回调抽出来真实求值执行（`resolveEffort`、`resolveRowEffort`、`pickModelRoute`、`onComposerKeyDown`、`submit`、abort 竞速、`ObsidianPage` / `ModelPicker` 渲染树）。
- 客户端新增对宿主浏览器模块表的依赖：`react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives`（与姊妹插件 `dsh-forget-session` 同款用法）。
- **未做实机回归**：本批 UI 改动需在 DSH 44.7.0 里过一遍发送、停止（含静默期与双击 Esc）、排队自动发送、模型菜单两级切换/搜索/键盘导航、IME 与窄宽布局。

## v0.2.4 — 导出体验修复与预览面板可拖宽

本轮主题：**交互体验两连修**——修复「导出对话 .md」静默落盘的困惑（改为浏览器真实下载），为右侧笔记预览面板增加可拖动缩放分割线；README 同步补写两项能力介绍。全量测试 38 套件 0 fail。

### 修复与功能

- 导出对话 .md 改为浏览器真实下载：Blob + `<a download>` 触发下载（保存位置由浏览器/用户决定），无 DOM 环境降级为剪贴板复制全文；新增 `exportCopied` 文案键（中英）；单条「保存为笔记」仍走 vault 不受影响（`lib/client.js` exportChat）。
- 右侧笔记预览面板分割线可拖动缩放：复用左栏同款交互——pointer 拖拽（setPointerCapture + 锁 body 光标）、键盘 ←/→ 步进 16px / Shift 48px、Home 复位、双击还原；宽度持久化 `dsh-obsidian-board/refPaneWidth`（[280,720] 默认 380，向左拖=变宽），手柄带 role=separator + aria 值域（`lib/client.js`）。

## v0.2.3 — 知识库质量与工程化全量升级

本轮主题：**知识库质量与工程化全量升级**——检索与索引、RAG 管线、客户端 UI、契约与工程化四条车道共 40+ 项优化全部落地并逐项验证，全量测试 38 套件 0 fail。

### 检索与索引

- 代码围栏感知解析：chunkNote / extractTags 不再把围栏内的 `# 注释`、`#tag` 误判为标题或标签（`lib/vault.js`，围栏内 h1 计数 = 0 实证）。
- frontmatter 列表解析收窄：列表只认 `tags:` 字段（`lib/vault.js`）。
- 扫描目录与 vendored 权重可配置：Config 新增 `plannerEnabled` / `timeoutMs` / `extraVendoredDirs` / `extraSkipDirs` / `extraDotDirs` / `vendoredWeight` / `scanMaxDepth` 7 字段并接线进 `new VaultIndex()`（缺省值与旧行为逐字节等价）（`lib/index.js`）。
- vault 文件监听自动增量重建：默认关、显式开启，新建文件经防抖进索引，status 透出 `watching` / `watchError`（`lib/index.js` `_watchVault`）。
- 全量索引改有界并发：8 路并发池，按输入下标回填保序（`lib/vault.js`）。
- readNote 安全边界：扩展名白名单 + 大小上限（2 MiB，超限报错含实际字节数）+ junction 逃逸拦截，错误消息区分「点段」与「真实路径越界」（`lib/vault.js`）。
- search 返回检索 tokens，并新增顶层 `grouped` 按笔记聚合与每片 `highlights`（`lib/vault.js`）。
- listNotes 分页：`offset` + `hasMore` + `nextOffset`，缺省 limit 维持 500/400 向后兼容（`lib/vault.js`，宿主 `lib/index.js` 透传）。

### RAG 管线

- 规划档位映射修正：`PLAN_EFFORT_MAP` high→medium，不再跳档压缩规划质量（`lib/index.js`）。
- listModels 并行探测：12 个 provider `Promise.allSettled` 并行 + 单个 8s 超时，最坏耗时从约 2 分钟降到 8 秒级（`lib/index.js:898`）。
- 回退链不落盘：回退成功后改内存态 `state.fallback`（`chatPoll` 返回 `+fallback`），不再把临时路由写进持久化状态覆盖宿主默认模型（`lib/index.js:1124`、`lib/index.js:1303`、`lib/index.js:1374`）。
- 会话池两级清理：先删 done + 60s 过期会话，再按时间戳驱逐最老（`lib/index.js:1262`）。
- 会话阶段可见：`phase`（retrieval→planning→generating→done）与 `hitCount` 只增字段透出，`plannerEnabled` 有真实短路（`lib/index.js:661`）。
- 保存笔记后增量索引：`ensureIndexed(vaultPath)` 去掉 `force: true`，不再强制全量重建（`lib/index.js`）。
- 非流式 `chat` 下线：流式为唯一通路，回退逻辑不再双份维护（`lib/index.js`）。
- 回答超时可配置：`timeoutMs` 钳位 [30000, 900000]，宿主 `setTimeout`、提示文案与客户端轮询 deadline 全部动态化（`lib/index.js` `_timeoutMs()`、`lib/client.js:1220`）。
- planner 触发收窄为四类信号，误触发显著减少（三条强制断言实测全过）（`lib/index.js`）。
- 历史窗口放宽：最近 2 条 assistant 用 8000 字、更早仍 4000，替代原 4000 字硬截断（`lib/index.js` `buildMessages` 内联）。

### 客户端 UI

- Markdown 渲染补齐表格 / h4-h6 / 标准链接 / 斜体 / 任务列表，沙箱化渲染（`javascript:` 链接不成 `<a>`），渲染失败降级纯文本（`lib/client.js`）。
- 中文 IME 选词守卫（`lib/client.js:1391`）与流式自动回到底部（sticky 容器，`lib/client.js:146-148`）。
- 错误边界 `ChatErrorBoundary`（`lib/client.js:507-523`）与清空对话二次确认（`lib/client.js:1142-1143`）。
- 长对话性能：消息组件化 + memo、Markdown 渲染缓存 `MD_CACHE`（≥120 条清空）（`lib/client.js:334`、`lib/client.js:571-688`、`lib/client.js:1645`）。
- 回答操作条新增复制 / 导出对话 .md / 保存为笔记（`lib/client.js:965`、`lib/client.js:990`、`lib/client.js:1244-1267`）。
- 引用 chips 可见上限读宿主 `citationLimit`、按 notePath 去重收全量、超出折叠为「+N」可展开（`lib/client.js:1657-1659`、`lib/client.js:649`、`lib/client.js:659-674`）。
- wikilink 本地未命中时经 `search topK:1` 远端解析，失败回退搜索框（`lib/client.js:1245-1255`）。
- 面板历史按 vault 命名空间隔离（`vaultHashOf` + `adoptVaultHistory` 含旧键一次性迁移），支持导出 / 导入 JSON 并经 `historyGet` / `historySet` 同步宿主（`lib/client.js:163`、`lib/client.js:834-870`、`lib/client.js:1060-1140`）。
- 侧栏笔记列表触底分页（`lib/client.js:1345`）；configure 失败与 `vaultPathValid === false` 均有明确错误提示（`lib/client.js:773`、`lib/client.js:1452`）。
- 内联 i18n 文案表 `UI_TEXT`（zh+en 60+ 键）与模型选择器搜索 + provider 保序分组（`lib/client.js:509`、`lib/client.js:955`、`lib/client.js:1926`、`lib/client.js:1939`）。

### 工程化与契约

- typert 契约 15→17 个 invocations：新增 `historyGet` / `historySet`，`chat` 标记 deprecated（`lib/typert.js`；宿主侧 `lib/index.js:1091`、`lib/index.js:1392-1404`）。
- 新增契约生成器 `scripts/gen-client-contract.mjs`：以 TYPERT 为单一来源生成客户端 descriptors，幂等，`--check` 可作 CI 闸门（`test/opt-contract.test.mjs` 4 断言全绿；生成标记 `lib/client.js:2147`）。
- `package.json` 新增 scripts：`"test": "node --test"` 与 `"gen:contract": "node scripts/gen-client-contract.mjs"`。

### 稳定性与修复

- **saveNote 引用头写出重复 YAML key、损坏 frontmatter（P0）**：改为标准 YAML 列表写法（`lib/index.js:1470-1474`）。
- **「保存为笔记」提示错位（P0）**：sanitizeHistory 补稳定 id，savedTip 改按 `[m.id]` 键索引（`lib/client.js:193-203`、`lib/client.js:945-958`、`lib/client.js:1653`）。
- configure 增加 vaultPath 存在性校验，status 透出 `vaultPathValid`（`lib/index.js:1020`、`lib/index.js:982`）。
- `_fixMojibake` 样本映射常量化为 `MOJIBAKE_KNOWN` 并命中告警（`lib/index.js:349`、`lib/index.js:570`）；discoverVaults 候选根不再硬编码 `D:\`，改惰性探测 `CANDIDATE_ROOTS`（`lib/index.js:632`）。
- 修复点目录场景下 `allowDotDirs` 大小写不一致导致的潜在 `ReferenceError`（`lib/vault.js:200`）。

## 测试

`node --test` 全量绿：38 个测试套件、0 fail（含本轮新增的 5 个 `opt-*` 套件共 62 条断言；4 处因本轮改动而陈旧的断言由 QA 同步修正，仅断言侧、无源码 Bug）。

## v0.2.2 — AI 模型输出管线全量升级

本轮主题：**AI 模型输出管线全量升级**（用户反馈「AI 模型输出这一块 bug 太多了」）。

## 本版修复的四个输出管线缺陷

### 1. 输出错乱 / 整段回答被吞（最严重）

宿主回退链在切换 provider 时会 `state.text = ""` 重置缓冲，但客户端一直按**绝对偏移** `received` 取增量 → 切片错位。后果二选一：

- 新回答长度 ≤ 旧偏移 → **新正文永远显示不出来**（表现为"没反应"）
- 新回答长度 > 旧偏移 → 把上一路线的残文与新正文**拼接成重复/错乱输出**

这正是「总是输出异常」的一类来源。修复：给每次流式尝试打 `attempt` 序号（宿主 `lib/index.js:1026` 初始化、`lib/index.js:1174` 递增、`lib/index.js:1237` 随 chatPoll 下发）；客户端在 `lib/client.js:712-719` 检测到 `attempt` 变化即把 `received`/`receivedThink` 归零重新对齐。

### 2. 停止后气泡永久转圈

根因是**瞬时态被持久化**：`lib/client.js:577` 把 `messages`（含 `pending: true`）写进 localStorage，流被中断（停止 / 刷新 / HMR / 切面板）后组件重挂载，存储里仍留着 `pending` 的气泡，而没有任何流会再来更新它 → 永久转圈。

第二个来源：客户端只在 `poll.done` 时停止轮询，而宿主 `chatStop` 只置 abort/error，后台段可能正卡在没有 chunk 的 `await` 里。

修复：
- 新增 `sanitizeHistory()`（`lib/client.js:179`）：载入即净化，清掉 `pending`/`isThinking`；assistant 无正文且无 error 的标记 `interrupted`
- 宿主 `chatPoll` 新增 `stopped` 字段（`lib/index.js:1227-1239`，`state.stopping || signal.aborted`），并把 `done`、`error`、`thinking` 一并对齐
- 客户端消费 `stopped`（`lib/client.js:732-733`）：宿主一进停止终态就立刻收尾，不再等 `done`

### 3. 被中断的回答显示为空白

渲染层从二态扩为三态（`lib/client.js:1230`）：`m.stopped` → 「已停止」／`m.interrupted` → 「已中断——面板被刷新或流被切换打断，可重试」／否则「模型没有输出内容」。被中断/被停止的回答补上「重试」按钮（`lib/client.js:1263`、`lib/client.js:1270`，无正文时也给独立重试行，避免死胡同）。

### 4. 输出归属不透明

每条回答的动作条现在标注真正产出它的模型（`lib/client.js:1255`）与 token 用量，回退链换过模型时一眼可见。

## 测试

15 个测试套件全绿（含本轮扩充的 `test/stop-cycle.test.mjs`，覆盖停止终态与 attempt 对齐）。

## ✅ 发布结果（已逐项核验）

### npm

- **`dsh-obsidian-board@0.2.2`** 已上线，`dist-tags.latest = 0.2.2`
- 版本列表：`0.0.0-stage, 0.1.0, 0.2.0, 0.2.1, 0.2.2`
- 包内容 11 个文件，64.5 kB（unpacked 186.7 kB），shasum `4ccdcec2`

### GitHub

- 远端 `main = f8f2d2d3da7b25a495d8420443956d6684630d96`（记录在本地 `.git/remote-main-sha`）
- 本轮两个 API 提交：`3cbb844`（v0.2.2 主体，9 个文件）→ `f8f2d2d`（`.gitignore` 行尾归位）
- **终验：递归文件树 31 个条目、28 个 blob 逐个 `git hash-object` 比对 → 0 处不一致**

### 介绍同步

- README 中英文各新增一条特性（🧵 输出不再错乱、不再卡死）
- `locale/zh.json` + `locale/en.json` 的 `meta.description`
- `package.json` description

## 通道说明与踩坑记录

1. **GitHub 推送通道**：本机 `github.com:443` 表现为「TCP 握手可过、真实传输被重置」——`Test-NetConnection` 返回 True，但 `git fetch` / `git ls-remote` 均失败（`Recv failure: Connection was reset`）。因此继续走 **Git Data API**（`api.github.com`）的 blob→tree→commit→ref 四步重建。
2. **API 通道必须同进程跑完**：跨 pwsh 进程会丢变量，导致 base_tree/parents 为空、生成**残缺 tree**。已固化为脚本文件执行。
3. **脚本文件必须带 BOM**：PowerShell 5.1 按 ANSI 解码无 BOM 的 UTF-8 脚本，中文路径会变乱码（`D:\妗岄潰\...`）导致 `Set-Location` 失败。
4. **上传字节必须取自 git 对象库，不能读工作区文件**：`Add-Content` 等操作会把行尾写成 CRLF，而仓库里存的是规范化后的 LF，直接上传工作区字节会造成远端 blob ≠ 本地 blob。修正脚本改用 `git cat-file blob <sha>` 输出 base64 上传，并在上传后校验返回的 blob sha 与本地一致才继续。
