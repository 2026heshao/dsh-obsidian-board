// OPT-1.6 + OPT-5.1 核验：readNote 的扩展名/大小限制与路径越界防护
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const { VaultIndex } = await import("../lib/vault.js");

const root = await mkdtemp(join(tmpdir(), "ob-read-"));
const outside = await mkdtemp(join(tmpdir(), "ob-outside-"));
const results = [];

async function probe(label, relPath, expectReject) {
	const idx = new VaultIndex();
	try {
		const r = await idx.readNote(root, relPath);
		const rejected = false;
		results.push([label, JSON.stringify(relPath), expectReject ? "应拒绝但放行 ← 缺陷" : "放行（正确）", rejected, expectReject]);
		return r;
	} catch (e) {
		results.push([label, JSON.stringify(relPath), (expectReject ? "拒绝（正确）: " : "误拒 ← 缺陷: ") + String(e.message).slice(0, 80), true, expectReject]);
		return null;
	}
}

try {
	// 正常笔记
	await writeFile(join(root, "ok.md"), "# 标题\n正文\n", "utf8");
	await writeFile(join(root, "plain.txt"), "不是 markdown\n", "utf8");
	await mkdir(join(root, "sub"), { recursive: true });
	await writeFile(join(root, "sub", "n.md"), "# 子目录\n", "utf8");

	// 超大笔记（超过缺省 maxNoteBytes）
	const big = "# 大文件\n" + "字".repeat(2000);
	await writeFile(join(root, "big.md"), big, "utf8");

	// vault 外的文件
	await writeFile(join(outside, "secret.md"), "# 机密\n不该被读到\n", "utf8");

	// 尝试建符号链接（Windows 可能无权限）
	let symlinkMade = false;
	try {
		await symlink(outside, join(root, "linkout"), "junction");
		symlinkMade = true;
	} catch {
		/* 无权限则跳过 */
	}

	console.log("=== OPT-1.6 / OPT-5.1 readNote 边界核验 ===");
	console.log("  vault 根: " + root);
	console.log("");

	await probe("正常 md", "ok.md", false);
	await probe("子目录 md", "sub/n.md", false);
	await probe("非 md 扩展名", "plain.txt", true);
	await probe("超大 md", "big.md", true);
	await probe("相对越界 ..", "../" + (outside.split(sep).pop()) + "/secret.md", true);
	await probe("深层越界", "sub/../../escape.md", true);
	await probe("绝对路径（Windows）", join(outside, "secret.md"), true);
	await probe("绝对路径（POSIX 形式）", "/etc/passwd", true);
	await probe("UNC 路径", "\\\\server\\share\\x.md", true);
	await probe("盘符根", "C:\\Windows\\win.ini", true);
	await probe("空路径", "", true);

	if (symlinkMade) {
		await probe("经 junction 逃逸", "linkout/secret.md", true);
	} else {
		console.log("  （跳过 junction 逃逸测试：当前用户无创建链接权限）");
	}

	// 含 NUL 的路径
	try {
		await probe("含 NUL 字节", "ok.md\0.txt", true);
	} catch (e) {
		console.log("  含 NUL 字节: 探针本身抛错 -> " + e.message.slice(0, 60));
	}

	console.log("");
	console.log("  结论表：");
	console.log("  " + "场景".padEnd(22) + "路径".padEnd(46) + "实际结果");
	for (const [label, p, res] of results) {
		console.log("  " + label.padEnd(22) + String(p).slice(0, 44).padEnd(46) + res);
	}

	const fails = results.filter(([, , , rejected, expectReject]) => rejected !== expectReject);
	console.log("");
	console.log("  不符合预期: " + fails.length + " / " + results.length);
	fails.forEach((f) => console.log("    ✗ " + f[0] + " -> " + f[2]));

	// 大小错误信息必须含实际字节数
	const bigIdx = new VaultIndex();
	try {
		await bigIdx.readNote(root, "big.md");
	} catch (e) {
		const expectBytes = Buffer.byteLength(big, "utf8");
		const hasNum = String(e.message).includes(String(expectBytes));
		console.log("");
		console.log("  超限错误信息: " + e.message);
		console.log("  含实际字节数 " + expectBytes + " :", hasNum ? "是（正确）" : "否（缺陷）");
	}

	process.exitCode = fails.length === 0 ? 0 : 1;
} finally {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
}
