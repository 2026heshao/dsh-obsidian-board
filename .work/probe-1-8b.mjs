// OPT-1.8 精确核验：顶层 grouped 结构 + highlights 字段内容
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const src = readFileSync("lib/vault.js", "utf8");
const lines = src.split("\n");

console.log("=== buildHighlights 实现 ===");
const bi = lines.findIndex((l) => /function buildHighlights/.test(l));
if (bi >= 0) {
	for (let k = bi; k < Math.min(bi + 30, lines.length); k++) {
		console.log(String(k + 1).padStart(4) + ": " + lines[k]);
		if (k > bi && /^\}/.test(lines[k])) break;
	}
}

console.log("\n=== grouped 构造（L560-580）===");
for (let k = 559; k < 585 && k < lines.length; k++) console.log(String(k + 1).padStart(4) + ": " + lines[k]);

const { VaultIndex } = await import("../lib/vault.js");

const root = await mkdtemp(join(tmpdir(), "ob-g2-"));
try {
	await mkdir(join(root, "sub"), { recursive: true });
	const longBody = ["# 主题一", "关键词 出现一次。", "", "## 主题二", "关键词 又出现。", "", "### 主题三", "关键词 第三次。", ""].join("\n");
	await writeFile(join(root, "multi.md"), longBody, "utf8");
	await writeFile(join(root, "other.md"), "# 别的\n关键词 也在这里。\n", "utf8");
	await writeFile(join(root, "none.md"), "# 无关\n完全没有。\n", "utf8");

	const idx = new VaultIndex();
	await idx.ensureIndexed(root);

	const g = idx.search("关键词", { topK: 10, groupByNote: true });
	console.log("\n=== groupByNote=true 完整结构 ===");
	console.log("  顶层键: " + Object.keys(g).join(", "));
	console.log("  grouped: " + JSON.stringify(g.grouped, null, 2).split("\n").join("\n  "));

	console.log("\n=== 单片结构（第 0 条 hit 的全部键）===");
	const h = g.hits[0];
	console.log("  键: " + Object.keys(h).join(", "));
	console.log("  highlights = " + JSON.stringify(h.highlights));
	console.log("  snippet    = " + JSON.stringify(String(h.snippet).slice(0, 100)));

	// 判定
	const hasGrouped = g.grouped && Array.isArray(g.grouped.notes);
	const notes = hasGrouped ? g.grouped.notes : [];
	console.log("\n=== 判定 ===");
	console.log("  grouped.notes 存在     :", hasGrouped ? "是（" + notes.length + " 篇）" : "否");
	notes.forEach((n) => console.log("    " + (n.notePath || n.path) + "  count=" + (n.count ?? n.chunkCount ?? n.hits?.length ?? "-")));

	// 聚合正确性：multi.md 应有 3 片（若分散限制在聚合模式下被放宽）
	const multi = notes.find((n) => (n.notePath || n.path) === "multi.md");
	console.log("  multi.md 聚合片数 = " + (multi ? (multi.count ?? multi.chunkCount ?? multi.hits?.length ?? "-") : "未找到"));
	console.log("  （缺省非聚合模式下 multi.md 仅 2 片，聚合模式下应能看到全部 3 片）");

	const hl = g.hits[0].highlights;
	console.log("  highlights 是数组 :", Array.isArray(hl) ? "是（" + hl.length + " 条）" : "否");
	console.log("  highlights 含查询词:", Array.isArray(hl) && hl.every((s) => String(s).includes("关键词")) ? "是（正确）" : "否/部分");
	console.log("  样例 highlights   :", JSON.stringify(hl));

	const pass = hasGrouped && notes.length >= 2 && Array.isArray(hl) && hl.length > 0;
	console.log("\nOPT-1.8 总判定 :", pass ? "PASS" : "FAIL");
	process.exitCode = pass ? 0 : 1;
} finally {
	await rm(root, { recursive: true, force: true });
}
