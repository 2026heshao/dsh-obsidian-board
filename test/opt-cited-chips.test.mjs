// §8.3 引用语义：把「召回片段」和「正文真正标了 [n] 的引用」分开。
// 背景：宿主 citations 返回的是全部 topK 召回片段，而系统提示词只要求具体事实挂 [n]
// （结论/观点明确不挂），所以一律叫「引用」就是宣传片挑出的 P0-4 口径毛病。
// 硬约束：判据必须与正文渲染同源（CITED_MARK_RE == renderInline 交替式里的 [n] 组），
// 否则 chips 说是引用、正文点不动 → 分裂口径。本测试用断言把两处字面量锁死。
// 方法：真实求值 helper + 文案表 + MessageCardBase，并用 slot 化 useState 假体驱动重渲染，
// 验证「越界 [n] 点击 → 可见提示 → 有效点击 → 提示消失」这条真实交互链。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

// ── 切片：helper + 文案表 + MessageCardBase（真实执行，不用副本）────
const helperStart = src.indexOf("const CITED_MARK_RE");
const locEnd = src.indexOf("// ── 模型选择", helperStart);
const mcStart = src.indexOf("function MessageCardBase");
const mcEnd = src.indexOf("// C2 模板（切片安全）", mcStart);
t("切片边界可定位", helperStart > 0 && locEnd > helperStart && mcStart > locEnd && mcEnd > mcStart);
const code = src.slice(helperStart, locEnd) + "\n" + src.slice(mcStart, mcEnd);

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c !== null && c !== undefined && c !== false && c !== "") });
// slot 化 useState：setter 立即写回槽位，下次 render 读到新值 → 可测跨渲染的状态链路。
let slots = [];
let slotIdx = 0;
const useState = (init) => {
	const i = slotIdx++;
	if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
	return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }];
};
let capturedMdOptions = null;
const cachedMarkdown = (id, text, options) => {
	capturedMdOptions = options;
	return { type: "div", props: { className: "md-stub" }, children: [String(text || "")] };
};
const ThinkBlock = (props) => h("div", { className: "think-stub" }, props && props.text);

let api;
try {
	const run = new Function("h", "useState", "cachedMarkdown", "ThinkBlock",
		code + "\nreturn { MessageCardBase, citationGroups, citedNumbers, CITED_MARK_RE, UI_TEXT, UI_LANG };")(
		h, useState, cachedMarkdown, ThinkBlock);
	api = run;
	t("helper + 组件可求值", typeof run.MessageCardBase === "function" && typeof run.citationGroups === "function" && typeof run.citedNumbers === "function");
} catch (error) {
	t("helper + 组件可求值", false, String(error && error.stack || error));
	process.exit(1);
}
const { MessageCardBase, citationGroups, citedNumbers, CITED_MARK_RE, UI_TEXT } = api;
const L = UI_TEXT.zh;

