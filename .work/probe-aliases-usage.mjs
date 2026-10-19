// 查证 aliases 的实际用途：是否参与检索加权/别名召回
import { readFileSync } from "node:fs";

const src = readFileSync("lib/vault.js", "utf8");
const lines = src.split("\n");

console.log("=== 所有 aliases 出现点 ===");
lines.forEach((ln, i) => {
	if (/aliases/i.test(ln)) console.log("  L" + (i + 1) + ": " + ln.trim().slice(0, 130));
});

// 真执行：别名是否能召回到笔记
const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { VaultIndex } = await import("../lib/vault.js");

const body = ["---", "aliases: [阿尔法别名, 贝塔别名]", "---", "", "# 正文", "", "这是一篇讲数据库索引的笔记。"].join("\n");

const root = await mkdtemp(join(tmpdir(), "ob-alias-use-"));
try {
	await writeFile(join(root, "n.md"), body, "utf8");
	const idx = new VaultIndex();
	await idx.ensureIndexed(root);

	for (const q of ["阿尔法别名", "贝塔别名", "贝塔别名]"]) {
		const r = idx.search(q, { topK: 5 });
		console.log("\n搜索 " + JSON.stringify(q) + " -> " + (r.hits || []).length + " 命中");
		(r.hits || []).forEach((h) => console.log("   " + h.notePath + " score=" + h.score + " snippet=" + JSON.stringify(String(h.snippet).slice(0, 60))));
	}
} finally {
	await rm(root, { recursive: true, force: true });
}
