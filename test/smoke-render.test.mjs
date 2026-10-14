// 冒烟：真实执行 ObsidianPage 组件函数，构造整棵渲染树。
// 目标：抓住静态检查抓不到的运行时错误（TDZ ReferenceError / 未定义引用 / 结构断裂）。
// 方法：从 client.js 抽出「常量与工具 → typert 契约」之间的完整组件代码，
// 注入最小 React hooks 假体后真实调用 ObsidianPage({call})。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const start = src.indexOf("// ── 常量与工具");
const end = src.indexOf("// ── 浏览器侧 typert 契约");
const code = src.slice(start, end);

// 最小浏览器环境
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

// 最小 React hooks 假体：返回初值、不触发副作用
const useState = (init) => [typeof init === "function" ? init() : init, () => {}];
const useEffect = () => {};
const useCallback = (fn) => fn;
const useMemo = (fn) => fn();
const useRef = (v) => ({ current: v });
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c !== null && c !== undefined && c !== false && c !== "") });

let ObsidianPage;
try {
	ObsidianPage = new Function(
		"h", "useState", "useEffect", "useCallback", "useMemo", "useRef",
		code + "\nreturn ObsidianPage;",
	)(h, useState, useEffect, useCallback, useMemo, useRef);
	t("组件代码可求值", typeof ObsidianPage === "function");
} catch (error) {
	t("组件代码可求值", false, String(error));
	process.exit(1);
}

// 真实调用组件函数（status=null → 走完整三栏构造路径，覆盖全部节点声明）
const call = async () => ({ ok: false, error: "smoke" });
let tree = null;
try {
	tree = ObsidianPage({ call });
	t("组件渲染不抛错（无 TDZ / 未定义引用）", !!tree);
} catch (error) {
	t("组件渲染不抛错（无 TDZ / 未定义引用）", false, String(error && error.stack || error));
	process.exit(1);
}

const json = JSON.stringify(tree);
t("页头有只读模型摘要", json.includes("默认模型"));
t("composer 含模型选择器区域（ob-composer-meta）", json.includes("ob-composer-meta"));
t("模型按钮区域存在（ob-model-area）", json.includes("ob-model-area"));
t("发送按钮存在", json.includes("ob-btn primary"));
t("输入框占位文案", json.includes("基于知识库提问"));
t("空状态卡片", json.includes("向你的知识库提问"));
t("侧栏状态卡", json.includes("ob-status"));
t("页面根节点 ob-page", tree.type === "div" && tree.props.className === "ob-page");

// ── 结构断言（真实遍历，不靠字符串）：输入框必须在聊天列内部、且贴底 ──
// 历史 bug：composer 被挂成 .ob-page 的直接子节点 → 横向 flex 下变成右侧第四列（"输入框跑到右上角"）。
const kids = (n) => (n && Array.isArray(n.children) ? n.children.filter((c) => c && typeof c === 'object' && c.type) : []);
const cls = (n) => (n && n.props && n.props.className) || '';
const findAll = (n, predicate, out = []) => {
	if (!n || typeof n !== 'object') return out;
	if (n.type && predicate(n)) out.push(n);
	for (const c of kids(n)) findAll(c, predicate, out);
	return out;
};
const pageKids = kids(tree);
const pageClasses = pageKids.map(cls);
t("结构：.ob-page 直接子节点为 侧栏/聊天列/右栏（composer 不在其中）", !pageClasses.includes('ob-composer'), JSON.stringify(pageClasses));
t("结构：.ob-page 不含自由浮动的 ob-composer 列", pageClasses.filter((c) => c === 'ob-composer').length === 0);
const mains = findAll(tree, (n) => cls(n) === 'ob-main');
t("结构：存在聊天列 .ob-main", mains.length === 1);
const mainKids = mains.length ? kids(mains[0]).map(cls) : [];
t("结构：composer 是聊天列 .ob-main 的子节点", mainKids.includes('ob-composer'), JSON.stringify(mainKids));
t("结构：composer 是聊天列的最后一个子节点（贴底）", mainKids[mainKids.length - 1] === 'ob-composer', JSON.stringify(mainKids));
const composers = findAll(tree, (n) => cls(n) === 'ob-composer');
t("结构：composer 全树唯一（无重复挂载）", composers.length === 1);
const composerKids = composers.length ? kids(composers[0]).map(cls) : [];
t("结构：composer 内含输入行 + 模型选择器元信息行", composerKids.includes('ob-composer-row') && composerKids.includes('ob-composer-meta'), JSON.stringify(composerKids));
const rows = composers.length ? kids(composers[0]).find((c) => cls(c) === 'ob-composer-row') : null;
const rowKids = rows ? kids(rows) : [];
t("结构：输入行含 textarea + 发送按钮", rowKids.some((c) => c.type === 'textarea') && rowKids.some((c) => cls(c).includes('ob-btn')), JSON.stringify(rowKids.map((c) => c.type + '.' + cls(c))));
const metas = composers.length ? kids(composers[0]).find((c) => cls(c) === 'ob-composer-meta') : null;
t("结构：元信息行含模型选择器按钮（模型切换入口贴输入框）", metas ? JSON.stringify(metas).includes('ob-model-area') : false);
t("结构：聊天区在 composer 之前（输入框位于消息下方）", mainKids.indexOf('ob-chat') < mainKids.indexOf('ob-composer') || mainKids.indexOf('ob-empty') < mainKids.indexOf('ob-composer'), JSON.stringify(mainKids));

