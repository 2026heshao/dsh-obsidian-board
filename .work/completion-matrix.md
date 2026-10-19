# 优化项完成度追踪矩阵

状态口径：
- ✅ **已交付并实证** —— 工程师报告 + 主理人独立验证（真执行，非静态断言）双通过
- 🟡 **已交付待验** —— 工程师已回传，主理人验证未完成
- 🔵 **在跑** —— 批次正在执行
- ⬜ **未派** —— 尚未派发
- ⏸️ **本轮不做** —— 已决策延后

---

## 一、检索与索引质量（`lib/vault.js` 车道，批次 `3951ba08`）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| 1.1 | P1 | chunkNote 不识别代码围栏，`# 注释` 被当标题 | ✅ | 真执行 + 围栏内 h1 计数 = 0 |
| 1.2 | P2 | extractTags 把代码块里的 `#tag` 当标签 | ✅ | 真执行 |
| 1.3 | P2 | frontmatter 列表解析过宽 | ✅ | 真执行，只认 `tags:` 键 |
| 1.4 | P1 | 降权与跳过目录硬编码 | ✅ | 10 项扫描参数缺省值**逐字节等价**比对 PASS |
| 1.5 | P1 | 无文件监听 | ✅ | 默认关、显式开、新建文件经防抖进索引、可 unwatch |
| 1.6 | P2 | readNote 无大小/扩展名限制 | ✅ | 精确边界 2097058 放行 / 2097258 拒绝且含实际字节数 |
| 1.7 | P2 | 全量索引串行 | ✅ | 有界并发池（8 路），按输入下标回填保序 |
| 1.8 | P2 | 无高亮与按笔记聚合 | ✅ | 功能在（顶层 `grouped` + 每片 `highlights`）。主理人一度上报 DEF-E/DEF-F，**实测后均撤销**，详见 `.work/correction-1-8-dismissed.md` |
| 1.9 | P1 | listNotes 上限 400 无翻页 | ✅ | `offset` + `hasMore` + `nextOffset`，缺省 limit 仍 500/400 兼容 |
| 5.1 | P2 | readNote 路径校验边缘 | ✅ | junction 逃逸**实测被拦**，错误消息区分「点段」与「真实路径越界」 |

**车道缺口**：无。10 项全部落地。

---

## 二、RAG 管线（`lib/index.js` 车道）

### 批次 I1（已完成，`dcff273c`）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| Config 基座 | — | 新增 7 字段：`plannerEnabled` / `timeoutMs` / `extraVendoredDirs` / `extraSkipDirs` / `extraDotDirs` / `vendoredWeight` / `scanMaxDepth` | ✅ | probe 实测 Config 含 15 字段；单条 `;\n` 约束仍成立 |
| 2.4 | P2 | 规划跳档位映射 high→low 压缩质量 | ✅ | `PLAN_EFFORT_MAP` high→medium，与清单原文一致 |
| 2.9 | P2 | 历史 4000 字硬截断 | ✅ | 最近 2 条 assistant 用 8000，更早仍 4000，内联在 `buildMessages` 内 |
| 2.12 | P2 | 双超时硬编码 | ✅（宿主半） | `_timeoutMs()` 钳 [30000, 900000]，`setTimeout` 与两处文案均改。**客户端半待 C4** |

