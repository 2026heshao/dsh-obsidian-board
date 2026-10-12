window.__ModuleLoader__.load({
	id: 'dsh-obsidian-board',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
// dsh-obsidian-board — 客户端半：DSH 主窗口里的 Obsidian 专属对话页面。
//
// 装配契约（与 dsh-skill-mcp-board 同构，已在其真机上验证）：
// - main slot（key = PANEL_ID）：宿主中栏按 entryKey 渲染插件页面，与切换对话同构；
// - sidebar.panellist 面板行：主入口，点击行为由宿主 selectPanel 承担；
// - sidebar.footer.action：侧栏底部兼容入口，点击切到本页。
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
	'.ob-sidebar{width:264px;min-width:220px;flex:none;display:flex;flex-direction:column;gap:8px;border-right:1px solid var(--ob-line);padding:12px 10px;overflow-y:auto;box-sizing:border-box}',
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
	'.ob-composer{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--ob-line);flex:none;align-items:flex-end}',
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
].join('\n');

// ── 常量与工具 ──────────────────────────────────────────────────────
const PANEL_ID = 'dsh-obsidian-board';
const PANEL_LABEL = 'Obsidian';
const HISTORY_KEY = 'dsh-obsidian-board/history';
const DRAFT_KEY = 'dsh-obsidian-board/draft';

const LS = {
	get(key, fallback) {
		try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
	},
	set(key, value) {
		try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储被禁用时本次会话内仍生效 */ }
	},
};

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
	obsidian: 'M11.2.9 8.7 1a5.1 5.1 0 0 0-3 1.5 5 5 0 0 0-1 2.2l-2 9.6a5 5 0 0 0 1 4.3 5 5 0 0 0 3.4 1.8l6.4.7a5 5 0 0 0 4.2-1.5 5 5 0 0 0 1.2-2.3l1.7-8.2a5 5 0 0 0-1-4.2A5 5 0 0 0 15.3 3l-4.1-2.1Z',
	search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm5.6 13.1L21 21',
	send: 'M3 11.5 21 3l-8.5 18-2-7.5Z',
	refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 3v5h-5',
	clear: 'M5 5l14 14M19 5 5 19',
	book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5ZM20 19.5H6.5A2.5 2.5 0 0 0 4 22',
};
const FILLED = new Set([ICONS.obsidian]);

const Icon = ({ d, size, className }) =>
	h('svg', {
		viewBox: '0 0 24 24', width: size || 16, height: size || 16, className,
		fill: FILLED.has(d) ? 'currentColor' : 'none',
		stroke: FILLED.has(d) ? 'none' : 'currentColor',
		strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
	}, h('path', { d }));

// ── 入口组件（行点击由宿主承担，这里只画图形）───────────────────────
const PanelIcon = ({ size, active }) =>
	h(Icon, { d: ICONS.obsidian, size: size || 18, className: active ? 'ob-panel-icon active' : 'ob-panel-icon' });

const FooterAction = ({ wide }) =>
	h('button', {
		type: 'button',
		className: 'ob-btn' + (wide ? '' : ' rail'),
		style: wide ? undefined : { border: '0', background: 'transparent', padding: '8px' },
		title: 'Obsidian 知识库',
		'aria-label': '打开 Obsidian 知识库面板',
		onClick: () => openObsidianPanel(),
	},
		h(Icon, { d: ICONS.obsidian, size: wide ? 16 : 18 }),
		wide ? h('span', null, 'Obsidian') : null,
	);

