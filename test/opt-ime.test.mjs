// OPT-3.2 回归：composer 输入法合成期回车不发送（中文选词 Enter ≠ 发送）
// 历史 bug：选词确认的 Enter 直接触发 send()，候选词还没上屏消息就发出去了。
// 守卫双信号：nativeEvent.isComposing（现代浏览器标准）+ keyCode 229
// （Safari / 部分输入法合成期只给 229 不置 isComposing），两个信号缺一不可。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 文本断言：双信号守卫存在且在 Enter 处理之前 ──────────────────
t("composer onKeyDown 含 isComposing 守卫与 keyCode 229", /if \(e\.nativeEvent\?\.isComposing \|\| e\.keyCode === 229\) return;/.test(client));
t("keyCode 229 兼容信号存在（Safari 合成期）", client.includes("keyCode === 229"));
const composerIdx = client.indexOf("onChange: (e) => setDraft(e.target.value)"); // composer textarea 唯一锚点（源码行尾是逗号）
const keyIdx = composerIdx >= 0 ? client.indexOf("onKeyDown: (e) => {", composerIdx) : -1;
t("守卫挂在 composer 输入框的 onKeyDown 上", keyIdx > composerIdx && composerIdx >= 0);
const bodyMatch = keyIdx > 0
	? client.slice(keyIdx).match(/onKeyDown: \(e\) => \{([\s\S]*?)\n\t+\},\n\t+disabled: busy,/)
	: null;
t("可抽取 onKeyDown 回调体", !!bodyMatch);
t("守卫先于 Enter 分支（先拦合成期，再判 Enter）", !!bodyMatch && bodyMatch[1].indexOf("isComposing") < bodyMatch[1].indexOf("e.key === 'Enter'"));
const handler = bodyMatch ? new Function("e", "send", bodyMatch[1]) : () => {};

const runKey = (ev) => {
	let sent = false, prevented = false;
	handler({
		shiftKey: false, ctrlKey: false, altKey: false, keyCode: 13, key: "Enter",
		nativeEvent: { isComposing: false }, preventDefault: () => { prevented = true; },
		...ev,
	}, () => { sent = true; });
	return { sent, prevented };
};

t("行为：合成期 Enter（isComposing）不发送、不 preventDefault", (() => { const r = runKey({ nativeEvent: { isComposing: true } }); return !r.sent && !r.prevented; })());
t("行为：合成期 Enter（keyCode 229）不发送", (() => { const r = runKey({ keyCode: 229 }); return !r.sent && !r.prevented; })());
t("行为：普通 Enter 发送且阻止默认换行", (() => { const r = runKey({}); return r.sent && r.prevented; })());
t("行为：Shift+Enter 不发送（保留换行）", (() => { const r = runKey({ shiftKey: true }); return !r.sent && !r.prevented; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
