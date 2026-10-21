// 回归：composer 输入法合成期回车不发送（中文选词 Enter ≠ 发送）
// 历史 bug：选词确认的 Enter 直接触发 submit()，候选词还没上屏消息就发出去了。
// 守卫双信号：nativeEvent.isComposing（现代浏览器标准）+ keyCode 229
// （Safari / 部分输入法合成期只给 229 不置 isComposing），两个信号缺一不可。
//
// 新版 composer 与宿主 InputBar 同语义：
//   空闲时 Enter 发送；生成中 Enter 入队（submit 内部判断），Shift/Ctrl/Alt/Meta+Enter 换行。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 文本断言：双信号守卫存在且先于 Enter 分支 ────────────────────
t("composer 含 isComposing 守卫与 keyCode 229", /if \(e\.nativeEvent\?\.isComposing \|\| e\.isComposing \|\| e\.keyCode === 229\) return;/.test(client));
t("keyCode 229 兼容信号存在（Safari 合成期）", client.includes("keyCode === 229"));

const anchor = client.indexOf("const onComposerKeyDown = useCallback((e) => {");
const end = client.indexOf("}, [submit]);", anchor);
t("可定位 onComposerKeyDown（composer 输入框专用）", anchor > 0 && end > anchor);
const body = anchor >= 0 && end > anchor
	? client.slice(anchor + "const onComposerKeyDown = useCallback((e) => {".length, end)
	: "";
t("守卫先于 Enter 分支（先拦合成期，再判 Enter）", body.indexOf("isComposing") >= 0 && body.indexOf("isComposing") < body.indexOf("e.key === 'Enter'"));
t("composer textarea 绑定 onKeyDown: onComposerKeyDown", /className: 'ob-composer-input'[\s\S]{0,500}onKeyDown: onComposerKeyDown/.test(client));
t("composer textarea 绑定 onChange 写 draft", /onChange: \(e\) => setDraft\(e\.target\.value\)/.test(client));
t("textarea 随 draft 自动增高（36–200px）", /Math\.min\(el\.scrollHeight \|\| 36, 200\)/.test(client));

// 真实执行 handler 体（与 client.js 同源）
const handler = body ? new Function("e", "submit", body) : () => {};
const runKey = (ev, submit = () => {}) => {
	let sent = 0, prevented = 0;
	const event = {
		shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
		keyCode: 13, key: "Enter",
		nativeEvent: { isComposing: false },
		preventDefault: () => { prevented++; },
		...ev,
	};
	handler(event, () => { sent++; });
	return { sent, prevented };
};

t("行为：合成期 Enter（isComposing）不发送、不 preventDefault", (() => { const r = runKey({ nativeEvent: { isComposing: true } }); return r.sent === 0 && r.prevented === 0; })());
t("行为：合成期 Enter（e.isComposing 顶层信号）不发送", (() => { const r = runKey({ isComposing: true }); return r.sent === 0 && r.prevented === 0; })());
t("行为：合成期 Enter（keyCode 229）不发送", (() => { const r = runKey({ keyCode: 229 }); return r.sent === 0 && r.prevented === 0; })());
t("行为：普通 Enter 触发提交并阻止默认换行", (() => { const r = runKey({}); return r.sent === 1 && r.prevented === 1; })());
t("行为：Shift+Enter 不提交（保留换行）", (() => { const r = runKey({ shiftKey: true }); return r.sent === 0 && r.prevented === 0; })());
t("行为：Ctrl+Enter 不提交（允许宿主快捷键）", (() => { const r = runKey({ ctrlKey: true }); return r.sent === 0 && r.prevented === 0; })());
t("行为：Alt/Meta+Enter 不提交", (() => { const r = runKey({ altKey: true }); const m = runKey({ metaKey: true }); return r.sent === 0 && m.sent === 0; })());
t("行为：非 Enter 键不提交、不阻止默认", (() => { const r = runKey({ key: 'a', keyCode: 65 }); return r.sent === 0 && r.prevented === 0; })());

// ── 2. 提交语义：空闲发送 / 生成中入队 ──────────────────────────────
// submit 的决策是「读 draft + busyRef」的薄封装，直接抽取执行。
const subStart = client.indexOf("const submit = useCallback(() => {");
const subEnd = client.indexOf("}, [draft, enqueue, send]);", subStart);
const subBody = subStart >= 0 && subEnd > subStart
	? client.slice(subStart + "const submit = useCallback(() => {".length, subEnd)
	: "";
const runSubmit = (draft, busy, spy) => new Function(
	"draft", "busyRef", "enqueue", "send", "textareaRef", subBody,
)(draft, { current: busy }, spy.enqueue, spy.send, spy.textareaRef || { current: null });

t("submit：空草稿直接返回（空白不入队）", (() => {
	let calls = 0;
	runSubmit('   \n  ', false, { enqueue: () => calls++, send: () => calls++ });
	return calls === 0;
})());
t("submit：空闲时直接发送（不入队）", (() => {
	const spy = { enq: 0, snd: 0 };
	runSubmit('问题', false, { enqueue: () => spy.enq++, send: () => spy.snd++ });
	return spy.snd === 1 && spy.enq === 0;
})());
t("submit：生成中入队（不打断当前回答）", (() => {
	const spy = { enq: 0, snd: 0 };
	runSubmit('下一问', true, { enqueue: () => spy.enq++, send: () => spy.snd++ });
	return spy.enq === 1 && spy.snd === 0;
})());
t("submit：空白草稿不发送（trim 后为空即返回）", (() => {
	let calls = 0;
	runSubmit('  问题  ', false, { enqueue: () => {}, send: () => { calls++; } });
	return calls === 1;
})());
t("submit：入队文本去掉首尾空白", (() => {
	let seen = '';
	runSubmit('\n  下一问\t', true, { enqueue: (q) => { seen = q; }, send: () => {} });
	return seen === '下一问';
})());
t("submit：提交后焦点还给输入框（下一次 Enter 不会误触停止）", (() => {
	let focused = 0;
	runSubmit('问题', false, { enqueue: () => {}, send: () => {}, textareaRef: { current: { focus: () => { focused++; } } } });
	return focused === 1;
})());
t("submit：生成中入队也保持焦点在输入框", (() => {
	let focused = 0;
	runSubmit('排队', true, { enqueue: () => {}, send: () => {}, textareaRef: { current: { focus: () => { focused++; } } } });
	return focused === 1;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
