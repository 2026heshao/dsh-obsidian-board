# 主理人核实结论（架构师 14 项待明确事项 → 已全部定案）

> 来源：主理人实测 `.work/probe-q.mjs` / `.work/probe-final.mjs`。**凡与本文件冲突的，以本文件为准。**
> 架构师设计（分区/契约/顺序）总体采纳，但下列 Q1/Q10/Q12 三处**前提有误**，已按下文纠正。

## Q1 【架构师前提错误】Config 不是 zod，是纯 JSON Schema
`lib/index.js:23-44` 原文：
```js
export const Config = {
	type: "object",
	properties: { vaultPath: {type:"string",...,default:""}, ... },
	default: {},
};
```
- 全文件 `zod` 命中数 = **0**（`/zod/.test(host) === false`）。`zod` 只被 `lib/typert.js` 使用。
- **结论**：I1 新增 7 个 Config 字段 = 新增 7 个 JSON Schema 属性，写法照抄既有字段：
  `plannerEnabled: { type: "boolean", description: "...", default: true },`
- **仍然有效的禁令**：字段行以 `,` 结尾，**绝不得出现 `;`**（`cold-start.test.mjs:27` 与 `mojibake.test.mjs:27` 用 `.replace(/export const Config[\s\S]*?;\n/, "")` 非贪婪截断，Config 内第一个 `;\n` 会被当成文件尾）。
- 不需要 `z.array`/`z.number().int()` 等 zod API；数组字段用 `{ type: "array", items: { type: "string" }, default: [], description: "..." }`。

## Q2/Q3 已定：smoke-render 注入白名单与切片边界
`test/smoke-render.test.mjs:14-16 / 28-31` 原文：
```js
const start = src.indexOf("// ── 常量与工具");
const end   = src.indexOf("// ── 浏览器侧 typert 契约");
const code  = src.slice(start, end);
ObsidianPage = new Function("h","useState","useEffect","useCallback","useMemo","useRef", code + "\nreturn ObsidianPage;")(...)
```
- 注入白名单恰为 6 个：`h, useState, useEffect, useCallback, useMemo, useRef`。**没有 `React`、没有 `sanitize`、没有 `escape`。**
- 切片 = `// ── 常量与工具`(146) → `// ── 浏览器侧 typert 契约`(1323)，**左闭右开**，不含契约段。
- **硬结论**：切片内新增的任何 helper/常量都必须在切片内定义；不得引用 `React`/`module`/`ctx`/`process`/`require`。

## Q4/Q11 已定：index.js 各测试切片的确切锚点（实测）
| 测试 | 切片起点 → 终点 |
|---|---|
| llm-contract | `function visibleDelta` → `async function mapHasVaultPath`；`function terminalFailure` → `// 给任意 promise 加超时` |
| mature | `const MD_STYLE`→`// ── 主页面`；`function visibleDelta`→`async function mapHasVaultPath`；`function terminalFailure`→`export class` |
| thinking | `function ThinkBlock`→`// ── 主页面`；`function visibleDelta`→`async function mapHasVaultPath` |
| model-picker | `const EFFORT_VALUES` → `export class ObsidianBoardGateway` |
| planner | `function needsPlanning` → `function parseQueryList` → `function contextBlock`（**三段连续**） |
| stop-cycle | `ObsidianBoardGateway._streams.set(sessionId, state)` 下标 < `await abortable(this._multiHits(` 下标 |

- `// 给任意 promise 加超时` 实测在 **`lib/index.js:263`**（`withTimeout` 定义于 265）。
- **`lib/index.js:120`（`m.content.slice(0, 4000)`）落在 `buildMessages`(102-127) 内，不在任何测试切片里** → 2.9 可以安全地内联改。

## Q5 已定：`export const Config` 不可改写法
`cold-start.test.mjs:27`、`mojibake.test.mjs:27` 用正则字面定位。**保持 `export const Config = {` 原样**，不得改成 `const Config` + 末尾 `export {Config}`。

## Q6 已定：`listNotes` 现有返回**已含 `total`**
`lib/vault.js:403-447` 返回 `{ notes: rows.slice(0, limit), total: rows.length }`；`vault.test.mjs:63` 断言 `list.total !== 3`。
→ `hasMore = offset + notes.length < total`，`nextOffset = offset + notes.length`。

## Q7 已定：**无任何测试调用非流式 `chat`**
实测 15 套件中 `"chat"` 字面命中数：仅 `model-picker.test.mjs` 有 `"chatStart"`×1，`"chat"`×0。`chatPoll` 命中 0。
→ 2.6 可安全改为 `console.warn` + 保留实现（**不要 throw**，避免运行时炸面板）。同时 `chat` 的 descriptor 在 B7 前不得删。

