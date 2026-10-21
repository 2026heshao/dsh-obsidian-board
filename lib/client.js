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
// ctx.llm 产生（DSH 配好的模型通道）；索引、BM25 召回与引用原文的读取全部本地完成，
// 只有问题、最近对话与命中片段会发往模型通道，整库不上传。
var React = require('react');
// 宿主把这两项放进了浏览器模块表（web boot 的 staticModules 种子词），
// 因此可以直接 require，不需要在 package.json 里声明 external/inject。
// 模型菜单的弹层、分组、搜索框与图标全部走宿主 primitives，视觉与主对话页同源。
var ReactDOM = require('react-dom');
var primitives = require('@deepseek-ai/dsh-client-ui-primitives');
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
	// 排队区（生成中按 Enter 的待发消息）：与主对话页一样放在输入卡上方
	'.ob-queue{display:flex;flex-direction:column;gap:4px;max-height:96px;overflow-y:auto}',
	'.ob-queue-item{display:flex;align-items:center;gap:8px;border:1px solid var(--ob-line);border-radius:var(--ob-r-md);background:var(--ob-bg-2);padding:5px 8px;font-size:11.5px;color:var(--ob-mut)}',
	'.ob-queue-tag{flex:none;font-size:10px;color:var(--ob-mut)}',
	'.ob-queue-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}',
	'.ob-queue-cancel{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;background:none;border:none;border-radius:50%;color:var(--ob-mut);cursor:pointer}',
	'.ob-queue-cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
	// 输入卡：几何与主对话页 InputBar 同源（圆角 panel、输入区 14px/24px、底行 28px 控件）
	'.ob-composer-card{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding-top:6px;background:var(--dsw-specific-input-major,var(--ob-bg-2));border:1px solid var(--dsw-alias-border-l2,var(--ob-line));border-radius:var(--dsw-radius-panel,var(--ob-r-lg));box-shadow:var(--dsw-elevation-soft,none)}',
	// 焦点态挂在卡片上（宿主 InputBar 同款：wrap:focus-within 改 border-color）。
	// textarea 自身没有圆角，宿主全局 :focus-visible 会给可编辑元素画 2px 直角 outline，
	// 于是聚焦时出现一个和圆角卡片不贴合的蓝色矩形框——抑制元素 outline，改由卡片描边+光环表达。
	'.ob-composer-card:focus-within{border-color:var(--dsw-alias-state-business-primary,var(--ob-accent));box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--ob-accent)) 14%,transparent)}',
	'.ob-composer-input{box-sizing:border-box;width:100%;min-height:36px;max-height:200px;resize:none;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary,var(--ob-accent));font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:24px;padding:8px 14px 0;overflow-y:auto;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;border-radius:calc(var(--dsw-radius-panel,var(--ob-r-lg)) - 1px)}',
	// !important 兜底：宿主 focus.css 可能在插件样式之后注入，且它只改 color/width 不改 style；
	// 万一 outline-style 被更晚的规则恢复，圆角（上一行）保证残留环仍贴合卡片形状。
	// 整棵 composer 子树一并压制：焦点表达只由卡片描边 + 光环承担，不留任何直角框。
	'.ob-composer-input:focus,.ob-composer-input:focus-visible{outline:none !important}',
	'.ob-composer:focus-within,.ob-composer-card:focus,.ob-composer-card:focus-within{outline:none !important}',
	'.ob-composer-input::placeholder{color:var(--dsw-alias-label-caption,var(--ob-mut))}',
	'.ob-composer-row{display:flex;align-items:center;gap:12px;min-width:0;padding:2px 8px 8px;flex-wrap:wrap;container-type:inline-size}',
	'.ob-composer-trailing{display:flex;align-items:center;gap:12px;margin-left:auto;min-width:0;flex:none}',
	'.ob-send{corner-shape:round;display:grid;place-items:center;width:34px;height:34px;flex:none;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-button-primary-fill));color:#fff;cursor:pointer;transform:translateY(-2px);transition:background-color .1s}',
	'.ob-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-primary-hover))}',
	'.ob-send:disabled{opacity:.4;cursor:default}',
	'@container (width <= 560px){.ob-composer-row{gap:8px}.ob-composer-trailing{gap:8px}}',
	// 模型选择器：从宿主 ModelSelect.module.css 移植（trigger 28px、菜单 240–420px、34px 行高）
	'.ob-ms-root{min-width:0;position:relative}',
	'.ob-ms-trigger{border-radius:var(--dsw-radius-sm,var(--ob-r-sm));min-width:0;max-width:min(360px,60%);max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary,var(--ob-mut));cursor:pointer;background:none;border:none;outline:none;display:flex;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;font-family:inherit}',
	'.ob-ms-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
	'.ob-ms-trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--ob-accent)))}',
	'.ob-ms-trigger:disabled{color:var(--dsw-alias-label-dimmed,var(--ob-mut));cursor:default}',
	'.ob-ms-triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
	'.ob-ms-triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption,var(--ob-mut));flex-shrink:1000;overflow:hidden}',
	'.ob-ms-triggerIcon{display:none;flex:none}',
	'.ob-ms-chevron{color:var(--dsw-alias-label-caption,var(--ob-mut));flex:none;transition:transform .12s}',
	'.ob-ms-chevronOpen{transform:rotate(180deg)}',
	'.ob-ms-menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden;text-align:left}',
	'.ob-ms-status,.ob-ms-empty{color:var(--dsw-alias-label-tertiary,var(--ob-mut));padding:8px;font-size:12px;line-height:18px}',
	'.ob-ms-warning{border-radius:var(--dsw-radius-md,var(--ob-r-md));background:var(--dsw-alias-bg-module-platform,var(--ob-bg-2));color:var(--dsw-alias-state-warn-label,var(--ob-warn));margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px}',
	'.ob-ms-searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}',
	'.ob-ms-searchRow .ob-ms-search{border-radius:var(--dsw-radius-md,var(--ob-r-md));background:none;border:0 solid transparent;height:auto;padding:5px 7px;display:flex}',
	'.ob-ms-searchRow .ob-ms-searchWithQuery{padding-right:34px}',
	'.ob-ms-searchRow .ob-ms-search input{padding:0;font-size:12px;line-height:normal}',
	'.ob-ms-searchRow .ob-ms-search input::placeholder{color:var(--dsw-alias-label-caption,var(--ob-mut))}',
	'.ob-ms-searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary,var(--ob-mut));cursor:pointer;background:none;border:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0;position:absolute;top:50%;right:4px;transform:translateY(-50%)}',
	'.ob-ms-searchClear:hover,.ob-ms-searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));outline:none}',
	'.ob-ms-searchClear svg{width:14px;height:14px}',
	'.ob-ms-error{border-radius:var(--dsw-radius-md,var(--ob-r-md));background:var(--dsw-alias-interactive-bg-hover-danger,rgba(220,60,60,.1));color:var(--dsw-alias-state-error-primary,var(--ob-err));justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}',
	'.ob-ms-retry{color:inherit;font:inherit;cursor:pointer;background:none;border:none;flex:none;padding:0;font-weight:600}',
	'.ob-ms-groups{min-height:0;overflow-y:auto}',
	'.ob-ms-option{box-sizing:border-box;border-radius:var(--dsw-radius-md,var(--ob-r-md));width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:none;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex;font-family:inherit}',
	'.ob-ms-option:hover:not(:disabled),.ob-ms-option:focus-visible,.ob-ms-optionActive:not(:disabled),.ob-ms-option[data-highlighted]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
	'.ob-ms-option:disabled{color:var(--dsw-alias-label-dimmed,var(--ob-mut));cursor:default}',
	'.ob-ms-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}',
	'.ob-ms-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}',
	'.ob-ms-modelSub,.ob-ms-optionMeta{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary,var(--ob-mut));font-size:11px;line-height:15px;overflow:hidden}',
	'.ob-ms-check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}',
	'.ob-ms-check svg{width:14px;height:14px}',
	'.ob-ms-cell{box-sizing:border-box;border-radius:var(--dsw-radius-md,var(--ob-r-md));width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:none;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex;font-family:inherit}',
	'.ob-ms-cell:hover,.ob-ms-cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
	'.ob-ms-cellLabel{white-space:nowrap;flex:none}',
	'.ob-ms-cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary,var(--ob-mut));flex:auto;overflow:hidden}',
	'.ob-ms-cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon,var(--ob-mut));flex:none}',
	'.ob-empty{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}',
	'.ob-empty-card{border:1px dashed var(--ob-line);border-radius:var(--ob-r-lg);padding:22px 26px;text-align:center;display:flex;flex-direction:column;gap:10px;max-width:460px;font-size:12.5px;color:var(--ob-mut)}',
	'.ob-empty-card b{font-size:14px;color:var(--dsw-alias-label-primary)}',
	'.ob-ref{width:380px;min-width:280px;flex:none;display:flex;flex-direction:column;border-left:1px solid var(--ob-line);min-height:0;position:relative}',
	'.ob-ref-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--ob-line);flex:none;min-width:0}',
	'.ob-ref-title{font-size:12.5px;font-weight:650;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	// OPT-3.6 正文改为块级 Markdown 排版，故不再保留 white-space:pre-wrap
	// （否则段落内的软换行会被当成硬换行）；降级纯文本分支自带内联 pre-wrap。
	'.ob-ref-body{flex:1;overflow:auto;padding:12px 14px;font-size:12.5px;line-height:1.65;overflow-wrap:anywhere;box-sizing:border-box}',
	'.ob-ref-meta{font-size:11px;color:var(--ob-mut);padding:0 14px 10px}',
	'.ob-ref-resizer{position:absolute;top:0;left:-4px;width:8px;height:100%;cursor:col-resize;z-index:5;background:transparent;border:none;padding:0}',
	'.ob-ref-resizer::after{content:"";position:absolute;top:0;left:3px;width:1px;height:100%;background:transparent;transition:background .15s}',
	'.ob-ref-resizer:hover::after,.ob-ref-resizer.active::after{background:var(--ob-accent)}',
	'.ob-ref-resizer:focus-visible{outline:2px solid var(--ob-accent);outline-offset:-2px}',
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
	// 左侧 vault 列表拖拽手柄：命中区 7px（可见 1px 分隔线 + hover/拖拽高亮）
	'.ob-resizer{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:5;background:transparent;border:none;padding:0}',
	'.ob-resizer::after{content:"";position:absolute;top:0;right:3px;width:1px;height:100%;background:transparent;transition:background .15s}',
	'.ob-resizer:hover::after,.ob-resizer.active::after{background:var(--ob-accent)}',
	'.ob-resizer:focus-visible{outline:2px solid var(--ob-accent);outline-offset:-2px}',
	// OPT-3.3「回到底部」浮动按钮：必须留在 .ob-chat 内部（不能成为 .ob-main 的直接子节点，
	// 否则 composer 不再是聊天列尾子节点）。sticky 贴在滚动容器底部，不参与消息流排版。
	'.ob-jump-bottom{position:sticky;bottom:8px;align-self:flex-end;z-index:20;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--ob-line);border-radius:999px;padding:5px 11px;background:var(--ob-bg-1);color:var(--dsw-alias-label-primary);font-size:11.5px;font-family:inherit;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22);flex:none}',
	'.ob-jump-bottom:hover{border-color:var(--ob-accent);color:var(--ob-accent)}',
	// OPT-3.5b 错误边界降级卡：与 .ob-err 同色系但更克制，避免抢正文注意力
	'.ob-error-boundary{border:1px solid var(--ob-line);background:var(--ob-bg-1);border-radius:var(--ob-r-md);padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--ob-mut)}',
	'.ob-error-boundary .ob-error-text{flex:1;min-width:160px}',
].join('\n');

// ── 常量与工具 ──────────────────────────────────────────────────────
const PANEL_ID = 'dsh-obsidian-board';
const PANEL_LABEL = 'Obsidian';
const HISTORY_KEY = 'dsh-obsidian-board/history';
// OPT-4.1 历史 localStorage 键按 vault 命名空间：正式键 = 'history:<vaultHash(路径)>'。
// HISTORY_KEY 自此降级为「旧版单键名」：只在首次接管某个 vault 时读一次做迁移；
// 迁移后旧键保留不删（保留一版，便于回滚 OPT-4.1 之前的旧数据）。
// djb2 → 8 位 hex：把 vault 绝对路径压成稳定短哈希做命名空间后缀；空/非法路径统一 'default'。
const vaultHashOf = (p) => {
	const s = String(p == null ? '' : p).trim();
	if (!s) return 'default';
	let hash = 5381;
	for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
	return hash.toString(16).padStart(8, '0');
};
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

// 右侧笔记预览宽度：默认 380，可拖拽在 [280, 720] 间调整，持久化到 localStorage
const REFPANE_KEY = 'dsh-obsidian-board/refPaneWidth';
const REFPANE_DEFAULT = 380;
const REFPANE_MIN = 280;
const REFPANE_MAX = 720;
function clampRefPane(width) {
	const n = Number(width);
	if (!Number.isFinite(n)) return REFPANE_DEFAULT;
	return Math.min(REFPANE_MAX, Math.max(REFPANE_MIN, Math.round(n)));
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
			let next = m;
			if (m.pending || m.isThinking) {
				next = { ...m, pending: false, isThinking: false };
				if (m.role === 'assistant' && !String(m.content || '').trim() && !m.error) next.interrupted = true;
			}
			// OPT-4.3 给缺 id 的 assistant 消息补稳定 id：savedTip / Markdown 缓存都以 m.id
			// 为键——下标在 retryLast 删尾重发后会整体位移，键必须钉在消息上。每条只赋一次，
			// 赋过的 id 随消息持久化到 localStorage，之后的加载不会再变。user 消息不需要 id。
			if (next.role === 'assistant' && !next.id) {
				next = { ...next, id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
			}
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

// 主按钮图标：直接取自宿主 InputBar（16 viewBox，实心），
// 发送 = 向上箭头，停止 = 10×10 圆角方块。与主对话页逐像素同源。
const SEND_PATH = 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z';
const SendGlyph = () => h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
	h('path', { d: SEND_PATH, fill: 'currentColor' }));
const StopGlyph = () => h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
	h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 3, fill: 'currentColor' }));

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
	// OPT-3.1c 四级及以下标题：模型常输出 #### 小节，缺该键时 MD_STYLE[tag] 为 undefined
	h4: { fontSize: 13, fontWeight: 650, margin: '7px 0 3px' },
	h5: { fontSize: 12.5, fontWeight: 600, margin: '6px 0 2px' },
	h6: { fontSize: 12.5, fontWeight: 600, margin: '6px 0 2px', color: 'var(--dsw-alias-label-secondary)' },
	li: { marginLeft: 18, lineHeight: 1.6 },
	pre: { background: 'var(--ob-bg-1)', border: '1px solid var(--ob-line)', borderRadius: 'var(--ob-r-md)', padding: '9px 11px', overflowX: 'auto', margin: '7px 0', fontFamily: 'var(--ob-mono)', fontSize: 12, lineHeight: 1.5 },
	quote: { borderLeft: '3px solid var(--ob-accent)', paddingLeft: 10, margin: '6px 0', color: 'var(--dsw-alias-label-secondary)' },
	wikilink: { color: 'var(--ob-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 },
	// OPT-3.1b 标准链接；renderInline 的正则只接受 http/https，非 http(s) 保持字面文本
	a: { color: 'var(--ob-accent)', textDecoration: 'underline', textUnderlineOffset: 3 },
	// OPT-3.1d 斜体与任务列表复选框
	em: { fontStyle: 'italic' },
	input: { margin: '0 5px 0 0', verticalAlign: 'middle' },
	// OPT-3.1a 表格：边框走 --ob-line，th 用 --ob-bg-1 底色区分表头；宽度 100% 让窄栏自适应换行
	table: { borderCollapse: 'collapse', width: '100%', margin: '7px 0', fontSize: 12, lineHeight: 1.5 },
	thead: { background: 'var(--ob-bg-1)' },
	// 表体/行本身无需额外样式：保留键位，使 MD_STYLE[tag] 查表恒有值、也便于主题整体覆盖
	tbody: { background: 'transparent' },
	tr: { background: 'transparent' },
	th: { border: '1px solid var(--ob-line)', background: 'var(--ob-bg-1)', padding: '4px 8px', textAlign: 'left', fontWeight: 650, verticalAlign: 'top' },
	td: { border: '1px solid var(--ob-line)', padding: '4px 8px', verticalAlign: 'top' },
	hr: { border: 'none', borderTop: '1px solid var(--ob-line)', margin: '10px 0' },
};

