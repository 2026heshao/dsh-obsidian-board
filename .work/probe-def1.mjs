// 核实 DEF-1：package.json description 是否含 mojibake
import { readFileSync } from "node:fs";

const raw = readFileSync("package.json", "utf8");
const pkg = JSON.parse(raw);
const d = pkg.description || "";
console.log("description 原文 :", JSON.stringify(d));
console.log("码点序列         :");
for (const ch of d) {
	const cp = ch.codePointAt(0);
	if (cp > 0x7e) console.log("  U+" + cp.toString(16).toUpperCase().padStart(4, "0") + "  " + JSON.stringify(ch));
}
// 判定是否存在 U+9225 系（GBK 误解 UTF-8 em dash 的典型残留）
const bad = /[\u9225\u9226\u9286\u93c8\u9510\u6d60\u6d93\u93af\u7ee0]/.test(d);
console.log("含 mojibake 特征 :", bad);
// 期望：description 应为纯 ASCII + 正常标点
