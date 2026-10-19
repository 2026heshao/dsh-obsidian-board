# 测试与源码的硬耦合地图（改动前基线，主理人自验）

> 目的：15 个测试套件**不是**通过 `import` 调 API，而是**按文本标记切片 + `new Function` 求值**。
> 因此任何改动只要移动/重命名下列标记，都会让测试静默失败或抛错。
> 派工时必须把本文作为「不可破坏契约」下发给每个 batch。

## 一、client.js 切片标记（行号为 v0.2.3 基线）

| 标记 | 基线行 | 被谁切片 | 语义 |
|---|---|---|---|
| `// ── 常量与工具` | 146 | smoke-render | 组件代码起始 |
| `const SIDEBAR_DEFAULT` | 155 | smoke-render | `clampSidebar` 抽取起点 |
| `function clampSidebar` | 158 | smoke-render | 抽取终止锚点 |
| `const MD_STYLE` | 231 | mature, render-stress | Markdown 渲染器起点 |
| `// ── 主页面` | 382 | mature, render-stress | 渲染器终点 / 组件起点 |
| `const ObsidianPage` | 383 | note-tree | `buildNoteTree` 抽取终点 |
| `function buildNoteTree` | — | note-tree | 抽取起点 |
| `// ── 浏览器侧 typert 契约` | 1323 | smoke-render | 组件代码终点 |
| `OBSIDIAN_CONTRIBUTION` | 1335 | (client 契约) | 手写契约副本 |

### 切片后的正则改写（render-stress / mature）
```js
.replace(/const h = React\.createElement[\s\S]*?;/, "")   // 必须能匹配到 h 定义行
.replace(/\bh\(/g, "hFake(")                             // 所有 h( 调用被重写
.replace(/var React = require\('react'\);/, "")
.replace(/const React2 = React;\n/, "")
.replace(/const \{ useState, useEffect, useCallback, useMemo, useRef \} = React2;\n/, "")
```
**约束**：
1. `const h = React.createElement`（client.js:37）必须保持**同一行、同一写法**，否则 `[\s\S]*?;` 可能吞掉更多代码。
2. 渲染器内部所有 JSX 等价调用必须写 `h(`，不能改成别的工厂名。
3. 上述 3 行 `React`/`React2` 解构语句若被改写，`.replace` 失效 → 注入的 `new Function` 里出现未定义 `React` → 抛错。

## 二、index.js 切片标记（行号为 v0.2.3 基线）

| 切片区间 | 起点 | 终点 | 被谁用 |
|---|---|---|---|
| 流式纯函数 | `function visibleDelta`(155) | `async function mapHasVaultPath`(242) | llm-contract, mature, thinking |
| 失败判定 | `function terminalFailure`(194) | `export class`(315) | mature |
| 失败判定（另一处） | `function terminalFailure`(194) | `// 给任意 promise 加超时` | llm-contract |
| planner | `function needsPlanning`(74) | `function parseQueryList` | planner |
| planner-2 | `function parseQueryList` | `function contextBlock` | planner |
| 模型元数据 | `const EFFORT_VALUES` | `export class ObsidianBoardGateway` | model-picker |

**约束**：
1. 这 7 个函数/常量的**名字与相对顺序**不可变。`visibleDelta` 必须仍在 `mapHasVaultPath` 之前；`terminalFailure` 必须仍在 `export class` 之前。
2. `needsPlanning` → `parseQueryList` → `contextBlock` 三者相对顺序不可变（planner.test 依赖三段连续切片）。
3. `const EFFORT_VALUES` 必须在 `export class ObsidianBoardGateway` 之前。

## 三、整流改写型（cold-start / mojibake）——最脆弱

这两个测试把**整个 index.js** 做正则替换后 `new Function` 求值，要求：
```js
.replace(/import [\s\S]*?"node:child_process";/, ...)
.replace(/import [\s\S]*?"node:os";/, ...)
.replace(/import [\s\S]*?"node:fs\/promises";/, ...)
.replace(/import [\s\S]*?"node:fs";/, ...)
.replace(/import [\s\S]*?"node:path";/, ...)
.replace(/import [\s\S]*?"@deepseek-ai\/dsh-typert-protocol";/, ...)
.replace(/import \{ VaultIndex \} from "\.\/vault\.js";/, ...)
.replace(/export const Config[\s\S]*?;\n/, "")
.replace(/export class/, "class")
.replace(/export default[\s\S]*$/, "")
```
**致命约束（等价于「不许做的事」）**：
1. **import 块的写法与顺序必须是原样**：`import ... from "node:child_process"` 等 6 条 + `./vault.js` 一条。新增任何 import 若插在这些之间，`[\s\S]*?` 可能跨语句匹配导致整段代码被吞。
   - 若某优化项**必须新增 import**（如 `node:crypto`、`node:events`），必须放在**全部现有 import 之后**，且**不得**写在这些已知 import 之前。
