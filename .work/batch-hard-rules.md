# 全批次通用铁律（每个 engineer batch 任务书必附）

> 本文件由主理人（齐活林）编译，来源：①测试耦合实测 `.work/test-coupling-map.md` ②生效链路实测 `.work/live-link-verification.md` ③本仓库既有约定。
> **违反任一条 = 该批次判失败并回退。**

## A. 生效链路（先读这条，决定你敢不敢乱写）

```
C:\Users\LENOVO\.dsh\profiles\desktop\node_modules\dsh-obsidian-board
   ──(Directory Junction)──> D:\桌面\AI Port\DSH plugins\dsh-obsidian-board
```
- 改工作区 **立刻** 是生效插件。**没有中间态安全网**。
- 因此：**禁止**「先删后加」「注释掉半截先跑跑看」这类破坏性中间态。
- 回滚只有 git：`git diff` / `git checkout -- lib/`。基线 commit `0d164fe`。

## B. 验收命令（并行期规则 —— 极重要，别跑错）

**并行期间禁止跑全量 `node --test`。** 原因（实测依赖表）：

| 套件 | 依赖的 lib 文件 |
|---|---|
| `vault` / `list-display` | 仅 `vault.js` |
| `llm-contract` / `planner` | 仅 `index.js` |
| `note-tree` / `render-stress` / `smoke-render` / `stream-update` | 仅 `client.js` |
| `cold-start` / `mojibake` / `recall-and-source` | `vault.js` + `index.js` |
| `model-picker` / `stop-cycle` / `thinking` | `index.js` + `client.js` |
| `mature` | 三个全要 |

⇒ 你改 A 文件时，别的并行批次可能正写到 A 之外的 B/C 文件半截；跑跨文件套件会读到半成品 → **假红，浪费一轮**。

**你只许跑本批专属套件**（写完后跑，不要边写边跑）：

```powershell
cd "D:\桌面\AI Port\DSH plugins\dsh-obsidian-board"
node --test test/vault.test.mjs test/list-display.test.mjs          # vault.js 车道
node --test test/llm-contract.test.mjs test/planner.test.mjs        # index.js 车道
node --test test/note-tree.test.mjs test/render-stress.test.mjs test/smoke-render.test.mjs test/stream-update.test.mjs   # client.js 车道
```

- 单文件定向运行实测可行（`node --test test/vault.test.mjs` → 1 pass）。
- ❌ `node --test test/` 在 Node v24.19.0 报 `Cannot find module ...\test`，别用。
- 全量 `node --test`（基线 **15 suites / 15 pass / 0 fail**）由主理人在**每轮 3 个车道全部收口后**统一跑，不归你。
- 回传时必须贴出你跑的**原始输出尾部**（`ℹ pass N / ℹ fail 0`）。

**若你本批新增了测试文件**：新增文件同样只能依赖你本车道的 lib 文件，别去 import 别的 lib（会在别人写到一半时炸）。

## C. 三条 index.js 全局硬禁令（否则 cold-start / mojibake 立刻崩）

1. **不得新增 `export class`**。测试用 `.replace(/export class/, "class")` 只替换第一处；新增会抢占，导致 `ObsidianBoardGateway` 未定义。
2. **`export default` 必须仍是文件最后一段导出，其后不得有任何代码**（含注释块、辅助函数）。测试 `[\s\S]*$` 会把其后全部删掉。
3. **新增 import 只能追加在现有 import 全部之后**；现有顺序
   `node:child_process` → `node:os` → `node:fs/promises` → `node:fs` → `node:path` → `@deepseek-ai/dsh-typert-protocol` → `./vault.js`
   不可变更、不可插入中间。
4. **`export const Config` 必须是单条以 `;\n` 结尾的语句**（测试 `[\s\S]*?;\n` 非贪婪）。**Config 对象内不得出现任何以 `;\n` 结尾的内层语句**——加字段只能写属性（`key: { type: "number", default: N },`），不得写语句。

## D. client.js 锚点与窗口（smoke-render / mature / render-stress 靠它切片）

不可移动、不可改写的标记行（基线行号）：
| 标记 | 行 |
|---|---|
| `const h = React.createElement` | 37 |
| `// ── 常量与工具` | 146 |
| `const SIDEBAR_DEFAULT` | 155 |
| `function clampSidebar` | 158 |
| `const MD_STYLE` | 231 |
| `// ── 主页面` | 382 |
| `const ObsidianPage` | 383 |
| `// ── 浏览器侧 typert 契约` | 1323 |
| `OBSIDIAN_CONTRIBUTION` | 1335 |