### 批次 I2（已完成，`e6ec4d57`）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| **I2-0** | **修复** | **GAP-1：`new VaultIndex()` 一个参数都没传，5 个 Config 字段全是死字段** | ✅ | probe + 工程师自测：`vendoredWeight`/`scanMaxDepth` 生效，`extraVendoredDirs` 是**追加**（7 基线 + 1） |
| 1.4（宿主半） | P1 | 扫描参数接线 | ✅ | 同上 |
| 1.5（宿主半） | P1 | `_watchVault` 幂等启动 + status 透出 `watching`/`watchError` | ✅ | `watch()` 是**同步**函数，try/catch 能真捕获；无 unhandledRejection 风险 |
| 1.9（宿主半） | P1 | listNotes 分页透传 | ✅ | `offset` 保留 `undefined` 语义，老客户端行为零变化 |
| 2.3 | P1 | planner 触发过宽 | ✅ | 收窄为四类信号；三条强制断言 `对比…区别`→true、`k8s`→false、`为什么要用 RRF`→true 全过 |
| 2.8 | P1 | 检索/规划阶段不可见 | ✅ | `phase` + `hitCount` 只增字段；`plannerEnabled` 在 661 行有真实短路 |
| 2.10 | P2 | saveNote 强制全量重建 | ✅ | `ensureIndexed(vaultPath)` 去掉 `force: true` |

