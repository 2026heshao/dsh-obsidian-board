// 冒烟：真实执行 ObsidianPage 组件函数，构造整棵渲染树。
// 目标：抓住静态检查抓不到的运行时错误（TDZ ReferenceError / 未定义引用 / 结构断裂）。
// 方法：从 client.js 抽出「常量与工具 → typert 契约」之间的完整组件代码，
// 注入最小 React hooks / primitives 假体后真实调用 ObsidianPage({call}) 与 ModelPicker(...)。
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

// 宿主 primitives 假体：只保留结构 / 文本断言需要的形状
const iconStub = (props) => h('span', { className: 'icon-stub', ...(props || {}) });
const primitives = {
	IconChevronRightOutlineRegular: iconStub,
	IconChevronDownOutlineRegular: iconStub,
	IconCheckOutlineRegular: iconStub,
	IconCloseFillRegular: iconStub,
	IconDataOutlineRegular: iconStub,
	StateDot: (props) => h('span', { className: 'state-dot', ...(props || {}) }),
	MenuGroup: (props) => h('div', { className: 'menu-group' }, props && props.label),
	MenuSurface: (props) => h('div', { className: 'menu-surface' }, props && props.children),
	Input: (props) => h('input', props),
	rankByName: (list, query) => {
		const q = String(query || '').trim().toLowerCase();
		if (!q) return list.slice();
		return list.filter((item) => String(item && (item.name || item.label) || '').toLowerCase().includes(q));
	},
	observeStickyMenuGroups: () => () => {},
};
const ReactDOMStub = { createPortal: (node) => node };