- **Markdown 渲染器只能改 `231` ~ `382` 窗口内部**（3.1 / 3.6 的落点）。
- 渲染器内所有元素构造必须继续写 `h(`，**不得**改名或改用 JSX。
- `MD_STYLE` 新增标签时**必须同时加对应样式键**：`h4`/`h5`/`h6`/`table`/`thead`/`tbody`/`tr`/`th`/`td`/`a`/`em`/`del`/`input`，否则 `MD_STYLE[tag]` 为 undefined。
- 组件区（146~1323）是**一整段**被 smoke-render 抽去求值，所以**同一时刻只能有一个 batch 落笔 client.js**。

## E. index.js 切片锚点（不可移动、不可改名、不可改相对顺序）

| 区间 | 被谁用 |
|---|---|
| `function visibleDelta` → `async function mapHasVaultPath` | llm-contract / mature / thinking |
| `function terminalFailure` → `export class` （或 `// 给任意 promise 加超时`） | mature / llm-contract |
| `function needsPlanning` → `function parseQueryList` → `function contextBlock` | planner（**三段连续**） |
| `const EFFORT_VALUES` → `export class ObsidianBoardGateway` | model-picker |

## F. 两处「一字不能改」的文本

1. `lib/index.js` 中 `ObsidianBoardGateway._streams.set(sessionId, state)` 必须**仍出现在** `await abortable(` **之前**（`stop-cycle.test.mjs:29` 做字符串下标比较）。
2. `lib/client.js` 中 ThinkBlock 折叠那一行原文：
```js
if (!!open !== wasOpen) { setWasOpen(!!open); setExpanded(!!open); }
```
（`thinking.test.mjs:34` 用正则精确匹配整行）

## G. 编码与格式

- 文件：UTF-8 **无 BOM**，行尾 **LF**（`.gitattributes` 已声明）。
- 缩进：**Tab**（现有文件全部使用 Tab，勿混空格）。
- 中文注释沿用现有风格；**不要**引入 emoji 到源码（UI 文案除外）。
- 每个优化项落地处，在附近注释标注 `OPT-<编号>`（如 `OPT-2.1`），便于回溯。

## H. 代码风格五戒（AI 通病）

1. 不写「过度防御」的空 try/catch；异常要么处理要么上抛。
2. 不写与现有风格不一致的 Promise 链；统一 `async/await`。
3. 不新增无用的中间变量/包装函数。
4. 不改与任务无关的代码（含格式化、重排 import、改注释）。**只碰任务书授权的行区间。**
5. 不引入任何新依赖（`package.json` dependencies 保持仅 `zod`）。

## I. 交付格式（每个 batch 必须回传）

```
## 改动清单
- <文件>:<起止行>  OPT-<编号>  <一句话说明>

## 契约变更
- <有/无>；若有：<RPC 名 / Config 字段 / 事件名> 的旧形状 → 新形状

## 验收
<node --test 尾部摘要原文粘贴>

## 风险与遗留
- <未覆盖场景 / 需要下游 batch 处理的事项>
```

## J. 调度级铁律（主理人教训，2026-10-19 新增）

**INV-1 同一文件同一时刻只允许一个写者。** 主理人在 R1 曾误让两个 agent 并行写 `lib/vault.js`，导致 284 行改动互相覆盖、双方都基于过期上下文继续 `edit`。

因此：

- 派单前主理人必须核对 `list_agents` 中仍 `running` 的 agent 各自声明写入的文件集合，**交集必须为空**。
- 任何 agent 若在任务中途发现目标文件**已被他人修改**（`git status` 显示意料之外的 `M`），必须**立即停手并上报**，不得基于旧上下文继续 `edit`。
- 主理人在收到任何 batch 完成通知后，第一步是 `git status --short` + `git diff --stat` 核对，再跑该批声明的验收命令。
- 冲突处置优先级：**保先到者的成果**，中断后来者；中断后让存续者「重新 read 磁盘真实内容再做增量 edit」，禁止整文件重写。
- 改动前快照：`.work/snapshots/<file>-<HHmmss>.js`，供冲突时人工比对与回滚。
