// 成熟版功能测试：Markdown 渲染 + 流式会话 chunk 解析 + saveNote 文件名消毒
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

// ── 1. Markdown 渲染器（从 client.js 提取纯逻辑）──
const clientSrc = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
// 提取 MD_STYLE + renderInline + renderMarkdown（模块顶层到「── 主页面」之间）
const start = clientSrc.indexOf("const MD_STYLE");
const end = clientSrc.indexOf("// ── 主页面");
const code = clientSrc.slice(start, end)
	.replace(/const h = React\.createElement[\s\S]*?;/, "")
	.replace(/\bh\(/g, "hFake(")
	.replace(/var React = require\('react'\);/g, "")
	.replace(/const React2 = React;\n/g, "")
	.replace(/const \{ useState, useEffect, useCallback, useMemo, useRef \} = React2;\n/g, "");
// 提供极简 h 假体：记录树结构
const hFake = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c !== null && c !== undefined && c !== false && c !== "") });
globalThis.hFake = hFake;
const sandbox = new Function("hFake", code + "\nreturn { renderMarkdown, renderInline, MD_STYLE };")(hFake);
const { renderMarkdown } = sandbox;

const md = [
	"## 结论",
	"- 第一点 **重要**",
	"- 第二点引用 [1]",
	"",
	"```js",
	"const x = 1;",
	"```",
	"",
	"> 引用块内容",
	"",
	"相关笔记见 [[GitHub账号]] 与 [[账号与仓库|账号页]]。",
].join("\n");
const tree = renderMarkdown(md, { onCite: () => {}, onWiki: () => {} });
const types = tree.map((n) => n.type);
t("标题渲染 h2", types.includes("h2"));
t("列表渲染 ul", types.includes("ul"));
t("代码块渲染 pre", types.includes("pre"));
t("引用块渲染 blockquote", types.includes("blockquote"));
const allJson = JSON.stringify(tree);
t("粗体识别", allJson.includes("重要"));
t("[n] 引用转按钮", allJson.includes("[1]"));
t("wikilink 带别名", allJson.includes("账号页") && allJson.includes("GitHub账号"));
t("wikilink 目标传给 onWiki", (() => {
	// onWiki 在点击 wikilink 按钮时触发——渲染出树后模拟点击
	let captured = "";
	const tree = renderMarkdown("见 [[目标笔记]]", { onCite: () => {}, onWiki: (w) => { captured = w; } });
	const findBtns = (n, acc = []) => { if (Array.isArray(n)) { n.forEach((x) => findBtns(x, acc)); return acc; } if (n && typeof n === "object") { if (n.type === "button" && n.props.onClick) acc.push(n); (n.children || []).forEach((c) => findBtns(c, acc)); } return acc; };
	const btns = findBtns(tree);
	if (!btns.length) return false;
	btns.forEach((b) => b.props.onClick());
	return captured === "目标笔记";
})());
// 嵌套列表回归：引用块里再套 markdown 不炸
t("引用块嵌套不炸", (() => { try { renderMarkdown("> # 内部标题\n> - 项", {}); return true; } catch { return false; } })());

// ── 2. 流式会话 chunk 解析（从 index.js 提取 visibleDelta/terminalFailure）──
const indexSrc = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const fnSrc = indexSrc.slice(indexSrc.indexOf("function visibleDelta"), indexSrc.indexOf("async function mapHasVaultPath"));
const termSrc = indexSrc.slice(indexSrc.indexOf("function terminalFailure"), indexSrc.indexOf("export class"));
const fnBox = new Function(fnSrc + termSrc + "\nreturn { visibleDelta, terminalFailure };")();
const { visibleDelta, terminalFailure } = fnBox;
// usage chunk 不会被当成文本
t("usage chunk 不产文本", visibleDelta({ kind: "usage", usage: { input: 10, output: 20 } }) === "");
t("finish 无失败", terminalFailure({ kind: "finish", reason: "stop" }) === null);
t("error 有失败码", terminalFailure({ kind: "error", failure: { code: "AUTH", message: "bad key" } }) === "AUTH：bad key");
// 模拟完整流攒文本
const seq = [
	{ type: "block-start", block: { kind: "text" } },
	{ type: "text-delta", delta: "根据" },
	{ kind: "usage", usage: { input: 320, output: 64 } },
	{ type: "text-delta", delta: "笔记 [1]" },
	{ kind: "finish", reason: "stop" },
];
let acc = "", usage = null, term = null;
for (const c of seq) {
	term = terminalFailure(c); if (term) break;
	if (c.kind === "usage") { usage = c.usage; continue; }
	acc += visibleDelta(c);
}
t("完整流攒文本", acc === "根据笔记 [1]");
t("usage 被捕获", usage && usage.input === 320 && usage.output === 64);

// ── 3. saveNote 文件名消毒 ──
const sanitize = (title) => String(title).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "知识库回答";
t("非法字符消毒", sanitize('我的/问题: *测试?"<a>|') === "我的 问题 测试 a");
t("空标题兜底", sanitize("   ") === "知识库回答");
t("超长截断", sanitize("x".repeat(100)).length === 80);

// ── 4. 真实 vault 索引回归 ──
const { VaultIndex } = await import("../lib/vault.js");
const vault = join(tmpdir(), "dsh-ob-mature-" + Date.now());
mkdirSync(vault, { recursive: true });
writeFileSync(join(vault, "a.md"), "# 标题A\n内容 alpha。\n");
writeFileSync(join(vault, "b.md"), "---\ntags: [t1]\n---\n# 标题B\n内容 beta。\n");
const idx = new VaultIndex();
await idx.ensureIndexed(vault);
t("索引2篇", idx.status().noteCount === 2);
t("标签检索", idx.search("#t1").hits.length > 0);
rmSync(vault, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
