// 分诊：maxNoteBytes 默认值 vs 探针文件大小；5.1 清单原文范围
import { readFileSync } from "node:fs";

const src = readFileSync("lib/vault.js", "utf8");
const lines = src.split("\n");

console.log("=== maxNoteBytes 相关 ===");
lines.forEach((ln, i) => {
	if (/maxNoteBytes|MAX_NOTE_BYTES/.test(ln)) console.log("  L" + (i + 1) + ": " + ln.trim());
});

const m = src.match(/const DEFAULT_MAX_NOTE_BYTES = ([0-9\s*.]+);/);
if (m) console.log("\nDEFAULT_MAX_NOTE_BYTES 求值 =", Function("return (" + m[1] + ")")());

console.log("\n=== readNote 完整实现 ===");
const ri = lines.findIndex((l) => /readNote\s*\(/.test(l) && !/this\.readNote|\.readNote\(/.test(l));
if (ri >= 0) {
	for (let k = ri; k < Math.min(ri + 40, lines.length); k++) {
		console.log(String(k + 1).padStart(4) + ": " + lines[k]);
		if (k > ri && /^\t\}/.test(lines[k])) break;
	}
}

// 5.1 清单原文
console.log("\n=== 优化清单 5.1 原文 ===");
const doc = readFileSync("../dsh-obsidian-board-v0.2.3-optimization-items.md", "utf8");
const dl = doc.split("\n");
const s = dl.findIndex((l) => /^###\s*5\.1/.test(l));
if (s >= 0) {
	for (let k = s; k < Math.min(s + 14, dl.length); k++) {
		if (k > s && /^###\s/.test(dl[k])) break;
		console.log(dl[k]);
	}
}

// 1.6 清单原文
console.log("\n=== 优化清单 1.6 原文 ===");
const s16 = dl.findIndex((l) => /^###\s*1\.6/.test(l));
if (s16 >= 0) {
	for (let k = s16; k < Math.min(s16 + 12, dl.length); k++) {
		if (k > s16 && /^###\s/.test(dl[k])) break;
		console.log(dl[k]);
	}
}
