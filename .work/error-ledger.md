# 错误台账（error-ledger，dev-expert 纪律）

> 登记标准：新坑且排查耗时不短，或对后续批次有复发风险。每条含根因 / 修复 / 防范 / 错判点。

## ERR-1 模块级符号落入测试切片重叠区 → 重复声明 SyntaxError（2026-10-19，I3 批次）

- **现象**：I3 把 `const MOJIBAKE_KNOWN = {...}` 放在 `terminalFailure` 之后、`export class` 之前，`node --test test/llm-contract.test.mjs` 全红：`SyntaxError: Identifier 'MOJIBAKE_KNOWN' has already been declared`。
- **根因**：llm-contract 把 `visibleDelta→mapHasVaultPath`（fnSrc）和 `terminalFailure→"// 给任意 promise 加超时"`（failSrc）**两个切片拼接进同一个 new Function**。`terminalFailure` 之后到注释行之间恰好是两切片的重叠区，符号声明在拼接体里出现两次。
- **修复**：`MOJIBAKE_KNOWN` 移到 `withTimeout` 函数之后（两切片均不含该区域），实测全绿（`lib/index.js:349`）。
- **防范**：
  1. index.js 新增**模块级**符号前，必须先用探针验证落点：把目标行区间按测试同款切片拼接后 `new Function` 求值一次。
  2. 优先用**类静态字段/静态方法**承载新增状态（如 I4 的 `static _historyStore`），类体不进任何切片。
  3. I3 工程师已把错误字面量写进源码注释供排障；后续批次见 `already been declared` 先查本条。
- **错判点**：单看「export class 之前是安全区」这一经验规则是错的——安全区是**切片并集的补集**，不是任意两锚点之间。
- **适用批次**：I4（进行中，已预防性改为类静态字段）、B7（typert 生成器落位时必须复验切片纯度）。

## ERR-2 `node --test test/` 在 Node 24 报 Cannot find module（基线期发现，清单 §6.2 写法有误）

- **根因**：Node 24 的 `node --test <dir>` 需要显式目录存在性，`test/` 作为参数被当模块路径解析失败。
- **修复**：统一用 `node --test`（无参自动发现）或 `node --test test/<file>.test.mjs` 逐文件。
- **防范**：B7 写 package.json scripts 时用 `"test": "node --test"`；任何批次不得照抄清单 §6.2。

## ERR-3 R1 双写者覆盖事故（INV-1 的由来，2026-10-19 早段）

- **现象**：两个 agent 并行写 `lib/vault.js`，284 行改动互相覆盖，双方基于过期上下文继续 edit。
- **修复**：中断后到者，存续者重新 read 磁盘真实内容做增量修复。
- **防范**：铁律 J——派单前核对 running agent 的写文件集合交集为空；收包后先 `git status` + `git diff --stat` 再验收；改动前快照必做。