// ── 气泡里的轻量 markdown：粗体 / 行内代码 / [n] 引用高亮 ───────────
function renderInline(text, onCite) {
	const parts = [];
	let rest = String(text);
	let key = 0;
	const push = (node) => parts.push(h(node.type, { key: 'k' + (key++), ...node.props }, node.children));
	// 依序匹配：[n] 引用、`code`、**bold**
	const re = /\[(\d{1,2})\]|`([^`]+)`|\*\*([^*]+)\*\*/g;
	let last = 0;
	let m;
	while ((m = re.exec(rest)) !== null) {
		if (m.index > last) push({ type: 'span', props: {}, children: rest.slice(last, m.index) });
		if (m[1] !== undefined) {
			push({
				type: 'button', props: {
					type: 'button', className: 'ob-cite', style: { padding: '0 7px', margin: '0 1px' },
					title: '查看引用 ' + m[1],
					onClick: () => onCite && onCite(Number(m[1])),
				}, children: '[' + m[1] + ']',
			});
		} else if (m[2] !== undefined) {
			push({ type: 'code', props: { style: { fontFamily: 'var(--ob-mono)', fontSize: '12px', background: 'var(--ob-bg-1)', borderRadius: 'var(--ob-r-sm)', padding: '1px 5px' } }, children: m[2] });
		} else if (m[3] !== undefined) {
			push({ type: 'b', props: {}, children: m[3] });
		}
		last = m.index + m[0].length;
	}
	if (last < rest.length) push({ type: 'span', props: {}, children: rest.slice(last) });
	return parts;
}

// ── 主页面 ──────────────────────────────────────────────────────────
const ObsidianPage = ({ call }) => {
	const [status, setStatus] = useState(null);
	const [notes, setNotes] = useState({ notes: [], total: 0 });
	const [messages, setMessages] = useState(() => LS.get(HISTORY_KEY, []));
	const messagesRef = useRef(messages);
	useEffect(() => { messagesRef.current = messages; }, [messages]);
	const [draft, setDraft] = useState(() => LS.get(DRAFT_KEY, ''));
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState(null);       // 右栏整篇笔记
	const [noteLoading, setNoteLoading] = useState(false);
	const [query, setQuery] = useState('');
	const [vaultInput, setVaultInput] = useState('');
	const [configuring, setConfiguring] = useState(false);
	// 选择仓库位置模式的状态
	const [vaults, setVaults] = useState([]);            // 发现的 vault 列表
	const [discovering, setDiscovering] = useState(false);
	const [picking, setPicking] = useState(false);       // 系统目录对话框进行中
	const [showManual, setShowManual] = useState(false); // 手动输入兜底
	const [discoverError, setDiscoverError] = useState('');
	const [switching, setSwitching] = useState(false);   // 已连接后的「换仓库」模式
	const discoverTried = useRef(false);
	const chatRef = useRef(null);
	const loadedRef = useRef(false);

	// 首次拉状态 + 笔记列表
	useEffect(() => {
		if (loadedRef.current) return;
		loadedRef.current = true;
		call('status').then((res) => { if (res && res.ok) setStatus(res); }).catch(() => {});
		call('listNotes').then((res) => {
			if (res && res.ok) setNotes({ notes: res.notes || [], total: res.total || 0 });
		}).catch(() => {});
	}, [call]);

	// 持久化历史与草稿
	useEffect(() => { LS.set(HISTORY_KEY, messages.slice(-40)); }, [messages]);
	useEffect(() => { LS.set(DRAFT_KEY, draft); }, [draft]);

	// 新消息/回答完成时滚到底
	useEffect(() => {
		const el = chatRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages.length, busy]);

	const updateStatus = useCallback((res) => {
		if (res && res.ok) setStatus(res);
	}, [call]);

	// ── 提问（RAG：宿主半检索 + llm 流式）──────────────────────────
	const send = useCallback(async () => {
		const question = draft.trim();
		if (!question || busy) return;
		setDraft('');
		const history = messagesRef.current
			.filter((m) => m && typeof m.content === 'string' && m.content && !m.pending)
			.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
		setMessages((prev) => [...prev, { role: 'user', content: question, ts: Date.now() }, { role: 'assistant', content: '', pending: true }]);
		setBusy(true);
		try {
			const res = await call('chat', { question, history });
			setMessages((prev) => {
				const next = prev.slice();
				for (let i = next.length - 1; i >= 0; i--) {
					if (next[i].pending) {
						next[i] = res && res.ok
							? { role: 'assistant', content: res.answer || '', citations: res.citations || [], ts: Date.now() }
							: { role: 'assistant', content: '', error: (res && res.error) || '调用失败', ts: Date.now() };
						break;
					}
				}
				return next;
			});
		} catch (error) {
			setMessages((prev) => {
				const next = prev.slice();
				for (let i = next.length - 1; i >= 0; i--) {
					if (next[i].pending) { next[i] = { role: 'assistant', content: '', error: String(error && error.message || error), ts: Date.now() }; break; }
				}
				return next;
			});
		} finally {
			setBusy(false);
		}
	}, [busy, draft, call]);

	// ── 侧栏：检索笔记 ─────────────────────────────────────────────
	const doSearch = useCallback(async () => {
		const q = query.trim();
		if (!q) {
			call('listNotes').then((res) => {
				if (res && res.ok) setNotes({ notes: res.notes || [], total: res.total || 0 });
			}).catch(() => {});
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
		}
	}, [query, call]);

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
				const list = await call('listNotes');
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

	// 系统目录选择对话框；宿主不支持时退回手动输入
	const browse = useCallback(async () => {
		if (picking) return;
		setPicking(true);
		try {
			const res = await call('pickVault');
			if (res && res.ok && res.picked && res.path) await connectVault(res.path);
			else if (res && res.ok && res.unsupported) setShowManual(true);
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
			const list = await call('listNotes');
			if (list && list.ok) setNotes({ notes: list.notes || [], total: list.total || 0 });
		} finally {
			setBusy(false);
		}
	}, [busy, call, updateStatus]);

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
							h('button', { className: 'ob-btn', onClick: browse, disabled: picking || configuring },
								picking ? h('span', { className: 'ob-spin' }) : null, '浏览…'),
							h('button', { className: 'ob-btn', onClick: () => setShowManual((v) => !v) }, '手动输入路径'),
						),
						// 手动输入兜底
						showManual
							? h('div', { style: { display: 'flex', gap: 6 } },
								h('input', {
									className: 'ob-input', value: vaultInput,
									onChange: (e) => setVaultInput(e.target.value),
									placeholder: 'D:\\笔记库\\MyVault',
									onKeyDown: (e) => { if (e.key === 'Enter' && vaultInput.trim()) connectVault(vaultInput.trim()); },
								}),
								h('button', { className: 'ob-btn primary', disabled: configuring || !vaultInput.trim(), onClick: () => connectVault(vaultInput.trim()) },
									configuring ? h('span', { className: 'ob-spin' }) : '连接'),
							)
							: null,
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

	const sidebarNode = h('div', { className: 'ob-sidebar' },
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
		h('h3', null, '笔记' + (notes.total ? ' · ' + notes.total : '')),
		h('input', {
			className: 'ob-input', value: query, placeholder: '检索笔记（支持 #标签）…',
			onChange: (e) => setQuery(e.target.value),
			onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
		}),
		h('div', { className: 'ob-notes' },
			(notes.notes || []).map((n) =>
				h('button', { key: n.path, type: 'button', className: 'ob-note', onClick: () => openNote(n.path) },
					h('span', { className: 'ob-note-title' }, n.title || n.path),
					h('span', { className: 'ob-note-sub' }, n.sub || (n.tags && n.tags.length ? n.tags.join(' · ') : n.path)),
				),
			),
			!(notes.notes || []).length
				? h('div', { style: { color: 'var(--ob-mut)', fontSize: 11.5, padding: '8px 4px' } }, status && status.configured ? '没有笔记（先重建索引）' : '…')
				: null,
		),
	);

	const chatNode = h('div', { className: 'ob-main' },
		h('div', { className: 'ob-head' },
			h('div', { className: 'ob-title' }, h(Icon, { d: ICONS.obsidian, size: 18 }), 'Obsidian 知识库'),
			h('div', { className: 'ob-head-meta' },
				status && status.engine ? h('span', { style: { fontFamily: 'var(--ob-mono)' } }, status.engine) : null,
				h('span', { className: 'ob-dot ' + (status ? (status.llm ? 'ok' : 'bad') : 'warn') }),
			),
		),
		messages.length
			? h('div', { className: 'ob-chat', ref: chatRef },
				messages.map((m, i) =>
					h('div', { key: i, className: 'ob-msg ' + (m.role === 'assistant' ? 'assistant' : 'user') },
						m.error
							? h('div', { className: 'ob-err' }, m.error)
							: h('div', { className: 'ob-bubble' },
								m.pending
									? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ob-mut)' } }, h('span', { className: 'ob-spin' }), '检索知识库并生成回答…')
									: renderInline(m.content, (n) => {
										const cite = (m.citations || []).find((c) => c.n === n);
										if (cite) openNote(cite.notePath);
									}),
							),
						m.role === 'assistant' && (m.citations || []).length
							? h('div', { className: 'ob-cites' },
								m.citations.map((c) =>
									h('button', {
										key: c.n, type: 'button', className: 'ob-cite', title: c.notePath,
										onClick: () => openNote(c.notePath),
									}, h('span', { className: 'n' }, '[' + c.n + ']'), c.noteTitle),
								))
							: null,
					),
				))
			: h('div', { className: 'ob-empty' },
				h('div', { className: 'ob-empty-card' },
					h('b', null, '向你的知识库提问'),
					h('div', null, '回答基于本地笔记检索（BM25 + 中文 bigram），引用可点击查看原文。试试：「我关于 X 的笔记说了什么」「总结 #标签 下的要点」。'),
				)),
		h('div', { className: 'ob-composer' },
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
			h('button', { className: 'ob-btn primary', onClick: send, disabled: busy || !draft.trim(), style: { height: 38 } },
				busy ? h('span', { className: 'ob-spin' }) : h(Icon, { d: ICONS.send, size: 15 }),
			),
		),
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
		{ id: 'dsh-obsidian-board#obsidianBoard/listNotes', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'listNotes', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('NotesResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/readNote', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'readNote', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('NoteResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/search', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'search', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('SearchResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/chat', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chat', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/reindex', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'reindex', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('StatusResult') },
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
	// 切换——与进入/切换对话完全同构，这就是主入口）。
	ctx.slots.inject('sidebar.panellist', () =>
		ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: PANEL_LABEL }, PanelIcon),
	);
	// 侧栏底部兼容入口。
	ctx.slots.inject('sidebar.footer.action', () =>
		ctx.slots.register({ name: 'sidebar.footer.action', id: 'obsidian-board', order: 90, label: PANEL_LABEL }, FooterAction),
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
