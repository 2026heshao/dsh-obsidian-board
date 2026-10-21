// §8.2 回退可视化：宿主 chatPoll.fallback 必须被客户端消费，并在动作条标出「备用通道」。
// 背景：宿主只在「首跳零文本且未被中断」时整段重来（lib/index.js 回退分支），回退成功后
// state.provider/model 已经是新通道——光看模型名分不清主/备用通道，等于把回退过程藏起来。
// 方法：抽出 MessageCardBase + 真实文案表（t 走 UI_TEXT，标签不再靠硬编码字面量断言）
// 真实执行并遍历渲染树；poll 消费段直接执行 send() 里的真实源码片段（不是同构改写）。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

// ── 切片：文案表（含 t）+ MessageCardBase ──────────────────────────
const locStart = src.indexOf("const UI_LANG = 'zh';");
const locEnd = src.indexOf("// ── 模型选择", locStart);
const mcStart = src.indexOf("function MessageCardBase");
const mcEnd = src.indexOf("// C2 模板（切片安全）", mcStart);
t("切片边界可定位", locStart > 0 && locEnd > locStart && mcStart > locEnd && mcEnd > mcStart);
// helpers 段（citedNumbers / citationGroups）：MessageCardBase 引用它，切片必须带上
const helperStart = src.indexOf("const CITED_MARK_RE");
t("引用分组 helper 在文案表之前（可随切片一起求值）", helperStart > 0 && helperStart < locStart);
const code = src.slice(helperStart, locEnd) + "\n" + src.slice(mcStart, mcEnd);

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c !== null && c !== undefined && c !== false && c !== "") });
const useState = (init) => [typeof init === "function" ? init() : init, () => {}];
const cachedMarkdown = (id, text) => ({ type: "div", props: { className: "md-stub" }, children: [String(text || "")] });
const ThinkBlock = (props) => h("div", { className: "think-stub" }, props && props.text);

let MessageCardBase, UI_TEXT;
try {
	const exported = new Function("h", "useState", "cachedMarkdown", "ThinkBlock",
		code + "\nreturn { MessageCardBase, UI_TEXT };");
	const run = exported(h, useState, cachedMarkdown, ThinkBlock);
	MessageCardBase = run.MessageCardBase;
	UI_TEXT = run.UI_TEXT;
	t("组件代码可求值（含真实文案表）", typeof MessageCardBase === "function" && !!UI_TEXT?.zh && !!UI_TEXT?.en);
} catch (error) {
	t("组件代码可求值（含真实文案表）", false, String(error && error.stack || error));
	process.exit(1);
}
const CHIP_LABEL = UI_TEXT.zh.fallbackChip;
t("备用通道标签走文案表（中英均有该键）", typeof CHIP_LABEL === "string" && !!CHIP_LABEL && typeof UI_TEXT.en.fallbackChip === "string", CHIP_LABEL);

const kids = (n) => (n && Array.isArray(n.children) ? n.children.filter((c) => c && typeof c === "object" && c.type) : []);
const findAll = (n, predicate, out = []) => {
	if (!n || typeof n !== "object") return out;
	if (n.type && predicate(n)) out.push(n);
	for (const c of kids(n)) findAll(c, predicate, out);
	return out;
};
const textOf = (n) => (Array.isArray(n.children) ? n.children.filter((c) => typeof c === "string").join("") : "");

const base = {
	id: "r1", role: "assistant", content: "回答正文。", citations: [],
	provider: "qwen", model: "qwen3-max", effort: null, usage: null,
};
const noop = () => {};
const render = (m) => MessageCardBase({
	m, isLast: true, saved: false, copied: "", citationLimit: 12,
	openNote: noop, goWiki: noop, saveAnswer: noop, retryLast: noop, copyAnswer: noop,
});

// 1. 有 fallback → 出现「备用通道」标签，tooltip 说清「丢弃 + 从头生成 + 不拼接」
const withFb = render({ ...base, fallback: { provider: "qwen", model: "qwen3-max" } });
const chips = findAll(withFb, (n) => n.type === "span" && textOf(n) === CHIP_LABEL);
t("回退消息渲染出备用通道标签", chips.length === 1, JSON.stringify(chips.map(textOf)));
const tip = (chips[0] && chips[0].props.title) || "";
t("tooltip 点名真正产出的通道", tip.includes("qwen") && tip.includes("qwen3-max"), tip);
t("tooltip 说清机制：首跳零文本丢弃 / 从头重新生成 / 不拼接",
	tip.includes("首跳没有产出正文") && tip.includes("从头重新生成") && tip.includes("不拼接"), tip);
