# OPT-1.8 质量复核：主理人两次判断的反转与最终定论

## 结论（最终）

**OPT-1.8 实现无缺陷，不需要修复。** 主理人此前上报的 DEF-E / DEF-F **均为误判，已撤销**。

---

## 第一次判断（错误）

我曾在完成度矩阵中记录：
- DEF-E：「highlights 名额被 bigram 碎片占满，3 条全是同一位置」
- DEF-F：「grouped 未放宽按笔记 ≤2 片，聚合拿不到第 3 片」

## 实测证伪（探针 `.work/probe-1-8-quality.mjs`）

```
=== 命中片数 === 3
[B.md] score=4.45   highlights 条数 = 1
   · 第一篇讲<mark>检索</mark>排序，BM25 打分。 第二篇讲检索召回…
[C.md] score=0.5    highlights 条数 = 1
[C.md] score=0.5    highlights 条数 = 1

C.md 在 hits 中的片数 = 2    C.md 在 grouped 中的片数 = 2
chunkCount = 11  noteCount = 3  grouped 笔记数 = 2
```

### DEF-E 撤销理由

1. 探针里 **A.md 根本不含「检索」二字**（写的是「部署」），它不命中是**正确行为**——是探针数据造错了，不是代码错。
2. highlights 只有 1 条的真实原因（读源码确认）：
   - `lib/vault.js:526` `hlTerms = [...new Set([...uniqLiterals, ...qTokens])].filter(t => t.length >= 2).sort(byLengthDesc).slice(0,16)`
   - `uniqLiterals` 来自 `lib/vault.js:496` 的 `/[\u4e00-\u9fff]{3,}/g` —— **要求 3 个以上汉字**
   - 查询「检索」只有 2 字 → 不进 `uniqLiterals`，只由 `qTokens` 的 bigram 提供
   - 故 `hlTerms = ["检索"]`，**只有 1 项**
   - `lib/vault.js:531-548` `buildHighlights` 对每个 term 只 `lower.indexOf(term)` 取**首次出现**，至多 3 条
   - → 单字词查询必然只有 1 条高亮。这是**数据结构决定的必然结果，不是 bug**。

3. 清单原文（`dsh-obsidian-board-v0.2.3-optimization-items.md:49`）：
   > search 返回 snippet 时附**命中词**列表（qTokens ∩ chunk.tokens），客户端用 `<mark>` 高亮

   要求的是「**命中词**」列表——每个命中词一条，**未**要求「同一词的多次出现各出一条」。当前实现（每个词取首次出现、附 `<mark>`）**忠实符合原文**。

### DEF-F 撤销理由

`lib/vault.js:517-524` 原文：
```js
for (const [idx, score] of ranked) {
    const c = this.chunks[idx];
    const n = perNote.get(c.notePath) || 0;
    if (n >= 2) continue;          // ← 刻意的按笔记分散
    perNote.set(c.notePath, n + 1);
    picked.push([idx, score]);
    if (picked.length >= topK) break;
}
```
紧邻注释（`lib/vault.js:513-514`）已写明设计理由：
> 按笔记分散：单篇最多 2 片进 topK。一篇长笔记的多个 chunk 会把 topK 全占，模型只看到一两篇原文，综合无从谈起；分散后多笔记多视角进入原料。

→ 单篇上限 2 片是**基线既有且正确的设计**，不是 1.8 引入的缺陷。清单里「3 处命中」只是举例式文案，在分散策略下**构造上不可能出现 3 片**。

---

## 对下游（C4 客户端）的结论

1. `highlights` 是「**每个命中查询词一条**」，中文短查询通常 1 条，长查询/多词查询可到 2-3 条。UI 必须按 `highlights.length` 渲染，**不得假设恒为 3**。
2. 同笔记聚合的「N 处命中」应显示 `grouped.notes[i].hits.length`（**实际值，最大 2**），**不得写死 3**，也不得宣称「共 3 处」。
3. `highlights` 内的 `<mark>` 已是**宿主转义过的安全 HTML 片段**（`lib/vault.js:540-542` 用 `escapeHtml`），客户端可直接 `dangerouslySetInnerHTML`，无需二次转义；但**不得**把用户原文未经 escapeHtml 混入。

---

## 教训

「无证据 = 未完成」是双向的：**没有实测证据就不能断定有缺陷**。我此前仅凭读代码结构（`slice(0,3)` + bigram 常识）就推断「碎片占满」，实测后发现连数据都不对。上报缺陷必须以探针输出为准。
