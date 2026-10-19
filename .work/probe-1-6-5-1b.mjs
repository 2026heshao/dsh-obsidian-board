// 精确复核 OPT-1.6（用真超 2MB 的文件）与 OPT-5.1（realpath 归一化是否缺失）
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync("lib/vault.js", "utf8");
const { VaultIndex } = await import("../lib/vault.js");

// ── 静态确认：readNote 内是否出现 realpath
const ri = src.split("\n").findIndex((l) => /async readNote\(/.test(l));
const body = src
	.split("\n")
	.slice(ri, ri + 20)
	.join("\n");
console.log("=== readNote 内是否使用 realpath ===");
console.log("  含 realpath :", /realpath/.test(body) ? "是" : "否（← OPT-5.1 未实现）");
console.log("  含 resolve  :", /\bresolve\s*\(/.test(body) ? "是" : "否（← OPT-5.1 未实现）");
console.log("  模块是否 import realpath :", /realpath/.test(src) ? "是" : "否");

const root = await mkdtemp(join(tmpdir(), "ob-size-"));
const outside = await mkdtemp(join(tmpdir(), "ob-out-"));
try {
	// 1.6：刚好 2MB 与 略超 2MB
	const LIMIT = 2 * 1024 * 1024;
	const under = "# 小\n" + "a".repeat(LIMIT - 100);
	const over = "# 大\n" + "a".repeat(LIMIT + 100);
	await writeFile(join(root, "under.md"), under, "utf8");
	await writeFile(join(root, "over.md"), over, "utf8");
	await writeFile(join(root, "ok.md"), "# ok\n", "utf8");
	await writeFile(join(outside, "secret.md"), "# 机密\n", "utf8");

	console.log("\n=== OPT-1.6 大小上限（上限 " + LIMIT + " 字节）===");
	console.log("  under.md 实际字节 :", Buffer.byteLength(under, "utf8"));
	console.log("  over.md  实际字节 :", Buffer.byteLength(over, "utf8"));

	const idx = new VaultIndex();
	for (const [label, file] of [["略小于上限", "under.md"], ["略超上限", "over.md"], ["正常小文件", "ok.md"]]) {
		try {
			const r = await idx.readNote(root, file);
			console.log("  " + label.padEnd(12) + " -> 放行，读到 " + r.content.length + " 字符");
		} catch (e) {
			console.log("  " + label.padEnd(12) + " -> 拒绝: " + String(e.message).slice(0, 90));
		}
	}

	// 5.1：junction 逃逸
	console.log("\n=== OPT-5.1 junction 逃逸 ===");
	let made = false;
	try {
		await symlink(outside, join(root, "linkout"), "junction");
		made = true;
	} catch (e) {
		console.log("  无法创建 junction: " + e.message.slice(0, 60));
	}
	if (made) {
		try {
			const r = await idx.readNote(root, "linkout/secret.md");
			console.log("  linkout/secret.md -> 放行，读到: " + JSON.stringify(r.content.trim()));
			console.log("  判定: 逃出 vault 边界 ← OPT-5.1 缺陷（缺 realpath 归一化）");
		} catch (e) {
			console.log("  linkout/secret.md -> 拒绝: " + String(e.message).slice(0, 90) + "  （正确）");
		}
	}

	// 5.1：8.3 短名
	console.log("\n=== OPT-5.1 8.3 短名 ===");
	await writeFile(join(root, "LongFileName.md"), "# 长名\n", "utf8");
	for (const p of ["LONGFI~1.MD", "longfilename.md", "LONGFILENAME.MD"]) {
		try {
			const r = await idx.readNote(root, p);
			console.log("  " + p.padEnd(20) + " -> 放行（读到 " + r.content.trim() + "）");
		} catch (e) {
			console.log("  " + p.padEnd(20) + " -> 拒绝: " + String(e.message).slice(0, 60));
		}
	}
} finally {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
}
