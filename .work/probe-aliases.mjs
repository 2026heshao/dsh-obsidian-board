// 查证：aliases 是否只保留了第一条（OPT-1.3 改动可能误伤 extractAliases）
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cur = readFileSync("lib/vault.js", "utf8");
const base = execSync("git show HEAD:lib/vault.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

function show(src, label) {
	console.log("===== " + label + " extractAliases =====");
	const lines = src.split("\n");
	const i = lines.findIndex((l) => /function extractAliases/.test(l));
	if (i < 0) return console.log("  （未找到）");
	for (let k = i; k < Math.min(i + 22, lines.length); k++) {
		console.log(String(k + 1).padStart(4) + ": " + lines[k]);
		if (k > i && /^\}/.test(lines[k])) break;
	}
	console.log("");
}
show(base, "基线 HEAD");
show(cur, "当前工作区");

// 真执行：三种 frontmatter aliases 写法
const { VaultIndex } = await import("../lib/vault.js");

const cases = {
	"块列表 (aliases:\\n  - a\\n  - b)": ["---", "aliases:", "  - 别名一", "  - 别名二", "---", "", "# 正文", "内容"].join("\n"),
	"行内列表 (aliases: [a, b])": ["---", "aliases: [甲, 乙, 丙]", "---", "", "# 正文", "内容"].join("\n"),
	"单值字符串 (aliases: a)": ["---", "aliases: 单别名", "---", "", "# 正文", "内容"].join("\n"),
};

for (const [label, body] of Object.entries(cases)) {
	const root = await mkdtemp(join(tmpdir(), "ob-alias-"));
	try {
		await writeFile(join(root, "n.md"), body, "utf8");
		const idx = new VaultIndex();
		await idx.ensureIndexed(root);
		const row = idx.listNotes({ limit: 5 }).notes[0];
		console.log(label);
		console.log("  aliases = " + JSON.stringify(row.aliases));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
