// 回归：侧栏笔记列表 = 仿 Obsidian 文件树（目录可收缩、嵌套、计数）
// 需求：与真实 Obsidian 文件浏览器一致的分组收缩列表。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 构树纯函数（从源码抽取，与实现同源）──────────────────────────
const fnStart = client.indexOf("function buildNoteTree");
const fnEnd = client.indexOf("const ObsidianPage");
const fns = new Function("h", client.slice(fnStart, fnEnd).replace(/^export /gm, "") + "\nreturn { buildNoteTree, renderTreeChildren };")((type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c !== null && c !== undefined) }));

const rows = [
	{ path: "开发思路/DSH插件/a.md", title: "a", dir: "开发思路/DSH插件", display: "a" },
	{ path: "开发思路/Healix/b.md", title: "b", dir: "开发思路/Healix", display: "b" },
	{ path: "开发思路/Healix/子/c.md", title: "c", dir: "开发思路/Healix/子", display: "c" },
	{ path: "github/d.md", title: "d", dir: "github", display: "d" },
	{ path: "根笔记.md", title: "根笔记", dir: "", display: "根笔记" },
];
const tree = fns.buildNoteTree(rows);

// 行为：树形状
t("树：根目录叶子直挂 root", tree.notes.length === 1 && tree.notes[0].title === "根笔记");
t("树：一级目录数正确（开发思路/github）", tree.dirs.size === 2 && tree.dirs.has("开发思路") && tree.dirs.has("github"));
t("树：嵌套子目录（开发思路/Healix/子）", tree.dirs.get("开发思路").dirs.get("Healix").dirs.has("子"));
t("树：叶子落在正确层级", tree.dirs.get("github").notes.length === 1 && tree.dirs.get("开发思路").dirs.get("Healix").notes.length === 1);
t("树：目录带完整路径键（同名目录不冲突）", tree.dirs.get("开发思路").dirs.get("Healix").path === "开发思路/Healix");

// 行为：渲染
const noop = () => {};
const leafOf = (n) => ({ type: "button", props: { key: n.path }, children: [] });
// 递归收集（kids 容器的 children 是扁平参数列表，直接遍历）
const walk = (nodes, out = []) => {
	for (const c of nodes) {
		out.push(c);
		if (c.props && String(c.props.key || "").startsWith("kids:") && Array.isArray(c.children)) {
			walk(c.children, out);
		}
	}
	return out;
};
const all = walk(fns.renderTreeChildren(tree, { collapsed: new Set(), toggleFolder: noop, renderLeaf: leafOf }));
t("渲染：展开态包含全部 5 个目录行 + 5 个叶子（全树）", all.filter((c) => String(c.props.key || "").startsWith("dir:")).length === 5 && all.filter((c) => c.type === "button" && String(c.props.key || "").includes(".md")).length === 5, "dirs=" + all.filter((c) => String(c.props.key || "").startsWith("dir:")).length + " leaves=" + all.filter((c) => c.type === "button" && String(c.props.key || "").includes(".md")).length);
t("渲染：目录行带 aria-expanded=true（展开态）", all.every((c) => !String(c.props.key || "").startsWith("dir:") || c.props["aria-expanded"] === true));
t("渲染：箭头字符存在（收缩指示）", all.filter((c) => String(c.props.key || "").startsWith("dir:")).every((c) => JSON.stringify(c).includes("▶")));

// 行为：折叠（collapsed 集合中的目录不渲染子节点）
const treeCollapsed = fns.buildNoteTree(rows);
const collapsedOut = walk(fns.renderTreeChildren(treeCollapsed, { collapsed: new Set(["开发思路", "github"]), toggleFolder: noop, renderLeaf: leafOf }));
t("折叠：折叠「开发思路」和「github」后叶子只剩根目录 1 条", collapsedOut.filter((c) => c.type === "button" && String(c.props.key || "").includes(".md")).length === 1);
t("折叠：折叠后只显示顶层折叠目录行（嵌套子目录随之隐藏）", collapsedOut.filter((c) => String(c.props.key || "").startsWith("dir:")).length === 2, "dirs=" + collapsedOut.filter((c) => String(c.props.key || "").startsWith("dir:")).length);
t("折叠：折叠目录行 aria-expanded=false", collapsedOut.filter((c) => String(c.props.key || "").startsWith("dir:")).every((c) => c.props["aria-expanded"] === false));

// ── 2. 客户端接线断言 ──────────────────────────────────────────────
t("接线：目录视图用文件树（noteSort === 'path'）", client.includes("if (noteSort === 'path' && !query.trim())"));
t("接线：搜索视图保持平铺（搜索结果不构树）", client.includes("return rows.map(renderLeaf);"));
t("接线：收缩状态持久化到 localStorage", client.includes("dsh-obsidian-board/collapsedDirs"));
t("接线：toggleFolder 按 dir.path 记录（防同名目录冲突）", /toggleFolder = \(path\) => \{/.test(client) && /prev\.includes\(path\)/.test(client));
t("接线：目录树 CSS（缩进导轨 + 箭头旋转）", client.includes(".ob-tree-children{") && client.includes(".ob-tree-folder.open .ob-tree-arrow{transform:rotate(90deg)"));
t("接线：手柄/树互不影响（resizer 仍是侧栏尾子节点）", /onDoubleClick: \(\) => setSidebarWidth\(SIDEBAR_DEFAULT\),/.test(client));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