### 批次 I3（✅ 完成，agent `2025d5d5`，IS_PASS: YES；快照 `index-preI3-195036.js`）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| **2.1** | **P0** | **saveNote 引用头写出重复 YAML key，frontmatter 损坏** | ✅ | YAML 列表写法 `lib/index.js:1470-1474`（grep 实证 :1545 `refs:` 列表块） |
| 2.5 | P1 | listModels 串行探测 12 provider，最坏 2 分钟 | ✅ | `Promise.allSettled` 并行 `:898`（grep 实证）+ 单个 8s 超时 |
| 2.7 | P2 | 会话池清理只删一个 done 会话 | ✅ | 两级清理 `:1262`（grep 实证：先删 done+60s 过期，再按 ts 驱逐最老） |
| 2.11 | P1 | configure 不校验 vaultPath 存在性 | ✅ | configure stat 校验 throw `:1020` 旁 + status `vaultPathValid` `:982`（grep 实证） |
| 5.2 | P2 | `_fixMojibake` 硬编码样本映射 | ✅ | `MOJIBAKE_KNOWN` 常量 `:349` + 命中 console.warn `:570`（grep 实证） |
| 5.3 | P2 | discoverVaults 候选根硬编码 `D:\` | ✅ | `CANDIDATE_ROOTS` 惰性 getter `:632`（grep 实证，Windows 才 statSync 探测） |

> 工程师验收：6 套件 50 passed / 0 failed。排障记录：`MOJIBAKE_KNOWN` 放切片重叠区曾致 llm-contract 全红（重复声明），最终位置 withTimeout 之后。

### 批次 I4（✅ 完成，agent `b9f759f9`，IS_PASS: YES；快照 `index-preI4-202917.js`；文件 1446 行）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| 2.2 | P1 | 回退成功后把临时路由永久写进状态，静默覆盖「宿主默认模型」 | ✅ | 流式回退成功分支删 config 写入/_saveState，改 `state.fallback`（`:1303` 注释实证）；`chatPoll` 返回 `+fallback` `:1374`；state 初始化 `fallback: null` `:1124` |
| 2.6 | P2 | 非流式 `chat` 已是死代码，回退逻辑双份维护 | ✅ | `async chat(` count=0（实测）；共享符号 `_multiHits`/`contextBlock`/`buildMessages` 等保留 |
| 4.2（宿主半） | P1 | 历史目前仅 localStorage，新增 `historyGet`/`historySet` RPC | ✅ | `static _historyStore = new Map()` `:1091`（类静态字段，避开 ERR-1 切片重叠）+ 两 RPC `:1392-1404`（纯内存、slice(-40)） |
| I4-T2 | 测试 | recall-and-source.test.mjs:34 `pushPair >= 2` 陈旧计数 | ✅ 裁决归 QA | 实测 count=1；`:35` 守卫体断言完整保留 → QA 自修（≥2→≥1） |

> 工程师验收：五套件 4 pass / 1 fail（唯一红 = T-2）；stop-cycle 探针 `_streams.set` idx 47950 < `abortable(` idx 49430 ok；硬禁令四条 + UTF-8/LF/Tab 自查过。**客户端半（fallback 提示 UI、history 同步）归 C4/B7。**

---

## 三、客户端 UI（`lib/client.js` 车道）

### 批次 C1（已完成，`347b4d3c`）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| **3.1** | **P0** | **Markdown 缺口：表格 / h4-h6 / 标准链接 / 斜体 / 任务列表** | ✅ | 真执行节点计数：table 1 / tr 3 / th 3 / td 6 / h4 h5 h6 各 1 / em 1 / a 1 / input 2。**反向验证**：围栏内 `# 注释` h1=0；`javascript:` 链接**未**成 `<a>` |
| 3.5（a 半） | P1 | 渲染器 try/catch 降级为纯文本 | ✅ | 原 `renderMarkdown` 改名 `renderMarkdownImpl`，外层包 try/catch |
| 3.6 | P1 | 右栏笔记纯文本 | ✅（待验渲染细节） | 已接入 markdown 渲染 |

### 批次 C2（已完成，`95e1dbe0`；交付阶段异常终止但改动已全部落盘，grep 实证）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| **3.2** | **P0** | **中文 IME 选词回车误发送** | ✅ | OPT-3.2 守卫 `lib/client.js:1391`（`e.nativeEvent?.isComposing \|\| e.keyCode === 229`） |
| 3.3 | P1 | 流式不跟随滚动 | ✅ | CSS `.ob-jump-bottom` sticky `:146-148` + 渲染 `:1512-1518` |
| 3.5（b 半） | P1 | 无错误边界 | ✅ | `ChatErrorBoundary` `:507-523` + 包裹 `:1426` |
| 3.9 | P2 | 清空对话无确认 | ✅ | 清空确认 `:1142-1143` |

> 全量 `node --test`：28 pass / 1 fail（唯一红 = T-1，归 QA 批次）。

### 批次 C3（✅ 完成，agent `ac25439c`，IS_PASS: YES；快照 `client-preC3-200525.js`；文件 1634→1777 行）

| 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|
| **4.3** | **P0** | **savedTip 以消息下标为键，retryLast 删尾重发后全部错位** | ✅ | sanitizeHistory 补稳定 id `:193-203`（`'h'+…` 每条只赋一次）+ savedTip 键改 `[m.id]` `:945-958` + tip 传布尔原值 `:1653`（grep 实证） |
| 3.10 | P1 | 长对话全量重渲染 | ✅ | `MD_CACHE` `:334`（key=id:len，≥120 清空）+ `MessageCardBase`/`MessageCard` memo `:571-688`（C2 typeof React2 模板）+ 消息 map 改组件化 `:1645`（grep 实证） |
| 3.4 | P2 | 无复制/导出对话 | ✅ | `copyAnswer` `:965` + `exportChat`（复用 saveNote RPC）`:990` + 「导出对话 .md」按钮 `:1244-1267`（grep 实证；在 .ob-head-meta 内，不破 composer-last 断言） |
| 3.11 | P2 | chips 上限 8 与 topK 20 不一致 | ✅ | 可见上限唯一来源 `status.citationLimit`（派生 `:1657-1659`，兜底 12）+ chips 按 notePath 去重收全量 `:649` + 「+N」展开/收起 `:659-674`（grep 实证） |
| 3.12 | P2 | wikilink 仅限本地 400 条 | ✅ | goWiki 改 async：本地未命中 → `search topK:1` 远端解析 `:1245-1255`，异常/空结果回退搜索框（grep 实证） |

> 主理人复核：四件套重跑 4/4 绿（note-tree / render-stress / smoke-render / stream-update）；9 锚点未动、ThinkBlock 折叠行 `:500` 逐字、`const h` `:37` 未动；send/轮询区 diff 零命中。副作用裁决：sanitizeHistory 重构致 `stop-cycle.test.mjs:73` 字面断言陈旧 → T-3（QA 自修）。

### 批次 C4（✅ 完成，agent `27a0445e`，IS_PASS: YES；快照 `client-preC4-205355.js`）/ C5（未派）

| 批次 | 编号 | 优先级 | 内容 | 状态 | 验证依据 |
|---|---|---|---|---|---|
| C4 | 1.9（客户端半） | P1 | 侧栏列表分页 | ✅ | `loadMoreNotes` + 触底 onScroll（<40px）`lib/client.js:1345`（grep 实证）；notes state 补 `hasMore/nextOffset` `:751`；buildNoteTree 未动 |
| C4 | 4.1 | P1 | 历史不区分 vault | ✅ | `vaultHashOf`（djb2 hex）`:163` + `adoptVaultHistory`（含旧键一次性迁移、旧键保留）`:834-870` + 持久化空 hash 守卫 `:924-928`（grep 实证） |
| C4 | 4.2（客户端半） | P1 | 历史导出/导入 | ✅ | 导出/导入 JSON `:1060-1140`（Blob 下载 + DOM 缺失剪贴板降级；`historySet` `.catch(()=>{})` 尽力而为 `:1129`）+ 按钮 `:1831`（grep 实证） |
| C4 | 2.11（客户端半） | P1 | configure 错误展示 | ✅ | `configError` state `:773` + configure 失败/`vaultPathValid===false` 两种 `.ob-err` 展示 `:1452/:1564/:1567`（grep 实证） |
| C4 | 2.12（客户端半） | P2 | 轮询超时读 `status.timeoutMs` | ✅ | pollDeadline `Date.now() + (Number(status&&status.timeoutMs)||300000) + 30000` `:1220`（30000 宽限注释实证），文案秒数同步动态化 |
| C5 | 3.7 | P1 | i18n 备而不用（locale 只有 2 个 meta 键） | ✅ | 内联 `UI_TEXT`(zh+en 60+ 键) `:509` + `t()` `:673`（zh 值逐字一致，七断言不破）；`UI_LANG='zh'` `:508`（grep 实证） |
| C5 | 3.8 | P2 | 模型选择器无搜索分组 | ✅ | `modelQuery` `:955`（打开清空）+ 搜索框 `.ob-model-search` `:1926` + provider 保序分组 `:1939` + 无匹配空态；CSS 仅追加 `:154-155`（grep 实证） |

> **QA 终态（2026-10-19）**：T-1/T-2/T-3/T-4 四处陈旧断言修复（T-3 扩面 :72/:78/:79，均为断言侧）；新增 5 套件 62 断言全绿；全量 **38/38/0**（Routing=NoOne，无源码 Bug）。

---

## 四、工程化、契约、文档

| 批次 | 编号 | 优先级 | 内容 | 状态 |
|---|---|---|---|---|
| B7 | 6.1 | P1 | 契约双份维护（`typert.js` 15 个 invocations vs `client.js:1335` 手写 15 个 descriptors） | ✅ typert 17 invocations（+historyGet/historySet，chat deprecated）；`scripts/gen-client-contract.mjs`（TYPERT 单一来源，幂等，--check 带差异定位）；client 生成标记 :2147/:2173（切片外）；`test/opt-contract.test.mjs` 4 断言全绿 |
| B7 | 6.2 | P2 | package.json 无 scripts 字段 | ✅ scripts 节 `{"test":"node --test","gen:contract":"node scripts/gen-client-contract.mjs"}`（避 ERR-2）；全量基线 29 pass / 4 fail（红=T-1/T-2/T-3/T-4 全为 QA 陈旧断言） |
| X1 | 7.1 | P2 | RELEASE-NOTES 停在 v0.2.2，无 v0.2.3 段落 | ✅ v0.2.3 段（125 行，主题句+5 分组 36 条+测试小节，落点行号取矩阵终态；v0.2.2 段 :62 原样保留） |
| X1 | 7.2 | P2 | README 边界同步 | ✅ :96 英/:201 中 history 边界改写、:88/:193 连带一致性修正、DEF-B :95/:200、Features 中英各+4；残留 grep=0 |
| — | 6.4 | P2 | client.js 单文件拆分 | ⏸️ 本轮不做（拆分与三个按字面切片 client.js 的测试冲突，且与 C 车道 5 轮全面撞车） |

---

## 五、主理人发现但清单未收录的缺陷

| 编号 | 内容 | 状态 |
|---|---|---|
| DEF-A | `lib/vault.js:200` 引用小写 `allowDotDirs` 而声明是大写 → 遇点目录时 `ReferenceError` | ✅ 已修（改回大写，因 `recall-and-source.test.mjs:43` 有逐字断言该行） |
| DEF-B | `cordis.patch.yml` 只有 6 键，连基线的 `historyLimit`/`reasoningEffort` 都没有 | 接受现状；7.2 README 须写明「配置以 `lib/index.js` 的 `Config` 为准」 |
| DEF-C | `maxNoteBytes` 有 vault.js 缺省值但无 Config 出口 | 接受（清单 1.6 只要求有上限，未要求可配） |
| DEF-D | `package.json` description 的 mojibake 是误报（实为 `U+2014` em dash） | ✅ 已撤销 |
| DEF-E | OPT-1.8 的 highlights 名额被 bigram 碎片占满，3 条全是同一位置 | ✅ 已撤销（`.work/correction-1-8-dismissed.md`：探针实测为数据造错 + 设计如此，非缺陷） |
| DEF-F | OPT-1.8 的 `grouped` 未放宽「按笔记 ≤2 片」，聚合拿不到第 3 片 | ✅ 已撤销（同上：单篇 ≤2 片是基线既有设计，`vault.js:513-514` 注释写明理由） |
| **T-1** | **`test/thinking.test.mjs:26` 断言旧缺陷字面文本，与 OPT-2.4 直接冲突** | ✅ QA 修复（改 PLAN_EFFORT_MAP 断言 + high→medium 行为验证；:34 正则/:41 切片未动） |
| **T-2** | **`test/recall-and-source.test.mjs:34` 断言 `pushPair >= 2`，I4 下线非流式 chat 后计数降为 1**（守卫属性由 :35 保留） | ✅ QA 修复（≥2→≥1 + 注释；:35 守卫断言保留） |
| **T-3** | **`test/stop-cycle.test.mjs:73` 断言 `const next = {...}` 字面，C3 的 OPT-4.3 合法重构 sanitizeHistory（`let next = m` + reassign 补 id）后失效** | ✅ QA 修复（扩面共 4 处：:73 去 const 字面、:72 历史命名空间键断言、:78/:79 isLast prop；行为断言 :74/:75 全绿；client.js 未动） |
| **T-4** | **`test/model-picker.test.mjs:43` 断言 `defaultEffort || '默认'` 字面，C5 的 OPT-3.7 收编为 `t('effortDefault')`**（B7 隔离复现证实与工程批次无关） | ✅ QA 修复（改 `/selRow\.defaultEffort \|\| t\('effortDefault'\)/`，对应 client.js:1905 终态） |

---

## 已知的「文档说 vs 实际」偏差（须在最终报告修正）

1. **测试入口**：清单 §6.2 建议 `"test": "node --test test/"`，在 Node 24 上**会失败**（`Cannot find module ...\test`）。正确写法是 `"test": "node --test"`（无参数，自动发现）。
2. **架构师假设 Config 用 zod 链式** —— 实际 `lib/index.js` 中 zod 使用点为 **0**，`Config` 是纯 JSON-Schema 风格对象字面量。
3. **架构师担心 `strictCodec` 拒收未知字段** —— 实际 `ANY_VALUE_SCHEMA = { parse: (v) => v }` **全通透**，新增返回字段绝不会被拒。只有新增 RPC **方法**才必须登记 `lib/typert.js`。
4. **清单假设客户端读 `locale/*.json`** —— 实际 `lib/client.js` 完全不读，`locale` 唯一命中是 `localeCompare`。3.7 只能内联文案表。
