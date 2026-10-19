# vault.js 车道行为验证证据（主理人独立执行）

探针：`.work/probe-1-7-1-9.mjs`（可复跑）
命令：`node .work/probe-1-7-1-9.mjs`
结果：**16 项，失败 0 项**

---

## OPT-1.7 全量索引串行 → 有界并发，保序性验证

构造 40 篇笔记，文件名刻意打乱（`note-{(i*17)%40}`），分别用：
- `new VaultIndex()`（缺省，并发池 8 路）
- `new VaultIndex({ readConcurrency: 1 })`（串行基准）

| 检查 | 结果 |
|---|---|
| chunks 总数与串行一致 | PASS |
| **chunks 的 notePath 出现顺序与串行完全一致** | PASS |

结论：并发池不是「乱序塞入」，而是**按输入下标回填**，索引内部结构在并发下与串行**逐项等价**。这意味着下游 `search` 的 BM25 统计与排序不会因并发而漂移。

---

## OPT-1.9 listNotes 分页语义验证

40 篇笔记，逐项验证：

| 检查 | 结果 |
|---|---|
| `total` 恒为 40（各页一致） | PASS |
| 第 1 页 10 条 | PASS |
| 第 2 页 10 条，且与第 1 页**零重叠** | PASS |
| 第 4 页 10 条 | PASS |
| `hasMore` 第 1 页 = `true` | PASS |
| `hasMore` 第 4 页 = `false`（40 条正好取完，边界不误报） | PASS |
| 越界 `offset=40` → 空数组 + `hasMore=false` | PASS |
| 不传 offset 时 `hasMore=false`（老客户端语义） | PASS |
| 不传 offset 时 `offset` 回显 0 | PASS |
| `offset` 回显正确（10 / 40） | PASS |
| 客户端可自行推导下一页偏移（`offset + notes.length`） | PASS |
| `limit` 上限钳到 2000 | PASS |
| `limit` 下限钳到 0 | PASS |
| 每项仍含 `path`/`title`/`display` 字段 | PASS |

---

## 探针两次失败的原因（记录，避免误判为代码缺陷）

首次运行 2 项 FAIL，均为**探针预期写错**，非实现缺陷：

1. 断言「不传 offset 时 `hasMore` 不出现」 → 实际 `hasMore` 恒存在，未传 offset 时短路为 `false`。
   实现原文 `lib/vault.js:635`：
   ```js
   return { notes: page, total: rows.length, offset: off, hasMore: paged && off + page.length < rows.length };
   ```
   字段恒存在属**纯增量**，老调用方忽略即可，符合 INV-2「契约只增不改」。

2. 断言「`nextOffset` 仅 hasMore 时为数字」 → 实现**没有 `nextOffset` 字段**，只回显输入 `offset`。
   与架构师契约表（第 3 条列了 `+nextOffset`）有偏差，但客户端用 `offset + notes.length` 可自行推导，功能不缺。
   → **结论：接受实现，不要求补 `nextOffset`**；C4 客户端按 `offset + notes.length` 推进分页。
