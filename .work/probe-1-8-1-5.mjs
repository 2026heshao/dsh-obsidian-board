// OPT-1.8 核验：search 的命中词高亮 + 按笔记聚合；snip 截断是否仍 500
// OPT-1.5 核验：watch() 默认不启用、可显式启用、变更后索引能自动跟上
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync("lib/vault.js", "utf8");
const { VaultIndex } = await import("../lib/vault.js");

// ── 静态：1.8 相关实现点
console.log("=== OPT-1.8 实现点（静态）===");
src.split("\n").forEach((ln, i) => {
	if (/OPT-1\.8|groupByNote|highlight|tokens:/.test(ln)) console.log("  L" + (i + 1) + ": " + ln.trim().slice(0, 120));
});

// ── 静态：1.5 相关实现点
console.log("\n=== OPT-1.5 实现点（静态）===");
src.split("\n").forEach((ln, i) => {
	if (/OPT-1\.5|async watch|watchError|watching|fs\.watch|node:fs["']?\s*;|watch\(/.test(ln)) console.log("  L" + (i + 1) + ": " + ln.trim().slice(0, 120));
});

// ── 真行为：1.8
const root = await mkdtemp(join(tmpdir(), "ob-group-"));
try {
	await mkdir(join(root, "sub"), { recursive: true });
	// 一篇长笔记，多个章节都出现同一关键词 → 应按笔记聚合
	const longBody = ["# 主题一", "关键词 出现一次。" , "", "## 主题二", "关键词 又出现。", "", "### 主题三", "关键词 第三次。", ""].join("\n");
	await writeFile(join(root, "multi.md"), longBody, "utf8");
	await writeFile(join(root, "other.md"), "# 别的\n关键词 也在这里。\n", "utf8");
	await writeFile(join(root, "none.md"), "# 无关\n完全没有。\n", "utf8");

	const idx = new VaultIndex();
	await idx.ensureIndexed(root);

	console.log("\n=== OPT-1.8 默认（不聚合）===");
	const plain = idx.search("关键词", { topK: 10 });
	console.log("  hits = " + plain.hits.length);
	plain.hits.forEach((h) => console.log("   " + h.notePath + "  heading=" + JSON.stringify(h.heading) + "  score=" + h.score));
	const multiCount = plain.hits.filter((h) => h.notePath === "multi.md").length;
	console.log("  multi.md 命中片数 = " + multiCount + "（缺省按笔记 ≤2 片）");

	console.log("\n=== OPT-1.8 groupByNote=true ===");
	const grouped = idx.search("关键词", { topK: 10, groupByNote: true });
	console.log("  返回键: " + Object.keys(grouped).join(", "));
	console.log("  hits = " + (grouped.hits || []).length);
	(grouped.hits || []).forEach((h) => {
		console.log("   " + h.notePath + "  score=" + h.score + "  tokens=" + JSON.stringify(h.tokens) + "  聚合数=" + (h.chunkCount ?? h.count ?? "-"));
	});
	console.log("  notes 数组: " + (Array.isArray(grouped.notes) ? grouped.notes.length + " 项" : "无"));

	// tokens 必须 ⊆ 查询词
	const q = "关键词";
	let tokOk = true;
	(grouped.hits || []).forEach((h) => {
		(h.tokens || []).forEach((t) => {
			if (!q.includes(t) && !t.includes(q)) tokOk = false;
		});
	});
	console.log("  tokens 均为查询词子集 :", tokOk ? "是（正确）" : "否（缺陷）");

	// 高亮：snippet 里应含标记
	const anyHl = (grouped.hits || []).some((h) => /<mark>|\[\[|\*\*|\u0002/.test(String(h.snippet || "")));
	console.log("  snippet 含高亮标记 :", anyHl ? "是" : "否（若清单要求高亮则缺陷）");
	console.log("  样例 snippet: " + JSON.stringify(String((grouped.hits || [])[0]?.snippet || "").slice(0, 120)));

	// ── 真行为：1.5 watch
	console.log("\n=== OPT-1.5 watch ===");
	const st0 = idx.status();
	console.log("  初始 watching = " + st0.watching + "  watchError = " + JSON.stringify(st0.watchError));
	if (st0.watching !== false) {
		console.log("  判定: 默认不应开启监听 ← 缺陷");
	} else {
		console.log("  判定: 默认关闭（正确）");
	}

	const w = await idx.watch(root);
	console.log("  watch() 返回 = " + JSON.stringify(w));
	const st1 = idx.status();
	console.log("  开启后 watching = " + st1.watching);

	// 新增一篇笔记，等待防抖后看索引是否自动跟上
	await writeFile(join(root, "brandnew.md"), "# 新笔记\n自动索引探针。\n", "utf8");
	await new Promise((r) => setTimeout(r, 1500));
	const st2 = idx.status();
	console.log("  新增文件后 noteCount = " + st2.noteCount + "（原 " + st0.noteCount + "）");
	console.log("  自动索引生效 :", st2.noteCount > st0.noteCount ? "是（正确）" : "否（可能需更长防抖，或未生效）");

	// 清理监听
	if (typeof idx.unwatch === "function") {
		await idx.unwatch();
		console.log("  unwatch() 存在，已清理");
	} else {
		const st3 = idx.status();
		if (st3.watcher && typeof st3.watcher.close === "function") st3.watcher.close();
		console.log("  无 unwatch()，status 暴露字段: " + Object.keys(st3).join(","));
	}
} finally {
	await rm(root, { recursive: true, force: true });
	process.exit(0);
}
