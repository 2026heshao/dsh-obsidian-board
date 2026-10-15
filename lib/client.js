window.__ModuleLoader__.load({
	id: 'dsh-obsidian-board',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
// dsh-obsidian-board — 客户端半：DSH 主窗口里的 Obsidian 专属对话页面。
//
// 装配契约（与 dsh-skill-mcp-board 同构，已在其真机上验证）：
// - main slot（key = PANEL_ID）：宿主中栏按 entryKey 渲染插件页面，与切换对话同构；
// - sidebar.panellist 面板行：唯一入口（侧栏左上角），点击行为由宿主 selectPanel 承担。
//
// 定位：这是「知识库问答面板」——历史由客户端持有（localStorage），回答由宿主半
// ctx.llm 产生（DSH 配好的模型通道），检索与引用全部本地完成。
var React = require('react');
var __injectCss = function(text) {
	if (typeof document === 'undefined') return function() {};
	var id = 'dsh-obsidian-board/chat.css';
	var tag = document.querySelector('style[data-plugin-css="' + id + '"]');
	var created = false;
	if (!tag) {
		tag = document.createElement('style');
		tag.dataset.plugin = 'dsh-obsidian-board';
		tag.dataset.pluginCss = id;
		document.head.appendChild(tag);
		created = true;
	}
	try {
		tag.textContent = text;
		return function() { tag.remove(); };
	} catch (error) {
		if (created) tag.remove();
		throw error;
	}
};

const React2 = React;
const h = React.createElement;
const { useState, useEffect, useCallback, useMemo, useRef } = React2;

/* 主题令牌别名层：挂在 body（三个 slot 子树的公共祖先；ui-theme 把 --dsw-alias-* 定义
   在 body 上，挂 :root 取不到值）。几何走 --dsw-radius-* 分级，不写字面圆角。 */
const CSS = [
	'body{--ob-accent:var(--dsw-alias-brand-primary);--ob-ok:var(--dsw-alias-state-success-primary);--ob-err:var(--dsw-alias-state-error-primary);--ob-warn:var(--dsw-alias-state-warn-primary);--ob-mut:var(--dsw-alias-label-secondary);--ob-bg-1:var(--dsw-alias-bg-layer-1);--ob-bg-2:var(--dsw-alias-bg-layer-2);--ob-line:var(--dsw-alias-border-l2);--ob-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);--ob-r-sm:var(--dsw-radius-sm);--ob-r-md:var(--dsw-radius-md);--ob-r-lg:var(--dsw-radius-lg)}',
	'.ob-page{display:flex;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:13px;-webkit-font-smoothing:antialiased}',
	'.ob-page ::-webkit-scrollbar{width:8px;height:8px}',
	'.ob-page ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:999px;border:2px solid transparent;background-clip:padding-box}',
	'.ob-sidebar{flex:none;display:flex;flex-direction:column;gap:8px;border-right:1px solid var(--ob-line);padding:12px 10px;overflow-y:auto;box-sizing:border-box;position:relative}',
	'.ob-sidebar h3{margin:2px 0 0;font-size:11px;font-weight:650;letter-spacing:.6px;color:var(--ob-mut);text-transform:uppercase}',
	'.ob-status{display:flex;flex-direction:column;gap:5px;border:1px solid var(--ob-line);border-radius:var(--ob-r-md);background:var(--ob-bg-2);padding:9px 10px;font-size:12px}',
	'.ob-status-row{display:flex;justify-content:space-between;gap:8px;align-items:center;min-width:0}',
	'.ob-status-key{color:var(--ob-mut);flex:none}',
	'.ob-status-val{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	'.ob-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--ob-mut)}',
	'.ob-dot.ok{background:var(--ob-ok)}',
	'.ob-dot.bad{background:var(--ob-err)}',
	'.ob-dot.warn{background:var(--ob-warn);animation:obBlink 1.2s infinite}',
	'@keyframes obBlink{50%{opacity:.4}}',
	'.ob-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--ob-line);border-radius:var(--ob-r-sm);padding:6px 12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s;font-family:inherit}',
	'.ob-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}',
	'.ob-btn:disabled{opacity:.45;cursor:not-allowed}',
	'.ob-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
	'.ob-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}',
	'.ob-input{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:var(--ob-r-md);border:1px solid var(--ob-line);background:var(--ob-bg-1);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;transition:border-color .15s;font-family:inherit}',
	'.ob-input:focus{border-color:var(--ob-accent)}',
	'.ob-input::placeholder{color:var(--ob-mut)}',
	'.ob-notes{display:flex;flex-direction:column;gap:2px;overflow-y:auto;flex:1;min-height:60px}',
	// 关键：行不可收缩——flex 列子项默认 flex-shrink:1，内容超高时行会被压扁重叠而非滚动
	'.ob-notes > *{flex:none}',
	'.ob-notes-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
	'.ob-sort{display:flex;gap:2px;border:1px solid var(--ob-line);border-radius:var(--ob-r-sm);overflow:hidden}',
	'.ob-sort-btn{background:transparent;border:none;color:var(--ob-mut);font-size:10px;padding:2px 7px;cursor:pointer;font-family:inherit;line-height:16px}',
	'.ob-sort-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
	'.ob-sort-btn.sel{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--ob-accent);font-weight:600}',
	'.ob-dir-head{font-size:10px;color:var(--ob-mut);padding:7px 4px 2px;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--ob-mono)}',
	// 文件树（仿 Obsidian 文件浏览器）：目录可收缩、嵌套缩进、箭头旋转
	'.ob-tree-folder{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:600;padding:5px 4px;cursor:pointer;font-family:inherit;text-align:left;white-space:nowrap;overflow:hidden;line-height:1.4;border-radius:var(--ob-r-sm)}',
	'.ob-tree-folder:hover{background:var(--dsw-alias-interactive-bg-hover)}',
	'.ob-tree-arrow{flex:none;width:12px;height:12px;display:inline-flex;align-items:center;justify-content:center;color:var(--ob-mut);font-size:9px;transition:transform .15s}',
	'.ob-tree-folder.open .ob-tree-arrow{transform:rotate(90deg)}',
	'.ob-tree-folder .cnt{flex:none;font-size:10px;color:var(--ob-mut);font-family:var(--ob-mono)}',
	'.ob-tree-children{display:flex;flex-direction:column;gap:2px;border-left:1px solid var(--ob-line);margin-left:10px;padding-left:3px}',
	'.ob-note{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:var(--ob-r-sm);cursor:pointer;border:1px solid transparent;text-align:left;width:100%;background:transparent;color:inherit;font-family:inherit}',
	'.ob-note:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--ob-line)}',
	'.ob-note-title{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	'.ob-note-sub{font-size:10.5px;color:var(--ob-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	'.ob-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}',
	'.ob-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid var(--ob-line);flex:none}',
	'.ob-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;letter-spacing:.2px}',
	'.ob-title::before{content:"";width:4px;height:16px;border-radius:2px;background:var(--ob-accent)}',
	'.ob-head-meta{display:flex;align-items:center;gap:8px;color:var(--ob-mut);font-size:11.5px}',
	'.ob-chat{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:14px 16px}',
	'.ob-msg{display:flex;flex-direction:column;gap:5px;max-width:78%}',
	'.ob-msg.user{align-self:flex-end;align-items:flex-end}',
	'.ob-msg.assistant{align-self:flex-start;align-items:flex-start}',
	'.ob-bubble{border:1px solid var(--ob-line);border-radius:var(--ob-r-lg);padding:10px 12px;font-size:13px;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap;box-sizing:border-box;max-width:100%}',
	'.ob-msg.user .ob-bubble{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:transparent}',
	'.ob-msg.assistant .ob-bubble{background:var(--ob-bg-2)}',
	'.ob-cites{display:flex;flex-wrap:wrap;gap:5px;max-width:100%}',
	'.ob-cite{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--ob-line);background:var(--ob-bg-1);color:var(--ob-mut);border-radius:999px;padding:2px 9px;font-size:10.5px;cursor:pointer;font-family:inherit}',
	'.ob-cite:hover{color:var(--ob-accent);border-color:var(--ob-accent)}',
	'.ob-cite .n{font-weight:700;color:var(--ob-accent)}',
	'.ob-err{border:1px solid var(--ob-err);background:color-mix(in srgb,var(--ob-err) 8%,transparent);color:var(--ob-err);border-radius:var(--ob-r-md);padding:9px 12px;font-size:12px;overflow-wrap:anywhere}',
	'.ob-spin{width:14px;height:14px;border:2px solid var(--ob-line);border-top-color:var(--ob-accent);border-radius:50%;animation:obSpin .9s linear infinite;flex:none}',
	'@keyframes obSpin{to{transform:rotate(360deg)}}',
	'.ob-composer{display:flex;flex-direction:column;gap:6px;padding:10px 14px;border-top:1px solid var(--ob-line);flex:none}',
	// composer 元信息行：模型选择器 + 推理档位（与主对话页「选择器贴输入框」同位）
	'.ob-composer-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-height:24px}',
	'.ob-composer-row{display:flex;gap:8px;align-items:flex-end}',
	'.ob-model-area{position:relative;display:inline-flex;align-items:center}',
	'.ob-model-menu{position:absolute;bottom:calc(100% + 8px);left:0;z-index:40;min-width:300px;max-height:360px;overflow-y:auto;background:var(--ob-bg-1);border:1px solid var(--ob-line);border-radius:var(--ob-r-md);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;text-align:left}',
	'.ob-composer textarea{flex:1;box-sizing:border-box;min-height:60px;max-height:180px;resize:vertical;padding:9px 11px;border-radius:var(--ob-r-md);border:1px solid var(--ob-line);background:var(--ob-bg-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-family,inherit);line-height:1.5;outline:none;transition:border-color .15s}',
	'.ob-composer textarea:focus{border-color:var(--ob-accent)}',
	'.ob-composer textarea::placeholder{color:var(--ob-mut)}',
	'.ob-empty{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}',
	'.ob-empty-card{border:1px dashed var(--ob-line);border-radius:var(--ob-r-lg);padding:22px 26px;text-align:center;display:flex;flex-direction:column;gap:10px;max-width:460px;font-size:12.5px;color:var(--ob-mut)}',
	'.ob-empty-card b{font-size:14px;color:var(--dsw-alias-label-primary)}',
	'.ob-ref{width:380px;min-width:280px;flex:none;display:flex;flex-direction:column;border-left:1px solid var(--ob-line);min-height:0}',
	'.ob-ref-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--ob-line);flex:none;min-width:0}',
	'.ob-ref-title{font-size:12.5px;font-weight:650;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	'.ob-ref-body{flex:1;overflow:auto;padding:12px 14px;font-size:12.5px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box}',
	'.ob-ref-meta{font-size:11px;color:var(--ob-mut);padding:0 14px 10px}',
	'.ob-actions{display:flex;gap:6px;align-items:center}',
	'.ob-msg-actions{display:flex;gap:10px;align-items:center;margin-top:6px;font-size:10.5px;color:var(--ob-mut);flex-wrap:wrap}',
	'.ob-usage{font-family:var(--ob-mono);opacity:.85}',
	'.ob-msg-btn{background:none;border:none;color:var(--ob-mut);font-size:10.5px;cursor:pointer;padding:0;font-family:inherit}',
	'.ob-msg-btn:hover{color:var(--ob-accent)}',
	// 思考过程块：弱化视觉层级（斜体灰字），与正文明确区分
	'.ob-think{border:1px solid var(--ob-line);border-left:3px solid var(--ob-accent);border-radius:var(--ob-r-sm);background:var(--ob-bg-1);margin:2px 0 6px;opacity:.92}',
	'.ob-think-head{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;color:var(--ob-mut);font-size:11px;padding:6px 9px;cursor:pointer;font-family:inherit;text-align:left}',
	'.ob-think-head:hover{color:var(--ob-accent)}',
	'.ob-think-body{max-height:200px;overflow-y:auto;padding:2px 10px 8px;font-size:11.5px;line-height:1.6;color:var(--ob-mut);white-space:pre-wrap;overflow-wrap:anywhere;font-style:italic}',
	// 模型 chips（下拉行内：免费/徽章）与推理档位 chips（选择器旁）
	'.ob-chip{flex:none;display:inline-flex;align-items:center;border:1px solid var(--ob-line);border-radius:999px;padding:0 6px;font-size:9.5px;line-height:15px;color:var(--ob-mut);white-space:nowrap}',
	'.ob-chip-free{color:var(--ob-ok);border-color:color-mix(in srgb,var(--ob-ok) 45%,transparent)}',
	'.ob-efforts{display:inline-flex;gap:3px;align-items:center}',
	'.ob-chip-btn{background:transparent;border:1px solid var(--ob-line);border-radius:999px;color:var(--ob-mut);font-size:10px;padding:1px 8px;cursor:pointer;font-family:var(--ob-mono);line-height:16px}',
	'.ob-chip-btn:hover{border-color:var(--ob-accent);color:var(--ob-accent)}',
	'.ob-chip-btn.sel{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--ob-accent);color:var(--ob-accent);font-weight:600}',
	// 左侧 vault 列表拖拽手柄：命中区 7px（可见 1px 分隔线 + hover/拖拽高亮）
	'.ob-resizer{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:5;background:transparent;border:none;padding:0}',
	'.ob-resizer::after{content:"";position:absolute;top:0;right:3px;width:1px;height:100%;background:transparent;transition:background .15s}',
	'.ob-resizer:hover::after,.ob-resizer.active::after{background:var(--ob-accent)}',
	'.ob-resizer:focus-visible{outline:2px solid var(--ob-accent);outline-offset:-2px}',
].join('\n');

// ── 常量与工具 ──────────────────────────────────────────────────────
const PANEL_ID = 'dsh-obsidian-board';
const PANEL_LABEL = 'Obsidian';
const HISTORY_KEY = 'dsh-obsidian-board/history';
const DRAFT_KEY = 'dsh-obsidian-board/draft';
const SORT_KEY = 'dsh-obsidian-board/sort';
const SIDEBAR_KEY = 'dsh-obsidian-board/sidebarWidth';

// 左侧 vault 列表宽度：默认 264，可拖拽在 [200, 560] 间调整，宽度持久化到 localStorage
const SIDEBAR_DEFAULT = 264;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 560;
function clampSidebar(width) {
	const n = Number(width);
	if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
	return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

const LS = {
	get(key, fallback) {
		try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
	},
	set(key, value) {
		try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储被禁用时本次会话内仍生效 */ }
	},
};

// 历史消息净化：pending / isThinking 是**流进行中的瞬时态，绝不能跨会话存活**。
// 截图「永久转圈」的根因：流被中断（停止 / 刷新 / HMR / 切面板）后面板重新挂载，
// localStorage 里仍留着 pending:true 的气泡，而已经没有任何流会再来更新它 →
// 转圈永不结束、正文永不出现。净化规则：
//   pending/isThinking 一律清掉；若这条 assistant 消息最终没有正文也没错误，
//   标记 interrupted，由渲染层显示「已中断」而不是空白或转圈。
function sanitizeHistory(list) {
	if (!Array.isArray(list)) return [];
	return list
		.filter((m) => m && typeof m === 'object')
		.map((m) => {
			if (!m.pending && !m.isThinking) return m;
			const next = { ...m, pending: false, isThinking: false };
			if (m.role === 'assistant' && !String(m.content || '').trim() && !m.error) next.interrupted = true;
			return next;
		});
}

const MODULE_CTX = { ctx: null };

// 切到本页：当前已在本页时再点一次回到对话（与 mcp-board 同一切换语义）。
function openObsidianPanel() {
	const ctx = MODULE_CTX.ctx;
	const layout = ctx && typeof ctx.get === 'function' ? ctx.get('layout') : null;
	if (!layout || typeof layout.selectPanel !== 'function') return;
	const snap = layout.panelInfo && layout.panelInfo.getSnapshot ? layout.panelInfo.getSnapshot() : null;
	const active = snap ? snap.activePanelId : undefined;
	layout.selectPanel(active === PANEL_ID ? null : PANEL_ID);
}

// ── 图标（自绘，不引宿主包）────────────────────────────────────────
const ICONS = {
	// 切割面宝石：线性风格，与侧栏其它图标同规格（24 viewBox / 1.7 stroke）。
	obsidian: 'M12 2.6 20 8.2l-3 11.2H7L4 8.2ZM4 8.2h16M12 2.6 8.6 8.2 12 19.4l3.4-11.2Z',
	search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm5.6 13.1L21 21',
	send: 'M3 11.5 21 3l-8.5 18-2-7.5Z',
	refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 3v5h-5',
	clear: 'M5 5l14 14M19 5 5 19',
	book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5ZM20 19.5H6.5A2.5 2.5 0 0 0 4 22',
};
const FILLED = new Set([]);

const Icon = ({ d, size, className }) =>
	h('svg', {
		viewBox: '0 0 24 24', width: size || 16, height: size || 16, className,
		fill: FILLED.has(d) ? 'currentColor' : 'none',
		stroke: FILLED.has(d) ? 'none' : 'currentColor',
		strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
	}, h('path', { d }));

// ── 入口组件（行点击由宿主承担，这里只画图形）───────────────────────
// 唯一入口：侧栏左上角「全局面板」行（panellist）。底部 footer 入口已按需求移除。
const PanelIcon = ({ size, active }) =>
	h(Icon, { d: ICONS.obsidian, size: size || 18, className: active ? 'ob-panel-icon active' : 'ob-panel-icon' });

// ── 轻量 Markdown 块级渲染 ─────────────────────────────────────────
// 只处理 AI 回答里实际出现的形状：标题 / 无序·有序列表 / 代码块 / 行内代码 /
// 粗体 / [[wikilink]] / 引用块 / 分隔线 / 段落。不求全，求「看起来像回答」。
const MD_STYLE = {
	h1: { fontSize: 16, fontWeight: 700, margin: '10px 0 4px' },
	h2: { fontSize: 15, fontWeight: 700, margin: '9px 0 4px' },
	h3: { fontSize: 13.5, fontWeight: 650, margin: '8px 0 3px' },
	li: { marginLeft: 18, lineHeight: 1.6 },
	pre: { background: 'var(--ob-bg-1)', border: '1px solid var(--ob-line)', borderRadius: 'var(--ob-r-md)', padding: '9px 11px', overflowX: 'auto', margin: '7px 0', fontFamily: 'var(--ob-mono)', fontSize: 12, lineHeight: 1.5 },
	quote: { borderLeft: '3px solid var(--ob-accent)', paddingLeft: 10, margin: '6px 0', color: 'var(--dsw-alias-label-secondary)' },
	wikilink: { color: 'var(--ob-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 },
	hr: { border: 'none', borderTop: '1px solid var(--ob-line)', margin: '10px 0' },
};

function renderMarkdown(text, { onCite, onWiki } = {}) {
	const lines = String(text).split(/\r?\n/);
	const out = [];
	let key = 0;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		// 代码块
		const fence = line.match(/^```(\w*)/);
		if (fence) {
			const code = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
			i++; // 跳过收尾 ```
			out.push(h('pre', { key: 'k' + (key++), style: MD_STYLE.pre }, h('code', null, code.join('\n'))));
			continue;
		}
		// 标题
		const hm = line.match(/^(#{1,3})\s+(.*)$/);
		if (hm) {
			const tag = 'h' + hm[1].length;
			out.push(h(tag, { key: 'k' + (key++), style: MD_STYLE[tag] }, renderInline(hm[2], onCite, onWiki)));
			i++;
			continue;
		}
		// 分隔线
		if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push(h('hr', { key: 'k' + (key++) })); i++; continue; }
		// 无序列表（连续行聚成一组）
		if (/^\s*[-*+]\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
				i++;
			}
			out.push(h('ul', { key: 'k' + (key++), style: { margin: '4px 0', paddingLeft: 4 } },
				items.map((t, n) => h('li', { key: 'li' + n, style: MD_STYLE.li, ...{} }, renderInline(t, onCite, onWiki)))));
			continue;
		}
		// 有序列表
		if (/^\s*\d+[.)]\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
				i++;
			}
			out.push(h('ol', { key: 'k' + (key++), style: { margin: '4px 0', paddingLeft: 4 } },
				items.map((t, n) => h('li', { key: 'li' + n, style: MD_STYLE.li }, renderInline(t, onCite, onWiki)))));
			continue;
		}
		// 引用块
		if (/^>\s?/.test(line)) {
			const quote = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
			out.push(h('blockquote', { key: 'k' + (key++), style: MD_STYLE.quote }, renderMarkdown(quote.join('\n'), { onCite, onWiki })));
			continue;
		}
		// 空行
		if (!line.trim()) { i++; continue; }
		// 普通段落（连续非空非特殊行）
		const para = [line];
		i++;
		while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|>\s?)/.test(lines[i])) {
			para.push(lines[i]);
			i++;
		}
		out.push(h('div', { key: 'k' + (key++), style: { margin: '2px 0' } }, renderInline(para.join('\n'), onCite, onWiki)));
	}
	return out;
}
function renderInline(text, onCite, onWiki) {
	const parts = [];
	let rest = String(text);
	let key = 0;
	const push = (node) => parts.push(h(node.type, { key: 'k' + (key++), ...node.props }, node.children));
	// 依序匹配：[[wikilink]]、[n] 引用、`code`、**bold**
	const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[(\d{1,2})\]|`([^`]+)`|\*\*([^*]+)\*\*/g;
	let last = 0;
	let m;
	while ((m = re.exec(rest)) !== null) {
		if (m.index > last) push({ type: 'span', props: {}, children: rest.slice(last, m.index) });
		if (m[1] !== undefined) {
			const target = m[1].trim();
			const label = (m[2] || m[1]).trim();
			push({
				type: 'button', props: {
					type: 'button', style: MD_STYLE.wikilink, title: '打开笔记：' + target,
					onClick: () => onWiki && onWiki(target),
				}, children: label,
			});
		} else if (m[3] !== undefined) {
			push({
				type: 'button', props: {
					type: 'button', className: 'ob-cite', style: { padding: '0 7px', margin: '0 1px' },
					title: '查看引用 ' + m[3],
					onClick: () => onCite && onCite(Number(m[3])),
				}, children: '[' + m[3] + ']',
			});
		} else if (m[4] !== undefined) {
			push({ type: 'code', props: { style: { fontFamily: 'var(--ob-mono)', fontSize: '12px', background: 'var(--ob-bg-1)', borderRadius: 'var(--ob-r-sm)', padding: '1px 5px' } }, children: m[4] });
		} else if (m[5] !== undefined) {
			push({ type: 'b', props: {}, children: m[5] });
		}
		last = m.index + m[0].length;
	}
	if (last < rest.length) push({ type: 'span', props: {}, children: rest.slice(last) });
	return parts;
}

// ── 思考过程块（可折叠）─────────────────────────────────────────────
// 思考中：展开 + 自动滚到底，让用户实时看到模型在想什么；
// 有正文后：默认折叠成一行「已深度思考(N 字)」，点击可回看。
function ThinkBlock({ text, open }) {
	const [expanded, setExpanded] = useState(!!open);
	const [wasOpen, setWasOpen] = useState(!!open);
	const bodyRef = useRef(null);
	// open 状态翻转时跟随（思考中→展开；出正文→折叠）
	useEffect(() => {
		if (!!open !== wasOpen) { setWasOpen(!!open); setExpanded(!!open); }
	}, [open, wasOpen]);
	// 展开且内容增长时滚到底
	useEffect(() => {
		if (expanded && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
	}, [expanded, text]);
	const body = String(text || '');
	const summary = expanded ? '收起思考过程' : '已深度思考（' + body.length + ' 字）· 点击展开';
	return h('div', { className: 'ob-think' + (expanded ? ' open' : '') },
		h('button', {
			type: 'button', className: 'ob-think-head',
			onClick: () => setExpanded((v) => !v),
			'aria-expanded': expanded,
		},
			h('span', { style: { fontSize: 10, opacity: .7 } }, expanded ? '▼' : '▶'),
			summary,
		),
		expanded
			? h('div', { className: 'ob-think-body', ref: bodyRef }, body || '（暂无思考内容）')
			: null,
	);
}

// ── 主页面 ──────────────────────────────────────────────────────────
// ── 文件树构树（仿 Obsidian 文件浏览器）────────────────────────────
// 把 listNotes 的平铺行（含 dir 字段）构建成嵌套树：目录节点 + 笔记叶子。
// 纯函数，便于测试抽取。目录名排序不区分大小写（与 Obsidian 一致）。
function buildNoteTree(rows) {
	const root = { name: '', path: '', dirs: new Map(), notes: [] };
	for (const n of rows || []) {
		const parts = String(n.dir || '').split('/').filter(Boolean);
		let cur = root;
		let acc = '';
		for (const p of parts) {
			acc = acc ? acc + '/' + p : p;
			if (!cur.dirs.has(p)) cur.dirs.set(p, { name: p, path: acc, dirs: new Map(), notes: [] });
			cur = cur.dirs.get(p);
		}
		cur.notes.push(n);
	}
	const sortDir = (d) => {
		for (const child of d.dirs.values()) sortDir(child);
		d.notes.sort((a, b) => String(a.title || a.path).localeCompare(String(b.title || b.path), undefined, { sensitivity: 'base' }));
	};
	sortDir(root);
	return root;
}

// 渲染树节点（递归）：目录行（箭头+名+计数）+ 子节点容器；笔记叶子复用 ob-note 行。
function renderTreeChildren(node, { collapsed, toggleFolder, renderLeaf }) {
	const out = [];
	for (const dir of node.dirs.values()) {
		const isOpen = !collapsed.has(dir.path);
		out.push(h('button', {
			key: 'dir:' + dir.path, type: 'button',
			className: 'ob-tree-folder' + (isOpen ? ' open' : ''),
			'aria-expanded': isOpen,
			onClick: () => toggleFolder(dir.path),
		},
			h('span', { className: 'ob-tree-arrow' }, '▶'),
			h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, dir.name),
			h('span', { className: 'cnt' }, String(dir.notes.length)),
		));
		if (isOpen) {
			out.push(h('div', { key: 'kids:' + dir.path, className: 'ob-tree-children' },
				renderTreeChildren(dir, { collapsed, toggleFolder, renderLeaf })));
		}
	}
	for (const n of node.notes) out.push(renderLeaf(n));
	return out;
}

const ObsidianPage = ({ call }) => {
	const [status, setStatus] = useState(null);
	const [notes, setNotes] = useState({ notes: [], total: 0 });
	// 载入即净化：把上次会话残留的 pending/isThinking 收尾（否则永久转圈，见 sanitizeHistory 注释）
	const [messages, setMessages] = useState(() => sanitizeHistory(LS.get(HISTORY_KEY, [])));
	const messagesRef = useRef(messages);
	useEffect(() => { messagesRef.current = messages; }, [messages]);
	const [draft, setDraft] = useState(() => LS.get(DRAFT_KEY, ''));
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState(null);       // 右栏整篇笔记
	const [noteLoading, setNoteLoading] = useState(false);
	const [query, setQuery] = useState('');
	const [noteSort, setNoteSort] = useState(() => LS.get(SORT_KEY, 'mtime')); // mtime | name | path
	// 文件树收缩状态（仅目录视图）：记录被折叠的目录名，默认全部展开（与 Obsidian 首次打开一致）
	const [collapsedDirs, setCollapsedDirs] = useState(() => LS.get('dsh-obsidian-board/collapsedDirs', []));
	const [notesError, setNotesError] = useState('');
	const [configuring, setConfiguring] = useState(false);
	// 选择仓库位置模式的状态
	const [vaults, setVaults] = useState([]);            // 发现的 vault 列表
	const [discovering, setDiscovering] = useState(false);
	const [picking, setPicking] = useState(false);       // 系统目录对话框进行中
	const [discoverError, setDiscoverError] = useState('');
	const [switching, setSwitching] = useState(false);   // 已连接后的「换仓库」模式
	const discoverTried = useRef(false);
	// 模型选择器
	const [modelList, setModelList] = useState(null);    // {providers, models}
	const [selProvider, setSelProvider] = useState('');  // '' = 宿主默认路由
	const [selModel, setSelModel] = useState('');        // '' = provider 默认
	const [selEffort, setSelEffort] = useState(null);    // null = 跟随默认规则；'' = 上游默认；'low'... = 显式档位
	const [modelOpen, setModelOpen] = useState(false);
	// 左侧 vault 列表宽度（可拖拽）：持久化到 localStorage，跨会话保留
	const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(LS.get(SIDEBAR_KEY, SIDEBAR_DEFAULT)));
	const [resizing, setResizing] = useState(false);
	const sidebarRef = useRef(null);
	const chatRef = useRef(null);
	const loadedRef = useRef(false);

	// 拖拽调宽：pointer 事件 + setPointerCapture（拖出面板也跟手），
	// 拖拽中锁 body 光标并禁文本选择，避免误选聊天内容。
	const onResizeStart = useCallback((e) => {
		if (e.button !== undefined && e.button !== 0) return; // 只响应左键
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sidebarRef.current ? sidebarRef.current.getBoundingClientRect().width : sidebarWidth;
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		setResizing(true);
		try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 老浏览器无此 API */ }
		const onMove = (ev) => {
			// 用起始宽度 + 位移计算，避免逐帧累积误差
			setSidebarWidth(clampSidebar(startWidth + (ev.clientX - startX)));
		};
		const onUp = () => {
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
			setResizing(false);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}, [sidebarWidth]);

	// 键盘可达（可访问性）：←/→ 步进 16px，Shift 加速 48px，Home 复位
	const onResizeKey = useCallback((e) => {
		const step = e.shiftKey ? 48 : 16;
		if (e.key === 'ArrowLeft') { e.preventDefault(); setSidebarWidth((w) => clampSidebar(w - step)); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth((w) => clampSidebar(w + step)); }
		else if (e.key === 'Home') { e.preventDefault(); setSidebarWidth(SIDEBAR_DEFAULT); }
	}, []);

	// 宽度持久化（拖拽结束后写入，避免每帧写 localStorage）
	useEffect(() => {
		if (resizing) return;
		LS.set(SIDEBAR_KEY, sidebarWidth);
	}, [sidebarWidth, resizing]);

	// 首次拉数据。关键顺序：status 先行（宿主半在 status 里触发索引），完成后再拉
	// listNotes——并行发出时冷启动会竞态（listNotes 先回来是 0，status 后到但列表不重拉，
	// 笔记面板停留在 0，表现为「识别到了但不显示」）。
	const applyNoteListRef = useRef(() => {});
	useEffect(() => {
		if (loadedRef.current) return;
		loadedRef.current = true;
		let alive = true;
		(async () => {
			const res = await call('status').catch(() => null);
			if (!alive) return;
			if (res && res.ok) {
				setStatus(res);
				// 已配置 vault → status 已带索引结果；但保险起见串行再拉一次完整列表
				if (res.configured) {
					const list = await call('listNotes', { sort: noteSort }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
					if (alive) applyNoteListRef.current(list);
				}
			}
			// 未配置/失败时也拉一次（配置卡之后的发现逻辑会接手）
			const list2 = alive ? await call('listNotes', { sort: noteSort }).catch((e) => ({ ok: false, error: String(e && e.message || e) })) : null;
			if (alive && list2) {
				applyNoteListRef.current(list2);
			}
		})();
		call('listModels').then((res) => {
			if (alive && res && res.ok) {
				setModelList({ providers: res.providers || [], models: res.models || [], source: res.source || '', providerCount: res.providerCount || 0 });
				setSelProvider(res.defaultProvider || '');
				setSelModel(res.defaultModel || '');
				setSelEffort(null); // null = 跟随默认规则（catalog defaultEffort / 配置默认）
			}
		}).catch(() => {});
		return () => { alive = false; };
	}, [call]);

	// 当前选中模型的目录行（富化信息 + 档位集）
	const selRow = useMemo(() => {
		if (!selModel || !modelList || !Array.isArray(modelList.models)) return null;
		return modelList.models.find((m) => m.model === selModel && (!selProvider || m.provider === selProvider)) || null;
	}, [modelList, selModel, selProvider]);
	// 生效档位集：选中模型声明了档位 → 用之；否则空（不发 effort，跟随上游）
	const selEfforts = useMemo(() => (Array.isArray(selRow?.efforts) ? selRow.efforts : []), [selRow]);

	// 选择模型 → 持久到宿主半 config（本面板会话生效；写进 profile 要手动改 patch）
	// 换模型时清掉显式档位（新模型档位集不同），回到「跟随默认规则」。
	const applyModel = useCallback(async (provider, model) => {
		setSelProvider(provider);
		setSelModel(model);
		setSelEffort(null);
		setModelOpen(false);
		call('configure', { provider, model }).then((res) => {
			if (res && res.ok) setStatus(res);
		}).catch(() => {});
	}, [call]);

	// 选择推理档位（仅客户端记录，随每条消息下发 chatStart；不写宿主 config——
	// 与主对话页同构：模型+档位是「发送时」的选择）
	const applyEffort = useCallback((effort) => {
		setSelEffort(effort);
	}, []);

	// 持久化历史与草稿
	// 持久化历史与草稿。落盘前净化：绝不把 pending/isThinking 写进存储——
	// 它们是「此刻有活跃流」的瞬时态，一旦跨会话存活就变成永久转圈。
	useEffect(() => { LS.set(HISTORY_KEY, sanitizeHistory(messages).slice(-40)); }, [messages]);
	useEffect(() => { LS.set(DRAFT_KEY, draft); }, [draft]);

	// 新消息/回答完成时滚到底；模型下拉点外部关闭
	useEffect(() => {
		const el = chatRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages.length, busy]);
	useEffect(() => {
		if (!modelOpen) return;
		const close = (e) => {
			// 点在选择器按钮/菜单/chips 区域内不关（选择器贴在输入框上方）
			if (e.target && e.target.closest && e.target.closest('.ob-composer-meta')) return;
			setModelOpen(false);
		};
		document.addEventListener('click', close);
		return () => document.removeEventListener('click', close);
	}, [modelOpen]);

	const updateStatus = useCallback((res) => {
		if (res && res.ok) setStatus(res);
	}, [call]);

	// refs 供渲染回调读取最新列表（wikilink 解析 / 搜索跳转）
	const notesRef = useRef(notes);
	useEffect(() => { notesRef.current = notes; }, [notes]);
	const doSearchRef = useRef(null); // doSearch 定义后回填

	// 保存回答为笔记
	const [savedTip, setSavedTip] = useState({});
	const saveAnswer = useCallback(async (m) => {
		if (!m || !m.content || !m.content.trim()) return;
		const idx = messagesRef.current.indexOf(m);
		const res = await call('saveNote', {
			title: (messagesRef.current[idx - 1] || {}).content || '',
			content: m.content,
			citations: m.citations || [],
		}).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
		if (res && res.ok) {
			setSavedTip((prev) => ({ ...prev, [idx]: res.path }));
			call('listNotes', { sort: noteSort }).then((list) => { applyNoteListRef.current(list); }).catch(() => {});
		} else {
			setSavedTip((prev) => ({ ...prev, [idx]: '保存失败' }));
		}
	}, [call]);

	// ── 提问（流式会话：chatStart → 轮询 chatPoll → done）──────────
	const activeStream = useRef(null); // {sessionId, received, replyId}
	// 停止意向标志：覆盖「chatStart 还在跑（检索/规划）」这段没有 sessionId 的窗口——
	// 历史版本 stopStream 只在 activeStream.current 存在时才发 chatStop，那段窗口里
	// 点停止完全空转，气泡卡在「检索知识库并生成回答…」，用户视角＝停止按钮失灵。
	const stopRequested = useRef(false);
	// 流轮次 token：每轮 send 自增并捕获自己的序号；finally 里只有在「自己仍是最新一轮」
	// 时才清 activeStream/busy。否则「停止 → 立刻重发」时，旧轮的 finally 会把新一轮的
	// busy 清掉（新气泡不再转圈、文本框提前解冻），状态互相踩。
	const streamSeq = useRef(0);
	// send 接受可选的显式问题（字符串）：重试路径传上一问（setDraft 是异步的，闭包里的
	// draft 还是旧值——历史版本 setTimeout 后读闭包 draft 永远是 ''，重试按钮点了没反应）。
	// 参数校验从严：React onClick 会把**点击事件对象**当第一个参数传进来，若原样使用
	// 就会把 String(event) = "[object Object]" 当成问题发出去（实测 bug）。
	// 因此：只有 typeof === 'string' 才视为显式问题，其余（事件、undefined、null）一律回到 draft。
	const send = useCallback(async (overrideQuestion) => {
		const question = String(typeof overrideQuestion === 'string' ? overrideQuestion : draft).trim();
		if (!question || busy) return;
		setDraft('');
		const history = messagesRef.current
			.filter((m) => m && typeof m.content === 'string' && m.content && !m.pending)
			.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
		// 本条回复的稳定 id：整轮流式更新都靠它定位（见下方 patchReply 注释）
		const replyId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		setMessages((prev) => [...prev, { role: 'user', content: question, ts: Date.now() }, { id: replyId, role: 'assistant', content: '', pending: true }]);
		setBusy(true);
		// 本轮序号：停止后立刻重发时，旧轮的 finally 不得清新轮的状态
		const mySeq = ++streamSeq.current;
		stopRequested.current = false;
		// 用**稳定 id** 定位本条回复，而不是靠 pending 标志：
		// 两条 setMessages 交错时（流式 delta 与状态补丁并发），按 pending 匹配会
		// 命中错的目标或落空，导致「已显示的文本被丢掉/后续增量写不进去」。
		const patchReply = (patch) => setMessages((prev) => {
			const idx = prev.findIndex((m) => m && m.id === replyId);
			if (idx < 0) return prev; // 目标已不存在（被清空/删除）——保持数组引用不变
			const next = prev.slice();
			next[idx] = { ...next[idx], ...patch };
			return next;
		});
		const appendDelta = (delta) => setMessages((prev) => {
			const idx = prev.findIndex((m) => m && m.id === replyId);
			if (idx < 0) return prev;
			const next = prev.slice();
			next[idx] = { ...next[idx], content: (next[idx].content || '') + delta };
			return next;
		});
		// 思考增量：单独字段攒（不混进 content，渲染成可折叠思考块）
		const appendThink = (delta) => setMessages((prev) => {
			const idx = prev.findIndex((m) => m && m.id === replyId);
			if (idx < 0) return prev;
			const next = prev.slice();
			next[idx] = { ...next[idx], thinking: (next[idx].thinking || '') + delta };
			return next;
		});
		try {
			// 消息级路由（与主对话页同构）：选择器选了具体模型就随消息下发；
			// 档位：null=跟随默认规则（宿主 resolveEffort），''=上游默认，'low'…=显式。
			const override = selModel ? { provider: selProvider, model: selModel } : {};
			const effortParam = selEffort === null ? {} : { effort: selEffort };
			const start = await call('chatStart', { question, history, ...override, ...effortParam });
			// chatStart 期间被点了停止：宿主已按中止收尾，这里直接落定终态，别再轮询。
			if (stopRequested.current) {
				patchReply({ pending: false, stopped: true });
				return;
			}
			if (!start.ok) { patchReply({ pending: false, error: start.error || '启动失败' }); return; }
			const sessionId = start.sessionId;
			const citations = start.citations || [];
			activeStream.current = { sessionId, received: 0, receivedThink: 0, replyId, attempt: 1 };
			patchReply({ citations });
			// 轮询增量，300ms 间隔；done/error 终止。客户端侧上限 = 宿主 300s + 缓冲，
			// 宿主若整进程卡死（HMR 更换、连接重建）这里也能自愈。
			const pollDeadline = Date.now() + 330000;
			for (;;) {
				// 用户已点停止：轮询到此为止（宿主那边也在同一时刻收到 abort，两边一致）
				if (stopRequested.current) {
					patchReply({ pending: false, stopped: true });
					return;
				}
				await new Promise((r) => setTimeout(r, 300));
				if (Date.now() > pollDeadline) {
					patchReply({ pending: false, error: '等待回答超时（330 秒）——宿主可能已卡住，请重试或重启 DSH。' });
					return;
				}
				const poll = await call('chatPoll', { sessionId, received: activeStream.current.received, receivedThink: activeStream.current.receivedThink || 0 });
				if (!poll.ok) { patchReply({ pending: false, error: poll.error || '轮询失败' }); return; }
				// 宿主换了下一条候选路由：缓冲已被清空，本轮的 delta 是按旧偏移算的，
				// 直接丢弃并同步重置偏移 + 抹掉气泡里上一轮的残文，下一轮从头收新回答。
				// （不这么做就会输出错乱：残余正文与新正文拼接、或新回答因长度不及旧偏移而永不显示。）
				if (poll.attempt && activeStream.current.attempt && poll.attempt !== activeStream.current.attempt) {
					activeStream.current.attempt = poll.attempt;
					activeStream.current.received = 0;
					activeStream.current.receivedThink = 0;
					patchReply({ content: '', thinking: '', error: '' });
					continue;
				}
				if (poll.attempt) activeStream.current.attempt = poll.attempt;
				if (poll.thinkDelta) {
					activeStream.current.receivedThink = (activeStream.current.receivedThink || 0) + poll.thinkDelta.length;
					appendThink(poll.thinkDelta);
				}
				if (poll.delta) {
					activeStream.current.received += poll.delta.length;
					appendDelta(poll.delta);
				}
				if (poll.usage) patchReply({ usage: poll.usage });
				if (poll.provider) patchReply({ provider: poll.provider, model: poll.model });
				// 宿主已进入停止终态：立刻收尾，不再等 poll.done（后台段可能正卡在
				// 上游静默期的 await 里，永远不会自己把 done 置真 → 气泡一直转圈）。
				if (poll.stopped) {
					patchReply({ pending: false, stopped: true });
					return;
				}
				// 思考阶段提示：onlyReasoning 模型（glm-5.3-flash 等）先思考后回答，
				// 思考期可达分钟级——让用户看到「在思考」而不是「卡死转圈」。
				// 注意：标记叫 isThinking，不能与 m.thinking（累积思考文本）撞名。
				if (poll.thinking) patchReply({ isThinking: true });
				if (poll.error) {
					// 宿主已把「用户主动停止」与真实故障分开（「已停止」是中性文案）：
					// 停止不显示红色错误，正常收尾即可。
					const stopped = poll.aborted === true || poll.error === '已停止';
					patchReply(stopped ? { pending: false, stopped: true } : { pending: false, error: poll.error });
					return;
				}
				if (poll.done) {
					patchReply({ pending: false, stopped: !!poll.aborted });
					return;
				}
			}
		} catch (error) {
			patchReply(stopRequested.current
				? { pending: false, stopped: true }
				: { pending: false, error: String(error && error.message || error) });
		} finally {
			// 只有「自己仍是最新一轮」才回收共享状态：停止后立刻重发时，旧轮的 finally
			// 若照常清空 activeStream/busy，会把新一轮的转圈与输入框锁一起清掉。
			if (streamSeq.current === mySeq) {
				activeStream.current = null;
				stopRequested.current = false; // 本轮结束，复位停止意向
				setBusy(false);
			}
		}
	}, [busy, draft, call, selProvider, selModel, selEffort]);

	// 停止生成：三条路径都要覆盖。
	// ①已有 sessionId → 通知宿主中止（宿主侧 abort 会与「等 chunk」赛跑，静默期也能停住）；
	// ②还没拿到 sessionId（chatStart 正在检索/规划）→ 只置标志，send 会在 chatStart
	//   返回后立刻落定终态，并且不再发起模型调用；
	// ③无论如何先把 UI 解冻（busy=false）——这是用户点「停止」时的第一预期，
	//   不能等宿主确认（历史上宿主卡在静默期时按钮看起来完全没反应）。
	const stopStream = useCallback(async () => {
		if (busy) {
			stopRequested.current = true;
			setBusy(false);
		}
		if (activeStream.current) await call('chatStop', { sessionId: activeStream.current.sessionId }).catch(() => {});
	}, [busy, call]);

	// 重试：删掉最后一条 assistant 回复，重新发送上一问。
	// 关键修复：把上一问**显式传给 send**——setDraft 是异步状态更新，历史版本
	// setTimeout 后读闭包里的 draft 仍是旧值（''），点「重试」永远没反应。
	const retryLast = useCallback(() => {
		const msgs = messagesRef.current;
		let lastQ = '';
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role === 'user' && typeof msgs[i].content === 'string') { lastQ = msgs[i].content; break; }
		}
		// 只删除「末尾连续的 assistant 回复」（错误重试时通常只有一条），
		// 不删除 user 消息，避免把提问也删掉后无法重发。
		setMessages((prev) => {
			const next = prev.slice();
			while (next.length && next[next.length - 1].role === 'assistant') next.pop();
			return next;
		});
		if (lastQ) {
			setDraft('');
			setTimeout(() => send(lastQ), 50);
		}
	}, [send]);

	// ── 侧栏：检索笔记 ─────────────────────────────────────────────
	// 统一落列表结果：成功写 notes，失败写 notesError（再也不静默吞错——
	// 「列表空且无任何提示」正是历次排查的最大障碍）。
	const applyNoteList = useCallback((res, fallbackTotal) => {
		if (res && res.ok) {
			setNotes({ notes: res.notes || [], total: res.total || 0 });
			setNotesError('');
			return true;
		}
		setNotesError((res && res.error) || '笔记列表加载失败');
		if (fallbackTotal !== undefined) setNotes((prev) => ({ notes: [], total: prev.total }));
		return false;
	}, []);

	const doSearch = useCallback(async () => {
		const q = query.trim();
		if (!q) {
			applyNoteList(await call('listNotes', { sort: noteSort }).catch((e) => ({ ok: false, error: String(e && e.message || e) })));
			return;
		}
		const res = await call('search', { query: q, topK: 40 });
		if (res && res.ok) {
			const seen = new Set();
			const list = [];
			for (const hit of (res.hits || [])) {
				if (seen.has(hit.notePath)) continue;
				seen.add(hit.notePath);
				list.push({ path: hit.notePath, title: hit.noteTitle, sub: hit.heading || '', tags: [] });
			}
			setNotes({ notes: list, total: res.noteCount || list.length });
			setNotesError('');
		} else {
			setNotesError((res && res.error) || '检索失败');
		}
	}, [query, call, noteSort, applyNoteList]);
	useEffect(() => { doSearchRef.current = (q) => { setQuery(q); }; }, []); // wikilink 未命中时把目标填进搜索框
	useEffect(() => { applyNoteListRef.current = applyNoteList; }, [applyNoteList]);

	// ── 右栏：整篇笔记 ─────────────────────────────────────────────
	const openNote = useCallback(async (relPath) => {
		setNoteLoading(true);
		try {
			const res = await call('readNote', { path: relPath });
			if (res && res.ok) setNote(res); else setNote({ path: relPath, content: '', error: (res && res.error) || '读取失败' });
		} finally {
			setNoteLoading(false);
		}
	}, [call]);

	// ── 连接/切换 vault（选择仓库位置模式）────────────────────────
	const connectVault = useCallback(async (vaultPath) => {
		const p = String(vaultPath || '').trim();
		if (!p || configuring) return;
		setConfiguring(true);
		try {
			const res = await call('configure', { vaultPath: p });
			updateStatus(res);
			if (res && res.ok) {
				const list = await call('listNotes', { sort: noteSort });
				if (list && list.ok) setNotes({ notes: list.notes || [], total: list.total || 0 });
			}
		} finally {
			setConfiguring(false);
		}
	}, [configuring, call, updateStatus]);

	// 发现：Obsidian 注册表 + 常见位置扫描
	const discover = useCallback(async () => {
		setDiscovering(true);
		try {
			const res = await call('discoverVaults');
			if (res && res.ok) setVaults(res.vaults || []);
			else setDiscoverError((res && res.error) || '扫描失败');
		} finally {
			setDiscovering(false);
		}
	}, [call]);

	// 首次进配置卡自动扫描一次
	useEffect(() => {
		if (status && !status.configured && !vaults.length && !discovering && !discoverTried.current) {
			discoverTried.current = true;
			discover();
		}
	}, [status, vaults.length, discovering, discover]);

	// 系统目录选择对话框（宿主 native capability）；unsupported 时提示用扫描
	const browse = useCallback(async () => {
		if (picking) return;
		setPicking(true);
		try {
			const res = await call('pickVault');
			if (res && res.ok && res.picked && res.path) await connectVault(res.path);
			else if (res && res.ok && (res.unsupported || res.browseOnly)) setDiscoverError('当前宿主没有系统对话框形态的目录选择（远程模式）。请用「重新扫描」发现仓库。');
			else if (res && res.ok && res.error) setDiscoverError(res.error);
			// cancelled：什么都不做
		} finally {
			setPicking(false);
		}
	}, [picking, call, connectVault]);

	// 已连接后想换仓库：从状态卡直接进选择模式
	const startSwitch = useCallback(() => {
		setSwitching(true);
		setVaults([]);
		discoverTried.current = false;
		discover();
	}, [discover]);

	const reindex = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			const res = await call('reindex');
			updateStatus(res);
			const list = await call('listNotes', { sort: noteSort });
			if (list && list.ok) setNotes({ notes: list.notes || [], total: list.total || 0 });
		} finally {
			setBusy(false);
		}
	}, [busy, call, updateStatus, noteSort]);

	// 切换排序：最近修改 / 名称 / 目录
	const changeSort = useCallback(async (next) => {
		setNoteSort(next);
		LS.set(SORT_KEY, next);
		if (query.trim()) return; // 搜索结果由搜索决定顺序
		const res = await call('listNotes', { sort: next }).catch(() => null);
		if (res && res.ok) setNotes({ notes: res.notes || [], total: res.total || 0 });
	}, [call, query]);

	const clearChat = useCallback(() => {
		setMessages([]);
		setNote(null);
	}, []);

	// ── 未配置 vault：选择仓库位置卡 ───────────────────────────────
	if (status && !status.configured || switching) {
		return h('div', { className: 'ob-page' },
			h('div', { className: 'ob-main' },
				h('div', { className: 'ob-head' },
					h('div', { className: 'ob-title' }, h(Icon, { d: ICONS.obsidian, size: 18 }), 'Obsidian 知识库'),
					h('div', { className: 'ob-head-meta' },
						h('span', { className: 'ob-dot ' + (status && status.llm ? 'ok' : 'bad') }),
						status && status.llm ? '模型通道就绪' : '模型通道不可用（检查 llm 适配器）',
					),
				),
				h('div', { className: 'ob-empty' },
					h('div', { className: 'ob-empty-card', style: { maxWidth: 560, width: '100%' } },
						h('b', null, switching ? '切换 Obsidian 仓库' : '选择 Obsidian 仓库位置'),
						h('div', null, '自动发现本机的 Obsidian 仓库（读 Obsidian 自己的记录 + 扫描常见位置）。也可以点「浏览…」用系统对话框选，或直接粘贴路径。索引与检索全部本地完成。'),
						discoverError ? h('div', { className: 'ob-err' }, discoverError) : null,
						// 发现列表
						discovering
							? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ob-mut)', fontSize: 12 } }, h('span', { className: 'ob-spin' }), '正在扫描本机的 Obsidian 仓库…')
							: (vaults && vaults.length)
								? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', textAlign: 'left' } },
									vaults.map((v) => h('button', {
										key: v.path, type: 'button', className: 'ob-note', disabled: configuring,
										onClick: () => connectVault(v.path),
									},
										h('span', { className: 'ob-note-title' }, v.name),
										h('span', { className: 'ob-note-sub' }, v.path + (v.depth === 0 ? '　·　最近使用' : '')),
									)),
								)
								: h('div', { style: { color: 'var(--ob-mut)', fontSize: 12 } }, discoverTried.current ? '没有自动发现到仓库——用下面的「浏览…」选，或粘贴路径。' : ' '),
						// 操作行
						h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' } },
							h('button', { className: 'ob-btn', onClick: discover, disabled: discovering },
								discovering ? h('span', { className: 'ob-spin' }) : h(Icon, { d: ICONS.refresh, size: 13 }), '重新扫描'),
							h('button', { className: 'ob-btn', onClick: browse, disabled: picking || configuring, title: '打开系统目录选择对话框' },
								picking ? h('span', { className: 'ob-spin' }) : null, '浏览…'),
						),
						switching
							? h('button', { className: 'ob-btn', onClick: () => setSwitching(false), style: { alignSelf: 'center' } }, '取消，返回当前仓库')
							: null,
					),
				),
			),
		);
	}

	// ── 正常三栏布局 ───────────────────────────────────────────────
	const statusNode = h('div', { className: 'ob-status' },
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, 'Vault'),
			h('span', { className: 'ob-status-val', title: status ? status.vaultPath : '' },
				status ? (status.configured ? status.vaultPath : '未配置') : '…'),
		),
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, '笔记'),
			h('span', { className: 'ob-status-val' }, status ? String(status.noteCount ?? '…') : '…'),
		),
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, '片段'),
			h('span', { className: 'ob-status-val' }, status ? String(status.chunkCount ?? '…') : '…'),
		),
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, '模型'),
			h('span', { className: 'ob-status-val', style: { display: 'flex', alignItems: 'center', gap: 5 } },
				h('span', { className: 'ob-dot ' + (status ? (status.llm ? 'ok' : 'bad') : 'warn') }),
				status ? (status.llm ? '就绪' : '不可用') : '…',
			),
		),
	);

	const sidebarNode = h('div', {
		className: 'ob-sidebar' + (resizing ? ' resizing' : ''),
		ref: sidebarRef,
		style: { width: sidebarWidth + 'px' },
	},
		h('h3', null, 'Vault'),
		statusNode,
		h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
			h('button', { className: 'ob-btn', onClick: reindex, disabled: busy, title: '强制全量重建索引' },
				h(Icon, { d: ICONS.refresh, size: 13 }), '重建索引'),
			h('button', { className: 'ob-btn', onClick: clearChat, title: '清空面板对话历史' },
				h(Icon, { d: ICONS.clear, size: 13 }), '清空对话'),
			h('button', { className: 'ob-btn', onClick: startSwitch, title: '连接另一个 Obsidian 仓库' },
				h(Icon, { d: ICONS.book, size: 13 }), '换仓库'),
		),
		h('div', { className: 'ob-notes-head' },
			h('h3', null, '笔记' + (notes.total ? ' · ' + notes.total : '')),
			h('div', { className: 'ob-sort', role: 'group', 'aria-label': '笔记排序' },
				[['mtime', '最近'], ['name', '名称'], ['path', '目录']].map(([key, label]) =>
					h('button', {
						key, type: 'button', className: 'ob-sort-btn' + (noteSort === key ? ' sel' : ''),
						'aria-pressed': noteSort === key,
						title: key === 'mtime' ? '按修改时间（最近优先）' : key === 'name' ? '按显示名排序' : '按目录分组排序',
						onClick: () => changeSort(key),
					}, label),
				),
			),
		),
		h('input', {
			className: 'ob-input', value: query, placeholder: '检索笔记（支持 #标签）…',
			onChange: (e) => setQuery(e.target.value),
			onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
		}),
		h('div', { className: 'ob-notes' },
			(() => {
				const rows = notes.notes || [];
				// 叶子行：目录树与平铺共用（label/sub 策略一致）
				const renderLeaf = (n) => {
					const label = n.display || n.title || n.path;
					// 副标题策略：通用名（SKILL/README…）显示"父目录/文件名"以彻底区分；
					// 其余显示目录；无目录时显示标签
					const sub = n.generic
						? (n.dir ? n.dir + '/' : '') + (n.title || '') + '.md'
						: (n.dir || (n.tags && n.tags.length ? n.tags.join(' · ') : ''));
					return h('button', {
						key: n.path, type: 'button', className: 'ob-note',
						onClick: () => openNote(n.path), title: n.path,
					},
						h('span', { className: 'ob-note-title' }, label),
						sub ? h('span', { className: 'ob-note-sub' }, sub) : null,
					);
				};
				// 目录视图：仿 Obsidian 文件树（目录可收缩、嵌套缩进、计数）
				if (noteSort === 'path' && !query.trim()) {
					const tree = buildNoteTree(rows);
					const collapsed = new Set(collapsedDirs);
					const toggleFolder = (path) => {
						setCollapsedDirs((prev) => {
							const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
							LS.set('dsh-obsidian-board/collapsedDirs', next);
							return next;
						});
					};
					return renderTreeChildren(tree, { collapsed, toggleFolder, renderLeaf });
				}
				// 平铺视图（最近/名称/搜索结果）
				return rows.map(renderLeaf);
			})(),
			!(notes.notes || []).length
				? h('div', { style: { color: 'var(--ob-mut)', fontSize: 11.5, padding: '8px 4px' } },
					notesError
						? h('span', { style: { color: 'var(--ob-err)' } }, '列表加载失败：' + notesError)
						: (status && status.configured ? '没有笔记（先重建索引）' : '…'))
				: null,
		),
		// 拖拽手柄（贴右边缘）：鼠标拖拽调宽；键盘 ←/→ 步进、Home 复位；双击回默认
		h('div', {
			className: 'ob-resizer' + (resizing ? ' active' : ''),
			role: 'separator',
			'aria-orientation': 'vertical',
			'aria-label': '调整 vault 列表宽度',
			'aria-valuenow': sidebarWidth,
			'aria-valuemin': SIDEBAR_MIN,
			'aria-valuemax': SIDEBAR_MAX,
			tabIndex: 0,
			title: '拖动调整宽度（键盘 ←/→ 微调，Home 复位，双击还原）',
			onPointerDown: onResizeStart,
			onKeyDown: onResizeKey,
			onDoubleClick: () => setSidebarWidth(SIDEBAR_DEFAULT),
		}),
	);

	// 模型选择器（与主对话页同位：贴着输入框）：按钮 + 向上弹出菜单 + 档位 chips
	const modelPickerNode = h('div', { className: 'ob-composer-meta' },
		h('div', { className: 'ob-model-area' },
			h('button', {
				type: 'button', className: 'ob-btn', style: { padding: '3px 10px', fontSize: 11.5 },
				title: '选择回答用的模型与推理档位（走 DSH 配置的模型通道）',
				onClick: () => setModelOpen((v) => !v),
			},
				h('span', { className: 'ob-dot ' + (status ? (status.llm ? 'ok' : 'bad') : 'warn'), style: { width: 6, height: 6 } }),
				selModel
					? ((selRow?.label || selRow?.name || selModel) + (selEfforts.length ? ' · ' + (selEffort === null ? (selRow.defaultEffort || '默认') : (selEffort || '上游默认')) : ''))
					: '默认模型',
				h('span', { style: { fontSize: 9, opacity: 0.7 } }, '▲'),
			),
			modelOpen
				? h('div', { className: 'ob-model-menu' },
					h('button', {
						type: 'button', className: 'ob-note' + (!selModel ? ' sel' : ''), onClick: () => applyModel('', ''),
						style: { fontWeight: !selModel ? 700 : 500 },
					}, h('span', { className: 'ob-note-title' }, '宿主默认模型'), h('span', { className: 'ob-note-sub' }, '与 DSH 主会话一致')),
					(modelList && modelList.models && modelList.models.length)
						? modelList.models.map((m) => {
							const selected = m.model === selModel && (!selProvider || m.provider === selProvider);
							return h('button', {
								key: m.provider + '/' + m.model, type: 'button', className: 'ob-note',
								onClick: () => applyModel(m.provider, m.model),
								style: { fontWeight: selected ? 700 : 500 },
							},
								h('span', { className: 'ob-note-title', style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
									h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.label || m.name || m.model),
									m.free ? h('span', { className: 'ob-chip ob-chip-free' }, '免费') : null,
									(m.badges || []).slice(0, 1).map((b) => h('span', { key: b, className: 'ob-chip' }, b)),
								),
								h('span', { className: 'ob-note-sub' },
									(m.provider || '') +
									(m.credits ? ' · ' + m.credits + ' credits' : '') +
									(m.contextWindow ? ' · ' + Math.round(m.contextWindow / 1000) + 'K ctx' : '') +
									(Array.isArray(m.efforts) && m.efforts.length ? ' · 档位 ' + m.efforts.join('/') : '')),
							);
						})
						: h('div', { style: { padding: '8px 10px', fontSize: 11.5, color: 'var(--ob-mut)' } },
							h('div', null, modelList && modelList.source === 'empty' && (modelList.providerCount || 0) === 0
								? '宿主模型通道未注册（llm 目录为空）——重启 DSH 可重连；或确认模型插件（如 workbuddy-connect）已启用'
								: '没有发现可选模型（宿主 llm 未暴露目录）——仍可用宿主默认模型')),
				)
				: null,
		),
		// 推理档位 chips：选中模型声明了档位才出现（与主对话页「档位随模型」同构）
		selModel && selEfforts.length
			? h('div', { className: 'ob-efforts', role: 'group', 'aria-label': '推理档位' },
				selEfforts.map((e) => h('button', {
					key: e, type: 'button',
					className: 'ob-chip-btn' + ((selEffort === null ? e === (selRow.defaultEffort || '') : e === selEffort) ? ' sel' : ''),
					title: '推理档位 ' + e + (e === selRow.defaultEffort ? '（模型默认）' : ''),
					onClick: () => applyEffort(e === (selEffort === null ? (selRow.defaultEffort || '') : selEffort) ? '' : e),
				}, e)),
				h('button', {
					type: 'button', className: 'ob-chip-btn' + (selEffort === '' ? ' sel' : ''),
					title: '不指定档位，完全跟随上游默认',
					onClick: () => applyEffort(''),
				}, 'auto'),
			)
			: null,
	);

	const composerNode = h('div', { className: 'ob-composer' },
		h('div', { className: 'ob-composer-row' },
			h('textarea', {
				value: draft,
				placeholder: '基于知识库提问…（Enter 发送，Shift+Enter 换行）',
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: (e) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
						e.preventDefault();
						send();
					}
				},
				disabled: busy,
			}),
			// 流式进行中 = 停止按钮；否则 = 发送
			busy
				? h('button', { className: 'ob-btn danger', onClick: stopStream, title: '停止生成', style: { height: 38 } }, h(Icon, { d: ICONS.clear, size: 14 }))
				: h('button', { className: 'ob-btn primary', onClick: () => send(), disabled: !draft.trim(), style: { height: 38 } }, h(Icon, { d: ICONS.send, size: 15 })),
		),
		// 模型选择器 + 推理档位：输入框正下方（与主对话页 composer 同位）
		modelPickerNode,
	);

	const chatNode = h('div', { className: 'ob-main' },
		h('div', { className: 'ob-head' },
			h('div', { className: 'ob-title' }, h(Icon, { d: ICONS.obsidian, size: 18 }), 'Obsidian 知识库'),
			h('div', { className: 'ob-head-meta' },
				// 当前生效模型摘要（只读；切换入口在输入框旁——与主对话页同位）
				h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ob-mut)', fontSize: 11.5 } },
					h('span', { className: 'ob-dot ' + (status ? (status.llm ? 'ok' : 'bad') : 'warn'), style: { width: 6, height: 6 } }),
					selModel
						? ((selRow?.label || selRow?.name || selModel) + (selEfforts.length ? ' · ' + (selEffort === null ? (selRow.defaultEffort || '默认') : (selEffort || '上游默认')) : ''))
						: '默认模型',
				),
				status && status.engine ? h('span', { style: { fontFamily: 'var(--ob-mono)', fontSize: 10.5 } }, status.engine) : null,
			),
		),
		messages.length
			? h('div', { className: 'ob-chat', ref: chatRef },
				messages.map((m, i) =>
					h('div', { key: i, className: 'ob-msg ' + (m.role === 'assistant' ? 'assistant' : 'user') },
						m.error
							? h('div', { className: 'ob-err' },
								m.error,
								// 错误消息带重试
								i === messages.length - 1
									? h('div', { style: { marginTop: 8 } },
										h('button', { type: 'button', className: 'ob-btn', style: { padding: '4px 12px', fontSize: 11.5 }, onClick: retryLast }, '重试'))
									: null,
							)
							: h('div', { className: 'ob-bubble' },
								m.pending
									? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ob-mut)' } }, h('span', { className: 'ob-spin' }), (m.content ? '' : (m.isThinking || m.thinking ? '深度思考中…（思考过程见下方）' : '检索知识库并生成回答…')))
									: null,
								// 思考过程块：思考中实时展开；有正文后折叠成一行摘要。
								// onlyReasoning 模型的思考期可达分钟级——这是「只转圈不输出」的解药。
								String(m.thinking || '').trim()
									? h(ThinkBlock, { text: m.thinking, open: !!(m.pending && !m.content) })
									: null,
								// 空回复守卫：assistant 消息结束但没有任何内容时，渲染明确提示，
								// 而不是留一个空壳气泡（用户视角就是「闪一下变空了」）。
								// 三种中性终态分开表述：已停止 / 已中断（流被刷新或切换打断）/
								// 模型确实没输出。绝不静默留白。
								(!m.pending && m.role === 'assistant' && !String(m.content || '').trim())
									? h('span', { style: { color: 'var(--ob-mut)' } }, m.stopped ? '（已停止）' : m.interrupted ? '（已中断——面板被刷新或流被切换打断，可重试）' : '（模型没有输出内容）')
									: null,
								// Markdown 渲染（wikilink 可点击跳右栏；[n] 引用同）
								renderMarkdown(m.content, {
									onCite: (n) => {
										const cite = (m.citations || []).find((c) => c.n === n);
										if (cite) openNote(cite.notePath);
									},
									onWiki: (target) => {
										// wikilink → 在已知笔记里找匹配路径（按文件名结尾匹配）
										const wanted = String(target).toLowerCase().replace(/\.md$/, '');
										const all = notesRef.current.notes || [];
										const hit = all.find((n) => (n.title || '').toLowerCase() === wanted)
											|| all.find((n) => (n.path || '').toLowerCase().replace(/\.md$/, '').endsWith('/' + wanted) || (n.path || '').toLowerCase().replace(/\.md$/, '') === wanted);
										if (hit) openNote(hit.path);
										else doSearchRef.current(String(target));
									},
								}),
								// 消息动作条：token 用量 / 保存为笔记 / 已停止标记
								m.role === 'assistant' && !m.pending && m.content
									? h('div', { className: 'ob-msg-actions' },
										m.usage
											? h('span', { className: 'ob-usage', title: '本次回答 token 用量' },
												'↑' + (m.usage.input ?? '?') + ' ↓' + (m.usage.output ?? '?'))
											: null,
										m.provider ? h('span', { className: 'ob-usage' }, m.model ? m.provider + '·' + m.model + (m.effort ? '·' + m.effort : '') : m.provider) : null,
										h('button', {
											type: 'button', className: 'ob-msg-btn', title: '把这条回答保存为 vault 笔记（AI 回答/ 目录）',
											onClick: () => saveAnswer(m),
										}, savedTip[i] ? '已保存 ✓' : '保存为笔记'),
										m.stopped ? h('span', { className: 'ob-usage' }, '（已停止）') : null,
										m.interrupted ? h('span', { className: 'ob-usage' }, '（已中断）') : null,
										// 中断/停止/报错的消息都给出重试入口——否则用户只能手动重敲一遍
										(m.interrupted || m.stopped) && i === messages.length - 1
											? h('button', { type: 'button', className: 'ob-msg-btn', onClick: retryLast }, '重试')
											: null,
									)
									: null,
								// 被中断且无正文：动作条上面的守卫不渲染（没有 content），
								// 这里补一个独立的重试行，避免「什么都没有、也没法重试」的死胡同。
								(m.interrupted || m.stopped) && m.role === 'assistant' && !String(m.content || '').trim() && i === messages.length - 1
									? h('div', { style: { marginTop: 8 } },
										h('button', { type: 'button', className: 'ob-btn', style: { padding: '4px 12px', fontSize: 11.5 }, onClick: retryLast }, '重试'))
									: null,
							),
						m.role === 'assistant' && (m.citations || []).length
							? h('div', { className: 'ob-cites' },
								(() => {
									// 按 notePath 去重（历史消息可能含旧版重复）+ 上限 8
									const seen = new Set();
									const uniq = [];
									for (const c of m.citations) {
										if (!c || seen.has(c.notePath)) continue;
										seen.add(c.notePath);
										uniq.push(c);
										if (uniq.length >= 8) break;
									}
									return uniq.map((c) =>
										h('button', {
											key: c.n, type: 'button', className: 'ob-cite', title: c.notePath,
											onClick: () => openNote(c.notePath),
										}, h('span', { className: 'n' }, '[' + c.n + ']'), c.noteTitle),
									);
								})())
							: null,
					),
				))
			: h('div', { className: 'ob-empty' },
				h('div', { className: 'ob-empty-card' },
					h('b', null, '向你的知识库提问'),
					h('div', null, '回答基于本地笔记检索（BM25 + 中文 bigram），引用与 [[笔记链接]] 可点击查看原文。试试：「我关于 X 的笔记说了什么」「总结 #标签 下的要点」。'),
				)),
		composerNode,
	);

	const refNode = note
		? h('div', { className: 'ob-ref' },
			h('div', { className: 'ob-ref-head' },
				h('div', { className: 'ob-ref-title', title: note.path }, note.path),
				h('button', { type: 'button', className: 'ob-btn', onClick: () => setNote(null), style: { padding: '3px 9px', fontSize: 11 } }, '关闭'),
			),
			note.error
				? h('div', { style: { padding: '12px 14px' } }, h('div', { className: 'ob-err' }, note.error))
				: h('div', { className: 'ob-ref-body' }, note.content || '（空笔记）'),
			note.mtimeMs
				? h('div', { className: 'ob-ref-meta' }, '修改于 ' + new Date(note.mtimeMs).toLocaleString())
				: null,
		)
		: null;

	return h('div', { className: 'ob-page' }, sidebarNode, chatNode, refNode);
};

// ── 浏览器侧 typert 契约（与 lib/typert.js 同一份契约的两份产物）────
// 宿主 loader 校验 host 那份；typert-registry 的浏览器半校验这份。两个渠道查不同的键：
//   0.1.5-rc.x 查 codec.schema.parse；0.1.6+ 查 codec.create()。两个键都写
//   （少写一半 = 「加载即拒」或「面板能开、一调用就炸」）。浏览器侧不需要 zod：
//   宿主只要求 create() 返回带 parse 的 schema。形状与 mcp-board 的 MCP_CONTRIBUTION 同构。
const ANY_VALUE_SCHEMA = { parse: (v) => v };
function strictCodec(symbol) {
	return { mode: 'strict', typeSymbol: 'dsh-obsidian-board/typert#' + symbol, schema: ANY_VALUE_SCHEMA, create: () => ANY_VALUE_SCHEMA };
}
function obParam(name) {
	return { name, wire: name, source: 'json', codec: strictCodec(name === 'String' ? 'String' : 'Payload') };
}
const OBSIDIAN_CONTRIBUTION = {
	package: 'dsh-obsidian-board',
	descriptors: [
		{ id: 'dsh-obsidian-board#obsidianBoard/status', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'status', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('StatusResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/configure', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'configure', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('StatusResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/listNotes', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'listNotes', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('NotesResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/readNote', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'readNote', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('NoteResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/search', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'search', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('SearchResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/chat', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chat', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/reindex', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'reindex', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('StatusResult') },
		// 流式会话（可中断）+ 保存回答为笔记
		{ id: 'dsh-obsidian-board#obsidianBoard/chatStart', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chatStart', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatStartResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/chatPoll', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chatPoll', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatPollResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/chatStop', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chatStop', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatStopResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/saveNote', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'saveNote', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('SaveNoteResult') },
		// 模型目录（模型选择器）
		{ id: 'dsh-obsidian-board#obsidianBoard/listModels', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'listModels', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('ModelsResult') },
		// 选择仓库位置模式：发现 / 系统对话框选择 / 在资源管理器中定位
		{ id: 'dsh-obsidian-board#obsidianBoard/discoverVaults', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'discoverVaults', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('DiscoverResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/pickVault', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'pickVault', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('PickResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/revealVault', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'revealVault', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('RevealResult') },
	].map((descriptor) => ({ ...descriptor, sourceLocation: { file: 'dsh-obsidian-board/lib/typert.js', line: 7, column: 1 } })),
};

// ── 装配（apply）───────────────────────────────────────────────────
async function apply(ctx) {
	// 浏览器侧契约必须先挂载：remote.obsidianBoard 才会物化。漏了这步 remote.get
	// 永远取不到服务——这正是首版「左上角没入口」的根因（激活即失败）。
	const disposeMount = await ctx.remote.$mount(OBSIDIAN_CONTRIBUTION);
	const disposeCss = __injectCss(CSS);
	MODULE_CTX.ctx = ctx;

	// RPC 包装：宿主半 ObsidianBoardGateway 的 remote 服务。unreachable 时给可读错误
	//（宿主半未激活 / 无 llm 适配器时面板仍能打开并展示原因）。
	const call = async (method, args) => {
		const svc = (typeof ctx.get === 'function' ? ctx.get('remote.obsidianBoard') : null) || null;
		if (!svc || typeof svc[method] !== 'function') {
			return { ok: false, error: 'Obsidian 知识库服务未连接（检查宿主半是否激活、llm 适配器是否挂载）' };
		}
		const r = args === undefined || args === null ? await svc[method]() : await svc[method](args);
		if (r && r.ok) return { ok: true, ...((r.value && typeof r.value === 'object') ? r.value : {}) };
		if (r && !r.ok) return { ok: false, error: (r.error && (r.error.message || r.error.code)) || '调用失败' };
		return r;
	};

	// main slot 页面（用 inject 声明感知：等 ui-layout 声明 main slot 后再注册）。
	ctx.slots.inject('main', () =>
		ctx.slots.register(
			{ name: 'main', key: PANEL_ID, label: PANEL_LABEL, inject: () => ({ call }) },
			ObsidianPage,
		),
	);
	// 侧栏左上角「全局面板」行（与「插件」「定时任务」同一组，点击由宿主 selectPanel
	// 切换——与进入/切换对话完全同构，这是唯一入口）。
	ctx.slots.inject('sidebar.panellist', () =>
		ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: PANEL_LABEL }, PanelIcon),
	);

	return async () => {
		try { disposeCss(); } catch { /* 样式已清理 */ }
		try { await disposeMount(); } catch { /* 契约已随插件卸载 */ }
	};
}
exports.apply = apply;
exports.inject = ['slots', 'remote', 'typert'];

		return module.exports;
	}
});
