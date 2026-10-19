# 优化清单未收录的缺陷（主理人独立勘定）

> 来源：分批实施期间主理人以「真执行」方式核验已落地的优化项时顺带发现。
> 处理原则：**先记录、不擅自扩大本轮范围**。仅在与其直接相邻的批次已获授权、且修复不增加风险时才顺带处理；否则列入下一轮。

---

## DEF-A `extractAliases` 解析缺陷（vault.js，基线既有）

**证据**：`lib/vault.js:96-101` 的 `extractAliases` 与 `git show HEAD:lib/vault.js:57-62` **逐字节相同** → 非本次改动引入。

```js
function extractAliases(frontmatter) {
	if (!frontmatter) return [];
	const m = frontmatter.match(/(^|\n)\s*aliases\s*:\s*([^\n]+)/);
	if (!m) return [];
	return [...m[2].matchAll(/[\w\u4e00-\u9fff][^,，]*/g)].map((x) => x[0].trim()).filter(Boolean);
}
```

两个缺陷：

| 输入 | 期望 | 实际 |
|---|---|---|
| `aliases:\n  - 别名一\n  - 别名二`（块列表） | `["别名一","别名二"]` | `["别名一"]` —— `[^\n]+` 只取一行 |
| `aliases: [甲, 乙, 丙]`（行内） | `["甲","乙","丙"]` | `["甲","乙","丙]"]` —— 尾随 `]` 未被剥掉 |

**影响**：块列表写法（Obsidian 官方推荐格式之一）丢失除首条外的全部别名；行内写法最后一条带 `]` 污染。

---

## DEF-B `aliases` 完全不参与检索（vault.js，基线既有）

**证据**：`aliases` 在 `lib/vault.js` 只出现 5 处——
- `L96-101` `extractAliases` 定义
- `L278` `byNote` 结构注释
- `L364` `aliases: extractAliases(frontmatter)` 存入 note
- `L605` `aliases: n.aliases` 从 `listNotes` 返回（**仅展示**）

**真执行验证**：建一篇 `aliases: [阿尔法别名, 贝塔别名]` 的笔记，检索 `阿尔法别名` / `贝塔别名` / `贝塔别名]` → **三次全部 0 命中**。

**影响**：Obsidian 的核心用法「用别名指代笔记」在本插件中无效。用户搜笔记的另一个名字找不到。这是检索召回的真实缺口，严重度中等（用户会认为「别名功能坏了」）。

**可能修复方向**（下一轮）：
1. 修 `extractAliases` 支持块列表 + 剥离 `[]`。
2. 在 `_indexFile` 构造 `boost` 串时把 `aliases.join(" ")` 拼进去（与 `title`/`crumbs` 同权或略低），使别名命中也参与 BM25 打分。
3. 可选：`listNotes` 的 `search` 命中判定加一条「查询词全等于任一 alias → 直接给高分」。

---

## DEF-C `cordis.patch.yml` 缺 `historyLimit` / `reasoningEffort`（基线既有）

`cordis.patch.yml` 只列 6 键（`vaultPath`/`provider`/`model`/`topK`/`chunkLimit`/`systemPrompt`），而 `lib/index.js` 的 `Config` 声明了 `historyLimit`（默认 24）与 `reasoningEffort`（默认 `"high"`）。

**影响**：不是 bug —— 该文件惯例是「只列常用键」，不在此列的键走 `Config` 默认值。但用户若想在 patch 里改这两项会因未知键被忽略。

**处理**：7.2 的 README 必须写明「配置以 `lib/index.js` 的 `Config` 为准，`cordis.patch.yml` 只示范常用键」。

---

## DEF-D `package.json` 的 `description` 误报（已撤销）

早期用 PowerShell 看 `description` 以为含 mojibake `鈥?`。node 逐码点检查后确认只有 `U+2014`（em dash），**无 mojibake**。已撤销。

---

## DEF-E OPT-1.8 的 highlights 名额被 bigram 碎片占满（本轮实现内，属质量问题）

**证据**（`lib/vault.js` 的 `buildHighlights`，`hlTerms` 由 `[...new Set([...uniqLiterals, ...qTokens])]` 按长度降序取前 16 条）：

真执行，查询 `关键词`、命中文本 `关键词 也在这里。`：

```json
["<mark>关键词</mark> 也在这里。", "<mark>关键</mark>词 也在这里。", "关<mark>键词</mark> 也在这里。"]
```

三条全是**同一个字符位置**的三种切分。中文 bigram 分词把 `关键词` 拆成 `关键` + `键词`，两者都进了 `hlTerms`，于是 `out.length >= 3` 的名额被同一处耗光。

**影响**：正文里有 5 处匹配时，界面只高亮 1 处。用户感知是「高亮不准/漏高亮」。不崩溃，但功能打折。

**修复方向**（下一轮，改动很小）：`buildHighlights` 收集时按命中**起止区间**去重 —— 若新区间被已收集区间包含或完全重叠，跳过；只有位置真正不同才占名额。或者更简单：`hlTerms` 里剔除所有被更长 term 包含的短 term（`关键词` 存在时丢掉 `关键`/`键词`）。

---

## DEF-F OPT-1.8 的 `grouped` 未放宽「按笔记 ≤2 片」限制（本轮实现内，待确认是否算缺陷）

**证据**：`groupByNote: true` 时，`multi.md` 有 3 个章节都命中 `关键词`，但 `grouped.notes[].hits` 只有 **2** 条。

原因：`search` 里按笔记 ≤2 片的分散限制发生在 `picked` 阶段，`grouped` 是对**已截断的 `hits`** 再分组，所以聚合只是「把剩下的片子归类」，没有把被截断的片子找回来。

**影响**：表面看 `grouped` 存在，但内容并不比 `hits` 多。若用途是「点开一篇笔记看它所有相关片段」，则拿不到第 3 片。

**待确认**：优化清单 1.8 原文只说「按笔记聚合」，未明确要求放宽分散限制。**可能是设计选择而非缺陷**。留待与需求方确认，本轮不改。

