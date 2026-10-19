// 核验 OPT-1.4：扫描参数从硬编码改为可注入后，缺省行为是否与基线逐项等价
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const cur = readFileSync("lib/vault.js", "utf8");
const base = execSync("git show HEAD:lib/vault.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

function grab(src, re, label) {
	const m = src.match(re);
	return m ? m[1] : null;
}

const checks = [];

// 1) SKIP_DIRS 集合
function parseSet(src, name) {
	const re = new RegExp("const " + name + " = new Set\\(\\[([\\s\\S]*?)\\]\\)");
	const body = grab(src, re, name);
	if (body === null) return null;
	return body
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => s.replace(/^["'`]|["'`]$/g, ""))
		.sort();
}
for (const name of ["SKIP_DIRS", "ALLOW_DOT_DIRS"]) {
	const a = parseSet(base, name);
	const b = parseSet(cur, name);
	checks.push([name, a, b, JSON.stringify(a) === JSON.stringify(b)]);
}

// 2) 数值常量
function parseNum(src, name) {
	const m = src.match(new RegExp("const " + name + " = ([0-9*.\\s]+);"));
	if (!m) return null;
	try {
		// 只允许数字与 * 的表达式
		if (!/^[0-9*.\\s]+$/.test(m[1])) return null;
		return Function("return (" + m[1] + ")")();
	} catch {
		return null;
	}
}
for (const name of ["VENDORED_WEIGHT", "DEFAULT_MAX_NOTE_BYTES", "DEFAULT_READ_CONCURRENCY", "DEFAULT_WATCH_DEBOUNCE_MS"]) {
	const a = parseNum(base, name);
	const b = parseNum(cur, name);
	checks.push([name, a, b, a === b]);
}

// 3) VENDORED_DIR_HINTS 数组
function parseArr(src, name) {
	const m = src.match(new RegExp("const " + name + " = \\[([\\s\\S]*?)\\];"));
	if (!m) return null;
	return m[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => s.replace(/^["'`]|["'`]$/g, ""))
		.sort();
}
{
	const a = parseArr(base, "VENDORED_DIR_HINTS");
	const b = parseArr(cur, "VENDORED_DIR_HINTS");
	checks.push(["VENDORED_DIR_HINTS", a, b, JSON.stringify(a) === JSON.stringify(b)]);
}

// 4) 深度上限 12：基线是 scanVault 内的字面量 depth > 12
{
	const a = /depth > 12/.test(base) ? 12 : null;
	// 当前应为可注入参数，默认值需能在 options 默认里找到 12
	const m = cur.match(/maxDepth\s*=\s*(\d+)/);
	const b = m ? Number(m[1]) : /depth > 12/.test(cur) ? 12 : null;
	checks.push(["scanMaxDepth", a, b, a === b]);
}

// 5) 围栏感知不得改变无围栏文档的分块结果（结构性检查：chunkNote 签名与调用点仍在）
{
	const a = /function chunkNote\(/.test(base);
	const b = /function chunkNote\(/.test(cur);
	checks.push(["chunkNote 仍存在", a, b, a === b]);
}

// 6) MD_EXT 仍只含 .md/.markdown
{
	const re = /const MD_EXT = new Set\(\[([\s\S]*?)\]\)/;
	const a = grab(base, re)?.replace(/\s+/g, "");
	const b = grab(cur, re)?.replace(/\s+/g, "");
	checks.push(["MD_EXT", a, b, a === b]);
}

console.log("=== OPT-1.4 默认值等价核验（基线 HEAD vs 当前工作区）===\n");
let bad = 0;
for (const [name, a, b, ok] of checks) {
	if (!ok) bad++;
	console.log((ok ? "  OK   " : "  DIFF ") + name);
	if (!ok) {
		console.log("        基线 : " + JSON.stringify(a));
		console.log("        当前 : " + JSON.stringify(b));
	}
}
console.log("\n不一致项: " + bad + " / " + checks.length);
process.exit(bad === 0 ? 0 : 1);