// ── 左侧 vault 列表可拖拽调宽 ─────────────────────────────────────
const sidebars = findAll(tree, (n) => cls(n).includes('ob-sidebar'));
t("结构：存在 .ob-sidebar", sidebars.length === 1);
const sidebar = sidebars[0];
t("结构：侧栏宽度走内联 style（可编程调整，非固定 CSS）", !!(sidebar.props.style && typeof sidebar.props.style.width === 'string' && sidebar.props.style.width.endsWith('px')), JSON.stringify(sidebar.props.style));
t("结构：侧栏挂了 ref（拖拽需要实测宽度）", sidebar.props.ref !== undefined);
const sidebarKids = kids(sidebar);
const resizers = sidebarKids.filter((c) => cls(c).includes('ob-resizer'));
t("结构：拖拽手柄在侧栏内部（贴右边缘）", resizers.length === 1);
t("结构：手柄是侧栏最后一个子节点", sidebarKids.length > 0 && cls(sidebarKids[sidebarKids.length - 1]).includes('ob-resizer'));
const rp = resizers.length ? resizers[0].props : {};
t("结构：手柄声明 separator 语义 + 值域（可访问性）", rp.role === 'separator' && rp['aria-orientation'] === 'vertical' && rp['aria-valuemin'] === 200 && rp['aria-valuemax'] === 560 && typeof rp['aria-valuenow'] === 'number', JSON.stringify({ role: rp.role, min: rp['aria-valuemin'], max: rp['aria-valuemax'], now: rp['aria-valuenow'] }));
t("结构：手柄可键盘聚焦（tabIndex=0）", rp.tabIndex === 0);
t("结构：手柄绑定 pointer 拖拽 + 键盘调整 + 双击复位", typeof rp.onPointerDown === 'function' && typeof rp.onKeyDown === 'function' && typeof rp.onDoubleClick === 'function');
t("结构：默认宽度 264 落在值域内", Number(rp['aria-valuenow']) === 264);

// 行为：clampSidebar 边界（连同常量一起从 client.js 抽取，保证与实现同源）
const clampStart = src.indexOf("const SIDEBAR_DEFAULT");
const clampEnd = src.indexOf("function clampSidebar");
const clampBody = src.slice(clampStart, src.indexOf("\n}", clampEnd) + 2);
const clampFn = new Function(clampBody + "\nreturn clampSidebar;")();
t("行为：宽度下限裁剪（100 → 200）", clampFn(100) === 200);
t("行为：宽度上限裁剪（900 → 560）", clampFn(900) === 560);
t("行为：正常值取整（318.6 → 319）", clampFn(318.6) === 319);
t("行为：非法值回落默认（NaN/undefined → 264）", clampFn(NaN) === 264 && clampFn(undefined) === 264);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