// ── 1. 同源判据锁定：CITED_MARK_RE 必须就是 renderInline 的第 5 组 ──
const reLine = src.slice(src.indexOf("\tconst re = /\\[\\[", src.indexOf("function renderInline")));
const citeAlt = reLine.indexOf(CITED_MARK_RE.source);
t("renderInline 的正则里含同一段 [n] 交替（判据同源）", citeAlt > 0, CITED_MARK_RE.source);
// 只数捕获组：`\(` 是字面括号（链接语法的括号），靠后视排除；(?: 非捕获组一并排除。
const capCount = (s) => (s.match(/(?<!\\)\((?!\?)/g) || []).length;
t("该交替位于第 5 组（与 onCite(Number(m[5])) 一致）",
	capCount(reLine.slice(reLine.indexOf("/"), citeAlt)) === 4 && /onCite\(Number\(m\[5\]\)\)/.test(src),
	String(capCount(reLine.slice(0, citeAlt))));

// ── 2. citedNumbers：只认正文里真会被渲染成引用的编号 ───────────────
const setOf = (s) => [...citedNumbers(s)].sort((a, b) => a - b);
t("普通 [n] 计入", setOf("见 [1] 与 [2]，再回看 [1]。").join() === "1,2");
t("代码段里的 [n] 不算引用", setOf("例子 `[3]` 不算").length === 0, setOf("例子 `[3]` 不算").join());
t("wikilink [[1]] 不算引用", setOf("见 [[1]]").length === 0);
t("标准链接 [1](https://x) 不算引用（编号被链接吞掉）", setOf("参考 [1](https://example.com/a)").length === 0);
t("三位数 [123] 不算（与 \\d{1,2} 一致）", setOf("[123]").length === 0);
t("空正文返回空集合", citedNumbers("").size === 0 && citedNumbers(undefined).size === 0);
t("代码段与真编号混排只认真编号", setOf("`[9]` 但 [4] 是真的").join() === "4");

// ── 3. citationGroups：分组 + 按编号去重 ────────────────────────────
const c1 = { n: 1, notePath: "a.md", noteTitle: "A" };
const c2 = { n: 2, notePath: "b.md", noteTitle: "B" };
const c3 = { n: 3, notePath: "c.md", noteTitle: "C" };
const g1 = citationGroups("依据 [1] 和 [3]。", [c1, c2, c3]);
t("被 [n] 标到的进 cited 组", g1.cited.map((c) => c.n).join() === "1,3", JSON.stringify(g1.cited.map((c) => c.n)));
t("召回到但没标的进 snippets 组", g1.snippets.map((c) => c.n).join() === "2");
const gDup = citationGroups("[2] 一次", [c1, c2, { ...c2, notePath: "dup.md" }, null]);
t("同编号重复只留第一条（脏数据不双列）", gDup.cited.length === 1 && gDup.cited[0].notePath === "b.md", JSON.stringify(gDup));
t("分组覆盖全部召回（cited+snippets == 去重后总数，不漏条目）",
	gDup.cited.length + gDup.snippets.length === 2);
t("空 citations / 非数组不抛错", (() => { const g = citationGroups("x", undefined); return g.cited.length === 0 && g.snippets.length === 0; })());

// ── 4. 渲染：分组行 + 标签 + 视觉层级 + 折叠语义 ────────────────────
const kids = (n) => (n && Array.isArray(n.children) ? n.children.filter((c) => c && typeof c === "object" && c.type) : []);
const findAll = (n, predicate, out = []) => {
	if (!n || typeof n !== "object") return out;
	if (n.type && predicate(n)) out.push(n);
	for (const c of kids(n)) findAll(c, predicate, out);
	return out;
};
const textOf = (n) => (Array.isArray(n.children) ? n.children.filter((c) => typeof c === "string").join("") : "");
// chip 的编号在内层 span 里，标题才是直接字符串子节点 → 匹配必须递归取全文。
const fullText = (n) => {
	if (!n || typeof n !== "object") return String(n == null ? "" : n);
	return (Array.isArray(n.children) ? n.children.map(fullText).join("") : "");
};
const openCalls = [];
const render = (m, limit = 12) => {
	slotIdx = 0;
	return MessageCardBase({
		m, isLast: true, saved: false, copied: "", citationLimit: limit,
		openNote: (p) => openCalls.push(p), goWiki: () => {}, saveAnswer: () => {}, retryLast: () => {}, copyAnswer: () => {},
	});
};
const msg = { id: "r1", role: "assistant", content: "结论见 [1]，细节见 [3]。", citations: [c1, c2, c3], provider: "qwen", model: "m" };
const tree = render(msg);
const labels = findAll(tree, (n) => n.type === "span" && /引用|相关片段/.test(textOf(n))).map(textOf);
t("出现「引用 N」组标签（来自文案表，非拼接死串）", labels.includes(L.citeGroupCited + " 2"), JSON.stringify(labels));
t("出现「相关片段 N」组标签", labels.includes(L.citeGroupSnippets + " 1"), JSON.stringify(labels));
const citeChips = findAll(tree, (n) => n.props.className === "ob-cite" && fullText(n).startsWith("[1]"));
t("引用组 chip 不加淡出样式（出处与片段有视觉层级）", citeChips.length === 1 && !citeChips[0].props.style, JSON.stringify(citeChips[0] && citeChips[0].props.style));
const snipChip = findAll(tree, (n) => n.props.className === "ob-cite" && fullText(n).startsWith("[2]"));
t("相关片段 chip 淡出 + tooltip 说明「未标注」",
	snipChip.length === 1 && snipChip[0].props.style && snipChip[0].props.style.opacity && /未用 \[n\] 标注/.test(snipChip[0].props.title), snipChip[0] && snipChip[0].props.title);
t("引用组 chip 的 tooltip 就是笔记路径（不加「未标注」前缀）",
	citeChips.length === 1 && citeChips[0].props.title === "a.md", citeChips[0] && citeChips[0].props.title);
openCalls.length = 0;
citeChips[0] && citeChips[0].props.onClick();
t("chip onClick 真的打开对应笔记（分组不改变可点性）", openCalls[openCalls.length - 1] === "a.md", JSON.stringify(openCalls));

// 引用组不受 citationLimit 折叠影响（折叠出处＝把答案来源藏起来）
const manyCited = { ...msg, content: "[1][2][3]", citations: [c1, c2, c3] };
const folded = render(manyCited, 2);
t("引用组即使超过 citationLimit 也全显", findAll(folded, (n) => n.props.className === "ob-cite" && /^\[\d\]/.test(fullText(n))).length === 3,
	JSON.stringify(findAll(folded, (n) => n.props.className === "ob-cite").map(fullText)));

// 未标注任何编号 → 明说，而不是把召回冒充引用
const bare = render({ ...msg, content: "这是一段没有任何编号的结论。" });
const bareLabels = findAll(bare, (n) => n.type === "span" && /未标注|相关片段/.test(textOf(n))).map(textOf);
t("正文无 [n] 时显示「本条未标注编号引用」", bareLabels.includes(L.citeNoneMarked), JSON.stringify(bareLabels));
t("正文无 [n] 时不出现「引用」组标签（不冒充出处）", !bareLabels.some((s) => s.startsWith(L.citeGroupCited)));
t("正文无 [n] 时全部召回归入相关片段组", bareLabels.includes(L.citeGroupSnippets + " 3"), JSON.stringify(bareLabels));

// ── 5. 越界 [n] 的可见降级（真实交互链，不是字符串断言）────────────
t("cachedMarkdown 收到 onCite（正文 [n] 可点）", typeof (capturedMdOptions && capturedMdOptions.onCite) === "function");
openCalls.length = 0;
capturedMdOptions.onCite(9);
const afterMiss = render(msg);
t("点了召回里没有的编号 → 出现「未找到引用 [9]」",
	findAll(afterMiss, (n) => n.type === "span" && textOf(n) === L.citeMissing + " [9]").length === 1,
	JSON.stringify(findAll(afterMiss, (n) => n.type === "span" && /未找到/.test(textOf(n))).map(textOf)));
t("越界点击不打开右栏（不误跳别篇）", openCalls.length === 0, JSON.stringify(openCalls));
capturedMdOptions.onCite(1);
const afterHit = render(msg);
t("有效编号点击 → 打开原文", openCalls[openCalls.length - 1] === "a.md", JSON.stringify(openCalls));
t("下一次有效点击清掉「未找到引用」提示（不残留）",
	findAll(afterHit, (n) => n.type === "span" && /未找到引用/.test(textOf(n))).length === 0);

// 无 citations 的消息：保持静默（cachedMarkdown 按 id+长度缓存，闭包可能抓到空引用帧，
// 宁可无反应也不误报「未找到引用」）
openCalls.length = 0;
render({ id: "r2", role: "assistant", content: "正文 [5]。", citations: [] });
capturedMdOptions.onCite(5);
const silent = render({ id: "r2", role: "assistant", content: "正文 [5]。", citations: [] });
t("引用为空时点 [n] 不误报「未找到引用」", findAll(silent, (n) => n.type === "span" && /未找到引用/.test(textOf(n))).length === 0);

// ── 6. 导出口径与界面同源（执行 exportChat 里的真实片段）───────────
const expStart = src.indexOf("if (m.role === 'assistant' && (m.citations || []).length) {", src.indexOf("const exportChat = useCallback"));
t("exportChat 内的引用段可定位", expStart > 0);
// 块内语句都是 4 个 tab，第一个「换行 + 3 tab + }」就是这个 if 的收尾括号（含括号一起取，
// 否则搬进 new Function 的是半个块）
const closeTok = "\n\t\t\t}";
const closeIdx = src.indexOf(closeTok, expStart);
const expBlock = src.slice(expStart, closeIdx + closeTok.length);
t("导出段调用 citationGroups（与界面同一判据）", expBlock.includes("citationGroups(m.content, m.citations)"));
t("导出段取到闭合括号（可直接求值）", expBlock.trimEnd().endsWith("}"));
const runExport = (m) => {
	const lines = [];
	new Function("m", "lines", "citationGroups", expBlock)(m, lines, citationGroups);
	return lines;
};
const ex = runExport(msg);
t("导出分节：> 引用 只含正文标到的编号",
	ex.some((l) => l.startsWith("> 引用：[1] a.md；[3] c.md")), JSON.stringify(ex));
t("导出分节：> 相关片段 单列未标注的召回", ex.some((l) => l.startsWith("> 相关片段：[2] b.md")), JSON.stringify(ex));
const exBare = runExport({ role: "assistant", content: "没有编号", citations: [c1, c2] });
t("导出：一条没标时明说未标注，不整列冒充引用",
	exBare.some((l) => l.includes("未标注编号引用")) && !exBare.some((l) => l.startsWith("> 引用：")), JSON.stringify(exBare));

// ── 7. 文案表完整性：中英键集一致 + 新键双语齐全 ───────────────────
const zhKeys = Object.keys(UI_TEXT.zh);
const enKeys = Object.keys(UI_TEXT.en);
t("中英文案表键集完全一致（半迁移=0）",
	zhKeys.length === enKeys.length && zhKeys.every((k) => enKeys.includes(k)),
	JSON.stringify({ onlyZh: zhKeys.filter((k) => !enKeys.includes(k)), onlyEn: enKeys.filter((k) => !zhKeys.includes(k)) }));
t("引用相关键双语齐全", ["citeGroupCited", "citeGroupSnippets", "citeNoneMarked", "citeMissing", "fallbackChip"]
	.every((k) => typeof UI_TEXT.zh[k] === "string" && typeof UI_TEXT.en[k] === "string"));
t("中文标签不再写「N 段」这类插值串（组名走文案表 + 数字）", L.citeGroupCited === "引用" && L.citeGroupSnippets === "相关片段");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