## Q8 已定【架构师最大风险不存在】：strictCodec **全通透**，不校验字段
`lib/client.js:1328-1331` 原文：
```js
const ANY_VALUE_SCHEMA = { parse: (v) => v };
function strictCodec(symbol) {
	return { mode:'strict', typeSymbol:'dsh-obsidian-board/typert#'+symbol, schema: ANY_VALUE_SCHEMA, create: () => ANY_VALUE_SCHEMA };
}
```
→ `parse` 是恒等函数。**新增 `phase`/`hitCount`/`fallback`/`hasMore`/`vaultFingerprint` 等字段，客户端绝不会拒收。**
→ 但不改契约块仍有意义：`lib/typert.js` 走宿主 loader 校验，新增 **RPC 方法**（`historyGet`/`historySet`）才必须登记；**新增返回字段不需要改 typert.js**。

## Q9 已定：宿主 RPC 分发**以 `TYPERT.invocations` 为准**
`lib/typert.js:31-56` 的 `TYPERT.invocations` 是唯一登记表（15 个 `mv()`）。未声明的方法不可调用。
→ 4.2② 的 `historySet` 在 B7 前不存在 ⇒ C4 必须「先写 localStorage，再 `try{ call('historySet',...) }catch{}` 静默降级」。**这是硬要求，不是可选优化。**

## Q10 已定：`typert.js` 无上游生成器（文件自称 Generated 但仓库内无生成脚本）
`lib/typert.js:1` = `/* Generated for dsh-obsidian-board — do not edit. */`，仓库内仅此一份，无 `scripts/`。
→ B7 自建 `scripts/gen-client-contract.mjs`，**单一来源 = `lib/typert.js` 的 `TYPERT` 导出**，生成 `client.js` 的 `OBSIDIAN_CONTRIBUTION` 段。

## Q12 已定【架构师前提错误】：客户端**完全不读 `locale/*.json`**
`lib/client.js` 中 `locale` 唯一命中 = `:401` 的 `localeCompare`（与 i18n 无关）；`i18n`/`.json`/`I18N` 全部未命中。
`locale/zh.json`、`locale/en.json` 仅含 `meta.title`/`meta.description`，供 DSH 插件列表展示。
→ **3.7 只能两类做法**：① 切片内内联 `const I18N = {zh:{...},en:{...}}`（推荐，符合 INV-4）；② 宿主 `status` 回传文案表。**不得**在切片内 `import`/`fetch`。
→ `locale/*.json` 仍应补齐 meta 之外**不**做 —— 它是插件元数据文件，不是 UI 词典。

## Q13 已定：1.4 新增 Config 字段**不动 UI 配置卡**
客户端配置卡（`client.js:939+`）只处理 `vaultPath`/`provider`/`model`/`topK`。新增 7 字段走 `cordis.patch.yml`。
→ 但 `cordis.patch.yml` 现状**缺 `historyLimit` 与 `reasoningEffort`**（已有 schema 却未在 patch 暴露）。B7/X1 应补齐。

## Q14 已定：**本轮不做 6.4（client.js 拆分）**
理由：① `smoke-render`/`mature`/`thinking` 按字面锚点切片 `client.js`，拆分后必须保证**提交物仍是单文件 `lib/client.js`**；② 与 C 车道 5 轮改动全面冲突；③ 属独立工程改造，与 40 项混做会掩盖回归。列为后续独立轮次 B9。

---

# 追加发现（文档未收录的真实缺陷）

## DEF-1 `package.json` description 含 mojibake（U+9225 系）
`"description"` 中 `dedicated` 前是 `鈥?` 两字，本应为破折号 `—`。以正确 UTF-8 读取仍得 `鈥?` ⇒ **源文本已损坏**，非读取问题。
→ 归 X1（文档批次）修。

## DEF-2 `cordis.patch.yml` 与 Config schema 不同步
schema 有 `historyLimit`(24)、`reasoningEffort`("high")，patch 未写。用户改 patch 时无法调这两项。
→ 归 B7/X1 补齐。

## DEF-3 `test` 脚本缺失导致验收命令不可发现
`package.json` **无 `scripts` 字段**。6.2 是「新建 scripts」而非「修改」。
→ `"test": "node --test"`（**不是** `node --test test/`，后者在 Node 24 报 MODULE_NOT_FOUND，已实测）。
