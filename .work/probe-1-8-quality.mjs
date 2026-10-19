// 主理人独立验证 OPT-1.8 的实际质量：highlights 是否被碎片占满、grouped 能否拿到第 3 片
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex } from "../lib/vault.js";

const root = await mkdtemp(join(tmpdir(), "ob18-"));
const vault = join(root, "vault");
await mkdir(vault, { recursive: true });

// A 笔记：同一段里反复出现查询词，检验 highlights 是否三条全指向同一位置
await writeFile(join(vault, "A.md"), `# 部署\n\n部署流程第一步是部署准备，部署流程图见下。\n\n## 部署细节\n\n部署时需要检查部署配置，部署完成后再部署验证。\n`, "utf8");
// B 笔记：多段落，每段各含一次关键词，检验能否给出三个不同位置的上下文
await writeFile(join(vault, "B.md"), `# 检索\n\n第一篇讲检索排序，BM25 打分。\n\n第二篇讲检索召回，中文 bigram 分词。\n\n第三篇讲检索融合，RRF 合并多路。\n`, "utf8");
// C 笔记：足够长，产生 3 个以上 chunk，检验 grouped 能否聚合第 3 片
let long = "# 长文\n\n";
for (let i = 0; i < 8; i++) long += `## 小节 ${i}\n\n这里讨论检索的第 ${i} 个方面，内容比较长用来撑开 chunk。${"检索".repeat(40)}\n\n`;
await writeFile(join(vault, "C.md"), long, "utf8");

const idx = new VaultIndex();
await idx.ensureIndexed(vault, { force: true });

const q = "检索";
const r = idx.search(q, { topK: 8, groupByNote: true });

console.log("=== 命中片数 ===", r.hits.length);
for (const h of r.hits) {
	console.log(`\n[${h.notePath}] score=${h.score}`);
	console.log("  highlights 条数 =", h.highlights.length);
	for (const t of h.highlights) console.log("   ·", t.slice(0, 90).replace(/\n/g, " "));
}

// 检查 A 的 highlights 是否三条几乎相同（同位置）
const a = r.hits.find((h) => h.notePath === "A.md");
const sameSpot = a ? new Set(a.highlights.map((x) => x.replace(/<\/?mark>/g, "").slice(0, 40))).size : 0;
console.log("\n=== DEF-E 判定 ===");
console.log("A.md highlights 条数 =", a ? a.highlights.length : "N/A");
console.log("A.md 去掉 mark 后前 40 字去重种数 =", sameSpot, "（小于条数即说明多条指向同一位置）");

// 检查 C 是否出现 3 片以上，但 grouped 里最多 2 片
const cHits = r.hits.filter((h) => h.notePath === "C.md");
const cGroup = r.grouped.notes.find((g) => g.notePath === "C.md");
console.log("\n=== DEF-F 判定 ===");
console.log("C.md 在 hits 中的片数 =", cHits.length);
console.log("C.md 在 grouped 中的片数 =", cGroup ? cGroup.hits.length : "N/A");
console.log("chunkCount =", r.chunkCount, " noteCount =", r.noteCount);
console.log("grouped 笔记数 =", r.grouped.notes.length);

await rm(root, { recursive: true, force: true });
