// 主理人一次性核实架构师待明确项 Q4/Q5/Q7/Q11/Q12
import { readFileSync, readdirSync } from "node:fs";

const d = "test/";
const files = readdirSync(d).filter((f) => f.endsWith(".mjs"));

console.log("=== Q4/Q11: 各测试对 index.js 的切片锚点 ===");
for (const f of files) {
	const t = readFileSync(d + f, "utf8");
	if (!t.includes("index.js")) continue;
	const anchors = [...t.matchAll(/indexOf\(\s*["'`]([^"'`]{0,70})["'`]/g)].map((m) => m[1]);
	const slices = [...t.matchAll(/slice\(\s*[a-zA-Z]+,\s*[a-zA-Z]+\)/g)].map((m) => m[0]);
	if (anchors.length || slices.length) {
		console.log(" " + f);
		if (anchors.length) console.log("    indexOf -> " + JSON.stringify(anchors));
	}
}

console.log("");
console.log("=== Q5/Q6: Config 与 listNotes 在测试中的出现 ===");
for (const f of files) {
	const t = readFileSync(d + f, "utf8");
	const lines = t.split("\n");
	lines.forEach((l, i) => {
		if (/\bConfig\b|listNotes|total\b/.test(l)) console.log("  " + f + ":" + (i + 1) + ": " + l.trim().slice(0, 150));
	});
}

console.log("");
console.log("=== Q7: 测试是否引用非流式 chat / chatStart ===");
const CHAT = '"chat"';
for (const f of files) {
	const t = readFileSync(d + f, "utf8");
	const plain = [...t.matchAll(/["'`]chat["'`]/g)].length;
	const start = [...t.matchAll(/["'`]chatStart["'`]/g)].length;
	const poll = [...t.matchAll(/["'`]chatPoll["'`]/g)].length;
	if (plain || start || poll) console.log("  " + f + "  chat=" + plain + " chatStart=" + start + " chatPoll=" + poll);
}

console.log("");
console.log("=== Q12: client 是否读 locale/*.json ===");
const c = readFileSync("lib/client.js", "utf8");
for (const kw of ["locale", "i18n", ".json", "I18N", "zh.json"]) {
	console.log("  client.js 含 " + kw + ": " + c.includes(kw));
}

console.log("");
console.log("=== Q8: strictCodec 是否拒绝未知字段 ===");
const idx = c.indexOf("function strictCodec");
console.log(c.slice(idx - 700, idx + 500));