// OPT-3.1a 表格识别用的工具：按行尾/行首的 | 切单元格（首尾空段丢弃，单元格去首尾空格）。
// 分隔行允许空格与对齐标记（:-- / --: / :-:），第三段起必须能解析成合法分隔行。
function mdCells(line) {
	let body = String(line).trim();
	if (body.startsWith('|')) body = body.slice(1);
	if (body.endsWith('|')) body = body.slice(0, -1);
	return body.split('|').map((c) => c.trim());
}
// 形如 `| --- | :-- | --: |` 的分隔行判定（至少一个单元格，且每格都是分隔符或留空）
function mdIsSeparatorRow(line) {
	if (!line || line.indexOf('|') < 0) return false;
	const cells = mdCells(line);
	if (!cells.length) return false;
	return cells.every((c) => c === '' || /^:?-{1,}:?$/.test(c)) && cells.some((c) => c !== '');
}
// 表格行判定：必须以 | 开头或结尾（否则普通的「a | b」文本不该被吞成表格）
function mdIsTableRow(line) {
	const t = String(line || '').trim();
	return t.indexOf('|') >= 0 && (t.startsWith('|') || t.endsWith('|'));
}

// OPT-3.1d 无序列表项：任务列表 `- [ ] x` / `- [x] x` 前置禁用复选框，其余按普通项渲染
function mdListItem(text, key, onCite, onWiki) {
	const taskMatch = String(text).match(/^\[([ xX])\]\s+(.*)$/);
	if (!taskMatch) return h('li', { key, style: MD_STYLE.li }, renderInline(text, onCite, onWiki));
	return h('li', { key, style: MD_STYLE.li },
		h('input', { type: 'checkbox', checked: taskMatch[1].toLowerCase() === 'x', disabled: true, readOnly: true, style: MD_STYLE.input }),
		renderInline(taskMatch[2], onCite, onWiki));
}

// OPT-3.6 剥除 YAML frontmatter：仅当首行是 `---` 且其后存在独立的 `---` 结束行时剥离，
// 否则原样返回（避免把以分隔线开头的普通笔记的正文吃掉）。
function stripFrontmatter(text) {
	const src = String(text == null ? '' : text);
	const m = src.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
	return m ? src.slice(m[0].length) : src;
}

// OPT-3.5a 渲染兜底：renderMarkdown 内部对畸形输入（超深嵌套、异常正则路径）抛错时，
// 退化成纯文本而不是让整个气泡白屏。真正的 ErrorBoundary 由后续批次做。
function renderMarkdown(text, options) {
	try {
		return renderMarkdownImpl(text, options);
	} catch (error) {
		console.warn('[dsh-obsidian-board] Markdown 渲染失败，已降级为纯文本：', error);
		// 降级分支不能再触发一次 String(text)：若 text 的 toString 本身就是抛错源，
		// catch 里再转换会把异常重新抛出，兜底反而变成白屏。
		const plain = typeof text === 'string' ? text : '';
		return [h('div', { style: { whiteSpace: 'pre-wrap' } }, plain)];
	}
}