let ObsidianPage, ModelPicker;
try {
	const exported = new Function(
		"h", "useState", "useEffect", "useCallback", "useMemo", "useRef", "primitives", "ReactDOM",
		code + "\nreturn { ObsidianPage, ModelPicker };",
	)(h, useState, useEffect, useCallback, useMemo, useRef, primitives, ReactDOMStub);
	ObsidianPage = exported.ObsidianPage;
	ModelPicker = exported.ModelPicker;
	t("组件代码可求值", typeof ObsidianPage === "function" && typeof ModelPicker === "function");
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
t("页头有只读模型摘要（默认模型）", json.includes("默认模型"));
t("composer 是宿主同款输入卡（ob-composer-card）", json.includes("ob-composer-card"));
t("发送按钮存在", json.includes("ob-send"));
t("输入框占位文案", json.includes("基于知识库提问"));
// 与宿主 InputBar 一致：placeholder 只描述能输入什么，不塞快捷键说明（长提示在窄面板会被截断）。
t("占位文案与宿主同款克制（无快捷键括号）", json.includes("基于知识库提问…") && !json.includes("Shift+Enter"));
t("空状态卡片", json.includes("向你的知识库提问"));
t("侧栏状态卡", json.includes("ob-status"));
t("页面根节点 ob-page", tree.type === "div" && tree.props.className === "ob-page");
t("页面根节点挂 Escape 处理（双击停止）", typeof tree.props.onKeyDown === "function");
t("旧 composer 元信息行已移除", !json.includes("ob-composer-meta") && !json.includes("ob-model-area"));

// ── 聚焦态形状（用户反馈：点输入框弹出的蓝色框是矩形的，和圆角输入卡不贴合）──
// 根因：textarea 自身没有圆角，宿主 ui-theme 的全局 :focus-visible 会给可编辑元素
// （html[data-input-modality=pointer] 的抑制规则用 :not(:read-write) 排除了输入框）
// 画出直角 outline。修法是压制元素 outline，把焦点表达挂回圆角卡片（宿主 wrap:focus-within 同构）。
t("焦点态改由输入卡描边表达（圆角贴合）", src.includes(".ob-composer-card:focus-within{border-color:var(--dsw-alias-state-business-primary"));
t("卡片光环是半透明 3px（color-mix），不是实色重环", /box-shadow:0 0 0 3px color-mix\(in srgb,var\(--dsw-alias-state-business-primary,var\(--ob-accent\)\) 14%,transparent\)/.test(src));
t("textarea 直角 outline 被 !important 压制", /\.ob-composer-input:focus,\.ob-composer-input:focus-visible\{outline:none !important\}/.test(src));
t("textarea 圆角兜底（万一仍有环也贴合卡片）", src.includes("border-radius:calc(var(--dsw-radius-panel,var(--ob-r-lg)) - 1px)"));
t("composer 子树统一不吃 outline", src.includes(".ob-composer:focus-within,.ob-composer-card:focus,.ob-composer-card:focus-within{outline:none !important}"));

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
t("结构：.ob-page 直接子节点为 侧栏/聊天列（composer 不在其中）", !pageClasses.includes('ob-composer'), JSON.stringify(pageClasses));
t("结构：存在聊天列 .ob-main", findAll(tree, (n) => cls(n) === 'ob-main').length === 1);
const mains = findAll(tree, (n) => cls(n) === 'ob-main');
const mainKids = mains.length ? kids(mains[0]).map(cls) : [];
t("结构：composer 是聊天列 .ob-main 的子节点", mainKids.includes('ob-composer'), JSON.stringify(mainKids));
t("结构：composer 是聊天列的最后一个子节点（贴底）", mainKids[mainKids.length - 1] === 'ob-composer', JSON.stringify(mainKids));
t("结构：聊天区在 composer 之前（输入框位于消息下方）", mainKids.indexOf('ob-empty') < mainKids.indexOf('ob-composer'), JSON.stringify(mainKids));
t("结构：composer 全树唯一（无重复挂载）", findAll(tree, (n) => cls(n) === 'ob-composer').length === 1);

const composers = findAll(tree, (n) => cls(n) === 'ob-composer');
const composerKids = composers.length ? kids(composers[0]) : [];
t("结构：空队列时不渲染队列行", !composerKids.some((c) => cls(c) === 'ob-queue'), JSON.stringify(composerKids.map(cls)));
t("结构：composer 内含输入卡", composerKids.map(cls).includes('ob-composer-card'), JSON.stringify(composerKids.map(cls)));
const cards = findAll(tree, (n) => cls(n) === 'ob-composer-card');
t("结构：输入卡唯一", cards.length === 1);
const cardKids = cards.length ? kids(cards[0]) : [];
t("结构：输入卡内是 textarea + 底部行", cardKids.length === 2 && cardKids[0].type === 'textarea' && cls(cardKids[1]) === 'ob-composer-row', JSON.stringify(cardKids.map((c) => c.type + '.' + cls(c))));
const textarea = cardKids.find((c) => c.type === 'textarea');
t("结构：textarea 绑定了草稿与键盘处理", !!textarea && textarea.props.value === '' && typeof textarea.props.onChange === 'function' && typeof textarea.props.onKeyDown === 'function');
t("结构：textarea 单行起步（rows=1，随内容增高）", !!textarea && textarea.props.rows === 1);
const row = cardKids.find((c) => cls(c) === 'ob-composer-row');
const rowKids = row ? kids(row) : [];
const pickerNode = rowKids.find((c) => c.type === ModelPicker);
t("结构：底部行左侧挂 ModelPicker 组件", !!pickerNode, JSON.stringify(rowKids.map((c) => typeof c.type === 'function' ? c.type.name : c.type + '.' + cls(c))));
t("结构：ModelPicker 收到模型目录 / 选择 / hostEffort", !!pickerNode && Array.isArray(pickerNode.props.models) && !!pickerNode.props.selection && typeof pickerNode.props.hostEffort === 'string' && typeof pickerNode.props.onChange === 'function');
t("结构：ModelPicker 收到宿主默认路由", !!pickerNode && !!pickerNode.props.hostDefault && typeof pickerNode.props.hostDefault.model === 'string');
t("结构：ModelPicker 独立刷新入口（onReload）", !!pickerNode && typeof pickerNode.props.onReload === 'function');
const trailing = rowKids.find((c) => cls(c) === 'ob-composer-trailing');
t("结构：底部行右侧是发送按钮容器", !!trailing);
const sendBtn = trailing ? kids(trailing).find((c) => cls(c) === 'ob-send') : null;
t("结构：发送按钮是 button 且空草稿禁用", !!sendBtn && sendBtn.type === 'button' && sendBtn.props.disabled === true, JSON.stringify(sendBtn && sendBtn.props));
t("结构：发送按钮含宿主同款箭头图标", !!sendBtn && kids(sendBtn).some((c) => c.type && c.type.name === 'SendGlyph'));
t("结构：发送按钮有可访问名称", !!sendBtn && typeof sendBtn.props['aria-label'] === 'string' && !!sendBtn.props['aria-label']);

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

// ── 模型选择器真实调用：触发器文案 = 模型 · 宿主实际档位 ─────────────
const pickerModels = [
	{ provider: 'deepseek-account', model: 'glm-5.3', label: 'GLM 5.3', efforts: ['low', 'high', 'max'], defaultEffort: 'low', free: true },
	{ provider: 'deepseek-official', model: 'deepseek-v4', label: 'DeepSeek V4', efforts: ['low', 'high'], defaultEffort: 'high' },
];
const renderPicker = (selection, hostEffort, hostDefault) => {
	const node = ModelPicker({
		models: pickerModels, providerNames: { 'deepseek-account': 'DeepSeek 账户', 'deepseek-official': 'DeepSeek 官方' },
		selection, hostEffort, hostDefault, loading: false, error: '', source: 'host', providerCount: 2,
		onChange: () => {}, onReload: () => {},
	});
	const trigger = kids(node).find((c) => cls(c) === 'ob-ms-trigger');
	return trigger || null;
};

let trig = renderPicker({ provider: 'deepseek-account', model: 'glm-5.3', effort: 'max' }, 'low');
t("行为：显式档位优先于宿主默认（触发器）", trig && trig.props.title === 'GLM 5.3 · 最高', trig && trig.props.title);
trig = renderPicker({ provider: 'deepseek-account', model: 'glm-5.3', effort: null }, 'max');
t("行为：未显式选择 → 显示宿主配置默认档位", trig && trig.props.title === 'GLM 5.3 · 最高', trig && trig.props.title);
trig = renderPicker({ provider: 'deepseek-account', model: 'glm-5.3', effort: null }, 'medium');
t("行为：宿主默认不被模型支持 → 回退模型默认", trig && trig.props.title === 'GLM 5.3 · 低', trig && trig.props.title);
trig = renderPicker({ provider: 'deepseek-official', model: 'deepseek-v4', effort: null }, '');
t("行为：无宿主默认 → 模型默认", trig && trig.props.title === 'DeepSeek V4 · 高', trig && trig.props.title);
trig = renderPicker({ provider: '', model: '', effort: null }, '');
t("行为：未选模型 → 默认模型文案", trig && trig.props.title === '默认模型', trig && trig.props.title);
t("行为：未选模型时不显示档位格（无档位可切）", trig && kids(trig).every((c) => cls(c) !== 'ob-ms-triggerEffort'));
t("行为：未选模型但目录给出宿主默认 → 显示真实模型与档位", (() => {
	const node = renderPicker({ provider: '', model: '', effort: null }, 'max', { provider: 'deepseek-account', model: 'glm-5.3' });
	return !!node && node.props.title === 'GLM 5.3 · 最高';
})());
t("行为：宿主默认模型不在目录 → 回退默认文案", (() => {
	const node = renderPicker({ provider: '', model: '', effort: null }, 'max', { provider: 'x', model: 'gone' });
	return !!node && node.props.title === '默认模型';
})());
t("行为：触发器 aria 状态完整", trig && trig.props['aria-haspopup'] === 'menu' && trig.props['aria-expanded'] === false);
t("行为：菜单关闭时不 portal 渲染", kids(renderPicker({ provider: 'deepseek-account', model: 'glm-5.3', effort: null }, '')).every((c) => cls(c) !== 'menu-surface'));

// 加载中：触发按钮显示 StateDot，不显示 chevron
const loadingTrigger = (() => {
	const node = ModelPicker({
		models: [], providerNames: {}, selection: { provider: '', model: '', effort: null }, hostEffort: '',
		loading: true, error: '', source: '', providerCount: 0, onChange: () => {}, onReload: () => {},
	});
	return kids(node).find((c) => cls(c) === 'ob-ms-trigger');
})();
t("行为：加载中显示进度点与加载文案", !!loadingTrigger && kids(loadingTrigger).some((c) => c.type === primitives.StateDot) && JSON.stringify(loadingTrigger).includes('正在加载模型'), loadingTrigger && JSON.stringify(loadingTrigger));
t("行为：加载中 aria-busy", !!loadingTrigger && loadingTrigger.props['aria-busy'] === true);

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
