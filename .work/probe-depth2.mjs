// 确认 DEFAULT_MAX_DEPTH 的实际值，并验证 scanVault 的行为等价性（真执行）
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const cur = readFileSync("lib/vault.js", "utf8");

// 1) 常量值
const m = cur.match(/const DEFAULT_MAX_DEPTH = ([0-9\s*.]+);/);
console.log("DEFAULT_MAX_DEPTH 定义 :", m ? m[1].trim() : "未找到");
if (m) {
	const v = Function("return (" + m[1] + ")")();
	console.log("DEFAULT_MAX_DEPTH 求值 :", v, v === 12 ? "  <-- 与基线 depth > 12 一致 OK" : "  <-- 与基线 12 不一致 DIFF");
}

// 2) scanVault 完整签名（第一个 { 之后的解构）
const sig = cur.match(/export async function scanVault\(([\s\S]{0,500}?)\)\s*\{/);
console.log("\nscanVault 形参原文:");
console.log(sig ? sig[1] : "（未匹配）");

// 3) options 传递链：scanVault 如何把 opts 传给 walk
const walkCall = cur.match(/await walk\([^)]*\)/g);
console.log("\nwalk 调用点:");
(walkCall || []).forEach((s) => console.log("  " + s));

// 4) 深度判断行
const dl = cur.split("\n").find((l) => /depth\s*>\s*maxDepth/.test(l));
console.log("\n深度判断行:", dl ? dl.trim() : "（未找到）");

// 5) 真执行：建一棵 14 层深的临时目录，确认 depth 13/14 的文件不被收录（与基线 depth>12 行为一致）
const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { scanVault } = await import("./lib/vault.js");

const root = await mkdtemp(join(tmpdir(), "ob-depth-"));
try {
	// 在深度 0..14 各放一个 md
	for (let d = 0; d <= 14; d++) {
		let dir = root;
		for (let i = 0; i < d; i++) dir = join(dir, "d" + i);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "note" + d + ".md"), "# d" + d + "\n");
	}
	const files = await scanVault(root);
	const depths = files.map((f) => {
		const rel = f.slice(root.length + 1);
		return rel.split("\\").length - 1;
	});
	depths.sort((a, b) => a - b);
	console.log("\n=== 真执行 scanVault 深度采样 ===");
	console.log("  收录文件数 :", files.length);
	console.log("  各自深度   :", depths.join(","));
	const maxD = depths[depths.length - 1];
	console.log("  最大收录深度 :", maxD, maxD === 12 ? "  <-- 与基线 depth>12 语义一致 OK" : "  <-- 需复核");
} finally {
	await rm(root, { recursive: true, force: true });
}
