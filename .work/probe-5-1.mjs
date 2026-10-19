// 主理人独立验证 OPT-5.1：readNote 的 realpath 双向归一是否真的拦住 junction / symlink 逃逸
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex } from "../lib/vault.js";

const root = await mkdtemp(join(tmpdir(), "ob51-"));
const vault = join(root, "vault");
const outside = join(root, "outside");
await mkdir(vault, { recursive: true });
await mkdir(outside, { recursive: true });

// 正常笔记（对照组）
await writeFile(join(vault, "normal.md"), "# normal\n\n正常内容\n", "utf8");
// vault 外的秘密文件
await writeFile(join(outside, "secret.md"), "# secret\n\n不该被读到\n", "utf8");

// 造一个指向 vault 外部的链接：Windows 用 junction（目录），失败则退回文件 symlink
let linkKind = "";
try {
	await symlink(outside, join(vault, "linkout"), "junction");
	linkKind = "junction";
} catch (e) {
	try {
		await symlink(join(outside, "secret.md"), join(vault, "linkout.md"), "file");
		linkKind = "file-symlink";
	} catch (e2) {
		linkKind = "none:" + (e2?.message || e2);
	}
}

const idx = new VaultIndex();
await idx.ensureIndexed(vault, { force: true });

const results = [];
const probe = async (label, relPath) => {
	try {
		const r = await idx.readNote(vault, relPath);
		results.push({ label, path: relPath, blocked: false, contentHead: String(r?.content || "").slice(0, 30) });
	} catch (e) {
		results.push({ label, path: relPath, blocked: true, error: String(e?.message || e) });
	}
};

await probe("对照组-正常笔记", "normal.md");
await probe("逃逸-点段", "../outside/secret.md");
if (linkKind === "junction") await probe("逃逸-junction 目录", "linkout/secret.md");
if (linkKind === "file-symlink") await probe("逃逸-文件符号链接", "linkout.md");

console.log("linkKind =", linkKind);
console.log(JSON.stringify(results, null, 2));

const ctrl = results.find((r) => r.label === "对照组-正常笔记");
const escaped = results.filter((r) => r.label.startsWith("逃逸-"));
const pass = ctrl && ctrl.blocked === false && escaped.every((r) => r.blocked === true);
console.log("\nVERDICT =", pass ? "PASS（正常可读，逃逸全部被拦）" : "FAIL");

await rm(root, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
