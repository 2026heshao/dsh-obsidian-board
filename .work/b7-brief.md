# B7 任务书草稿（typert 契约生成 · R6 批次，必须最后做）

> 状态：DRAFT。前置：V2/I4/C4/C5 全部交付（typert.js 的终态消费方才确定）。
> 可写文件：`lib/typert.js`、`scripts/gen-client-contract.mjs`（新建）、`lib/client.js`（仅 OBSIDIAN_CONTRIBUTION 段）、`package.json`（仅 scripts）、`test/opt-contract.test.mjs`（新建）。**禁碰**三个 lib 主文件的其它部分。

## 为什么必须最后（三条理由，架构师结论）
1. 生成物必须等于**终态**描述符（17 个：15 基线 + historyGet/historySet；chat 保留 descriptor 标 deprecated）。提前做 → 之后任何批次改 client 会 CI 红且无法归因。
2. 失败模式最恶劣且对称（漏同步一处 = 面板能开一调用就炸 / 加载即拒），多批次齐飞时无法归因。
3. 它同时装 package.json scripts + CI 闸门，闸门必须最后装。

## 任务 1：scripts/gen-client-contract.mjs
- 单一来源：`lib/typert.js` 的 `TYPERT` 导出（15 → 17 invocations，`mv(method, params, resultSym)` 工厂）。
- 生成器读 TYPERT，产出客户端 descriptor 块，写入 `lib/client.js` 中 `// <gen:contract>` / `// </gen:contract>` 标记之间。
- **标记不得侵入 146~1323 切片**：放 `// ── 浏览器侧 typert 契约` 标记之后、`OBSIDIAN_CONTRIBUTION` 附近（派发时 grep 重定位）。
- `OBSIDIAN_CONTRIBUTION` 标记行不可移动/改名（INV-3）。

## 任务 2：typert.js 终态
- 新增 `historyGet({vaultId}) → {items, updatedAt}` 与 `historySet({vaultId, items, updatedAt}) → {ok}` 两个 invocation。
- `chat`：保留 descriptor，注释/字段标 deprecated（I4 已删实现，RPC 分发按 `ANY_VALUE_SCHEMA` 全通透，未声明方法 direct 调用也可达——descriptor 删除与否影响的是协议校验面，保守起见保留一版）。

## 任务 3：package.json scripts（注意 ERR-2）
```json
"scripts": { "test": "node --test", "gen:contract": "node scripts/gen-client-contract.mjs" }
```
**禁止**清单 §6.2 的 `node --test test/`（Node 24 报 Cannot find module）。

## 任务 4：test/opt-contract.test.mjs（CI 闸门）
- 断言：`node scripts/gen-client-contract.mjs` 的输出与 `lib/client.js` 中标记间现状**逐字节一致**；不一致 → fail 并指出第一处差异。
- 只读三个文件的契约段，不 import lib。

## 验收
`node --test`（全量自动发现）0 fail；`npm run gen:contract` 幂等（跑两次 diff 为空）。

## 交付格式（I）+ IS_PASS
