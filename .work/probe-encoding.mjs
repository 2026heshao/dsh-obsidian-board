// 编码诊断：判定 UTF-8 文件是否真的含 mojibake，还是 PowerShell 显示层问题
import { readFileSync } from "node:fs";

const files = ["lib/vault.js", "lib/index.js", "lib/client.js", "package.json"];
// UTF-8 字节被当作 GBK 解码后的典型特征字符
const MOJI = /[\u9225\u9226\u9286\u93c8\u9510\u7ee0\u7ef4\u5bc4\u93af\u6d60\ue000-\uf8ff]/;

for (const f of files) {
	const buf = readFileSync(f);
	const text = buf.toString("utf8");
	// U+FFFD 表示解码失败（真损坏）
	const fffd = (text.match(/\ufffd/g) || []).length;
	// 检查非法 UTF-8 序列：重新编码回字节再比对
	const roundTrip = Buffer.from(text, "utf8").equals(buf);
	// 统计 CJK 字符数（正常中文）
	const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
	// mojibake 特征串
	const mojHits = [];
	const lines = text.split("\n");
	lines.forEach((ln, i) => {
		if (/[\u9225\u9226\u93c8\u9510\u7ee0\u5bc4\u93af]/.test(ln)) mojHits.push(i + 1);
	});
	console.log("=== " + f + " ===");
	console.log("  bytes        :", buf.length);
	console.log("  BOM          :", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? "YES(EF BB BF)" : "no");
	console.log("  roundTripOK  :", roundTrip);
	console.log("  U+FFFD count :", fffd);
	console.log("  CJK count    :", cjk);
	console.log("  mojibake行号 :", mojHits.length ? mojHits.slice(0, 12).join(",") : "none");
	// 抽样：找出文件里是否含预期中文
	for (const probe of ["公网收集", "索引", "路径不允许", "笔记"]) {
		if (text.includes(probe)) console.log("  contains \"" + probe + "\" : YES");
	}
	console.log("");
}
