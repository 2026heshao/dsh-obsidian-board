// 专查 scanVault 的深度上限与扫描选项：确认 maxDepth 默认仍为 12
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const cur = readFileSync("lib/vault.js", "utf8");
const base = execSync("git show HEAD:lib/vault.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

function show(src, label, patterns) {
	console.log("===== " + label + " =====");
	const lines = src.split("\n");
	for (const p of patterns) {
		lines.forEach((ln, i) => {
			if (p.test(ln)) console.log("  L" + (i + 1) + ": " + ln.trim());
		});
	}
	console.log("");
}

const pats = [/scanVault/, /maxDepth/, /depth\s*[><=]/, /DEFAULT_SCAN/, /readConcurrency/, /watchDebounce/];
show(base, "基线 HEAD", [/scanVault/, /depth\s*[><=]/, /12/]);
show(cur, "当前工作区", pats);

// 精确提取 scanVault 签名
for (const [label, src] of [["基线", base], ["当前", cur]]) {
	const m = src.match(/export async function scanVault[\s\S]{0,400}?\{/);
	console.log("=== scanVault 签名（" + label + "）===");
	console.log(m ? m[0] : "  （未匹配）");
	console.log("");
}
