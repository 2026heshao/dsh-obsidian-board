// 查证 scanVault 内部 opts 的来源，确认 maxDepth 是否真的可注入且不会 ReferenceError
import { readFileSync } from "node:fs";

const src = readFileSync("lib/vault.js", "utf8");
const lines = src.split("\n");

console.log("=== vault.js L178-200 原文 ===");
for (let i = 177; i < 200; i++) console.log(String(i + 1).padStart(4) + ": " + lines[i]);

console.log("");
console.log("=== 所有 opts 出现位置 ===");
lines.forEach((ln, i) => {
	if (/\bopts\b/.test(ln)) console.log("  L" + (i + 1) + ": " + ln.trim());
});

// 真执行验证：默认调用 + 显式低深度调用
console.log("");
console.log("=== 真执行 ===");
const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { scanVault } = await import("../lib/vault.js");

const root = await mkdtemp(join(tmpdir(), "ob-depth-"));
try {
	for (let d = 0; d <= 14; d++) {
		let dir = root;
		for (let i = 0; i < d; i++) dir = join(dir, "d" + i);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "note" + d + ".md"), "# d" + d + "\n");
	}
	const depthOf = (f) => f.slice(root.length + 1).split("\\").length - 1;

	const def = (await scanVault(root)).map(depthOf).sort((a, b) => a - b);
	console.log("  默认调用     : 收录", def.length, "个，最大深度", def.length ? def[def.length - 1] : "-");

	let low = null;
	try {
		low = (await scanVault(root, { maxDepth: 3 })).map(depthOf).sort((a, b) => a - b);
		console.log("  maxDepth:3   : 收录", low.length, "个，最大深度", low.length ? low[low.length - 1] : "-");
	} catch (e) {
		console.log("  maxDepth:3   : 抛错 ->", e.message);
	}

	console.log("");
	console.log("  判定：");
	console.log("    默认最大深度应为 12 :", def.length && def[def.length - 1] === 12 ? "OK" : "DIFF");
	console.log("    显式 maxDepth 生效   :", low && low.length && low[low.length - 1] === 3 ? "OK" : "DIFF/不支持");
} finally {
	await rm(root, { recursive: true, force: true });
}