2. `export const Config` 必须是**单条语句并以 `;` 结尾且换行**（`[\s\S]*?;\n` 非贪婪）。若 Config 内出现跨行且提前匹配到内层 `;`，会截断。
   - **风险**：给 Config 增加字段（2.11、1.4、2.5 等很可能要加 `maxNotes`/`watch`/`respectObsidianConfig` 等）时，**不得**在 Config 的 zod 链中插入以 `;\n` 结尾的内层语句。
3. `export class` 只被替换**第一次出现**。若在 `export class ObsidianBoardGateway` 之前新增任何 `export class`，会替换到错误的那个 → `ObsidianBoardGateway` 未定义 → 两个测试全崩。
   - **硬禁令**：所有 batch **不得在 index.js 中新增 `export class`**。
4. `export default[\s\S]*$` 会把**从 `export default` 起到文件末尾全部删掉**。因此：
   - `export default` 必须仍是**文件最后一段导出**；
   - **不得**在 `export default` 之后再新增任何代码（含 OPT 注释块、辅助函数）。
5. `new Function(...)` 注入的是 `spawn/homedir/statSync/basename/dirname/isAbsolute/join/resolve/readFile/readdir/stat` 共 12 个假体，并在尾部追加 `const spawn = obSpawn; ... return { G: ObsidianBoardGateway };`。
   - 所以 **`ObsidianBoardGateway` 类名不可改**，且类必须仍是 `export class` 形式（去 `export` 后成为 `class` 声明，在函数作用域内可见）。

## 四、字符串包含型断言（弱耦合但会因文案改动而失败）

| 测试 | 断言内容 |
|---|---|
| smoke-render:50 | 页头含 `默认模型` |
| smoke-render:51 | 含 `ob-composer-meta` |
| smoke-render:52 | 含 `ob-model-area` |
| smoke-render:53 | 含 `ob-btn primary` |
| smoke-render:54 | 含 `基于知识库提问` |
| smoke-render:55 | 含 `向你的知识库提问` |
| smoke-render:56 | 含 `ob-status` |
| smoke-render:57 | 根节点 `div.ob-page` |
| smoke-render:71-87 | 结构：`.ob-page` 直接子节点、`.ob-main` 唯一、composer 是 `.ob-main` 最后子节点、composer 全树唯一、含 `.ob-composer-row`+`.ob-composer-meta`、输入行含 textarea+`.ob-btn`、元信息行含 `ob-model-area`、聊天区在 composer 之前 |
| smoke-render:90-103 | 侧栏唯一、宽度内联 px、有 ref、resizer 唯一且在最后、`role=separator`/`aria-orientation=vertical`/`aria-valuemin=200`/`aria-valuemax=560`/`tabIndex=0`、绑定 pointer/keydown/dblclick、默认 264 |
| smoke-render:110-113 | `clampSidebar(100)=200`、`(900)=560`、`(318.6)=319`、`(NaN/undefined)=264` |
| stop-cycle:29 | 源码内 `ObsidianBoardGateway._streams.set(sessionId, state)` 必须**出现在** `await abortable(` **之前**（字符串下标比较） |
| thinking:34 | 正则匹配 `if (!!open !== wasOpen) { setWasOpen(!!open); setExpanded(!!open); }` —— **ThinkBlock 折叠逻辑原文不可改** |

## 五、对分区的直接结论

1. **MD 渲染器（3.1、3.6）** 只能改 `MD_STYLE`(231) ~ `// ── 主页面`(382) 这个窗口内的实现，**不得**移动这两个锚点行，不得改 `h(` 工厂名。
   - 3.1 新增 h4-h6/table/a/em/task 时：必须**同时**在 `MD_STYLE` 里加对应键，否则 `MD_STYLE[tag]` 为 undefined（smoke/mature 会渲染出 `style: undefined`，虽不抛错但视觉崩）。
2. **smoke-render 的组件切片（146~1323）包含整个 ObsidianPage**，因此 client.js 的**任何** batch（3.x、4.x）都在同一窗口内 → **client.js 的组件区必须单线程串行**，不能并行两个 batch 同时改。
3. **index.js 的 `export class` 唯一性禁令** + **`export default` 末尾禁令** + **import 顺序禁令** 是三条全局硬约束，必须写进每个 index.js batch 的任务书。
4. **planner.test 依赖三段连续切片**（`needsPlanning`/`parseQueryList`/`contextBlock`），2.3（planner 增强）改动必须保持三者名字与顺序。
5. **stop-cycle 的下标比较**意味着 `_streams.set(...)` 必须在 `abortable(` 之前——2.7（会话池）若调整这两句顺序会直接失败。

## 六、验收命令

- ✅ `cd dsh-obsidian-board && node --test`（自动发现，15 suites）
- ❌ `node --test test/` —— Node 24 上会 `MODULE_NOT_FOUND`