t("「备用通道」标签挂在动作条（.ob-msg-actions）内，与模型名同级",
	findAll(withFb, (n) => n.props.className === "ob-msg-actions").some((bar) => kids(bar).some((c) => textOf(c) === CHIP_LABEL)));
t("模型名照常显示（备用通道标签是补充，不是替换）", JSON.stringify(withFb).includes("qwen·qwen3-max"));

// 2. 无 fallback（主通道直接成功 / 上一版历史消息）→ 不渲染，且不抛错
const noFb = render({ ...base });
t("未回退时不出现备用通道标签", findAll(noFb, (n) => textOf(n) === CHIP_LABEL).length === 0);
t("历史消息缺 fallback 字段可正常渲染（不抛错、无 undefined）",
	!!noFb && !JSON.stringify(noFb).includes("undefined"));

// 3. 与「已停止」并存时不互相吞掉
const stopped = render({ ...base, stopped: true, fallback: { provider: "qwen", model: "qwen3-max" } });
t("已停止 + 备用通道两个状态标签可共存",
	findAll(stopped, (n) => n.type === "span" && (textOf(n) === CHIP_LABEL || textOf(n) === "（已停止）")).length === 2);

// ── poll 消费段：直接执行 send() 里的真实源码（不写同构副本）────────
const sendStart = src.indexOf("const start = await call('chatStart'");
const sendSlice = src.slice(sendStart, src.indexOf("catch (error) {", sendStart));
t("send() 消费 poll.fallback（宿主 :1384 已下发，客户端此前未读）", sendSlice.includes("poll.fallback"));
const atFallback = sendSlice.indexOf("if (poll.fallback && !fallbackMarked)");
const atDone = sendSlice.indexOf("if (poll.done)");
t("fallback 在 done 收尾之前消费——否则最后一跳带的标记会丢", atFallback > 0 && atDone > atFallback);
t("按 attempt 重置残文的既有逻辑未被破坏", sendSlice.includes("poll.attempt !== activeStream.current.attempt"));

// 把「let fallbackMarked = false」+ 从首个 poll 消费语句到 poll.done 收尾块的真实源码
// 原样搬进循环执行：测的是仓库里的那段代码本身，不是它的改写。
const declStart = sendSlice.indexOf("let fallbackMarked = false;");
const stmtStart = sendSlice.indexOf("if (poll.usage) patchReply", declStart);
const doneStart = sendSlice.indexOf("if (poll.done) {", stmtStart);
const doneEnd = sendSlice.indexOf("}", sendSlice.indexOf("return;", doneStart));
const decl = sendSlice.slice(declStart, sendSlice.indexOf("\n", declStart));
const stmts = sendSlice.slice(stmtStart, doneEnd + 1);
t("真实 poll 片段可定位（含 done 收尾块）", declStart > 0 && stmtStart > declStart && doneStart > stmtStart && stmts.includes("poll.done"));
const runPolls = (polls) => {
	const patches = [];
	try {
		new Function("polls", "patchReply", `${decl}
			for (const poll of polls) {
				${stmts}
			}`)(polls, (p) => patches.push(p));
	} catch (error) {
		fail++;
		console.log("FAIL poll 片段求值", String(error && error.message || error));
	}
	return patches;
};
const fb = { provider: "qwen", model: "qwen3-max" };
const once = runPolls([{ delta: "a" }, { delta: "b", fallback: fb }, { delta: "c", fallback: fb }, { done: true, fallback: fb }]);
t("多轮 poll 带同一 fallback 只 patch 一次（不喂重复重渲染）",
	once.filter((p) => "fallback" in p).length === 1 && once.some((p) => p.fallback === fb), JSON.stringify(once));
const none = runPolls([{ delta: "a" }, { delta: "b" }, { done: true }]);
t("未回退时一条 fallback 都不记", none.filter((p) => "fallback" in p).length === 0, JSON.stringify(none));
const late = runPolls([{ done: true, fallback: fb }]);
t("fallback 只在最后一跳出现时也能记上", late.filter((p) => "fallback" in p).length === 1, JSON.stringify(late));
t("pending 收尾仍由 done 分支负责（fallback 分支不改终态）", late.some((p) => p.pending === false), JSON.stringify(late));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
