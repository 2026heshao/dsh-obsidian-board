// OPT-1.2 / OPT-1.3 真行为核验
// 1.2: extractTags 不得把代码围栏内的 #tag 当标签
// 1.3: frontmatter 列表解析不得把非 tags 字段的列表项当标签
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync("lib/vault.js", "utf8");

// extractTags 未导出，通过 VaultIndex 端到端验证
const { VaultIndex } = await import("../lib/vault.js");

const note = [
	"---",
	"title: 测试笔记",
	"tags: [alpha, beta]",
	"aliases:",
	"  - 别名一",
	"  - 别名二",
	"related:",
	"  - 不应该是标签A",
	"  - 不应该是标签B",
	"---",
	"",
	"# 正文",
	"",
	"这里有一个真标签 #真标签 和 #另一个真标签/x。",
	"",
	"```js",
	"// 围栏内的 #假标签 不是标签",
	"const x = 1;",
	"```",
	"",
	"行内代码 `#也是假的` 也不是标签。",
].join("\n");

const root = await mkdtemp(join(tmpdir(), "ob-tags-"));
try {
	await writeFile(join(root, "n.md"), note, "utf8");
	const idx = new VaultIndex();
	await idx.ensureIndexed(root);
	const st = idx.status();
	console.log("=== 索引状态 ===");
	console.log("  noteCount=" + st.noteCount + " chunkCount=" + st.chunkCount);

	// 从 chunks 里找该笔记的 tags
	const rows = idx.listNotes({ limit: 10, sort: "name" });
	const row = rows.notes && rows.notes[0];
	console.log("\n=== listNotes 行 ===");
	console.log("  " + JSON.stringify(row, null, 2).split("\n").join("\n  "));

	const tags = (row && row.tags) || [];
	console.log("\n=== 提取到的标签 ===");
	console.log("  [" + tags.join(", ") + "]");

	const hasA = tags.includes("alpha");
	const hasB = tags.includes("beta");
	const hasReal = tags.includes("真标签");
	const hasReal2 = tags.includes("另一个真标签/x") || tags.includes("另一个真标签");
	const hasFake = tags.some((t) => /假标签|也是假/.test(t));
	const hasRelated = tags.some((t) => /不应该是标签/.test(t));

	console.log("\n判定：");
	console.log("  frontmatter inline tags 保留 alpha/beta :", hasA && hasB ? "是（正确）" : "否（缺陷）");
	console.log("  正文真标签 #真标签 提取              :", hasReal ? "是（正确）" : "否（缺陷）");
	console.log("  正文真标签 #另一个真标签/x 提取      :", hasReal2 ? "是（正确）" : "否（缺陷/部分）");
	console.log("  OPT-1.2 围栏内 #假标签 被当标签       :", hasFake ? "是（缺陷）" : "否（正确）");
	console.log("  OPT-1.3 related 列表项被当标签        :", hasRelated ? "是（缺陷）" : "否（正确）");

	const ok = hasA && hasB && hasReal && !hasFake && !hasRelated;
	console.log("\nOPT-1.2/1.3 总判定 :", ok ? "PASS" : "FAIL");
	process.exitCode = ok ? 0 : 1;
} finally {
	await rm(root, { recursive: true, force: true });
}
