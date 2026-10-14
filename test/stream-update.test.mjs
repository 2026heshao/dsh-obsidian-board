// 回归：流式消息更新必须按稳定 id 定位，而非 pending 标志
// 历史 bug：delta 追加与状态补丁各自 setMessages，都按 pending 匹配；
// 两条更新交错时会命中错目标或落空 → 已渲染文本丢失（用户看到「闪一下变空」）。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

// 1. 结构断言：send() 内不再有按 pending 匹配的 patchPending
t("不再存在 patchPending（按 pending 匹配的反模式）", !src.includes("const patchPending"));
t("使用稳定 replyId 定位回复", src.includes("const replyId = 'r' + Date.now()"));
t("patchReply 按 id 查找", /findIndex\(\(m\) => m && m\.id === replyId\)/.test(src));
t("appendDelta 按 id 追加", /const appendDelta = \(delta\) => setMessages/.test(src));
t("每条回复带 id 入列", /\{ id: replyId, role: 'assistant', content: '', pending: true \}/.test(src));
t("找不到目标时保持引用不变（避免无谓重渲染）", src.includes("if (idx < 0) return prev;"));

// 2. 行为断言：模拟 id 定位逻辑（与 client.js 同构）
const makeMatcher = (replyId) => ({
	patch: (prev, patch) => {
		const idx = prev.findIndex((m) => m && m.id === replyId);
		if (idx < 0) return prev;
		const next = prev.slice();
		next[idx] = { ...next[idx], ...patch };
		return next;
	},
	append: (prev, delta) => {
		const idx = prev.findIndex((m) => m && m.id === replyId);
		if (idx < 0) return prev;
		const next = prev.slice();
		next[idx] = { ...next[idx], content: (next[idx].content || '') + delta };
		return next;
	},
});

const rid = "r-test-1";
const m = makeMatcher(rid);
let state = [
	{ role: "user", content: "问题" },
	{ id: rid, role: "assistant", content: "", pending: true },
];

// 场景 A：delta 先到，pending 补丁后到（旧实现下 delta 会丢）
state = m.append(state, "第一段。");
state = m.patch(state, { pending: false });
state = m.append(state, "第二段。"); // pending 已是 false——旧实现会落空
t("A: pending 转 false 后仍能追加增量", state[1].content === "第一段。第二段。", JSON.stringify(state[1]));

// 场景 B：并发交错 —— 用「先取快照再各自计算」模拟 React 批处理下的陈旧快照
const snap = state.map((x) => ({ ...x }));
const afterA = m.append(snap, "[A]");
const afterB = m.patch(snap, { usage: { input: 1, output: 2 } });
t("B: 两条更新都按 id 命中同一条消息", afterA[1].content.includes("[A]") && afterB[1].usage.output === 2);

// 场景 C：目标消息已被删除（清空对话）→ 不抛错、引用不变
const gone = [{ role: "user", content: "只剩余提问" }];
const r = m.append(gone, "x");
t("C: 目标不存在时不抛错且数组引用不变", r === gone);

// 场景 D：多个 assistant 消息时不会错写到最后一条
const multi = [
	{ id: "old", role: "assistant", content: "旧回答", pending: false },
	{ role: "user", content: "新问题" },
	{ id: rid, role: "assistant", content: "", pending: true },
];
const after = m.append(multi, "新内容");
t("D: 精确写入目标消息而非末尾", after[2].content === "新内容" && after[0].content === "旧回答");

// 3. 空回复守卫
t("空回复有可见提示（不再留空壳气泡）", src.includes("（模型没有输出内容）"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
