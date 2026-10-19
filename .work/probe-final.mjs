// 收尾核实：Config 实际形状 / withTimeout 注释 / typert.js 头 / locale 出现位置
import { readFileSync } from "node:fs";

const host = readFileSync("lib/index.js", "utf8");
const c = readFileSync("lib/client.js", "utf8");
const ty = readFileSync("lib/typert.js", "utf8");

console.log("=== Config 实际形状（index.js 前 50 行）===");
console.log(host.split("\n").slice(0, 50).map((l, i) => String(i + 1).padStart(4) + "| " + l).join("\n"));

console.log("\n=== `// 给任意 promise 加超时` 定位 ===");
const i1 = host.indexOf("// 给任意 promise 加超时");
console.log("  idx=" + i1 + " line=" + host.slice(0, i1).split("\n").length);
console.log(host.slice(i1 - 120, i1 + 260));

console.log("\n=== typert.js 头部（前 12 行）===");
console.log(ty.split("\n").slice(0, 12).map((l, i) => String(i + 1).padStart(3) + "| " + l).join("\n"));

console.log("\n=== client.js 中 'locale' 出现处 ===");
c.split("\n").forEach((l, i) => { if (l.includes("locale")) console.log("  " + (i + 1) + ": " + l.trim().slice(0, 120)); });

console.log("\n=== vault.js / index.js 中 'locale' / i18n ===");
for (const [n, t] of [["vault.js", readFileSync("lib/vault.js", "utf8")], ["index.js", host]]) {
	console.log("  " + n + ": locale=" + t.includes("locale") + " i18n=" + /i18n/i.test(t));
}

console.log("\n=== cordis.patch.yml 全文 ===");
console.log(readFileSync("cordis.patch.yml", "utf8"));
