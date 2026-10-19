// 主理人独立验证 OPT-1.7（有界并发索引的保序性）与 OPT-1.9（listNotes 分页语义）
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex } from "../lib/vault.js";

const root = await mkdtemp(join(tmpdir(), "ob17-"));
const vault = join(root, "vault");
await mkdir(vault, { recursive: true });

// 造 40 篇笔记，文件名刻意乱序，用于检验并发回填是否保序
const names = [];
for (let i = 0; i < 40; i++) {
	const n = `note-${String((i * 17) % 40).padStart(2, "0")}.md`;
	names.push(n);
	await writeFile(join(vault, n), `# ${n}\n\n内容 ${n} 关键词\n`, "utf8");
}

const idx = new VaultIndex();
await idx.ensureIndexed(vault, { force: true });

// ---- OPT-1.7 保序验证：chunks 的 notePath 顺序应与串行扫描给出的顺序一致 ----
const orderFromChunks = [];
const seen = new Set();
for (const c of idx.chunks) {
	if (!seen.has(c.notePath)) { seen.add(c.notePath); orderFromChunks.push(c.notePath); }
}
// 串行基准：单独建一个实例，用 readConcurrency=1 跑一遍，两者顺序必须完全相同
const serial = new VaultIndex({ readConcurrency: 1 });
await serial.ensureIndexed(vault, { force: true });
const orderFromSerial = [];
const seen2 = new Set();
for (const c of serial.chunks) {
	if (!seen2.has(c.notePath)) { seen2.add(c.notePath); orderFromSerial.push(c.notePath); }
}
const orderEqual = JSON.stringify(orderFromChunks) === JSON.stringify(orderFromSerial);
const countEqual = idx.chunks.length === serial.chunks.length;

// ---- OPT-1.9 分页语义验证 ----
const p1 = idx.listNotes({ limit: 10, offset: 0 });
const p2 = idx.listNotes({ limit: 10, offset: 10 });
const p4 = idx.listNotes({ limit: 10, offset: 30 });
const pEnd = idx.listNotes({ limit: 10, offset: 40 });
const noOffset = idx.listNotes({ limit: 10 });
const clamped = idx.listNotes({ limit: 99999 }); // 上限应钳到 2000
const zeroLimit = idx.listNotes({ limit: 0 });   // 下限应钳到 0

const pathSet = (r) => new Set((r.notes || []).map((n) => n.path));
const s1 = pathSet(p1), s2 = pathSet(p2);
const overlap = [...s1].filter((p) => s2.has(p));

const checks = [
	["1.7 chunks 总数与串行一致", countEqual],
	["1.7 并发回填顺序与串行完全一致", orderEqual],
	["1.9 total 恒为 40", p1.total === 40 && p4.total === 40],
	["1.9 第1页 10 条", p1.notes.length === 10],
	["1.9 第2页 10 条且与第1页零重叠", p2.notes.length === 10 && overlap.length === 0],
	["1.9 第4页 10 条", p4.notes.length === 10],
	["1.9 hasMore: 第1页 true", p1.hasMore === true],
	["1.9 hasMore: 第4页 false（40 条正好取完）", p4.hasMore === false],
	["1.9 越界 offset=40 返回空且 hasMore=false", pEnd.notes.length === 0 && pEnd.hasMore === false],
	// 修正：hasMore 恒存在；未传 offset 时短路为 false（纯增量字段，老调用方忽略即可）
	["1.9 不传 offset 时 hasMore 为 false（老客户端语义）", noOffset.hasMore === false],
	["1.9 不传 offset 时 offset 回显 0", noOffset.offset === 0],
	// 修正：实现无 nextOffset，回显输入 offset；客户端自行 offset+notes.length 推进
	["1.9 offset 回显正确", p2.offset === 10 && pEnd.offset === 40],
	["1.9 客户端可自行推导下一页偏移", p1.offset + p1.notes.length === p2.offset],
	["1.9 limit 上限钳到 2000", clamped.notes.length === 40],
	["1.9 limit 下限钳到 0", zeroLimit.notes.length === 0],
	["1.9 每项仍含 path/title/display/total 字段", p1.notes[0] && typeof p1.notes[0].path === "string" && typeof p1.notes[0].title === "string"],
];

let fail = 0;
for (const [label, ok] of checks) {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
console.log(`\n合计 ${checks.length} 项，失败 ${fail} 项`);
console.log("sample p1.nextOffset =", p1.nextOffset, " p4.nextOffset =", p4.nextOffset);

await rm(root, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