// OPT-3.10 Markdown 渲染结果缓存：长对话里卡片只要因任意 props 变化重渲染一次，
// renderMarkdown 就会对整条历史全文重新解析。按「消息稳定 id + 内容长度」缓存已建好的
// 元素树：len 变化（流式增量）天然失效，同键命中直接复用。仅 assistant 消息有稳定 id
// （send 的 replyId / sanitizeHistory 补发），user 消息不缓存——无 id 且短文本直渲，
// 也避免「同长度不同内容」撞键。超过 120 条整体清空防膨胀；元素树是不可变描述对象，
// 清空重建无任何副作用。
const MD_CACHE = new Map();
function cachedMarkdown(id, text, options) {
	if (!id) return renderMarkdown(text, options);
	const key = String(id) + ':' + String(text == null ? '' : text).length;
	if (MD_CACHE.has(key)) return MD_CACHE.get(key);
	const el = renderMarkdown(text, options);
	if (MD_CACHE.size >= 120) MD_CACHE.clear();
	MD_CACHE.set(key, el);
	return el;
}
function renderMarkdownImpl(text, { onCite, onWiki } = {}) {
	const lines = String(text == null ? '' : text).split(/\r?\n/);
	// 当前位置是否是一张表的起点（当前行是表格行、下一行是分隔行）
	const startsTable = (n) => n + 1 < lines.length && mdIsTableRow(lines[n]) && mdIsSeparatorRow(lines[n + 1]);
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
		// OPT-3.1a 表格：当前行是表格行，且下一行是分隔行才成立（否则按普通段落处理）
		if (mdIsTableRow(line) && i + 1 < lines.length && mdIsSeparatorRow(lines[i + 1])) {
			const head = mdCells(line);
			const rows = [];
			i += 2; // 跳过分隔行（不产出内容）
			while (i < lines.length && mdIsTableRow(lines[i])) { rows.push(mdCells(lines[i])); i++; }
			const colCount = Math.max(head.length, ...rows.map((r) => r.length));
			// 补齐缺列：单元格数量不齐时补空串，保证每行 td 数与表头一致
			const pad = (cells) => cells.concat(new Array(Math.max(0, colCount - cells.length)).fill(''));
			out.push(h('table', { key: 'k' + (key++), style: MD_STYLE.table },
				h('thead', { style: MD_STYLE.thead },
					h('tr', { style: MD_STYLE.tr },
						pad(head).map((cell, n) => h('th', { key: 'th' + n, style: MD_STYLE.th }, renderInline(cell, onCite, onWiki))))),
				rows.length
					? h('tbody', { style: MD_STYLE.tbody },
						rows.map((cells, r) => h('tr', { key: 'tr' + r, style: MD_STYLE.tr },
							pad(cells).map((cell, n) => h('td', { key: 'td' + n, style: MD_STYLE.td }, renderInline(cell, onCite, onWiki))))))
					: null,
			));
			continue;
		}
		// 标题（OPT-3.1c：放宽到 h1-h6）
		const hm = line.match(/^(#{1,6})\s+(.*)$/);
		if (hm) {
			const tag = 'h' + hm[1].length;
			out.push(h(tag, { key: 'k' + (key++), style: MD_STYLE[tag] }, renderInline(hm[2], onCite, onWiki)));
			i++;
			continue;
		}
		// 分隔线
		if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push(h('hr', { key: 'k' + (key++) })); i++; continue; }
		// 无序列表（连续行聚成一组；含任务列表）
		if (/^\s*[-*+]\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
				i++;
			}
			out.push(h('ul', { key: 'k' + (key++), style: { margin: '4px 0', paddingLeft: 4 } },
				items.map((t, n) => mdListItem(t, 'li' + n, onCite, onWiki))));
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
		// 普通段落（连续非空非特殊行）。OPT-3.1c：标题分支已放宽到 1-6 级，
		// 续行排除正则必须同步放宽，否则 #### 之后的行会被当成上一段吞掉。
		// 表格也要在这里截断（见 startsTable）：模型常写「对比如下：」紧跟表头而不留空行，
		// 不截断的话整张表会被并进上一段的行内文本。
		const para = [line];
		i++;
		while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|>\s?)/.test(lines[i]) && !startsTable(i)) {
			para.push(lines[i]);
			i++;
		}
		out.push(h('div', { key: 'k' + (key++), style: { margin: '2px 0' } }, renderInline(para.join('\n'), onCite, onWiki)));
	}
	return out;
}
function renderInline(text, onCite, onWiki) {
	const parts = [];
	const rest = String(text == null ? '' : text);
	let key = 0;
	const push = (node) => parts.push(h(node.type, { key: 'k' + (key++), ...node.props }, node.children));
	// 依序匹配：[[wikilink]]、[文字](http url)、[n] 引用、`code`、**bold**、*italic*
	// 顺序是语义的一部分：wikilink 必须在标准链接之前（否则 [[笔记]] 会被当链接吞掉），
	// bold 必须在 italic 之前（否则 **粗体** 会被当成两个单星号）。
	// 斜体要求起始星号后、结束星号前都是非空白，避免把「2 * 3 * 4」这类算式吞成斜体。
	const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[(\d{1,2})\]|`([^`]+)`|\*\*([^*]+)\*\*|\*(\S(?:[^*\n]*?\S)?)\*/g;
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
			// OPT-3.1b 标准链接：只认 http(s)，javascript:/data: 之类保持字面文本
			push({
				type: 'a', props: {
					href: m[4], target: '_blank', rel: 'noopener noreferrer', style: MD_STYLE.a,
				}, children: m[3],
			});
		} else if (m[5] !== undefined) {
			push({
				type: 'button', props: {
					type: 'button', className: 'ob-cite', style: { padding: '0 7px', margin: '0 1px' },
					title: '查看引用 ' + m[5],
					onClick: () => onCite && onCite(Number(m[5])),
				}, children: '[' + m[5] + ']',
			});
		} else if (m[6] !== undefined) {
			push({ type: 'code', props: { style: { fontFamily: 'var(--ob-mono)', fontSize: '12px', background: 'var(--ob-bg-1)', borderRadius: 'var(--ob-r-sm)', padding: '1px 5px' } }, children: m[6] });
		} else if (m[7] !== undefined) {
			push({ type: 'b', props: {}, children: m[7] });
		} else if (m[8] !== undefined) {
			// OPT-3.1d 斜体
			push({ type: 'em', props: { style: MD_STYLE.em }, children: m[8] });
		}
		last = m.index + m[0].length;
	}
	if (last < rest.length) push({ type: 'span', props: {}, children: rest.slice(last) });
	return parts;
}

// 引用编号的唯一判据：与 renderInline 交替式里的第 5 组 `\[(\d{1,2})\]` 同源（见下方
// 断言测试锁定两处字面量一致）。chips 分组、导出分节、[n] 点击兜底全部走这里——
// 「哪些算引用」的判定必须和渲染用同一条规则，否则会出现 chips 说是引用、正文点不动
// 的分裂口径（宣传稿 P0-4 挑出的正是「把召回叫成引用」，产品侧不能留同一个毛病）。
const CITED_MARK_RE = /\[(\d{1,2})\]/g;

// 扫正文里真实出现过的 [n]。先剔除代码段与链接类结构：`[1](http://x)`、`[[1]]`、
// `` `[2]` `` 在 renderInline 的交替式里都不会被当成引用标记，这里也不能误计。
function citedNumbers(text) {
	const out = new Set();
	if (!text) return out;
	const stripped = String(text)
		.replace(/`[^`]*`/g, ' ')
		.replace(/\[\[[^\]]+\]\]/g, ' ')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');
	CITED_MARK_RE.lastIndex = 0; // 全局正则复用：每次从头扫
	let m;
	while ((m = CITED_MARK_RE.exec(stripped)) !== null) out.add(Number(m[1]));
	return out;
}

// 把召回片段分成「引用」（正文里被 [n] 标到）与「相关片段」（召回了但没标）。
// 按编号去重（宿主给的 n 就是 topK 序号；同编号重复属脏数据，保留第一条）。
function citationGroups(content, citations) {
	const cited = citedNumbers(content);
	const seen = new Set();
	const groups = { cited: [], snippets: [] };
	for (const c of citations || []) {
		if (!c || seen.has(c.n)) continue;
		seen.add(c.n);
		(cited.has(c.n) ? groups.cited : groups.snippets).push(c);
	}
	return groups;
}

// OPT-3.7 内联文案表：locale/*.json 只是接入清单（exports 暴露），客户端从不读盘；
// 真实单一来源在这里。默认 zh，切换语言只需改 UI_LANG 常量或后续接 Config。
// 只收静态 UI 标签；动态错误消息（含变量插值）、轮询状态文案、poll.error 相关不进表。
const UI_LANG = 'zh';
const UI_TEXT = {
	zh: {
		// 页面标题 / 状态条
		appTitle: 'Obsidian 知识库',
		statusVault: 'Vault',
		notConfigured: '未配置',
		notesTitle: '笔记',
		statusChunks: '片段',
		statusModel: '模型',
		llmOk: '就绪',
		llmBad: '不可用',
		llmReady: '模型通道就绪',
		llmUnavailable: '模型通道不可用（检查 llm 适配器）',
		// 侧栏 / 笔记面板
		reindex: '重建索引',
		reindexTitle: '强制全量重建索引',
		clearChat: '清空对话',
		clearChatConfirm: '清空当前对话？此操作不可撤销（历史记录也会一并删除）。',
		clearChatTitle: '清空面板对话历史',
		switchVault: '换仓库',
		switchVaultTitle: '连接另一个 Obsidian 仓库',
		notesSortAria: '笔记排序',
		sortRecent: '最近',
		sortName: '名称',
		sortDir: '目录',
		sortRecentTitle: '按修改时间（最近优先）',
		sortNameTitle: '按显示名排序',
		sortDirTitle: '按目录分组排序',
		searchPlaceholder: '检索笔记（支持 #标签）…',
		notesEmpty: '没有笔记（先重建索引）',
		emptyStateTitle: '向你的知识库提问',
		// 动作条（复制 / 导出 / 导入 / 停止 / 输入占位）
		copy: '复制',
		copyAllTitle: '复制这条回答全文',
		copiedOk: '已复制 ✓',
		copyFail: '复制失败',
		fallbackChip: '备用通道',
		citeGroupCited: '引用',
		citeGroupSnippets: '相关片段',
		citeNoneMarked: '本条未标注编号引用（以下均为召回片段）',
		citeMissing: '未找到引用',
		exportMd: '导出对话 .md',
		exportMdTitle: '把当前对话导出为 Markdown 文件并下载（.md）',
		exportedOk: '已导出 ✓',
		exportCopied: '已复制到剪贴板 ✓',
		exportFail: '导出失败',
		exportJson: '导出 JSON',
		exportJsonTitle: '把当前对话导出为 JSON 文件（含 vaultHash 与全量历史）',
		importJson: '导入 JSON',
		importJsonTitle: '从 JSON 文件导入对话历史（替换当前对话）',
		stopTitle: '停止生成',
		sendTitle: '发送',
		queueSendTitle: '加入队列（当前回答结束后自动发送）',
		queueTitle: '待发送队列',
		queuedTag: '待发送',
		queueCancelTitle: '从队列移除',
		// 宿主 InputBar 的 placeholder 只描述「可以输入什么」，快捷键走按钮 tooltip；
		// 这里保持同款克制文案，避免长提示在窄面板被截断。
		askPlaceholder: '基于知识库提问…',
		// 配置卡
		pickVaultTitle: '选择 Obsidian 仓库位置',
		switchVaultCardTitle: '切换 Obsidian 仓库',
		vaultCardDesc: '自动发现本机的 Obsidian 仓库（读 Obsidian 自己的记录 + 扫描常见位置）。也可以点「浏览…」用系统对话框选，或直接粘贴路径。索引与关键词匹配全部本地完成；回答只发送问题、最近对话与命中片段，整库不上传。',
		vaultPathInvalid: '知识库路径无效：配置的目录已不存在或不可访问，请重新选择仓库位置。',
		scanningVaults: '正在扫描本机的 Obsidian 仓库…',
		recentlyUsedSuffix: '　·　最近使用',
		noVaultsFound: '没有自动发现到仓库——用下面的「浏览…」选，或粘贴路径。',
		rescan: '重新扫描',
		browse: '浏览…',
		browseTitle: '打开系统目录选择对话框',
		cancelSwitch: '取消，返回当前仓库',
		// 消息卡动作条（MessageCardBase 也在 smoke 切片内，这些键均为纯标签）
		savedOk: '已保存 ✓',
		saveAsNote: '保存为笔记',
		saveFail: '保存失败',
		// 模型选择器（两级菜单：模型 / 推理档位，与主对话页同构）
		modelDefault: '默认模型',
		modelHostDefault: '宿主默认模型',
		modelHostDefaultSub: '与 DSH 主会话一致',
		modelPickerTitle: '选择回答用的模型与推理档位（走 DSH 配置的模型通道）',
		modelPickerAria: '选择模型与推理档位',
		modelLoading: '正在加载模型…',
		modelMenuModel: '模型',
		modelMenuEffort: '推理档位',
		modelProviderAccount: 'DeepSeek 账号',
		modelProviderOfficial: 'DeepSeek 官方',
		modelRetry: '重试',
		modelErrorPrefix: '模型目录加载失败：',
		modelEmptyNoProviders: '宿主模型通道未注册（llm 目录为空）——重启 DSH 可重连；或确认模型插件（如 workbuddy-connect）已启用',
		modelEmptyNoModels: '没有发现可选模型（宿主 llm 未暴露目录）——仍可用宿主默认模型',
		modelNoEffort: '当前模型未提供推理档位。',
		chipFree: '免费',
		effortsLabel: '档位',
		effortDefault: '默认',
		effortUpstreamDefault: '默认',
		effortLow: '低',
		effortMedium: '中',
		effortHigh: '高',
		effortXHigh: '极高',
		effortMax: '最高',
		resizeHandleAria: '调整 vault 列表宽度',
		resizeHandleTitle: '拖动调整宽度（键盘 ←/→ 微调，Home 复位，双击还原）',
		refResizeAria: '调整笔记预览宽度',
		modelSearchPlaceholder: '搜索模型…',
		modelSearchClear: '清除搜索',
		modelNoMatch: '没有匹配的模型',
		modelGroupUngrouped: '未分组',
		// 消息卡动作条 / 回到底部 / 引用面板 / 头部摘要
		bottomJump: '回到底部',
		bottomJumpTitle: '回到底部（跳转到最新消息）',
		refClose: '关闭',
		refEmptyNote: '（空笔记）',
		refModifiedPrefix: '修改于 ',
		headModelFallback: '默认模型',
	},
	en: {
		// Page title / status bar
		appTitle: 'Obsidian Knowledge Base',
		statusVault: 'Vault',
		notConfigured: 'Not configured',
		notesTitle: 'Notes',
		statusChunks: 'Chunks',
		statusModel: 'Model',
		llmOk: 'Ready',
		llmBad: 'Unavailable',
		llmReady: 'Model channel ready',
		llmUnavailable: 'Model channel unavailable (check the llm adapter)',
		// Sidebar / notes panel
		reindex: 'Rebuild index',
		reindexTitle: 'Force full index rebuild',
		clearChat: 'Clear chat',
		clearChatConfirm: 'Clear the current conversation? This cannot be undone (stored history is removed too).',
		clearChatTitle: 'Clear panel chat history',
		switchVault: 'Switch vault',
		switchVaultTitle: 'Connect to another Obsidian vault',
		notesSortAria: 'Sort notes',
		sortRecent: 'Recent',
		sortName: 'Name',
		sortDir: 'Folder',
		sortRecentTitle: 'By modification time (newest first)',
		sortNameTitle: 'By display name',
		sortDirTitle: 'Sort by folder grouping',
		searchPlaceholder: 'Search notes (supports #tags)…',
		notesEmpty: 'No notes (rebuild the index first)',
		emptyStateTitle: 'Ask your knowledge base',
		// Action bar (copy / export / import / stop / composer placeholder)
		copy: 'Copy',
		copyAllTitle: 'Copy this answer in full',
		copiedOk: 'Copied ✓',
		copyFail: 'Copy failed',
		fallbackChip: 'Fallback channel',
		citeGroupCited: 'Cited',
		citeGroupSnippets: 'Related snippets',
		citeNoneMarked: 'No [n] markers in this answer — everything below is a retrieved snippet',
		citeMissing: 'Citation not found',
		exportMd: 'Export chat .md',
		exportMdTitle: 'Export the current chat as a Markdown file download (.md)',
		exportedOk: 'Exported ✓',
		exportCopied: 'Copied to clipboard ✓',
		exportFail: 'Export failed',
		exportJson: 'Export JSON',
		exportJsonTitle: 'Export the current chat as a JSON file (with vaultHash and full history)',
		importJson: 'Import JSON',
		importJsonTitle: 'Import chat history from a JSON file (replaces the current chat)',
		stopTitle: 'Stop generating',
		sendTitle: 'Send',
		queueSendTitle: 'Add to queue (sent after the current answer)',
		queueTitle: 'Queued messages',
		queuedTag: 'Queued',
		queueCancelTitle: 'Remove from queue',
		askPlaceholder: 'Ask your knowledge base…',
		// Vault config card
		pickVaultTitle: 'Choose Obsidian vault location',
		switchVaultCardTitle: 'Switch Obsidian vault',
		vaultCardDesc: 'Discover Obsidian vaults on this machine (reads the Obsidian registry + scans common locations). You can also click "Browse…" to pick with the system dialog, or paste a path directly. Indexing and keyword matching all run locally; an answer only sends your question, the recent conversation and the retrieved snippets to the model channel — the vault itself is never uploaded.',
		vaultPathInvalid: 'Vault path invalid: the configured folder no longer exists or is not accessible. Please choose the vault location again.',
		scanningVaults: 'Scanning for Obsidian vaults on this machine…',
		recentlyUsedSuffix: '　·　Recently used',
		noVaultsFound: 'No vaults discovered automatically — use "Browse…" below or paste a path.',
		rescan: 'Rescan',
		browse: 'Browse…',
		browseTitle: 'Open the system folder picker dialog',
		cancelSwitch: 'Cancel and return to current vault',
		// Message-card action bar (MessageCardBase is also inside the smoke slice; pure labels)
		savedOk: 'Saved ✓',
		saveAsNote: 'Save as note',
		saveFail: 'Save failed',
		// Model picker (two-level menu: Model / Effort, same as the main conversation)
		modelDefault: 'Default model',
		modelHostDefault: 'Host default model',
		modelHostDefaultSub: 'Same as the DSH main session',
		modelPickerTitle: 'Choose the model and reasoning effort for answers (via the DSH-configured model channel)',
		modelPickerAria: 'Select model and reasoning effort',
		modelLoading: 'Loading models…',
		modelMenuModel: 'Model',
		modelMenuEffort: 'Effort',
		modelProviderAccount: 'DeepSeek Account',
		modelProviderOfficial: 'DeepSeek Official',
		modelRetry: 'Retry',
		modelErrorPrefix: 'Model catalog failed to load: ',
		modelEmptyNoProviders: 'The host model channel is not registered (empty llm catalog) — restart DSH to reconnect, or check that the model plugin (e.g. workbuddy-connect) is enabled.',
		modelEmptyNoModels: 'No selectable models (the host llm exposes no catalog) — the host default model still works.',
		modelNoEffort: 'This model provides no reasoning effort levels.',
		chipFree: 'Free',
		effortsLabel: 'efforts',
		effortDefault: 'default',
		effortUpstreamDefault: 'Default',
		effortLow: 'Low',
		effortMedium: 'Medium',
		effortHigh: 'High',
		effortXHigh: 'Extra high',
		effortMax: 'Max',
		resizeHandleAria: 'Resize vault list width',
		resizeHandleTitle: 'Drag to resize (←/→ to fine-tune, Home to reset, double-click to restore)',
		refResizeAria: 'Resize note preview width',
		modelSearchPlaceholder: 'Search models…',
		modelSearchClear: 'Clear search',
		modelNoMatch: 'No matching models',
		modelGroupUngrouped: 'Ungrouped',
		bottomJump: 'Back to bottom',
		bottomJumpTitle: 'Back to bottom (jump to latest message)',
		refClose: 'Close',
		refEmptyNote: '(empty note)',
		refModifiedPrefix: 'Modified ',
		headModelFallback: 'Default model',
	},
};
// 取词顺序：当前语言表 → fallback → zh 表 → 键名本身（漏键在界面上可见，便于发现）。
const t = (key, fallback) => { const tab = UI_TEXT[UI_LANG] || UI_TEXT.zh; return tab[key] !== undefined ? tab[key] : (fallback !== undefined ? fallback : (UI_TEXT.zh[key] !== undefined ? UI_TEXT.zh[key] : key)); };

// ── 模型选择（移植宿主 ModelSelect 的两级菜单）──────────────────────
// 与主对话输入框同构：root 是「模型 / 推理档位」两行，分别钻入 provider 分组
// 的模型列表和档位列表；搜索、键盘行走、焦点回归、向上弹层与宿主一致。
// 面板没有 DSH 会话，选择只存在本地（localStorage）并随每条消息以
// provider/model/effort 覆盖下发——不写宿主全局 configure。
const MODEL_KEY = 'dsh-obsidian-board/model';
// 菜单首帧先按固定原点隐藏测量 offsetWidth/Height（Host MEASURE_STYLE 同款），
// 再定位到触发按钮上方 8px；四边留 12px 视口边距。
const MODEL_MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 };
const MODEL_MARGIN = 12;
const EFFORT_TEXT = { low: 'effortLow', medium: 'effortMedium', high: 'effortHigh', xhigh: 'effortXHigh', max: 'effortMax' };
const effortName = (id) => { const key = EFFORT_TEXT[id]; return key ? t(key) : String(id || ''); };

// 把持久化/菜单选择还原成合法路由。null = 目录里没有这个模型（调用方决定
// 等目录还是回默认）；model 为空 = 宿主默认（不覆盖）。
function pickModelRoute(sel, rows) {
	if (!sel || typeof sel !== 'object') return null;
	const model = String(sel.model || '').trim();
	if (!model) return { provider: '', model: '', effort: null };
	const provider = String(sel.provider || '').trim();
	const row = (Array.isArray(rows) ? rows : []).find((m) => m && m.model === model && (!provider || m.provider === provider));
	if (!row) return null;
	const efforts = Array.isArray(row.efforts) ? row.efforts.filter((e) => typeof e === 'string' && e) : [];
	const effort = typeof sel.effort === 'string' && efforts.includes(sel.effort) ? sel.effort : null;
	return { provider: row.provider || '', model: row.model, effort };
}

const modelRowName = (row) => String((row && (row.label || row.name || row.model)) || '');

// 当前生效档位（未做显示文案）：显式值 → 宿主配置默认（模型支持时）→ 模型默认。
// 与宿主半 resolveEffort 完全同序；undefined = 未声明档位或无法确定默认。
// 显示（触发器/页头）与实际下发共用这一处解析，避免「写的」和「发的」漂移。
function resolveRowEffort(row, effort, hostDefault) {
	const efforts = Array.isArray(row && row.efforts) ? row.efforts.filter((e) => typeof e === 'string' && e) : [];
	if (!efforts.length) return undefined;
	const explicit = typeof effort === 'string' && efforts.includes(effort) ? effort : '';
	if (explicit) return explicit;
	const configured = typeof hostDefault === 'string' && efforts.includes(hostDefault) ? hostDefault : '';
	if (configured) return configured;
	const modelDefault = typeof row.defaultEffort === 'string' && efforts.includes(row.defaultEffort) ? row.defaultEffort : '';
	return modelDefault || undefined;
}

// 触发器/摘要共用的档位文案：解析结果 → 中文名；模型支持档位但无默认 →「默认」。
function modelRowEffort(row, effort, hostDefault) {
	const pick = resolveRowEffort(row, effort, hostDefault);
	if (pick) return effortName(pick);
	const efforts = Array.isArray(row && row.efforts) ? row.efforts.filter((e) => typeof e === 'string' && e) : [];
	return efforts.length ? t('effortUpstreamDefault') : '';
}

// 行内富信息（免费/费率/上下文/档位/徽章）：与旧面板信息量一致，但不抢模型名。
function modelRowMeta(row) {
	if (!row) return '';
	const bits = [];
	if (row.free === true) bits.push(t('chipFree'));
	if (row.credits) bits.push(row.credits + ' credits');
	if (Number(row.contextWindow) > 0) bits.push(Math.round(Number(row.contextWindow) / 1000) + 'K ctx');
	const efforts = Array.isArray(row.efforts) ? row.efforts : [];
	if (efforts.length) bits.push(efforts.map(effortName).join(' / '));
	if (Array.isArray(row.badges) && row.badges.length) bits.push(...row.badges.slice(0, 2));
	return bits.join(' · ');
}

function ModelPicker({ models, providerNames, selection, hostEffort, hostDefault, loading, error, source, providerCount, disabled, onChange, onReload }) {
	const [open, setOpen] = useState(false);
	const [pane, setPane] = useState('root');
	const [query, setQuery] = useState('');
	const [highlighted, setHighlighted] = useState(null);
	const [selectionFocus, setSelectionFocus] = useState(false);
	const [menuPos, setMenuPos] = useState(null);
	const rootRef = useRef(null);
	const triggerRef = useRef(null);
	const searchRef = useRef(null);
	const menuRef = useRef(null);
	const groupsRef = useRef(null);
	// itemRefs：菜单内所有可聚焦行（root 两格 / 默认行 / 模型行 / 档位行）；
	// modelRefs：仅模型行（搜索高亮滚动用，索引与 visibleModels 对齐）。
	const itemRefs = useRef([]);
	const modelRefs = useRef([]);
	const paneFocus = useRef(null);
	const idRef = useRef(null);
	if (idRef.current === null) idRef.current = 'ob-ms-' + Math.random().toString(36).slice(2, 8);
	const id = idRef.current;

	const providerRank = (pid) => (pid === 'deepseek-account' ? 0 : pid === 'deepseek-official' ? 1 : 2);
	const groups = useMemo(() => {
		const map = new Map();
		for (const row of Array.isArray(models) ? models : []) {
			if (!row || !row.model) continue;
			const pid = String(row.provider || '');
			if (!map.has(pid)) {
				const name = (providerNames && providerNames[pid])
					|| (pid === 'deepseek-account' ? t('modelProviderAccount') : pid === 'deepseek-official' ? t('modelProviderOfficial') : (pid || t('modelGroupUngrouped')));
				map.set(pid, { id: pid, name, models: [] });
			}
			const label = modelRowName(row);
			map.get(pid).models.push({ row, id: row.model, name: label, label });
		}
		return [...map.values()].sort((a, b) => providerRank(a.id) - providerRank(b.id));
	}, [models, providerNames]);
	const currentRow = useMemo(() => {
		if (!selection || !selection.model) return null;
		return (Array.isArray(models) ? models : []).find((row) => row && row.model === selection.model && (!selection.provider || row.provider === selection.provider)) || null;
	}, [models, selection && selection.model, selection && selection.provider]);
	// 未显式选择时展示宿主默认模型（与主对话页一样，触发器显示真实模型名，
	// 而不是笼统的「默认模型」；宿主没配默认模型时仍回退文案）。
	const hostRow = useMemo(() => {
		const id = hostDefault && typeof hostDefault.model === 'string' ? hostDefault.model : '';
		if (!id) return null;
		const provider = typeof hostDefault.provider === 'string' ? hostDefault.provider : '';
		return (Array.isArray(models) ? models : []).find((row) => row && row.model === id && (!provider || row.provider === provider)) || null;
	}, [models, hostDefault && hostDefault.model, hostDefault && hostDefault.provider]);
	// 菜单/档位操作针对「当前生效模型」：显式选择优先，否则是宿主默认模型。
	const activeRow = currentRow || hostRow;
	const reasoning = useMemo(() => {
		if (!activeRow) return null;
		const efforts = Array.isArray(activeRow.efforts) ? activeRow.efforts.filter((e) => typeof e === 'string' && e) : [];
		if (!efforts.length) return null;
		return {
			efforts,
			defaultEffort: typeof activeRow.defaultEffort === 'string' && efforts.includes(activeRow.defaultEffort) ? activeRow.defaultEffort : undefined,
		};
	}, [activeRow]);
	const showSearch = (Array.isArray(models) ? models.length : 0) > 4;
	const filteredGroups = useMemo(() => groups
		.map((group) => ({ ...group, models: primitives.rankByName(group.models, showSearch ? query.trim() : '') }))
		.filter((group) => group.models.length > 0), [groups, query, showSearch]);
	const visibleModels = useMemo(() => filteredGroups.flatMap((group) => group.models.map((entry) => ({ group, row: entry.row }))), [filteredGroups]);
	const currentVisibleIndex = visibleModels.findIndex((entry) => activeRow && entry.row.provider === activeRow.provider && entry.row.model === activeRow.model);
	const activeModelIndex = visibleModels.length === 0
		? -1
		: Math.min(highlighted === null ? Math.max(0, currentVisibleIndex) : highlighted, visibleModels.length - 1);
	// 与宿主 resolveEffort 完全同序：显式值 → 宿主配置默认（模型支持时）→ 模型默认。
	// 面板不写回任何配置，所以 null 时显示的就是宿主接下来实际会发的档位。
	const explicitEffort = selection && typeof selection.effort === 'string' ? selection.effort : '';
	const effectiveEffort = reasoning ? resolveRowEffort(activeRow, explicitEffort, hostEffort) : undefined;
	const effortChoices = useMemo(() => {
		if (!reasoning) return [];
		const list = [];
		if (reasoning.defaultEffort === undefined) list.push({ key: 'provider-default', effort: null, label: t('effortUpstreamDefault') });
		for (const effort of reasoning.efforts) list.push({ key: 'effort:' + effort, effort, label: effortName(effort) });
		return list;
	}, [reasoning]);
	const modelLabel = activeRow ? modelRowName(activeRow) : (loading ? t('modelLoading') : t('modelDefault'));
	const effortLabel = reasoning ? (effectiveEffort ? effortName(effectiveEffort) : t('effortUpstreamDefault')) : '';
	const triggerText = effortLabel ? modelLabel + ' · ' + effortLabel : modelLabel;

	const reload = () => { if (typeof onReload === 'function') onReload(); };
	const changeQuery = (next) => { setQuery(next); setHighlighted(0); };
	const close = (restoreFocus) => {
		setOpen(false);
		setPane('root');
		if (restoreFocus) queueMicrotask(() => { if (triggerRef.current) triggerRef.current.focus(); });
	};
	const closeAfterSelection = () => { setSelectionFocus(true); close(true); };
	const drill = (next) => { setQuery(''); setHighlighted(null); paneFocus.current = 'drill'; setPane(next); };
	const back = (from) => { paneFocus.current = from; setPane('root'); };
	const show = () => {
		setSelectionFocus(false);
		if (triggerRef.current) triggerRef.current.focus();
		setQuery('');
		setHighlighted(null);
		if (!activeRow) paneFocus.current = 'drill';
		setPane(activeRow ? 'root' : 'model');
		setOpen(true);
		reload();
	};
	const chooseModel = (row) => {
		if (!row) return;
		// 选中的就是当前生效模型（含宿主默认）→ 只关菜单，不把默认路由钉成显式覆盖。
		if (activeRow && row.provider === activeRow.provider && row.model === activeRow.model) { closeAfterSelection(); return; }
		onChange({ provider: row.provider || '', model: row.model, effort: null });
		closeAfterSelection();
	};
	const chooseHostDefault = () => {
		if (!selection || !selection.model) { closeAfterSelection(); return; }
		onChange({ provider: '', model: '', effort: null });
		closeAfterSelection();
	};
	const chooseEffort = (effort) => {
		if (!activeRow) return;
		const chosen = effort == null ? null : effort;
		const active = effectiveEffort == null ? null : effectiveEffort;
		if (active === chosen) { closeAfterSelection(); return; }
		// 当前走宿主默认路由时选档位：把默认模型与档位一起钉成消息级覆盖，
		// 否则「只改档位」没有可挂载的显式模型。
		onChange({ provider: activeRow.provider || '', model: activeRow.model, effort: chosen });
		closeAfterSelection();
	};
	const moveFocus = (offset) => {
		const items = itemRefs.current.filter((item) => item !== null && item !== undefined);
		if (!items.length) return;
		const active = items.findIndex((item) => item === document.activeElement);
		const next = active === -1 ? (offset > 0 ? 0 : items.length - 1) : (active + offset + items.length) % items.length;
		if (items[next] && typeof items[next].focus === 'function') items[next].focus();
	};
	const onMenuKeyDown = (event) => {
		if ((event.nativeEvent && event.nativeEvent.isComposing) || event.isComposing) return;
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			if (pane !== 'root' && activeRow) back(pane);
			else close(true);
			return;
		}
		if (!open) return;
		if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault();
			if (!disabled && visibleModels.length > 0) {
				setHighlighted((activeModelIndex + (event.key === 'ArrowDown' ? 1 : -1) + visibleModels.length) % visibleModels.length);
				if (searchRef.current) searchRef.current.focus();
			}
			return;
		}
		if (pane === 'model' && showSearch && event.target && event.target.tagName === 'INPUT'
			&& (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
			if (event.key === 'Tab' && visibleModels.length === 0) return;
			event.preventDefault();
			const entry = visibleModels[activeModelIndex];
			if (!disabled && entry) chooseModel(entry.row);
			return;
		}
		if (event.key === 'Tab') {
			if (event.shiftKey) {
				event.preventDefault();
				if (pane !== 'root' && activeRow) back(pane);
				else close(true);
				return;
			}
			const focused = document.activeElement;
			const rows = itemRefs.current.filter((item) => item !== null && item !== undefined);
			if (focused && focused.tagName === 'BUTTON' && rows.indexOf(focused) >= 0) {
				event.preventDefault();
				focused.click();
				return;
			}
			if (focused !== triggerRef.current) return;
			event.preventDefault();
			if (pane === 'model' && showSearch) {
				setHighlighted(null);
				if (searchRef.current) searchRef.current.focus();
				return;
			}
			const checked = menuRef.current && menuRef.current.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])');
			const target = checked || rows.find((item) => !item.disabled);
			if (target) target.focus();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			moveFocus(event.key === 'ArrowDown' ? 1 : -1);
		}
	};
	const onMenuBlur = (event) => {
		const next = event.relatedTarget;
		if (next && ((rootRef.current && rootRef.current.contains(next)) || (menuRef.current && menuRef.current.contains(next)))) return;
		close(false);
	};

	// 外点关闭：菜单在 portal 里，必须同时检查 root 与 menu。
	useEffect(() => {
		if (!open) return;
		const closeOutside = (event) => {
			if (rootRef.current && rootRef.current.contains(event.target)) return;
			if (menuRef.current && menuRef.current.contains(event.target)) return;
			setOpen(false);
			setPane('root');
		};
		document.addEventListener('mousedown', closeOutside);
		return () => document.removeEventListener('mousedown', closeOutside);
	}, [open]);
	// 搜索模式变化时清空查询（与宿主 useLayoutEffect 同义）
	useEffect(() => {
		if (!showSearch) { setQuery(''); setHighlighted(null); }
	}, [showSearch]);
	// 打开/钻入后的焦点落点：搜索框 → 选中项 → 第一个可选项 → 触发按钮；回到 root 则还给对应格子。
	useEffect(() => {
		if (!open) return;
		const intent = paneFocus.current;
		paneFocus.current = null;
		if (intent === null) return;
		if (intent === 'drill') {
			if (pane === 'model' && showSearch) { if (searchRef.current) searchRef.current.focus(); return; }
			const checked = menuRef.current && menuRef.current.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])');
			const first = itemRefs.current.find((item) => item && !item.disabled);
			const target = checked || first || triggerRef.current;
			if (target) target.focus();
			return;
		}
		if (intent === 'model' || intent === 'effort') {
			const cell = itemRefs.current[intent === 'effort' ? 1 : 0];
			const target = cell && !cell.disabled ? cell : triggerRef.current;
			if (target) target.focus();
		}
	}, [open, pane, showSearch]);
	// provider 分组标题吸顶背景（宿主 MenuGroup 的配套观察器）。
	useEffect(() => {
		if (!open || pane !== 'model') return;
		const viewport = groupsRef.current;
		if (!viewport || typeof primitives.observeStickyMenuGroups !== 'function') return;
		return primitives.observeStickyMenuGroups(viewport);
	}, [open, pane, filteredGroups, loading]);
	// 定位：触发按钮上方 8px，四边 12px；滚动/尺寸变化重新测量（与宿主 place 同构）。
	useEffect(() => {
		if (!open) { setMenuPos(null); return; }
		const place = () => {
			const rect = triggerRef.current && triggerRef.current.getBoundingClientRect ? triggerRef.current.getBoundingClientRect() : null;
			if (!rect || typeof window === 'undefined') return;
			const lw = (menuRef.current && menuRef.current.offsetWidth) || 0;
			const lh = (menuRef.current && menuRef.current.offsetHeight) || 0;
			let x = rect.right - lw;
			let y = rect.top - 8 - lh;
			if (lw > 0) x = Math.min(Math.max(x, MODEL_MARGIN), window.innerWidth - lw - MODEL_MARGIN);
			if (lh > 0) y = Math.min(Math.max(y, MODEL_MARGIN), window.innerHeight - lh - MODEL_MARGIN);
			setMenuPos({ left: x, top: y });
		};
		place();
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		const menu = menuRef.current;
		const observer = typeof ResizeObserver !== 'undefined' && menu ? new ResizeObserver(place) : null;
		if (menu && observer) observer.observe(menu);
		return () => {
			if (observer) observer.disconnect();
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
	}, [open, pane, query, filteredGroups, loading]);
	// 高亮项跟随滚动（只在模型列表内，用 modelRefs 避免受默认行偏移影响）。
	useEffect(() => {
		if (open && pane === 'model' && activeModelIndex >= 0) {
			const node = modelRefs.current[activeModelIndex];
			if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
		}
	}, [open, pane, activeModelIndex, visibleModels]);

	// 只构建当前 pane：ref 序号必须按实际渲染顺序从 0 分配，
	// 否则 root 两格的 itemRefs[0]/[1] 会被未渲染 pane 的占位挤走。
	// 每次渲染清空（宿主同款）：换 pane/过滤后行数变化，旧行引用不得残留。
	itemRefs.current = [];
	modelRefs.current = [];
	let itemIndex = 0;
	const itemRef = () => {
		const at = itemIndex++;
		return (node) => { itemRefs.current[at] = node; };
	};

	const rootPane = pane === 'root'
		? [
			h('button', {
				ref: itemRef(),
				key: 'cell-model',
				type: 'button',
				role: 'menuitem',
				className: 'ob-ms-cell',
				onClick: () => drill('model'),
			},
				h('span', { className: 'ob-ms-cellLabel' }, t('modelMenuModel')),
				h('span', { className: 'ob-ms-cellValue' }, modelLabel),
				h(primitives.IconChevronRightOutlineRegular, { className: 'ob-ms-cellChevron' }),
			),
			reasoning
				? h('button', {
					ref: itemRef(),
					key: 'cell-effort',
					type: 'button',
					role: 'menuitem',
					className: 'ob-ms-cell',
					onClick: () => drill('effort'),
				},
					h('span', { className: 'ob-ms-cellLabel' }, t('modelMenuEffort')),
					h('span', { className: 'ob-ms-cellValue' }, effortLabel),
					h(primitives.IconChevronRightOutlineRegular, { className: 'ob-ms-cellChevron' }),
				)
				: null,
		]
		: null;

	const modelPane = pane === 'model'
		? (() => {
			const searchRow = showSearch
				? h('div', { className: 'ob-ms-searchRow' },
					h(primitives.Input, {
						ref: searchRef,
						className: 'ob-ms-search' + (query !== '' ? ' ob-ms-searchWithQuery' : ''),
						type: 'text',
						role: 'searchbox',
						'aria-label': t('modelSearchPlaceholder'),
						'aria-controls': id + '-models',
						'aria-activedescendant': activeModelIndex < 0 ? undefined : id + '-model-' + activeModelIndex,
						placeholder: t('modelSearchPlaceholder'),
						value: query,
						readOnly: !!disabled,
						onChange: (event) => changeQuery(event.target.value),
					}),
					query !== ''
						? h('button', {
							type: 'button', className: 'ob-ms-searchClear', 'aria-label': t('modelSearchClear'), disabled: !!disabled,
							onClick: () => { changeQuery(''); if (searchRef.current) searchRef.current.focus(); },
						}, h(primitives.IconCloseFillRegular, {}))
						: null,
				)
				: null;
			const hostDefaultRow = query.trim() === ''
				? h('button', {
					ref: itemRef(),
					type: 'button',
					role: 'menuitemradio',
					'aria-checked': !(selection && selection.model),
					className: 'ob-ms-option' + (!(selection && selection.model) ? ' ob-ms-optionActive' : ''),
					tabIndex: showSearch ? -1 : 0,
					disabled: !!disabled,
					onMouseMove: () => { if (!disabled && showSearch) setHighlighted(null); },
					onClick: chooseHostDefault,
				},
					h('span', { className: 'ob-ms-optionCopy' },
						h('span', { className: 'ob-ms-modelName' }, t('modelHostDefault')),
						h('span', { className: 'ob-ms-modelSub' }, t('modelHostDefaultSub')),
					),
					h('span', { className: 'ob-ms-check' }, !(selection && selection.model) ? h(primitives.IconCheckOutlineRegular, {}) : null),
				)
				: null;
			let modelIndex = 0;
			const modelRows = filteredGroups.map((group) => h(primitives.MenuGroup, { key: group.id, label: group.name },
				group.models.map((entry) => {
					const index = modelIndex++;
					const row = entry.row;
					const selected = !!(currentRow && row.provider === currentRow.provider && row.model === currentRow.model);
					const assign = itemRef();
					const meta = modelRowMeta(row);
					return h('button', {
						ref: (node) => { assign(node); modelRefs.current[index] = node; },
						key: row.provider + '/' + row.model,
						type: 'button',
						role: 'menuitemradio',
						'aria-checked': selected,
						id: id + '-model-' + index,
						tabIndex: showSearch ? -1 : 0,
						'data-highlighted': index === activeModelIndex ? '' : undefined,
						className: 'ob-ms-option' + (selected ? ' ob-ms-optionActive' : ''),
						title: entry.label,
						disabled: !!disabled,
						onFocus: () => setHighlighted(index),
						onMouseMove: !disabled && index !== activeModelIndex
							? () => { if (showSearch) setHighlighted(index); else if (modelRefs.current[index]) modelRefs.current[index].focus(); }
							: undefined,
						onClick: () => chooseModel(row),
					},
						h('span', { className: 'ob-ms-optionCopy' },
							h('span', { className: 'ob-ms-modelName' }, entry.label),
							meta ? h('span', { className: 'ob-ms-optionMeta' }, meta) : null,
						),
						h('span', { className: 'ob-ms-check' }, selected ? h(primitives.IconCheckOutlineRegular, {}) : null),
					);
				}),
			));
			const emptyHint = !(Array.isArray(models) && models.length)
				? (source === 'empty' && !providerCount ? t('modelEmptyNoProviders') : t('modelEmptyNoModels'))
				: t('modelNoMatch');
			return [
				searchRow,
				error
					? h('div', { className: 'ob-ms-error' },
						h('span', null, t('modelErrorPrefix') + String(error)),
						h('button', { type: 'button', className: 'ob-ms-retry', onClick: reload }, t('modelRetry')))
					: null,
				loading && !(Array.isArray(models) && models.length)
					? h('div', { className: 'ob-ms-status' }, t('modelLoading'))
					: null,
				hostDefaultRow,
				h('div', {
					ref: groupsRef,
					id: id + '-models',
					className: 'ob-ms-groups',
					role: 'menu',
					'aria-label': t('modelMenuModel'),
					hidden: filteredGroups.length === 0,
				}, modelRows),
				!loading && filteredGroups.length === 0
					? h('div', { className: 'ob-ms-empty', role: 'status' },
						h('span', null, emptyHint),
						!(Array.isArray(models) && models.length)
							? h('button', { type: 'button', className: 'ob-ms-retry', style: { marginLeft: 6 }, onClick: reload }, t('modelRetry'))
							: null)
					: null,
			];
		})()
		: null;

	const effortPane = pane === 'effort'
		? (effortChoices.length === 0
			? h('div', { className: 'ob-ms-empty' }, t('modelNoEffort'))
			: effortChoices.map((level) => {
				const active = (effectiveEffort == null ? null : effectiveEffort) === (level.effort == null ? null : level.effort);
				return h('button', {
					ref: itemRef(),
					key: level.key,
					type: 'button',
					role: 'menuitemradio',
					'aria-checked': active,
					className: 'ob-ms-option' + (active ? ' ob-ms-optionActive' : ''),
					disabled: !!disabled,
					onClick: () => chooseEffort(level.effort),
				},
					h('span', { className: 'ob-ms-optionCopy' },
						h('span', { className: 'ob-ms-modelName' }, level.label)),
					h('span', { className: 'ob-ms-check' }, active ? h(primitives.IconCheckOutlineRegular, {}) : null),
				);
			}))
		: null;

	return h('div', {
		ref: rootRef,
		className: 'ob-ms-root',
		onKeyDown: onMenuKeyDown,
		onBlur: onMenuBlur,
		onMouseDown: (event) => { if (event.target && event.target.closest && event.target.closest('button')) event.preventDefault(); },
	},
		h('button', {
			ref: triggerRef,
			type: 'button',
			className: 'ob-ms-trigger',
			'aria-label': t('modelPickerAria') + ' · ' + triggerText,
			'aria-haspopup': 'menu',
			'aria-expanded': open,
			'aria-controls': open ? id + '-menu' : undefined,
			title: triggerText,
			'aria-busy': !!loading,
			'data-selection-focus': selectionFocus ? '' : undefined,
			onBlur: () => setSelectionFocus(false),
			disabled: !!disabled,
			onClick: () => { if (open) close(true); else show(); },
		},
			h(primitives.IconDataOutlineRegular, { className: 'ob-ms-triggerIcon', size: 16 }),
			h('span', { className: 'ob-ms-triggerLabel' }, modelLabel),
			effortLabel ? h('span', { className: 'ob-ms-triggerEffort' }, effortLabel) : null,
			loading
				? h(primitives.StateDot, { state: 'ongoing' })
				: h(primitives.IconChevronDownOutlineRegular, { className: 'ob-ms-chevron' + (open ? ' ob-ms-chevronOpen' : '') }),
		),
		open
			? ReactDOM.createPortal(
				h(primitives.MenuSurface, {
					ref: menuRef,
					id: id + '-menu',
					className: 'ob-ms-menu',
					style: menuPos || MODEL_MEASURE_STYLE,
					role: pane === 'model' ? 'group' : 'menu',
					'aria-label': t('modelPickerAria'),
					'aria-busy': !!loading,
				},
					pane === 'root' ? rootPane : null,
					pane === 'model' ? modelPane : null,
					pane === 'effort' ? effortPane : null,
				),
				document.body,
			)
			: null,
	);
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

// OPT-3.5b 面板级错误边界。为什么必须是 class：React 只有 class 组件能声明
// getDerivedStateFromError / componentDidCatch，函数组件无法拦截子树渲染异常。
// 为什么粒度是「消息区」：Markdown 渲染器自身已有降级（renderMarkdown 内 try/catch），
// 但一条字段畸形的历史消息（例如 citations/thinking 被写坏）仍会让整个面板白屏；
// 包住消息列表后，坏消息只降级成一张卡，侧栏/输入框/右栏全部照常可用。
// 注意：本段在测试切片内被 new Function 求值，只能用注入的 h/useState/... 与 React2。
// 而 React2 声明在切片之外——直接 extends React2.Component 会让切片求值瞬间抛
// ReferenceError。故先用 typeof 探针（对未声明标识符安全）取基类，切片内退回一个
// 同形替身：切片只在无消息的空状态下建树，永不实例化该边界，真实运行时才用真 Component。
const ErrorBoundaryBase = (typeof React2 !== 'undefined' && React2 && React2.Component)
	? React2.Component
	: class {
		constructor(props) { this.props = props || {}; this.state = { error: null }; }
	};
class ChatErrorBoundary extends ErrorBoundaryBase {
	constructor(props) {
		super(props);
		this.state = { error: null };
		this.handleRetry = this.handleRetry.bind(this);
	}

	static getDerivedStateFromError(error) {
		return { error: error || new Error('渲染异常') };
	}

	componentDidCatch(error, info) {
		// 不静默吞：控制台留痕，便于把「哪条消息把面板打挂」定位到具体组件栈。
		console.warn('[obsidian-board] 消息区渲染异常，已降级显示：', error, info && info.componentStack);
	}

	handleRetry() {
		this.setState({ error: null });
	}

	render() {
		if (this.state.error) {
			return h('div', { className: 'ob-error-boundary', role: 'alert' },
				h('span', { className: 'ob-error-text' }, '这一块渲染出错，已降级显示：' + String((this.state.error && this.state.error.message) || this.state.error)),
				h('button', {
					type: 'button', className: 'ob-btn', style: { padding: '3px 10px', fontSize: 11.5 },
					onClick: this.handleRetry, title: '重新尝试渲染这块内容',
				}, '重试'),
			);
		}
		return this.props.children;
	}
}

// OPT-3.10 单条消息卡片：从 ObsidianPage 的大 map 里整体抽出，memo 包装后长对话
// 流式更新只重渲染「目标卡」，其余历史卡 props 不变直接跳过。
// memo 生效的三个前提（缺一全灭）：
//   1. props 一律传原值/稳定引用——m 是未被动过的消息对象（patchReply 只替换目标元素，
//      其余元素引用不变）；isLast/saved/copied/citationLimit 是布尔·字符串·数字原值；
//      回调全是 useCallback 产物；绝不把整个 savedTip 对象传进来（setState 换新引用）。
//   2. Markdown 渲染走 cachedMarkdown（消息 id + 内容长度为键）。
//   3. 每消息的 UI 态（引用 chips 展开/收起）放本组件自己的 useState，不进父级。
function MessageCardBase({ m, isLast, saved, copied, citationLimit, openNote, goWiki, saveAnswer, retryLast, copyAnswer }) {
	const [showAllCites, setShowAllCites] = useState(false);
	// 正文里点了个没有对应召回片段的 [n]（模型编号越界/串号）：记下来给一句可见提示，
	// 而不是静默无反应；下一次点到有效编号自动清掉。
	const [citeMiss, setCiteMiss] = useState(0);
	if (m.error) {
		return h('div', { className: 'ob-msg assistant' },
			h('div', { className: 'ob-err' },
				m.error,
				// 错误消息带重试
				isLast
					? h('div', { style: { marginTop: 8 } },
						h('button', { type: 'button', className: 'ob-btn', style: { padding: '4px 12px', fontSize: 11.5 }, onClick: retryLast }, '重试'))
					: null,
			),
		);
	}
	return h('div', { className: 'ob-msg ' + (m.role === 'assistant' ? 'assistant' : 'user') },
		h('div', { className: 'ob-bubble' },
			m.pending
				? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ob-mut)' } }, h('span', { className: 'ob-spin' }), (m.content ? '' : (m.isThinking || m.thinking ? '深度思考中…（思考过程见下方）' : '检索知识库并生成回答…')))
				: null,
			// 思考过程块：思考中实时展开；有正文后折叠成一行摘要。
			String(m.thinking || '').trim()
				? h(ThinkBlock, { text: m.thinking, open: !!(m.pending && !m.content) })
				: null,
			// 空回复守卫：assistant 消息结束但没有任何内容时，渲染明确提示而不是空壳气泡。
			(!m.pending && m.role === 'assistant' && !String(m.content || '').trim())
				? h('span', { style: { color: 'var(--ob-mut)' } }, m.stopped ? '（已停止）' : m.interrupted ? '（已中断——面板被刷新或流被切换打断，可重试）' : '（模型没有输出内容）')
				: null,
			// Markdown 渲染（wikilink 可点击跳右栏；[n] 引用同）。OPT-3.10 命中缓存时直接复用。
			cachedMarkdown(m.id, m.content, {
				onCite: (n) => {
					const cites = m.citations || [];
					const cite = cites.find((c) => c.n === n);
					if (cite) {
						setCiteMiss(0);
						openNote(cite.notePath);
					} else if (cites.length) setCiteMiss(n);
					// cites 为空时保持原有的静默：cachedMarkdown 按 id+长度缓存，
					// 极端情况下闭包可能抓到「引用还没到」的那一帧，宁可无反应也不误报。
				},
				onWiki: goWiki,
			}),
			// 消息动作条：token 用量 / 复制 / 保存为笔记 / 已停止标记
			m.role === 'assistant' && !m.pending && m.content
				? h('div', { className: 'ob-msg-actions' },
					m.usage
						? h('span', { className: 'ob-usage', title: '本次回答 token 用量' },
							'↑' + (m.usage.input ?? '?') + ' ↓' + (m.usage.output ?? '?'))
						: null,
					m.provider ? h('span', { className: 'ob-usage' }, m.model ? m.provider + '·' + m.model + (m.effort ? '·' + m.effort : '') : m.provider) : null,
					// 备用通道标记：宿主只在「首跳零文本且未中断」时回退，回退后 provider/model 已是新通道，
					// 光看模型名分不清这是主通道还是备用通道产的——这一段必须让用户看见，否则「标注真实模型」
					// 只标了结果、藏了过程。标签走 t()（静态），说明文案含通道名插值，与相邻动态 title 同策略。
					m.fallback ? h('span', {
						className: 'ob-usage',
						title: '首跳没有产出正文，已整段丢弃并由 '
							+ (m.fallback.provider || '?') + (m.fallback.model ? '·' + m.fallback.model : '')
							+ ' 从头重新生成（不拼接）',
					}, t('fallbackChip')) : null,
					// OPT-3.4 复制：clipboard 不可用 / 写入异常时短暂显示「复制失败」
					h('button', {
						type: 'button', className: 'ob-msg-btn', title: t('copyAllTitle'),
						onClick: () => copyAnswer(m),
					}, copied === 'ok' ? t('copiedOk') : copied === 'fail' ? t('copyFail') : t('copy')),
					h('button', {
						type: 'button', className: 'ob-msg-btn', title: '把这条回答保存为 vault 笔记（AI 回答/ 目录）',
						onClick: () => saveAnswer(m),
					}, saved ? t('savedOk') : t('saveAsNote')),
					m.stopped ? h('span', { className: 'ob-usage' }, '（已停止）') : null,
					m.interrupted ? h('span', { className: 'ob-usage' }, '（已中断）') : null,
					// 中断/停止/报错的消息都给出重试入口——否则用户只能手动重敲一遍
					(m.interrupted || m.stopped) && isLast
						? h('button', { type: 'button', className: 'ob-msg-btn', onClick: retryLast }, '重试')
						: null,
				)
				: null,
			// 被中断且无正文：动作条上面的守卫不渲染（没有 content），
			// 这里补一个独立的重试行，避免「什么都没有、也没法重试」的死胡同。
			(m.interrupted || m.stopped) && m.role === 'assistant' && !String(m.content || '').trim() && isLast
				? h('div', { style: { marginTop: 8 } },
					h('button', { type: 'button', className: 'ob-btn', style: { padding: '4px 12px', fontSize: 11.5 }, onClick: retryLast }, '重试'))
				: null,
		),
		m.role === 'assistant' && (m.citations || []).length
			? h('div', { className: 'ob-cites', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '4px' } },
				(() => {
					// 口径：宿主 citations 返回的是全部 topK **召回**片段，不是「回答实际引用了哪几条」——
					// 系统提示词只要求具体事实挂 [n]，结论与观点明确不挂（lib/index.js 提示词第 4 条）。
					// 分组判据与正文渲染同源（citationGroups → CITED_MARK_RE），否则会出现
					// 「chips 说是引用、正文里点不动」的分裂口径。把召回一律叫「引用」正是宣传片挑出的
					// P0-4 毛病，产品侧不能留同一个问题。
					const groups = citationGroups(m.content, m.citations);
					const chip = (c, isCited) =>
						h('button', {
							key: c.n, type: 'button', className: 'ob-cite',
							title: isCited ? c.notePath : '召回片段，正文未用 [n] 标注 · ' + c.notePath,
							style: isCited ? null : { opacity: 0.72 },
							onClick: () => openNote(c.notePath),
						}, h('span', { className: 'n' }, '[' + c.n + ']'), c.noteTitle);
					const label = (text) => h('span', { style: { fontSize: '10.5px', color: 'var(--ob-mut)' } }, text);
					// 引用组全显（数量小、且是答案的出处，折叠就等于把出处藏起来）；
					// 相关片段组延用 OPT-3.11 的折叠：可见数 = 宿主 status.citationLimit（上限唯一来源）。
					const rows = [];
					if (groups.cited.length) {
						rows.push(h('div', { className: 'ob-cites', key: 'cited' },
							label(t('citeGroupCited') + ' ' + groups.cited.length),
							groups.cited.map((c) => chip(c, true))));
					}
					if (groups.snippets.length) {
						const collapsed = !showAllCites && groups.snippets.length > citationLimit;
						const visible = collapsed ? groups.snippets.slice(0, citationLimit) : groups.snippets;
						const hidden = groups.snippets.length - visible.length;
						const chips = visible.map((c) => chip(c, false));
						if (hidden > 0) {
							chips.push(h('button', {
								key: 'more', type: 'button', className: 'ob-cite',
								title: '展开其余 ' + hidden + ' 条相关片段',
								onClick: () => setShowAllCites(true),
							}, '+' + hidden));
						} else if (showAllCites && groups.snippets.length > citationLimit) {
							chips.push(h('button', {
								key: 'less', type: 'button', className: 'ob-cite',
								title: '收起相关片段列表',
								onClick: () => setShowAllCites(false),
							}, '收起'));
						}
						rows.push(h('div', { className: 'ob-cites', key: 'snip' },
							label(t('citeGroupSnippets') + ' ' + groups.snippets.length),
							chips));
					}
					// 一条 [n] 都没有：直说「本条未标注编号引用」，而不是把召回伪装成引用列表。
					if (!groups.cited.length) {
						rows.unshift(h('div', { className: 'ob-cites', key: 'none' }, label(t('citeNoneMarked'))));
					}
					// 正文点了个召回里没有的编号 → 给可见原因，不做静默无反应。
					if (citeMiss) {
						rows.push(h('div', { className: 'ob-cites', key: 'miss' },
							label(t('citeMissing') + ' [' + citeMiss + ']')));
					}
					return rows;
				})())
			: null,
	);
}
// C2 模板（切片安全）：切片内没有 React，退回透传；真实运行时用 React.memo。
const MessageCard = (typeof React2 !== 'undefined' && React2 && React2.memo ? React2.memo : (fn) => fn)(MessageCardBase);

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
	const [notes, setNotes] = useState({ notes: [], total: 0, hasMore: false, nextOffset: null }); // OPT-1.9-client 分页游标
	// 载入即净化：把上次会话残留的 pending/isThinking 收尾（否则永久转圈，见 sanitizeHistory 注释）
	const [messages, setMessages] = useState(() => sanitizeHistory(LS.get(HISTORY_KEY, [])));
	const messagesRef = useRef(messages);
	useEffect(() => { messagesRef.current = messages; }, [messages]);
	const [draft, setDraft] = useState(() => LS.get(DRAFT_KEY, ''));
	const [busy, setBusy] = useState(false);
	// 索引重建独立于对话流：历史版本共用 busy，重建期间输入框被当成「生成中」，
	// 新 composer 会因此把发送变成排队/停止。两者语义无关，必须拆开。
	const [indexing, setIndexing] = useState(false);
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
	// OPT-2.11-client configure 失败原因展示（配置卡区域），'' = 无错误
	const [configError, setConfigError] = useState('');
	// 模型选择（与主对话页同构）：目录来自宿主 listModels；选择只存在本面板
	// （localStorage），发送时作为消息级 provider/model/effort 覆盖下发，不写宿主 configure。
	const [modelList, setModelList] = useState(null);    // {providers,providerNames,models,source,providerCount}
	const [modelSel, setModelSel] = useState(() => {
		const saved = LS.get(MODEL_KEY, null);
		if (saved && typeof saved === 'object' && typeof saved.model === 'string') {
			return {
				provider: String(saved.provider || ''),
				model: saved.model,
				effort: typeof saved.effort === 'string' ? saved.effort : null,
			};
		}
		return { provider: '', model: '', effort: null }; // 空 = 宿主默认路由
	});
	const [modelsLoading, setModelsLoading] = useState(true);
	const [modelsError, setModelsError] = useState('');
	// 待发送队列（生成中 Enter 入队）：UI state + ref 双份，ref 供流结束后同步取队首。
	const [queue, setQueue] = useState([]);
	const queueRef = useRef([]);
	const queueSeq = useRef(0);
	// 左侧 vault 列表宽度（可拖拽）：持久化到 localStorage，跨会话保留
	const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(LS.get(SIDEBAR_KEY, SIDEBAR_DEFAULT)));
	const [resizing, setResizing] = useState(false);
	const sidebarRef = useRef(null);
	const chatRef = useRef(null);
	const loadedRef = useRef(false);
	// OPT-4.1 当前 vault 命名空间哈希：'' = status 未到（此时持久化必须跳过，见下）
	const vaultHashRef = useRef('');
	// 右侧笔记预览宽度（可拖拽）：持久化到 localStorage；面板关闭再打开时宽度恢复
	const [refPaneWidth, setRefPaneWidth] = useState(() => clampRefPane(LS.get(REFPANE_KEY, REFPANE_DEFAULT)));
	const [refResizing, setRefResizing] = useState(false);
	const refPaneRef = useRef(null);

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

	// 右栏拖拽调宽：与左栏同模式（pointer + setPointerCapture + 锁 body 光标）。
	// 手柄贴右栏左边缘：向左拖 = 变宽，故用 startWidth - 位移。
	const onRefResizeStart = useCallback((e) => {
		if (e.button !== undefined && e.button !== 0) return; // 只响应左键
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = refPaneRef.current ? refPaneRef.current.getBoundingClientRect().width : refPaneWidth;
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		setRefResizing(true);
		try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 老浏览器无此 API */ }
		const onMove = (ev) => {
			setRefPaneWidth(clampRefPane(startWidth - (ev.clientX - startX)));
		};
		const onUp = () => {
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
			setRefResizing(false);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}, [refPaneWidth]);

	// 键盘可达：按「分割线移动方向」映射——← 分割线左移 = 变宽，→ 变窄，Home 复位
	const onRefResizeKey = useCallback((e) => {
		const step = e.shiftKey ? 48 : 16;
		if (e.key === 'ArrowLeft') { e.preventDefault(); setRefPaneWidth((w) => clampRefPane(w + step)); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); setRefPaneWidth((w) => clampRefPane(w - step)); }
		else if (e.key === 'Home') { e.preventDefault(); setRefPaneWidth(REFPANE_DEFAULT); }
	}, []);

	// 右栏宽度持久化（拖拽结束后写入）
	useEffect(() => {
		if (refResizing) return;
		LS.set(REFPANE_KEY, refPaneWidth);
	}, [refPaneWidth, refResizing]);

	// OPT-4.1 按当前 vault 命名空间接管历史：首拉 status 与 configure 成功都汇到这里。
	// 1) vaultPath → hash；与当前命名空间相同则不做任何事（幂等）。
	// 2) 读 'history:<hash>'；不存在且该 hash 是本会话首次遇到时，从旧单键 HISTORY_KEY
	//    一次性迁移（写 history:<hash> 完成接管；旧键保留不删，保留一版用于回滚）。
	// 3) sanitizeHistory 后 setMessages。
	// 换仓库（connectVault 成功）也走这里：否则旧 vault 的对话会被持久化进新 vault 的键。
	const adoptVaultHistory = useCallback((res) => {
		const hash = vaultHashOf(res && res.vaultPath);
		if (hash === vaultHashRef.current) return;
		vaultHashRef.current = hash;
		const nsKey = 'history:' + hash;
		let loaded = LS.get(nsKey, null);
		if (loaded === null || loaded === undefined) {
			// 本会话首次遇到该 vault：尝试旧键一次性迁移
			const legacy = LS.get(HISTORY_KEY, null);
			if (Array.isArray(legacy) && legacy.length) {
				LS.set(nsKey, legacy);
				loaded = legacy;
			}
		}
		if (Array.isArray(loaded)) setMessages(sanitizeHistory(loaded));
	}, []);

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
				// OPT-4.1 首次接管：按 status.vaultPath 切换历史命名空间（含旧键一次性迁移）
				if (alive) adoptVaultHistory(res);
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
		return () => { alive = false; };
	}, [call, adoptVaultHistory]);

	// 模型目录：首次挂载拉一次；打开菜单时按 30s 节流刷新（宿主目录可能因插件重载变化）。
	// 正在拉取时忽略重复请求（菜单打开事件 + 首次挂载可能叠在一起）。
	const modelsInFlight = useRef(false);
	const modelsFetchedAt = useRef(0);
	const loadModels = useCallback(async (force) => {
		if (modelsInFlight.current) return;
		if (!force && modelsFetchedAt.current && Date.now() - modelsFetchedAt.current < 30000) return;
		modelsInFlight.current = true;
		setModelsLoading(true);
		setModelsError('');
		try {
			const res = await call('listModels');
			if (res && res.ok) {
				const rows = Array.isArray(res.models) ? res.models : [];
				setModelList({
					providers: res.providers || [],
					providerNames: res.providerNames || {},
					models: rows,
					defaultProvider: res.defaultProvider || '',
					defaultModel: res.defaultModel || '',
					defaultEffort: res.defaultEffort || '',
					source: res.source || '',
					providerCount: res.providerCount || 0,
				});
				modelsFetchedAt.current = Date.now();
				// 持久化的选择可能已不在目录里（换通道/模型下线）：归一化为宿主默认。
				// 目录为空时保留用户选择，等下一次目录恢复后还能命中。
				if (rows.length) {
					setModelSel((prev) => pickModelRoute(prev, rows) || { provider: '', model: '', effort: null });
				}
			} else {
				setModelsError(String((res && res.error) || '未知错误'));
			}
		} catch (error) {
			setModelsError(String(error && error.message || error));
		} finally {
			modelsInFlight.current = false;
			setModelsLoading(false);
		}
	}, [call]);
	useEffect(() => { loadModels(); }, [loadModels]);
	const reloadModels = useCallback(() => { loadModels(true); }, [loadModels]);
	// 选择持久化：跨面板开关/刷新保留（与主对话页「模型选择跟着会话」相近的体验）
	useEffect(() => { LS.set(MODEL_KEY, modelSel); }, [modelSel]);

	// 当前选中模型的目录行（富化信息 + 档位集）
	const selRow = useMemo(() => {
		if (!modelSel.model || !modelList || !Array.isArray(modelList.models)) return null;
		return modelList.models.find((m) => m.model === modelSel.model && (!modelSel.provider || m.provider === modelSel.provider)) || null;
	}, [modelList, modelSel]);

	// 菜单选择 → 归一化（模型必须仍在目录内；档位必须属于该模型），不写宿主 config。
	const applyModelSelection = useCallback((next) => {
		const normalized = pickModelRoute(next, modelList && modelList.models);
		setModelSel(normalized || { provider: '', model: '', effort: null });
	}, [modelList]);

	// 持久化历史与草稿。落盘前净化：绝不把 pending/isThinking 写进存储——
	// 它们是「此刻有活跃流」的瞬时态，一旦跨会话存活就变成永久转圈。
	// OPT-4.1 持久化改走当前 vault 命名空间键；vaultHashRef 为空（status 未到）时跳过，
	// 避免在还不知道该写哪个命名空间时把消息写进错误键。
	useEffect(() => {
		if (!vaultHashRef.current) return;
		LS.set('history:' + vaultHashRef.current, sanitizeHistory(messages).slice(-40));
	}, [messages]);
	useEffect(() => { LS.set(DRAFT_KEY, draft); }, [draft]);

	// OPT-3.3 流式跟随用「内容感知识别」：旧依赖只有 [messages.length, busy]，而流式输出时
	// 数组长度不变、只有内容在变，于是文字一直在下方生成、视口却不动。改依赖 messages 引用
	// （每次 patch 都是新数组）后每个增量都会命中；是否真的滚由 stickToBottomRef 决定。
	// 滚动位置用一个 ref 记（不用 state）：scroll 事件每帧都来，不能每帧重渲染整棵消息树。
	const stickToBottomRef = useRef(true);
	const [showJump, setShowJump] = useState(false);

	// 新消息/流式增量：仍在底部附近才跟随
	useEffect(() => {
		const el = chatRef.current;
		if (!el) return;
		if (!stickToBottomRef.current) {
			// 用户正在上方翻阅：只亮起「回到底部」提示，绝不抢走阅读位置。
			setShowJump(true);
			return;
		}
		el.scrollTop = el.scrollHeight;
		setShowJump(false);
	}, [messages, busy]);

	// OPT-3.3 距底部 ≤80px 视为「仍跟随」；超过即认为用户主动上翻，暂停自动滚动。
	const onChatScroll = useCallback((e) => {
		const el = e && e.currentTarget;
		if (!el) return;
		const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
		const stick = gap <= 80;
		stickToBottomRef.current = stick;
		if (stick) setShowJump(false);
	}, []);

	// OPT-3.3 主动回到底部 = 恢复跟随：后续流式输出继续自动滚动（否则按钮点一次就失效）
	const jumpToBottom = useCallback(() => {
		stickToBottomRef.current = true;
		setShowJump(false);
		const el = chatRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, []);

	const updateStatus = useCallback((res) => {
		if (res && res.ok) setStatus(res);
	}, [call]);

	// refs 供渲染回调读取最新列表（wikilink 解析 / 搜索跳转）
	const notesRef = useRef(notes);
	useEffect(() => { notesRef.current = notes; }, [notes]);
	const doSearchRef = useRef(null); // doSearch 定义后回填

	// 保存回答为笔记
	// OPT-4.3 savedTip 改以消息稳定 id 为键：retryLast 删掉尾部 assistant 消息重发后，
	// 数组下标整体位移，按下标存的「已保存 ✓」会贴到错误的回答上；id（replyId / 历史
	// sanitizeHistory 补齐的 'h' 前缀 id）不随重排变化。indexOf 只用于找标题（上一条 user 消息）。
	const [savedTip, setSavedTip] = useState({});
	const saveAnswer = useCallback(async (m) => {
		if (!m || !m.id || !m.content || !m.content.trim()) return;
		const idx = messagesRef.current.indexOf(m);
		const res = await call('saveNote', {
			title: (messagesRef.current[idx - 1] || {}).content || '',
			content: m.content,
			citations: m.citations || [],
		}).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
		if (res && res.ok) {
			setSavedTip((prev) => ({ ...prev, [m.id]: res.path }));
			call('listNotes', { sort: noteSort }).then((list) => { applyNoteListRef.current(list); }).catch(() => {});
		} else {
			setSavedTip((prev) => ({ ...prev, [m.id]: t('saveFail') }));
		}
	}, [call]);

	// OPT-3.4 复制单条回答：clipboard 不可用或写入异常时降级为短暂显示「复制失败」。
	// copiedTip 以 m.id 为键（'ok' | 'fail'），1.5s 后自动复位按钮文案。
	const [copiedTip, setCopiedTip] = useState({});
	const copyAnswer = useCallback(async (m) => {
		if (!m || typeof m.content !== 'string' || !m.content || !m.id) return;
		const id = m.id;
		let ok = false;
		try {
			if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(m.content);
				ok = true;
			}
		} catch (e) {
			ok = false;
		}
		setCopiedTip((prev) => ({ ...prev, [id]: ok ? 'ok' : 'fail' }));
		setTimeout(() => {
			setCopiedTip((prev) => {
				const next = { ...prev };
				delete next[id];
				return next;
			});
		}, 1500);
	}, []);

	// OPT-3.4 导出整个对话为 .md（缺陷修复）：改为浏览器真实下载（Blob + <a download>，
	// 文件进浏览器下载目录 / 由浏览器询问保存位置），不再静默写入 vault——原实现走
	// saveNote 落到 vault「AI 回答」目录，用户未选位置就只见「已导出 ✓」，无从得知落点。
	// 导出体不变 = frontmatter + 「我 / 助手」分节，assistant 消息附引用列表。
	// 无 DOM 环境（非浏览器态）降级为剪贴板复制全文；存入 vault 仍走单条消息的「保存为笔记」。
	const [exportTip, setExportTip] = useState(null); // null | { state: 'ok'|'fail', path }
	const exportChat = useCallback(() => {
		const msgs = messagesRef.current
			.filter((m) => m && m.role && !m.pending && String(m.content || '').trim());
		if (!msgs.length) return;
		const now = new Date();
		const dateStr = now.toISOString().slice(0, 10);
		const title = '对话导出 ' + dateStr;
		const lines = ['---', 'title: ' + title, 'source: obsidian-board', 'exported: ' + now.toISOString(), '---', '', '# ' + title, ''];
		for (const m of msgs) {
			lines.push('## ' + (m.role === 'assistant' ? '助手' : '我'), '', String(m.content).trim(), '');
			if (m.role === 'assistant' && (m.citations || []).length) {
				// 导出口径与界面同源（citationGroups）：正文真标了 [n] 的才写「引用」，其余写「相关片段」。
				// 全写成引用＝把召回冒充出处，落进用户 vault 里再也分不清。
				// 段名沿用导出一贯的硬编码中文（同上方「助手 / 我」）。
				const g = citationGroups(m.content, m.citations);
				const row = (list) => list.map((c) => '[' + c.n + '] ' + c.notePath).join('；');
				if (g.cited.length) lines.push('> 引用：' + row(g.cited));
				else lines.push('> 本条未标注编号引用（以下均为召回片段）');
				if (g.snippets.length) lines.push('> 相关片段：' + row(g.snippets));
				lines.push('');
			}
		}
		const text = lines.join('\n');
		const fname = 'obsidian-board-对话导出-' + dateStr + '.md';
		try {
			if (typeof document === 'undefined' || typeof Blob === 'undefined' || !URL || !URL.createObjectURL) {
				throw new Error('no-dom');
			}
			const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fname;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 5000);
			setExportTip({ state: 'ok', path: fname });
		} catch (e) {
			// 降级：无下载 API 时复制到剪贴板（尽力而为，剪贴板也失败才报错）
			try {
				if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text);
					setExportTip({ state: 'ok', path: null });
				} else {
					setExportTip({ state: 'fail', path: null });
				}
			} catch (e2) {
				setExportTip({ state: 'fail', path: null });
			}
		}
		setTimeout(() => setExportTip(null), 2500);
	}, []);

	// ── OPT-4.2-client 对话 JSON 导出/导入 ──────────────────────────
	// 导出：当前命名空间全量历史序列化 {vaultHash, exportedAt, items}，Blob + 临时 <a download>
	// 触发下载；宿主无 Blob/URL API（非浏览器态）时降级为剪贴板复制完整 JSON。
	// 导入：隐藏 <input type="file"> → FileReader → 形状校验 → sanitizeHistory → setMessages
	// + 写当前命名空间 localStorage + 尽力而为远端 historySet（typert.js 尚未声明该 descriptor，
	// B7 才生成；未注册时 call 返回 {ok:false,error} 而不抛，catch 兜底静默降级）。
	const importFileRef = useRef(null);
	const [jsonTip, setJsonTip] = useState(null); // null | { state: 'ok'|'fail', msg }
	const exportChatJson = useCallback(() => {
		const items = sanitizeHistory(messagesRef.current);
		if (!items.length) return;
		const payload = {
			vaultHash: vaultHashRef.current || 'default',
			exportedAt: new Date().toISOString(),
			items,
		};
		const text = JSON.stringify(payload, null, 2);
		try {
			if (typeof document === 'undefined' || typeof Blob === 'undefined' || !URL || !URL.createObjectURL) {
				throw new Error('no-dom');
			}
			const blob = new Blob([text], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'obsidian-board-对话导出-' + new Date().toISOString().slice(0, 10) + '.json';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 5000);
			setJsonTip({ state: 'ok', msg: 'JSON 已导出' });
		} catch (e) {
			// 降级：无下载 API 时复制到剪贴板（尽力而为，剪贴板也失败才报错）
			try {
				if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text);
					setJsonTip({ state: 'ok', msg: '下载不可用，JSON 已复制到剪贴板' });
				} else {
					setJsonTip({ state: 'fail', msg: '导出失败：' + String(e && e.message || e) });
				}
			} catch (e2) {
				setJsonTip({ state: 'fail', msg: '导出失败：' + String(e2 && e2.message || e2) });
			}
		}
		setTimeout(() => setJsonTip(null), 2500);
	}, []);
	const importChatJson = useCallback((e) => {
		const file = e.target.files && e.target.files[0];
		e.target.value = ''; // 允许连续导入同一文件
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const parsed = JSON.parse(String(reader.result || ''));
				// 形状校验：{items: [{role, content}...]}，逐项检查最小契约
				if (!parsed || !Array.isArray(parsed.items)) throw new Error('缺少 items 数组');
				for (const it of parsed.items) {
					if (!it || (it.role !== 'user' && it.role !== 'assistant') || typeof it.content !== 'string') {
						throw new Error('items 中存在非法条目（需含 role: user|assistant 与 content 字符串）');
					}
				}
				const cleaned = sanitizeHistory(parsed.items);
				setMessages(cleaned);
				// 写当前命名空间（vaultHashRef 为空说明 status 未到——此时仍按 default 写，导入意图优先）
				const nsKey = 'history:' + (vaultHashRef.current || 'default');
				LS.set(nsKey, cleaned.slice(-40));
				// 尽力而为远端同步：typert.js 尚未声明 historySet descriptor（B7 生成），
				// 未注册时必须静默降级
				try {
					call('historySet', { vaultId: vaultHashRef.current, items: cleaned.slice(-40), updatedAt: Date.now() }).catch(() => {});
				} catch (e3) {
					// B7 前的 descriptor 缺失降级路径，静默即可
				}
				setJsonTip({ state: 'ok', msg: '已导入 ' + cleaned.length + ' 条对话记录' });
			} catch (err) {
				setJsonTip({ state: 'fail', msg: '导入失败：' + String(err && err.message || err) });
			}
			setTimeout(() => setJsonTip(null), 3000);
		};
		reader.onerror = () => {
			setJsonTip({ state: 'fail', msg: '导入失败：文件读取错误' });
			setTimeout(() => setJsonTip(null), 3000);
		};
		reader.readAsText(file, 'utf-8');
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
	// busy 的同步镜像：事件回调触发时 state 可能还没刷新，用 ref 做「此刻是否真有一轮
	// 在跑」的唯一真相，避免连点 / 停止后立刻重发互相踩。队列发送也以它为准。
	const busyRef = useRef(false);
	const textareaRef = useRef(null);
	const sendRef = useRef(null);
	const escapeAtRef = useRef(0);

	// 队列：生成中提交的消息依次排队，当前轮收尾后自动发下一条。队列项快照当时的
	// 模型路由——排队期间改选择器不会改写已排队消息的模型。
	const setQueueNow = useCallback((next) => {
		queueRef.current = next;
		setQueue(next);
	}, []);
	const enqueue = useCallback((text) => {
		const question = String(text || '').trim();
		if (!question) return;
		const item = {
			id: 'q' + (++queueSeq.current),
			text: question,
			route: { provider: modelSel.provider, model: modelSel.model, effort: modelSel.effort },
			ts: Date.now(),
		};
		setQueueNow([...queueRef.current, item]);
		setDraft('');
	}, [modelSel, setQueueNow]);
	const removeQueued = useCallback((id) => {
		setQueueNow(queueRef.current.filter((item) => item.id !== id));
	}, [setQueueNow]);
	// 流结束（自然完成/失败）后取队首发送。60ms 让 finally 里的 setBusy 先提交，
	// 下一次 send 看到的是「已空闲」。sendRef 避免 send ↔ scheduleDrain 的依赖环。
	const scheduleDrain = useCallback(() => {
		setTimeout(() => {
			if (busyRef.current) return;
			const next = queueRef.current[0];
			if (!next) return;
			setQueueNow(queueRef.current.slice(1));
			if (sendRef.current) sendRef.current(next.text, next.route);
		}, 60);
	}, [setQueueNow]);
	// send 接受可选的显式问题（字符串）：重试路径传上一问（setDraft 是异步的，闭包里的
	// draft 还是旧值——历史版本 setTimeout 后读闭包 draft 永远是 ''，重试按钮点了没反应）。
	// 第二个参数是可选路由快照（队列项携带；不传 = 用当前选择器）。
	// 参数校验从严：React onClick 会把**点击事件对象**当第一个参数传进来，若原样使用
	// 就会把 String(event) = "[object Object]" 当成问题发出去（实测 bug）。
	// 因此：只有 typeof === 'string' 才视为显式问题，其余（事件、undefined、null）一律回到 draft。
	const send = useCallback(async (overrideQuestion, overrideRoute) => {
		const question = String(typeof overrideQuestion === 'string' ? overrideQuestion : draft).trim();
		if (!question || busyRef.current) return;
		// 只有「从输入框发送」才清草稿；重试/队列项不碰用户正在写的下一句。
		if (typeof overrideQuestion !== 'string') setDraft('');
		const route = overrideRoute && typeof overrideRoute === 'object'
			? overrideRoute
			: { provider: modelSel.provider, model: modelSel.model, effort: modelSel.effort };
		const history = messagesRef.current
			.filter((m) => m && typeof m.content === 'string' && m.content && !m.pending)
			.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
		// 本条回复的稳定 id：整轮流式更新都靠它定位（见下方 patchReply 注释）
		const replyId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		setMessages((prev) => [...prev, { role: 'user', content: question, ts: Date.now() }, { id: replyId, role: 'assistant', content: '', pending: true }]);
		busyRef.current = true;
		setBusy(true);
		// 本轮序号：停止后立刻重发时，旧轮的 finally 不得清新轮的状态
		const mySeq = ++streamSeq.current;
		stopRequested.current = false;
		// 本轮是否已被用户停止 / 被更新的轮次取代。后者覆盖「停止后立刻重发」：
		// 新轮会把 stopRequested 复位，旧轮的 chatStart 回来时只能靠序号识别自己已过期，
		// 否则旧流会继续轮询并和新流抢 activeStream。
		const interrupted = () => stopRequested.current || streamSeq.current !== mySeq;
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
			// effort 为 null = 不下发，由宿主 resolveEffort 决定（配置默认 / 模型默认）。
			const override = route.model ? { provider: route.provider || '', model: route.model } : {};
			const effortParam = typeof route.effort === 'string' ? { effort: route.effort } : {};
			const start = await call('chatStart', { question, history, ...override, ...effortParam });
			// chatStart 期间被点了停止：宿主已按中止收尾，这里直接落定终态，别再轮询。
			if (interrupted()) {
				patchReply({ pending: false, stopped: true });
				return;
			}
			if (!start.ok) { patchReply({ pending: false, error: start.error || '启动失败' }); return; }
			const sessionId = start.sessionId;
			const citations = start.citations || [];
			activeStream.current = { sessionId, received: 0, receivedThink: 0, replyId, attempt: 1 };
			patchReply({ citations });
			// 回退标记只消费一次（poll 每轮都会带着同一个 fallback 对象，反复 patch 会多喂重渲染）。
			let fallbackMarked = false;
			// 轮询增量，300ms 间隔；done/error 终止。OPT-2.12：客户端上限跟随宿主 status.timeoutMs
			// （I1/I3 已落地，缺省 300s、30s-900s 钳制）+ 30s 缓冲。缓冲是宽限不是超时：
			// 覆盖宿主流式段自身收尾/清尾的耗时，避免宿主还没报 done/error 客户端先掐线。
			// status 缺失（理论不可达）回退 300s，与旧行为一致。
			const pollDeadline = Date.now() + (Number(status && status.timeoutMs) || 300000) + 30000;
			for (;;) {
				// 用户已点停止 / 已被新轮取代：轮询到此为止（宿主那边也会收到 abort）
				if (interrupted()) {
					patchReply({ pending: false, stopped: true });
					return;
				}
				await new Promise((r) => setTimeout(r, 300));
				if (Date.now() > pollDeadline) {
					const timeoutSec = Math.round(((Number(status && status.timeoutMs) || 300000) + 30000) / 1000);
					patchReply({ pending: false, error: '等待回答超时（' + timeoutSec + ' 秒）——宿主可能已卡住，请重试或重启 DSH。' });
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
				// 宿主只在「首跳零文本且未被中断」时记 fallback（见 lib/index.js 回退分支），回退成功后
				// 随后续每次 poll 一并带出。客户端只记一次：动作条据此标出这段回答出自备用通道，
				// 而不是用户配的主通道——不标就等于把真实来源藏起来（m05 讲的正是这件事）。
				if (poll.fallback && !fallbackMarked) {
					fallbackMarked = true;
					patchReply({ fallback: poll.fallback });
				}
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
			patchReply(interrupted()
				? { pending: false, stopped: true }
				: { pending: false, error: String(error && error.message || error) });
		} finally {
			// 只有「自己仍是最新一轮」才回收共享状态：停止后立刻重发时，旧轮的 finally
			// 若照常清空 activeStream/busy，会把新一轮的转圈与输入框锁一起清掉。
			if (streamSeq.current === mySeq) {
				activeStream.current = null;
				stopRequested.current = false; // 本轮结束，复位停止意向
				busyRef.current = false;
				setBusy(false);
				scheduleDrain(); // 队列里还有消息 → 自动发下一条
			}
		}
	}, [draft, call, modelSel, scheduleDrain]);
	// scheduleDrain 通过 ref 回调最新 send（依赖随 draft/modelSel 变化，不能进依赖环）
	useEffect(() => { sendRef.current = send; }, [send]);

	// 停止生成：三条路径都要覆盖。
	// ①已有 sessionId → 通知宿主中止（宿主侧 abort 会与「等 chunk」赛跑，静默期也能停住）；
	// ②还没拿到 sessionId（chatStart 正在检索/规划）→ 只置标志，send 会在 chatStart
	//   返回后立刻落定终态，并且不再发起模型调用；
	// ③无论如何先把 UI 解冻（busy=false）——这是用户点「停止」时的第一预期，
	//   不能等宿主确认（历史上宿主卡在静默期时按钮看起来完全没反应）。
	const stopStream = useCallback(async () => {
		// 用同步镜像判断，覆盖「send 已启动、setBusy 还没提交」的窗口：
		// 此时停止按钮尚未重渲染，但 Escape 已能被读到，停止意向不能丢。
		if (busyRef.current) stopRequested.current = true;
		setBusy(false);
		busyRef.current = false;
		// 停止后不再自动发送队列：把待发文本还给输入框（不静默丢失），清空队列。
		if (queueRef.current.length) {
			const pendingTexts = queueRef.current.map((item) => item.text).filter(Boolean);
			setQueueNow([]);
			const merged = [...pendingTexts, String(draft || '').trim()].filter(Boolean).join('\n');
			if (merged) setDraft(merged);
		}
		if (activeStream.current) await call('chatStop', { sessionId: activeStream.current.sessionId }).catch(() => {});
	}, [call, draft, setQueueNow]);

	// 输入框自动增高：按 scrollHeight 撑开，超过 CSS max-height(200px) 后内部滚动。
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight || 36, 200) + 'px';
	}, [draft]);

	// 提交：空闲 → 直接发送；生成中 → 入队（与主对话 InputBar 的 Enter 语义一致）。
	// 提交后把焦点还给输入框：点发送按钮时焦点会留在按钮上，下一次 Enter 会误触停止。
	const submit = useCallback(() => {
		const question = String(draft || '').trim();
		if (!question) return;
		if (busyRef.current) enqueue(question);
		else send();
		if (textareaRef.current) textareaRef.current.focus();
	}, [draft, enqueue, send]);

	// 输入法合成期 Enter = 选词确认，不是发送（历史 bug：候选词还没上屏就发出去了）。
	// isComposing 是现代浏览器标准信号；keyCode 229 覆盖 Safari / 部分输入法。缺一不可。
	const onComposerKeyDown = useCallback((e) => {
		if (e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229) return;
		if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			submit();
		}
	}, [submit]);

	// 双击 Escape 停止（宿主 InputBar 的快捷键）：只在真正生成中生效；
	// 菜单/弹层里已处理过的 Escape（defaultPrevented）不参与计数。
	const onPageKeyDown = useCallback((e) => {
		if (e.defaultPrevented) return;
		if (e.key !== 'Escape') { escapeAtRef.current = 0; return; }
		if (!busyRef.current) { escapeAtRef.current = 0; return; }
		const now = Date.now();
		if (now - escapeAtRef.current <= 500) {
			escapeAtRef.current = 0;
			e.preventDefault();
			stopStream();
		} else {
			escapeAtRef.current = now;
		}
	}, [stopStream]);

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
			// OPT-1.9-client 保留宿主分页游标：首拉/整表重拉走第一页（offset 未传 → hasMore:false），
			// 触底追加由 loadMoreNotes 负责
			setNotes({ notes: res.notes || [], total: res.total || 0, hasMore: false, nextOffset: null });
			setNotesError('');
			return true;
		}
		setNotesError((res && res.error) || '笔记列表加载失败');
		if (fallbackTotal !== undefined) setNotes((prev) => ({ notes: [], total: prev.total, hasMore: false, nextOffset: null }));
		return false;
	}, []);

	// OPT-1.9-client 侧栏触底分页：宿主 listNotes 支持 offset 入参（传了才开分页），
	// 返回 hasMore/nextOffset。触底（滚动距底 < 40px）且 hasMore 且无搜索词时追加下一页。
	// busyLockRef 防滚动事件连发导致重复请求；换 sort/reindex/连库时调用 resetNotePaging 归零。
	const notePagingRef = useRef({ loading: false, offset: 0 });
	const loadMoreNotes = useCallback(async () => {
		if (query.trim()) return; // 搜索分支不翻页
		if (notePagingRef.current.loading) return;
		notePagingRef.current.loading = true;
		try {
			const res = await call('listNotes', { sort: noteSort, offset: notePagingRef.current.offset });
			if (res && res.ok) {
				const page = res.notes || [];
				const hasMore = !!res.hasMore;
				notePagingRef.current.offset = hasMore
					? (Number(res.nextOffset) || (notePagingRef.current.offset + page.length))
					: 0;
				setNotes((prev) => ({
					notes: prev.notes.concat(page),
					total: res.total || prev.total,
					hasMore,
					nextOffset: hasMore ? notePagingRef.current.offset : null,
				}));
			}
		} catch (e) {
			setNotesError(String(e && e.message || e) || '笔记列表加载失败');
		} finally {
			notePagingRef.current.loading = false;
		}
	}, [call, noteSort, query]);
	// 归零分页游标：任何整表重拉（sort 切换 / reindex / 连库 / 搜索清空）后调用。
	const resetNotePaging = useCallback(() => {
		notePagingRef.current = { loading: false, offset: 0 };
	}, []);
	const onNotesScroll = useCallback((e) => {
		if (!notes.hasMore) return;
		const el = e.currentTarget;
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) loadMoreNotes();
	}, [notes.hasMore, loadMoreNotes]);

	const doSearch = useCallback(async () => {
		const q = query.trim();
		if (!q) {
			resetNotePaging();
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
			setNotes({ notes: list, total: res.noteCount || list.length, hasMore: false, nextOffset: null });
			setNotesError('');
		} else {
			setNotesError((res && res.error) || '检索失败');
		}
	}, [query, call, noteSort, applyNoteList, resetNotePaging]);
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

	// OPT-3.6 wikilink 统一跳转：按文件名/路径后缀匹配已知笔记，命中就打开（右栏）。
	// OPT-3.12 本地列表只有前 400 条（宿主 listNotes 截断），wikilink 指向列表外笔记时
	// 追加一次远端解析（search topK:1）；远端也命不中才回退「填进搜索框」。
	// goWiki 是 renderMarkdown onWiki 的 fire-and-forget 回调（返回值无人消费），改 async 安全；
	// 整段远端尝试包 try/catch——渲染回调抛错会炸掉整个消息区，绝不允许。
	const goWiki = useCallback(async (target) => {
		const wanted = String(target || '').toLowerCase().replace(/\.md$/, '');
		const all = notesRef.current.notes || [];
		const hit = all.find((n) => (n.title || '').toLowerCase() === wanted)
			|| all.find((n) => (n.path || '').toLowerCase().replace(/\.md$/, '').endsWith('/' + wanted) || (n.path || '').toLowerCase().replace(/\.md$/, '') === wanted);
		if (hit) { openNote(hit.path); return; }
		// OPT-3.12 远端解析：不依赖本地 400 条列表
		try {
			const res = await call('search', { query: String(target || ''), topK: 1 });
			if (res && res.ok && res.hits && res.hits[0] && res.hits[0].notePath) {
				openNote(res.hits[0].notePath);
				return;
			}
		} catch (e) {
			// 远端解析失败不致命：落回搜索框兜底
		}
		doSearchRef.current(String(target));
	}, [openNote, call]);

	// ── 连接/切换 vault（选择仓库位置模式）────────────────────────
	const connectVault = useCallback(async (vaultPath) => {
		const p = String(vaultPath || '').trim();
		if (!p || configuring) return;
		setConfiguring(true);
		try {
			const res = await call('configure', { vaultPath: p });
			updateStatus(res);
			// OPT-2.11-client 宿主 configure 校验失败 → RPC 包装层 {ok:false,error:'目录不存在或不是文件夹: …'}。
			// 展示到配置卡；清空旧错误避免上一次的失败残留误导
			if (res && res.error) setConfigError(String(res.error)); else setConfigError('');
			if (res && res.ok) {
				// OPT-4.1 连库成功 → 立刻按新 vaultPath 接管历史命名空间（含旧键迁移），
				// 否则旧 vault 的对话会被持久化进新 vault 的键
				adoptVaultHistory(res);
				resetNotePaging();
				const list = await call('listNotes', { sort: noteSort });
				if (list && list.ok) setNotes({ notes: list.notes || [], total: list.total || 0, hasMore: false, nextOffset: null });
			}
		} finally {
			setConfiguring(false);
		}
	}, [configuring, call, updateStatus, noteSort, adoptVaultHistory, resetNotePaging]);

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
		if (indexing || busyRef.current) return;
		setIndexing(true);
		try {
			const res = await call('reindex');
			updateStatus(res);
			resetNotePaging();
			const list = await call('listNotes', { sort: noteSort });
			if (list && list.ok) setNotes({ notes: list.notes || [], total: list.total || 0, hasMore: false, nextOffset: null });
		} finally {
			setIndexing(false);
		}
	}, [indexing, call, updateStatus, noteSort, resetNotePaging]);

	// 切换排序：最近修改 / 名称 / 目录
	const changeSort = useCallback(async (next) => {
		setNoteSort(next);
		LS.set(SORT_KEY, next);
		if (query.trim()) return; // 搜索结果由搜索决定顺序
		resetNotePaging();
		const res = await call('listNotes', { sort: next }).catch(() => null);
		if (res && res.ok) setNotes({ notes: res.notes || [], total: res.total || 0, hasMore: false, nextOffset: null });
	}, [call, query, resetNotePaging]);

	// OPT-3.9 误点即丢：这个按钮一点就把界面历史与 localStorage 里的副本一起清掉，
	// 没有任何撤销入口，所以必须先确认。空对话时直接返回——不给用户弹一个
	// 「要清空空列表吗」的无效确认。window 缺失（非浏览器宿主）时退回放行，保持可用。
	const clearChat = useCallback(() => {
		if (!messagesRef.current.length) return;
		const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
			? window.confirm(t('clearChatConfirm'))
			: true;
		if (!ok) return;
		setMessages([]);
		setNote(null);
		setQueueNow([]); // 清空对话同时丢弃待发队列（否则下一条会被旧队列顶掉）
	}, [setQueueNow]);

	// ── 未配置 vault：选择仓库位置卡 ───────────────────────────────
	if (status && !status.configured || switching) {
		return h('div', { className: 'ob-page' },
			h('div', { className: 'ob-main' },
				h('div', { className: 'ob-head' },
					h('div', { className: 'ob-title' }, h(Icon, { d: ICONS.obsidian, size: 18 }), t('appTitle')),
					h('div', { className: 'ob-head-meta' },
						h('span', { className: 'ob-dot ' + (status && status.llm ? 'ok' : 'bad') }),
						status && status.llm ? t('llmReady') : t('llmUnavailable'),
					),
				),
				h('div', { className: 'ob-empty' },
					h('div', { className: 'ob-empty-card', style: { maxWidth: 560, width: '100%' } },
						h('b', null, switching ? t('switchVaultCardTitle') : t('pickVaultTitle')),
						h('div', null, t('vaultCardDesc')),
						discoverError ? h('div', { className: 'ob-err' }, discoverError) : null,
						// OPT-2.11-client configure 校验失败的原因（宿主「目录不存在或不是文件夹: …」等），
						// 与 discoverError 并列展示在配置卡区域
						configError ? h('div', { className: 'ob-err' }, configError) : null,
						// OPT-2.11-client 已配置但 vault 路径失效（宿主探测 vaultPathValid=false）：
						// 独立的「路径无效」提示，区别于普通 configure 失败文案
						status && status.vaultPathValid === false
							? h('div', { className: 'ob-err' }, t('vaultPathInvalid'))
							: null,
						// 发现列表
						discovering
							? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ob-mut)', fontSize: 12 } }, h('span', { className: 'ob-spin' }), t('scanningVaults'))
							: (vaults && vaults.length)
								? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', textAlign: 'left' } },
									vaults.map((v) => h('button', {
										key: v.path, type: 'button', className: 'ob-note', disabled: configuring,
										onClick: () => connectVault(v.path),
									},
										h('span', { className: 'ob-note-title' }, v.name),
										h('span', { className: 'ob-note-sub' }, v.path + (v.depth === 0 ? t('recentlyUsedSuffix') : '')),
									)),
								)
								: h('div', { style: { color: 'var(--ob-mut)', fontSize: 12 } }, discoverTried.current ? t('noVaultsFound') : ' '),
						// 操作行
						h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' } },
							h('button', { className: 'ob-btn', onClick: discover, disabled: discovering },
								discovering ? h('span', { className: 'ob-spin' }) : h(Icon, { d: ICONS.refresh, size: 13 }), t('rescan')),
							h('button', { className: 'ob-btn', onClick: browse, disabled: picking || configuring, title: t('browseTitle') },
								picking ? h('span', { className: 'ob-spin' }) : null, t('browse')),
						),
						switching
							? h('button', { className: 'ob-btn', onClick: () => setSwitching(false), style: { alignSelf: 'center' } }, t('cancelSwitch'))
							: null,
					),
				),
			),
		);
	}

	// ── 正常三栏布局 ───────────────────────────────────────────────
	const statusNode = h('div', { className: 'ob-status' },
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, t('statusVault')),
			h('span', { className: 'ob-status-val', title: status ? status.vaultPath : '' },
				status ? (status.configured ? status.vaultPath : t('notConfigured')) : '…'),
		),
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, t('notesTitle')),
			h('span', { className: 'ob-status-val' }, status ? String(status.noteCount ?? '…') : '…'),
		),
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, t('statusChunks')),
			h('span', { className: 'ob-status-val' }, status ? String(status.chunkCount ?? '…') : '…'),
		),
		h('div', { className: 'ob-status-row' },
			h('span', { className: 'ob-status-key' }, t('statusModel')),
			h('span', { className: 'ob-status-val', style: { display: 'flex', alignItems: 'center', gap: 5 } },
				h('span', { className: 'ob-dot ' + (status ? (status.llm ? 'ok' : 'bad') : 'warn') }),
				status ? (status.llm ? t('llmOk') : t('llmBad')) : '…',
			),
		),
	);

	const sidebarNode = h('div', {
		className: 'ob-sidebar' + (resizing ? ' resizing' : ''),
		ref: sidebarRef,
		style: { width: sidebarWidth + 'px' },
	},
		h('h3', null, t('statusVault')),
		statusNode,
		h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
			h('button', { className: 'ob-btn', onClick: reindex, disabled: busy || indexing, title: t('reindexTitle') },
				h(Icon, { d: ICONS.refresh, size: 13 }), t('reindex')),
			h('button', { className: 'ob-btn', onClick: clearChat, title: t('clearChatTitle') },
				h(Icon, { d: ICONS.clear, size: 13 }), t('clearChat')),
			h('button', { className: 'ob-btn', onClick: startSwitch, title: t('switchVaultTitle') },
				h(Icon, { d: ICONS.book, size: 13 }), t('switchVault')),
		),
		h('div', { className: 'ob-notes-head' },
			h('h3', null, t('notesTitle') + (notes.total ? ' · ' + notes.total : '')),
			h('div', { className: 'ob-sort', role: 'group', 'aria-label': t('notesSortAria') },
				[['mtime', t('sortRecent')], ['name', t('sortName')], ['path', t('sortDir')]].map(([key, label]) =>
					h('button', {
						key, type: 'button', className: 'ob-sort-btn' + (noteSort === key ? ' sel' : ''),
						'aria-pressed': noteSort === key,
						title: key === 'mtime' ? t('sortRecentTitle') : key === 'name' ? t('sortNameTitle') : t('sortDirTitle'),
						onClick: () => changeSort(key),
					}, label),
				),
			),
		),
		h('input', {
			className: 'ob-input', value: query, placeholder: t('searchPlaceholder'),
			onChange: (e) => setQuery(e.target.value),
			onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
		}),
		h('div', { className: 'ob-notes', onScroll: onNotesScroll },
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
						: (status && status.configured ? t('notesEmpty') : '…'))
				: null,
		),
		// 拖拽手柄（贴右边缘）：鼠标拖拽调宽；键盘 ←/→ 步进、Home 复位；双击回默认
		h('div', {
			className: 'ob-resizer' + (resizing ? ' active' : ''),
			role: 'separator',
			'aria-orientation': 'vertical',
			'aria-label': t('resizeHandleAria'),
			'aria-valuenow': sidebarWidth,
			'aria-valuemin': SIDEBAR_MIN,
			'aria-valuemax': SIDEBAR_MAX,
			tabIndex: 0,
			title: t('resizeHandleTitle'),
			onPointerDown: onResizeStart,
			onKeyDown: onResizeKey,
			onDoubleClick: () => setSidebarWidth(SIDEBAR_DEFAULT),
		}),
	);

	// 模型选择器（与主对话页同位：输入卡左下）：两级菜单（模型 / 推理档位）+
	// provider 分组 + 搜索，全部走宿主 primitives；选择只作用于本面板。
	const hostEffort = (modelList && modelList.defaultEffort) || '';
	const hostDefaultRoute = {
		provider: (modelList && modelList.defaultProvider) || '',
		model: (modelList && modelList.defaultModel) || '',
	};
	const modelPickerNode = h(ModelPicker, {
		models: (modelList && Array.isArray(modelList.models)) ? modelList.models : [],
		providerNames: (modelList && modelList.providerNames) || {},
		selection: modelSel,
		hostEffort,
		hostDefault: hostDefaultRoute,
		loading: modelsLoading,
		error: modelsError,
		source: (modelList && modelList.source) || '',
		providerCount: (modelList && modelList.providerCount) || 0,
		onChange: applyModelSelection,
		onReload: reloadModels,
	});
	// 未显式选择时，页头也显示宿主默认模型的真实名字（目录里查得到才显示）。
	const hostRow = hostDefaultRoute.model && modelList && Array.isArray(modelList.models)
		? modelList.models.find((row) => row && row.model === hostDefaultRoute.model && (!hostDefaultRoute.provider || row.provider === hostDefaultRoute.provider)) || null
		: null;
	const activeRow = selRow || hostRow;
	const headEffortText = activeRow ? modelRowEffort(activeRow, modelSel.effort, hostEffort) : '';
	const headModelText = activeRow
		? (modelRowName(activeRow) + (headEffortText ? ' · ' + headEffortText : ''))
		: t('headModelFallback');

	// 待发送队列：与主对话页一样列在输入卡上方，可单条移除。
	const queueNode = queue.length
		? h('div', { className: 'ob-queue', role: 'list', 'aria-label': t('queueTitle') },
			queue.map((item) => h('div', { key: item.id, className: 'ob-queue-item', role: 'listitem' },
				h('span', { className: 'ob-queue-tag' }, t('queuedTag')),
				h('span', { className: 'ob-queue-text', title: item.text }, item.text),
				h('button', {
					type: 'button', className: 'ob-queue-cancel',
					title: t('queueCancelTitle'), 'aria-label': t('queueCancelTitle'),
					onClick: () => removeQueued(item.id),
				}, h(Icon, { d: ICONS.clear, size: 11 })),
			)))
		: null;

	// 主按钮：生成中且输入为空 = 停止；输入非空 = 发送（生成中则排队）。
	// 与宿主 InputBar 的 primaryStops 判定一致（running && empty）。
	const showStop = busy && !draft.trim();
	const primaryTitle = showStop ? t('stopTitle') : (busy ? t('queueSendTitle') : t('sendTitle'));
	const primaryButton = h('button', {
		type: 'button',
		className: 'ob-send',
		onClick: showStop ? () => stopStream() : () => submit(),
		disabled: !showStop && !draft.trim(),
		title: primaryTitle,
		'aria-label': primaryTitle,
	}, showStop ? h(StopGlyph, null) : h(SendGlyph, null));

	const composerNode = h('div', { className: 'ob-composer' },
		queueNode,
		h('div', { className: 'ob-composer-card' },
			h('textarea', {
				ref: textareaRef,
				className: 'ob-composer-input',
				rows: 1,
				value: draft,
				placeholder: t('askPlaceholder'),
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: onComposerKeyDown,
			}),
			h('div', { className: 'ob-composer-row' },
				modelPickerNode,
				h('div', { className: 'ob-composer-trailing' }, primaryButton),
			),
		),
	);

	const chatNode = h('div', { className: 'ob-main' },
		h('div', { className: 'ob-head' },
			h('div', { className: 'ob-title' }, h(Icon, { d: ICONS.obsidian, size: 18 }), t('appTitle')),
			h('div', { className: 'ob-head-meta' },
				// 当前生效模型摘要（只读；切换入口在输入卡左下——与主对话页同位）
				h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ob-mut)', fontSize: 11.5 } },
					h('span', { className: 'ob-dot ' + (status ? (status.llm ? 'ok' : 'bad') : 'warn'), style: { width: 6, height: 6 } }),
					headModelText,
				),
				status && status.engine ? h('span', { style: { fontFamily: 'var(--ob-mono)', fontSize: 10.5 } }, status.engine) : null,
				// OPT-3.4 导出整个对话为 .md：浏览器真实下载（文件名走 title 提示；剪贴板降级
				// 时显示「已复制到剪贴板 ✓」）。有对话才可导出。
				messages.length
					? h('button', {
						type: 'button', className: 'ob-msg-btn',
						title: exportTip && exportTip.state === 'ok' && exportTip.path ? ('已下载：' + exportTip.path) : t('exportMdTitle'),
						onClick: exportChat,
					}, exportTip ? (exportTip.state === 'ok' ? (exportTip.path ? t('exportedOk') : t('exportCopied')) : t('exportFail')) : t('exportMd'))
					: null,
				// OPT-4.2-client JSON 导出/导入入口：与「导出对话 .md」同一容器（ob-head-meta），
				// 不动 composer 的 .ob-main 尾子节点结构
				messages.length
					? h('button', {
						type: 'button', className: 'ob-msg-btn',
						title: t('exportJsonTitle'),
						onClick: exportChatJson,
					}, jsonTip && jsonTip.state === 'ok' && jsonTip.msg.indexOf('导出') === 0 ? t('exportedOk') : t('exportJson'))
					: null,
				messages.length
					? h('button', {
						type: 'button', className: 'ob-msg-btn',
						title: t('importJsonTitle'),
						onClick: () => { if (importFileRef.current) importFileRef.current.click(); },
					}, t('importJson'))
					: null,
				// 隐藏文件选择器：label-free，直接由按钮 click() 触发
				h('input', {
					ref: importFileRef,
					type: 'file',
					accept: '.json,application/json',
					style: { display: 'none' },
					onChange: importChatJson,
				}),
				jsonTip
					? h('span', {
						style: { color: jsonTip.state === 'ok' ? 'var(--ob-ok, #4caf50)' : 'var(--ob-err)', fontSize: 11 },
					}, jsonTip.msg)
					: null,
			),
		),
		messages.length
			? h('div', { className: 'ob-chat', ref: chatRef },
				// OPT-3.5b 消息列表整体包进错误边界：一条字段畸形的消息只降级成一张卡，
				// 侧栏 / 输入框 / 右栏不受牵连（没有边界时，任何渲染异常都会整个面板白屏）。
				h(ChatErrorBoundary, null,
					// OPT-3.10 单条消息整体抽成 memo 包装的 MessageCard（见组件定义处注释）。
					// key 用稳定 id（assistant 有 replyId / 历史补齐 id；user 无 id 回退下标），
					// retryLast 删尾重发时 React diff 不再依赖会位移的数组下标。
					messages.map((m, i) =>
						h(MessageCard, {
							key: m.id || ('u' + i),
							m,
							isLast: i === messages.length - 1,
							// OPT-4.3 tip 以 m.id 为键取布尔原值（不再传整个对象/下标），
							// retryLast 重排后「已保存 ✓」不会贴错回答
							saved: m.id ? !!savedTip[m.id] : false,
							copied: m.id ? (copiedTip[m.id] || '') : '',
							// OPT-3.11 引用可见上限唯一来源 = 宿主 status.citationLimit；
							// status 缺失时回退 12（缺省兜底，不是跨端语义常量）
							citationLimit: Math.max(1, Number(status && status.citationLimit) || 12),
							openNote, goWiki, saveAnswer, retryLast, copyAnswer,
						}),
					),
				),
				// OPT-3.3 上翻后又有新内容时浮出的「回到底部」。它必须是 .ob-chat 的子节点：
				// 既留在滚动容器内部，又不会让 composer 失去「.ob-main 尾子节点」的位置。
				showJump
					? h('button', {
						type: 'button', className: 'ob-jump-bottom', onClick: jumpToBottom,
						'aria-label': t('bottomJumpTitle'), title: t('bottomJumpTitle'),
					}, t('bottomJump'))
					: null,
			)
			: h('div', { className: 'ob-empty' },
				h('div', { className: 'ob-empty-card' },
					h('b', null, t('emptyStateTitle')),
					h('div', null, '回答基于本地笔记检索（BM25 + 中文 bigram），引用与 [[笔记链接]] 可点击查看原文。试试：「我关于 X 的笔记说了什么」「总结 #标签 下的要点」。'),
				)),
		composerNode,
	);

	// OPT-3.6 右栏原文：先剥掉 YAML frontmatter，再走同一套 Markdown 渲染。
	// 右栏不响应 [n] 引用点击（onCite 空实现）；wikilink 复用 goWiki，可继续在右栏跳转。
	const refBody = stripFrontmatter((note && note.content) || '');

	const refNode = note
		? h('div', { className: 'ob-ref', style: { width: refPaneWidth }, ref: refPaneRef },
			// 拖拽手柄（贴左边缘）：与左栏同款交互——拖动调宽、键盘 ←/→、Home 复位、双击还原
			h('div', {
				className: 'ob-ref-resizer' + (refResizing ? ' active' : ''),
				role: 'separator',
				'aria-orientation': 'vertical',
				'aria-label': t('refResizeAria'),
				'aria-valuenow': refPaneWidth,
				'aria-valuemin': REFPANE_MIN,
				'aria-valuemax': REFPANE_MAX,
				tabIndex: 0,
				title: t('resizeHandleTitle'),
				onPointerDown: onRefResizeStart,
				onKeyDown: onRefResizeKey,
				onDoubleClick: () => setRefPaneWidth(REFPANE_DEFAULT),
			}),
			h('div', { className: 'ob-ref-head' },
				h('div', { className: 'ob-ref-title', title: note.path }, note.path),
				h('button', { type: 'button', className: 'ob-btn', onClick: () => setNote(null), style: { padding: '3px 9px', fontSize: 11 } }, t('refClose')),
			),
			note.error
				? h('div', { style: { padding: '12px 14px' } }, h('div', { className: 'ob-err' }, note.error))
				: h('div', { className: 'ob-ref-body' },
					refBody.trim()
						? renderMarkdown(refBody, { onCite: () => {}, onWiki: goWiki })
						: t('refEmptyNote')),
			note.mtimeMs
				? h('div', { className: 'ob-ref-meta' }, t('refModifiedPrefix') + new Date(note.mtimeMs).toLocaleString())
				: null,
		)
		: null;

	return h('div', { className: 'ob-page', onKeyDown: onPageKeyDown }, sidebarNode, chatNode, refNode);
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
	// <gen:contract>
// scripts/gen-client-contract.mjs 生成区（OPT-6.1）— 请勿手改；单一来源 lib/typert.js TYPERT

		{ id: 'dsh-obsidian-board#obsidianBoard/status', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'status', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('StatusResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/configure', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'configure', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('StatusResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/listNotes', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'listNotes', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('NotesResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/readNote', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'readNote', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('NoteResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/search', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'search', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('SearchResult') },
		// deprecated: 非流式 chat 已下线（OPT-2.6），descriptor 保留一版
		{ id: 'dsh-obsidian-board#obsidianBoard/chat', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chat', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/reindex', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'reindex', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('StatusResult') },
		// 流式会话（可中断）+ 保存回答为笔记
		{ id: 'dsh-obsidian-board#obsidianBoard/chatStart', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chatStart', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatStartResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/chatPoll', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chatPoll', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatPollResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/chatStop', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'chatStop', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('ChatStopResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/saveNote', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'saveNote', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('SaveNoteResult') },
		// 对话历史跨端同步（宿主内存态；客户端 localStorage 兜底）
		{ id: 'dsh-obsidian-board#obsidianBoard/historyGet', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'historyGet', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('HistoryGetResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/historySet', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'historySet', invocation: { kind: 'direct' }, parameters: [obParam('payload')], result: strictCodec('HistorySetResult') },
		// 模型目录（模型选择器）
		{ id: 'dsh-obsidian-board#obsidianBoard/listModels', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'listModels', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('ModelsResult') },
		// 选择仓库位置模式：发现 / 系统对话框选择 / 在资源管理器中定位
		{ id: 'dsh-obsidian-board#obsidianBoard/discoverVaults', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'discoverVaults', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('DiscoverResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/pickVault', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'pickVault', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('PickResult') },
		{ id: 'dsh-obsidian-board#obsidianBoard/revealVault', service: 'obsidianBoard', namespace: 'obsidianBoard', method: 'revealVault', invocation: { kind: 'direct' }, parameters: [], result: strictCodec('RevealResult') },
// </gen:contract>
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
