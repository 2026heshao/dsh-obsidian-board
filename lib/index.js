// dsh-obsidian-board — 宿主半：Obsidian vault 本地 RAG 网关（TypertRemoteService）。
//
// 客户端半经 remote 通道调用这里的 RPC（service 名 "obsidianBoard"）。所有 LLM 调用走
// 宿主的 ctx.llm（provider-neutral 服务），流式 chunk 经 typert 事件面推给客户端，
// 「对话窗口的骨架」复用 DSH 原生（模型通道、会话审计、typert 传输）。
//
// 边界（practices.md 纪律）：
// - llm 是 optional inject：没挂 llm 适配器的 profile 里本插件不激活，而不是抛错炸树；
// - 检索全部本地完成（BM25 + CJK bigram），零外部依赖、零网络；
// - 回答不落盘、不写 session log（本插件的聊天是独立面板会话，不是 DSH 主会话），
//   每个面板会话的历史由客户端持有，宿主无状态（重启后面板历史清空是预期行为）。

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { VaultIndex } from "./vault.js";

// ── 配置 schema ─────────────────────────────────────────────────────
export const Config = {
	type: "object",
	properties: {
		vaultPath: {
			type: "string",
			description: "Obsidian vault 绝对路径（默认自动探测 ~/.dsh 之外最常见的 vault 位置）",
			default: "",
		},
		provider: { type: "string", description: "DSH llm provider 路由名；留空用宿主默认模型路由", default: "" },
		model: { type: "string", description: "模型 id；留空由 provider 自选默认", default: "" },
		topK: { type: "number", description: "每次检索引用的 chunk 数上限", default: 8 },
		reasoningEffort: {
			type: "string",
			description: "面板问答的推理档位（low/medium/high/xhigh/max）。默认 high：知识库问答不需要 max 深思，max 档在 onlyReasoning 模型上会把首字延迟拉到分钟级，表现为面板长时间转圈。",
			default: "high",
		},
		chunkLimit: { type: "number", description: "单条引用进提示词的最大字符数", default: 1200 },
		historyLimit: { type: "number", description: "面板会话保留的历史消息条数", default: 24 },
		systemPrompt: { type: "string", description: "自定义系统提示词（覆盖内置的 RAG 提示词）", default: "" },
	},
	default: {},
};

// 内置 RAG 系统提示词 v2：从「引用器」升级为「思考器」。
// 关键转变：检索片段是**原料**而不是答案——模型要先消化、对比、综合，
// 再用自己的结构输出结论；[n] 只做事实溯源，不做回答的组织方式。
const BUILTIN_SYSTEM_PROMPT = [
	"你是用户的 Obsidian 知识库思考助手——不是检索结果复读机。",
	"",
	"## 工作方式",
	"1. <context> 里是本地笔记的**原料片段**（可能不完整、相互矛盾、与问题只有部分相关）。",
	"2. 先在内部消化这些原料：识别相关信息、对比不同笔记的说法、注意矛盾与缺口，形成你自己的理解。",
	"3. 然后**直接输出思考后的结论**：综合、归纳、推理、给判断。不要逐条转述片段，不要「根据笔记 1…笔记 2…」式罗列（除非用户明确要出处清单）。",
	"4. [n] 引用只标在**具体事实**后面做溯源，自然嵌在句子里；结论与观点是你的综合，不用挂引用。",
	"5. 原料不足以支撑结论时，基于已有片段合理推理并**明确标注这是推断**；完全没有相关内容时才说「知识库中没有找到相关内容」，并基于通用知识回答（标注「未引用知识库」）。",
	"",
	"## 输出风格",
	"- 用与提问相同的语言；先给结论/答案，再给支撑细节；结构化（小标题/列表）但不过度嵌套。",
	"- 有观点：用户要总结就给真总结，要对比就给对比表，要判断就给判断+依据，不要回避下结论。",
].join("\n");

// 检索规划提示词：让模型先看问题该查什么——多路改写提升召回，再由主回答综合。
// 这是一次廉价的预调用（非流式、短输出），只在问题看起来复杂时触发。
const PLANNER_PROMPT = [
	"你是检索规划器。用户会在一个本地笔记库里提问，检索引擎是关键词式的（BM25+中文bigram），",
	"对自然语言长句、抽象概念、跨主题问题召回较差。",
	"你的任务：把用户的问题改写成 2-4 条**适合关键词检索的查询**，覆盖问题的不同侧面（同义词、上下位概念、相关主题）。",
	"只输出一个 JSON 数组，形如 [\"查询1\",\"查询2\"]，不要输出任何其它内容。",
].join("\n");

// 判断问题是否值得多路检索：长度较长或含问句特征（简单关键词查询直接走单路）。
function needsPlanning(question) {
	const q = String(question || "").trim();
	if (q.length >= 14) return true;
	if (/[?？]|怎么|如何|为什么|什么|哪些|对比|总结|区别|关系/.test(q)) return true;
	return false;
}

// 从模型输出里解析 JSON 数组（容忍代码围栏与前后杂文本）。
function parseQueryList(text) {
	const m = String(text || "").match(/\[[\s\S]*?\]/);
	if (!m) return [];
	try {
		const arr = JSON.parse(m[0]);
		if (!Array.isArray(arr)) return [];
		return arr.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 4);
	} catch { return []; }
}

// 组装 RAG 提示词：system + context + 历史 + 本轮问题。
//
// **契约要求（宿主 MessageBase，app.asar 源码核实）**：每条消息必须是
// { id, content, source }。source.kind 决定宿主如何投影：
//   user      → { kind:'user' }
//   assistant → { kind:'model', provider, model }——宿主 llm 的 forAdapter() 会读
//               `message.source.replayState`；缺 source 即
//               "Cannot read properties of undefined (reading 'replayState')"。
//               历史 bug：首轮无历史所以能成功，次轮起带 assistant 历史必崩，
//               用户视角就是「总是输出异常」。id 用 randomUUID（宿主用同款）。
function buildMessages({ system, context, history, question, historyLimit = 24, route }) {
	const messages = [];
	const modelSource = () => ({ kind: "model", provider: String(route?.provider || ""), model: String(route?.model || "") });
	messages.push({
		id: randomUUID(),
		role: "system",
		content: [{ type: "text", text: system + (context ? "\n\n<context>\n" + context + "\n</context>" : "") }],
		source: { kind: "system-prompt" },
	});
	// 面板会话历史（截断到最近 N 条，防止上下文膨胀）
	const limit = Math.max(2, Math.min(60, Number(historyLimit) || 24));
	const tail = history.slice(-limit);
	for (const m of tail) {
		if (!m || typeof m.content !== "string" || !m.content.trim()) continue;
		const isAssistant = m.role === "assistant";
		messages.push({
			id: randomUUID(),
			role: isAssistant ? "assistant" : "user",
			content: [{ type: "text", text: m.content.slice(0, 4000) }],
			source: isAssistant ? modelSource() : { kind: "user" },
		});
	}
	messages.push({ id: randomUUID(), role: "user", content: [{ type: "text", text: question }], source: { kind: "user" } });
	return messages;
}

function contextBlock(hits, chunkLimit) {
	if (!hits.length) return "";
	const isIndexLike = (title, text) => {
		const t = (title || "").toLowerCase();
		if (/目录|索引|moc|index|导航|sitemap/.test(t)) return true;
		const links = (text.match(/\[\[/g) || []).length + (text.match(/\.md/g) || []).length;
		return text.length > 0 && links / (text.length / 30) > 0.8;
	};
	return hits
		.map((hit, i) => {
			const body = hit.text.length > chunkLimit ? hit.text.slice(0, chunkLimit) + "…" : hit.text;
			const tag = isIndexLike(hit.noteTitle, hit.text)
				? "\n⚠️ 这是目录/索引类材料：它只说明库里**有哪些**笔记，不含具体内容。绝不依据它组织回答——只可用来了解知识库覆盖范围。"
				: "";
			return `[${i + 1}] 笔记「${hit.noteTitle}」${hit.heading ? " · " + hit.heading : ""}${tag}\n${body}`;
		})
		.join("\n\n---\n\n");
}

// 给 llm chunk 流里抽「可见文本」与「思考」增量。
// StreamChunk 真实契约（dsh-llm 0.2.0-rc.2，app.asar 源码核实）：
//   { type:'text-delta', index, text }          —— 正文增量（字段是 **text**，不是 delta）
//   { type:'reasoning-delta', index, text }     —— 思考增量（glm-5.3-flash 等 onlyReasoning
//                                                  模型先输出长思考段再给正文；不收集它，
//                                                  面板就在整个思考期只显示转圈）
//   { type:'block-start'|'block-end'|'tool-call-delta'|'usage'|'finish', ... }
// 块形状（block:{kind:'text'|'reasoning'|...}）保留兼容，但宿主实际发的是扁平 delta。
function visibleDelta(chunk) {
	return deltaOf(chunk, false);
}
function thinkingDelta(chunk) {
	return deltaOf(chunk, true);
}
function deltaOf(chunk, wantThinking) {
	if (!chunk || typeof chunk !== "object") return "";
	const type = String(chunk.type || chunk.kind || "");
	const isThinkType = /reasoning[-_]?delta|thinking[-_]?delta/i.test(type);
	if (wantThinking) {
		if (isThinkType) {
			if (typeof chunk.text === "string") return chunk.text;
			if (typeof chunk.delta === "string") return chunk.delta;
			if (chunk.block && typeof chunk.block.text === "string") return chunk.block.text;
		}
		// 块形状：{kind:'block-start'|'text-delta', block:{kind:'reasoning'|'thinking', text}}
		if (chunk.block && typeof chunk.block === "object" && /reasoning|thinking/i.test(String(chunk.block.kind || "")) && typeof chunk.block.text === "string") return chunk.block.text;
		return "";
	}
	// 正文通道：思考类 chunk 一律不算正文
	if (isThinkType) return "";
	if (chunk.block && typeof chunk.block === "object" && /reasoning|thinking/i.test(String(chunk.block.kind || ""))) return "";
	if (/text[-_]?delta/i.test(type)) {
		// 宿主真实字段是 text；delta 兜底兼容
		if (typeof chunk.text === "string") return chunk.text;
		if (typeof chunk.delta === "string") return chunk.delta;
		if (chunk.block && typeof chunk.block.text === "string") return chunk.block.text;
	}
	if (chunk.block && typeof chunk.block === "object" && /text/i.test(String(chunk.block.kind || "")) && typeof chunk.block.text === "string") return chunk.block.text;
	return "";
}

// 从终止 chunk 里提取失败原因。宿主 llm.md 真实契约（app.asar 源码核verified）：
//   每个流以恰好一个 { type:'finish', reason: FinishReason } 终止，FinishReason =
//   {kind:'stop'|'tool-calls'|'max-tokens'} 或 {kind:'error'|'aborted', failure:LlmFailure}，
//   LlmFailure = { message, code, status?, ... }。
// 注意 reason 可能是字符串（宽松兼容）或对象；aborted 在用户主动停止时也出现，单独标记。
// 返回 null 表示正常结束（stop/tool-calls/max-tokens 都不算失败）。
function terminalFailure(chunk) {
	if (!chunk || typeof chunk !== "object") return null;
	// 形状 1：{ type:'finish', reason:{kind, failure} }（宿主真实形状）
	const reason = chunk.reason;
	if (reason && typeof reason === "object") {
		const kind = String(reason.kind || "");
		if (kind === "stop" || kind === "tool-calls" || kind === "max-tokens") return null;
		if (kind === "error" || kind === "aborted") {
			const f = reason.failure || {};
			const code = String(f.code || "").trim();
			const message = String(f.message || "").trim();
			if (!code && !message) return kind + "（无失败详情）";
			// aborted 是用户停止/超时中止，不是通道故障——单独标记让调用方区分
			return (kind === "aborted" ? "[ABORTED] " : "") + (code ? code + (message ? "：" + message : "") : message);
		}
	}
	// 形状 2：{ type:'error' / 'aborted', failure }（宽松兼容旧版写法）
	const type = String(chunk.type || chunk.kind || "");
	if (type === "error" || type === "aborted") {
		const f = chunk.failure || {};
		const code = String(f.code || "").trim();
		const message = String(f.message || "").trim();
		return (type === "aborted" ? "[ABORTED] " : "") + (code ? code + (message ? "：" + message : "") : message || type);
	}
	return null;
}

// 终止原因是否为「用户主动停止」（非通道故障）。chatStart 用它区分：用户点了停止
// 不该显示红色错误，也不该触发回退链。
function isUserAbort(failureText) {
	return typeof failureText === "string" && failureText.startsWith("[ABORTED]");
}

// 从 usage chunk 提取 token 计量。宿主契约：{ type:'usage', usage:TokenUsage }，
// TokenUsage = { inputTokens, outputTokens, totalTokens?, ... }（camelCase）。
// 历史版本只认 {kind:'usage'}/snake_case，导致面板永远显示 ↑? ↓?。
function usageOf(chunk) {
	if (!chunk || typeof chunk !== "object") return null;
	const raw = (chunk.type === "usage" || chunk.kind === "usage") ? (chunk.usage && typeof chunk.usage === "object" ? chunk.usage : chunk) : null;
	if (!raw) return null;
	const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
	const input = num(raw.inputTokens ?? raw.input ?? raw.prompt_tokens);
	const output = num(raw.outputTokens ?? raw.output ?? raw.completion_tokens);
	const reasoning = num(raw.reasoningTokens ?? raw.reasoning_tokens);
	if (input === undefined && output === undefined && reasoning === undefined) return null;
	return { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}), ...(reasoning !== undefined ? { reasoning } : {}) };
}

async function mapHasVaultPath(map, dir) {
	return map.has(dir);
}

// ── llm 目录名称提取 ────────────────────────────────────────────────
// 宿主 llm.listProviders() 真实返回 { id, name }[]（id = 路由名如 "workbuddy"，name =
// 显示名如 "WorkBuddy"；llm 0.2.0-rc.2 registry 源码核实）。listModels(provider) 返回
// { provider, id, name }[]。**路由必须用 id**——历史上 String(p) 把对象变成
// "[object Object]" 或错拿显示名，回退链里 "DeepSeek/DeepSeek Account/WorkBuddy/"
// 这些名字没有一条能路由（截图错误消息的直接来源）。
function providerRouteOf(p) {
	if (typeof p === "string") return p.trim();
	if (p && typeof p === "object") return String(p.id || p.provider || "").trim();
	return "";
}

function providerNameOf(p) {
	if (p && typeof p === "object") return String(p.name || p.id || "").trim();
	return String(p || "").trim();
}

// 给任意 promise 加超时。宿主 llm 的某些调用（探测目录、无路由的流）可能永不 settle，
// 没有超时就会让面板无限转圈——所有 llm 交互都必须走这里。
function withTimeout(promise, ms, label) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error((label || "操作") + "超时（" + ms + "ms 无响应）")), ms);
	});
	return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

// ── WorkBuddy 模型目录（模型选择器富化数据源）──────────────────────
// workbuddy-connect 把完整模型元数据（含推理档位）存在 ~/.dsh/.workbuddy-catalog.json；
// llm.listModels 只有 id/name，主对话页的档位选择就是靠 catalog 的 reasoning 字段。
// 只读、60s 缓存、缺失/损坏一律返回空（富化是锦上添花，不能挡住基础选择）。
// 档位值域取 host 端 EffortId 域（low/medium/high/xhigh/max）与 workbuddy 上游
// （low/medium/high）的并集；absorbed 渠道（ZCode/EAC）的档位走 catalog 原样下发。
const EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"];

function readCatalogModels() {
	try {
		const file = resolve(homedir(), ".dsh", ".workbuddy-catalog.json");
		const raw = JSON.parse(readFileSync(file, "utf8"));
		const rows = [];
		for (const entry of Object.values(raw?.entries || {})) {
			for (const m of entry?.models || []) {
				if (typeof m?.id !== "string" || !m.id) continue;
				if (rows.some((r) => r.id === m.id)) continue;
				rows.push(m);
			}
		}
		return rows;
	} catch { return []; }
}

// 生效推理档位：显式选择 > 配置默认 > 不下发。
// 规则（保守优先，防 dsh-llm 对不支持的模型做 effort 校验报错）：
// - explicit 非空 → 原样用（客户端已保证只对声明档位的模型发）；
// - 模型在 catalog 里声明了 supportedEfforts → 配置默认值在档位集内用之，
//   不在则回退模型 defaultEffort；
// - 其余（未声明档位/模型未知）→ 不下发，用上游默认。
function resolveEffort({ explicit, configDefault, row }) {
	const pick = String(explicit || "").trim();
	if (pick) return pick;
	const declared = row?.reasoning;
	if (!declared || declared.supports !== true) return "";
	const efforts = Array.isArray(declared.supportedEfforts) ? declared.supportedEfforts.filter((e) => EFFORT_VALUES.includes(e)) : [];
	if (!efforts.length) return "";
	const def = String(configDefault || "").trim();
	if (def && efforts.includes(def)) return def;
	return typeof declared.defaultEffort === "string" && efforts.includes(declared.defaultEffort) ? declared.defaultEffort : "";
}

export class ObsidianBoardGateway extends TypertRemoteService {
	// 只写必然存在的服务。可选依赖一律在方法内用 ctx.get 探测——loader 不认 "?"
	// 后缀语法（实测 0.2.0-rc.2：带 ? 的条目会让注入解析失败 → 服务整体不激活）。
	// loader 是 cordis 核心服务（读 agent-default-model 的配置解析默认路由）。
	static inject = ["llm", "loader"];
	constructor(ctx, config) {
		super(ctx, "obsidianBoard");
		this.config = config || {};
		this.index = new VaultIndex();
		this.vaultPath = "";
	}

	_picker() {
		try { return this.ctx.get("directoryPicker") || null; } catch { return null; }
	}

	// ── 路由解析：默认模型 = DSH 自己的默认模型配置 ─────────────────
	// 「不带 provider 直接 stream」在实测里只会空转（零文本 finish）——llm 契约要求
	// 每次请求显式指定 provider。首选 agentDefaultModel 服务（0.2.0-rc.2 真实服务名，
	// currentSelection() 返回 {provider, model, reasoningEffort?}，即主会话同款模型）；
	// 旧宿主无该服务时回退读 loader 条目。注意：**fallback 的匹配键是 entry.id**——
	// entry.options.name 是cordis 模块名（@deepseek-ai/...），id 才是 'agent-default-model'；
	// 历史版本匹配 options.name 永远落空 → 默认路由永远为空 → 回退链全靠猜。
	_defaultRoute() {
		if (this._routeCache !== undefined) return this._routeCache;
		this._routeCache = { provider: "", model: "" };
		// ① agentDefaultModel 服务（真实宿主挂的是这个）
		try {
			const adm = typeof this.ctx.get === "function" ? this.ctx.get("agentDefaultModel") : null;
			if (adm && typeof adm.currentSelection === "function") {
				const sel = adm.currentSelection();
				if (sel && typeof sel === "object") {
					if (sel.provider) this._routeCache.provider = String(sel.provider);
					if (sel.model) this._routeCache.model = String(sel.model);
				}
			}
		} catch { /* 服务不可读，走 ② */ }
		// ② loader 条目回退（旧宿主）：id 是组合条目 id，config 是用户 patch 的值
		if (!this._routeCache.provider) {
			try {
				const loader = typeof this.ctx.get === "function" ? this.ctx.get("loader") : null;
				const entries = loader && typeof loader.entries === "function" ? [...loader.entries()] : [];
				for (const entry of entries) {
					// 组条目（cordis:group）递归下钻，扁平条目直接匹配 id
					if (entry?.options?.group && typeof entry.entries === "function") continue;
					const id = String(entry?.id || "");
					if (!/(^|[:/])agent-default-model$/.test(id)) continue;
					const cfg = entry?.options?.config || {};
					if (cfg.provider) this._routeCache.provider = String(cfg.provider);
					if (cfg.model) this._routeCache.model = String(cfg.model);
					break;
				}
			} catch { /* loader 不可读就留空，交给目录回退 */ }
		}
		return this._routeCache;
	}

	// 有效路由：显式配置 > DSH 默认模型 > 空（空则触发目录回退）
	async _resolveRoute(llm) {
		const def = this._defaultRoute();
		const provider = this.config.provider || def.provider || "";
		let model = this.config.model || def.model || "";
		if (provider && !model && llm && typeof llm.listModels === "function") {
			try {
				const raw = await withTimeout(Promise.resolve(llm.listModels(provider)), 8000, "模型目录");
				const items = Array.isArray(raw) ? raw : raw?.models || [];
				const first = items[0];
				if (first) model = typeof first === "string" ? first : first?.id || first?.model || "";
			} catch { /* 目录超时/不可得：不带 model 也能走 provider 默认 */ }
		}
		return { provider, model };
	}

	// ── 持久化：vault 选择存 ~/.dsh/dsh-obsidian-board/state.json ──
	// configure 是内存态，宿主重启就丢；这里落盘一份，启动时恢复。原子写 + 容错读。
	_stateFile() {
		if (this._statePath) return this._statePath;
		this._statePath = resolve(homedir(), ".dsh", "dsh-obsidian-board", "state.json");
		return this._statePath;
	}

	async _loadState() {
		try {
			const { readFile } = await import("node:fs/promises");
			let raw = await readFile(this._stateFile(), "utf8");
			// 容忍 BOM：外部工具常用 UTF-8-BOM 重写该文件，JSON.parse 遇 BOM 直接抛，
			// 状态静默回空 → 冷启动丢 vault 配置（本次排查实测踩坑）。
			if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
			return JSON.parse(raw);
		} catch { return {}; }
	}

	async _saveState(patch) {
		try {
			const { mkdir, writeFile, rename } = await import("node:fs/promises");
			const file = this._stateFile();
			await mkdir(dirname(file), { recursive: true });
			const next = { ...(await this._loadState()), ...patch };
			const tmp = file + ".tmp";
			await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
			await rename(tmp, file);
		} catch { /* 持久化失败不阻塞会话内使用 */ }
	}

	async _restorePersisted() {
		if (this._restored) return;
		this._restored = true;
		const state = await this._loadState();
		const fixed = ObsidianBoardGateway._fixMojibake(state.vaultPath || "");
		if (fixed && fixed !== state.vaultPath) {
			// 自愈成功：立即回写干净路径，下次不用再修
			this.config.vaultPath = fixed;
			await this._saveState({ vaultPath: fixed });
		} else if (!this.config.vaultPath && fixed) {
			this.config.vaultPath = fixed;
		}
		if (!this.config.vaultPath && state.vaultPath) this.config.vaultPath = state.vaultPath;
		if (!this.config.provider && state.provider) this.config.provider = state.provider;
		if (!this.config.model && state.model) this.config.model = state.model;
		if (this.config.reasoningEffort === undefined && typeof state.reasoningEffort === "string") this.config.reasoningEffort = state.reasoningEffort;
	}

	// 持久化文件的编码自愈：旧版本曾在 GBK 控制台下把中文路径写成 mojibake
	// （桌面 → 妗岄潰）。双重自愈：①已知映射表（本次实测样本）；②utf8→latin1→gbk
	// 逐段反转，且**每一段都验证还原后的目录真实存在**才采用。
	// 已知表额外覆盖本机实测损坏样本（AI Port → AI Port 的段间前缀损坏形态）。
	static _fixMojibake(s) {
		if (typeof s !== "string" || !s) return s;
		const exists = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
		// ①直接可用的路径不动
		if (exists(s)) return s;
		// ②已知 mojibake 片段映射（实测积累；GBK 双字节错位后的稳定残骸）
		const KNOWN = { "妗岄潰": "桌面", "娴嬭瘯": "测试", "鏂囦欢": "文件", "鐩綍": "目录", "绔彛": "端口", "绗旇": "笔记" };
		let mapped = s;
		for (const [bad, good] of Object.entries(KNOWN)) mapped = mapped.split(bad).join(good);
		if (mapped !== s && exists(mapped)) return mapped;
		// ③通用反转：utf8 字节被按 GBK 解码的场景，按 GBK 编码回字节再按 utf8 解码
		try {
			const gbkBytes = Buffer.from(s, "latin1");
			const decoded = gbkBytes.toString("utf8");
			if (decoded !== s && /[\u4e00-\u9fff]/.test(decoded) && exists(decoded)) return decoded;
		} catch { /* 不可逆 */ }
		return s;
	}

	// vault 路径解析。**惰性恢复持久化状态**：真实启动时插件行的 config 是空的，
	// vault 路径只存在于 state.json；任何直接调 _vaultPath 的 RPC 都不会漏掉恢复。
	// （历史 bug：只有 status/configure/chatStart 调了 _restorePersisted，listNotes 漏了，
	//  冷启动竞态下它抛「未配置」→ 上层吞错 → 状态卡有数字、笔记列表却空。）
	async _vaultPath() {
		if (this.vaultPath) return this.vaultPath;
		await this._restorePersisted();
		const raw = String(this.config.vaultPath || "").trim();
		if (!raw) throw new Error("未配置 vault 路径：请先在插件页面的「选择仓库位置」里连接一个 vault");
		const p = raw.startsWith("~") ? resolve(homedir(), raw.slice(1)) : raw;
		const abs = isAbsolute(p) ? p : resolve(p);
		this.vaultPath = abs;
		return abs;
	}

	_llm() {
		const llm = typeof this.ctx.get === "function" ? this.ctx.get("llm") : undefined;
		if (!llm || typeof llm.stream !== "function") throw new Error("宿主没有可用的 llm 服务（未挂载模型适配器），无法回答");
		return llm;
	}

	// ── RPC：vault 发现与选择（「选择仓库位置」模式）────────────────
	static CANDIDATE_ROOTS = [
		() => homedir(),
		() => resolve(homedir(), "Documents"),
		() => resolve(homedir(), "Documents/Obsidian"),
		() => resolve(homedir(), "OneDrive/Documents"),
		() => resolve(homedir(), "OneDrive/文档"),
		() => resolve(homedir(), "Desktop"),
		() => resolve(homedir(), "桌面"),
		() => "D:\\",
		() => resolve(homedir(), "Notes"),
		() => resolve(homedir(), "notes"),
	];

	// Obsidian 全局注册表（最可靠来源）：%APPDATA%\obsidian\obsidian.json
	// 形如 {"vaults":{"<id>":{"path":"C:\\...","ts":1699...,"open":true}}}。
	static async _registryVaults() {
		const candidates = [
			resolve(process.env.APPDATA || resolve(homedir(), "AppData/Roaming"), "obsidian/obsidian.json"),
			resolve(homedir(), "Library/Application Support/obsidian/obsidian.json"),
			resolve(homedir(), ".config/obsidian/obsidian.json"),
		];
		const { readFile: readFileModule } = await import("node:fs/promises");
		for (const file of candidates) {
			try {
				const raw = JSON.parse(await readFileModule(file, "utf8"));
				const vaults = [];
				for (const v of Object.values(raw.vaults || {})) {
					if (v && typeof v.path === "string" && v.path) vaults.push({ path: v.path, name: basename(v.path), depth: 0, lastOpened: Number(v.ts) || 0 });
				}
				if (vaults.length) return vaults;
			} catch { /* 下一个候选 */ }
		}
		return [];
	}

	async discoverVaults() {
		const found = new Map(); // path -> {path, name, depth, lastOpened}
		const push = (dir, depth, lastOpened) => {
			if (!mapHasVaultPath(found, dir)) found.set(dir, { path: dir, name: basename(dir), depth, lastOpened: lastOpened || 0 });
		};
		// 1) Obsidian 自己的注册表
		for (const v of await ObsidianBoardGateway._registryVaults()) {
			try { if (await stat(join(v.path, ".obsidian"))) push(v.path, 0, v.lastOpened); } catch { /* 注册表里的 vault 已被删除 */ }
		}
		// 2) 常见位置扫描（兜底：注册表缺席/为空时也有得选）
		const SKIP = new Set([
			"Windows", "Program Files", "Program Files (x86)", "ProgramData", "AppData",
			"$Recycle.Bin", "System Volume Information", "node_modules", "Recovery",
			"PerfLogs", "Intel", "Drivers", "Documents and Settings",
		]);
		let budget = 2200; // 目录访问次数预算，防慢盘卡死
		for (const root of ObsidianBoardGateway.CANDIDATE_ROOTS) {
			if (budget <= 0) break;
			let rootPath;
			try { rootPath = root(); } catch { continue; }
			try { if (await stat(join(rootPath, ".obsidian"))) push(rootPath, 0, 0); } catch { /* 根不是 vault */ }
			let level1;
			try { level1 = await readdir(rootPath, { withFileTypes: true }); } catch { continue; }
			for (const e of level1) {
				if (budget-- <= 0) break;
				if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("$")) continue;
				if (SKIP.has(e.name)) continue;
				const sub = join(rootPath, e.name);
				try { if (await stat(join(sub, ".obsidian"))) { push(sub, 1, 0); continue; } } catch { /* 不是 vault */ }
				// 二层：常见命名（Obsidian/笔记/notes/vault）再探一层
				if (/obsidian|笔记|notes?|vault|知识库|库$/i.test(e.name)) {
					let level2;
					try { level2 = await readdir(sub, { withFileTypes: true }); } catch { continue; }
					for (const e2 of level2) {
						if (budget-- <= 0) break;
						if (!e2.isDirectory() || e2.name.startsWith(".")) continue;
						const sub2 = join(sub, e2.name);
						try { if (await stat(join(sub2, ".obsidian"))) push(sub2, 2, 0); } catch { /* 不是 vault */ }
					}
				}
			}
		}
		const vaults = [...found.values()].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0) || a.path.localeCompare(b.path));
		return { vaults, scannedAt: Date.now() };
	}

	// 用宿主的目录选择能力让用户挑 vault 根目录。
	// 契约（@deepseek-ai/dsh-host-directory-picker，实测 0.2.0-rc.2 源码）：
	//   ctx.directoryPicker.capability() → { kind: 'native', pick(signal) } 或
	//   { kind: 'browse', list(path?, signal?), createDirectory(path, name) }。
	// native.pick 打开真正的系统对话框（Windows 走 IFileOpenDialog 子进程），
	// 返回绝对路径或 null（取消）。unknown kind 按「隐藏入口」处理，不炸。
	async pickVault() {
		const picker = this._picker();
		if (!picker || typeof picker.capability !== "function") return { picked: false, unsupported: true };
		let cap;
		try { cap = picker.capability(); } catch { return { picked: false, unsupported: true }; }
		if (!cap) return { picked: false, unsupported: true };
		if (cap.kind === "native" && typeof cap.pick === "function") {
			try {
				const controller = new AbortController();
				const path = await cap.pick(controller.signal);
				if (!path) return { picked: false, cancelled: true };
				return { picked: true, path };
			} catch (error) {
				const message = String(error?.message || error);
				if (/cancel|abort/i.test(message)) return { picked: false, cancelled: true };
				return { picked: false, error: message };
			}
		}
		if (cap.kind === "browse" && typeof cap.list === "function") {
			// 远程/无对话框形态：用 browse 原语做一层简易目录浏览器（从用户主目录开始）。
			try {
				let current = "";
				const levels = [];
				for (let depth = 0; depth < 24; depth++) {
					const listing = await cap.list(current || undefined);
					const dirs = (listing.entries || []).filter((e) => e.isDirectory && !e.hidden).map((e) => ({ name: e.name, path: e.path }));
					levels.push({ path: listing.path || current || "(home)", crumbs: (listing.crumbs || []).map((c) => c.name), dirs });
					// 没有调用方交互循环：这里只探测能力并返回第一层，UI 端不支持无对话框逐级浏览时退回发现模式。
					return { picked: false, browseOnly: true, firstLevel: levels[0] };
				}
			} catch (error) {
				return { picked: false, error: String(error?.message || error) };
			}
		}
		return { picked: false, unsupported: true };
	}

	// 打开系统文件管理器定位一个已连接的 vault（纠错用）。
	async revealVault() {
		const vaultPath = await this._vaultPath();
		if (process.platform === "win32") {
			spawn("explorer", [vaultPath], { detached: true, stdio: "ignore" }).unref();
			return { opened: true };
		}
		const cmd = process.platform === "darwin" ? "open" : "xdg-open";
		spawn(cmd, [vaultPath], { detached: true, stdio: "ignore" }).unref();
		return { opened: true };
	}

	// ── 多路检索融合（RRF）：planner 改写多查询 → 各路检索 → 去重融合 ──
	// 单路 BM25 只能查「问句里的词」；模型改写出的同义/上下位/相关主题查询把
	// 不同措辞的相关笔记都捞回来，融合后主回答才有综合的原料。
	static RRF_K = 60; // RRF 常数：排名倒数融合，避免单路高分碾压覆盖面

	async _multiHits(question, llm, route) {
		const vaultPath = await this._vaultPath();
		await this.index.ensureIndexed(vaultPath);
		const topK = Math.max(1, Math.min(20, Number(this.config.topK) || 8));
		const primary = this.index.search(question, { topK: topK * 2 }).hits;

		// 简单问题不规划。注意：primary 取的是 2×topK（给融合留冗余），
		// 但返回给调用方的 citations 必须收敛到 topK——否则引用 chips 会翻倍。
		if (!needsPlanning(question)) return primary.slice(0, topK);

		// 规划跳：非流式、短输出、失败静默（规划失败 = 退回单路）
		let extra = [];
		try {
			const planMessages = [
				{ role: "system", content: [{ type: "text", text: PLANNER_PROMPT }] },
				{ role: "user", content: [{ type: "text", text: question.slice(0, 500) }] },
			];
			const options = { messages: planMessages };
			if (route?.provider) options.provider = route.provider;
			if (route?.model) options.model = route.model;
			// 规划跳是廉价预调用：锁 low 档推理（模型支持 effort 时生效，不支持则被忽略）。
			// 用户档位是 xhigh/max 时用 high（low 档在深度模型上规划质量掉得厉害）。
			const planEffort = String(this.config.reasoningEffort ?? "high").trim();
			if (planEffort) options.reasoningEffort = (planEffort === "xhigh" || planEffort === "max") ? "high" : planEffort === "high" ? "low" : planEffort;
			let planText = "";
			// 规划跳必须有超时：某些路由/无路由下 llm.stream 永不 settle，会挂死整个请求。
			const planStream = (async () => {
				for await (const chunk of llm.stream(options)) {
					const failure = terminalFailure(chunk);
					if (failure) break;
					planText += visibleDelta(chunk);
				}
			})();
			await withTimeout(planStream, 20000, "检索规划");
			const queries = parseQueryList(planText).filter((q) => q !== question.trim());
			// 各路检索（串行即可：BM25 是内存毫秒级）
			const perQuery = [];
			for (const q of queries.slice(0, 3)) {
				const r = this.index.search(q, { topK });
				if (r.hits.length) perQuery.push(r.hits);
			}
			extra = perQuery;
		} catch { /* 规划失败退回单路 */ }

		if (!extra.length) return primary;

		// RRF 融合：score(chunk) = Σ 1/(RRF_K + rank_i)；同 chunk 以 notePath+heading 归并
		const fused = new Map();
		const lists = [primary, ...extra];
		for (const hits of lists) {
			hits.forEach((hit, rank) => {
				const key = hit.notePath + "::" + (hit.heading || "") + "::" + hit.text.slice(0, 60);
				const cur = fused.get(key) || { hit, rrf: 0, rankSum: 0, count: 0 };
				cur.rrf += 1 / (ObsidianBoardGateway.RRF_K + rank + 1);
				cur.rankSum += rank + 1;
				cur.count += 1;
				fused.set(key, cur);
			});
		}
		const merged = [...fused.values()]
			.sort((a, b) => b.count - a.count || b.rrf - a.rrf) // 多路共同命中优先，再按 RRF
			.map((v) => ({ ...v.hit, multiHit: v.count > 1, score: Math.round(v.rrf * 100) / 100 }));
		// 按笔记分散：单篇最多 2 片。防止一篇长笔记的多个 chunk 把 topK 全占，
		// 模型只看到一两篇原文——综合无从谈起。
		const perNote = new Map();
		const spread = [];
		for (const hit of merged) {
			const n = perNote.get(hit.notePath) || 0;
			if (n >= 2) continue;
			perNote.set(hit.notePath, n + 1);
			spread.push(hit);
			if (spread.length >= topK) break;
		}
		return spread;
	}

	// ── RPC：模型目录（模型选择器数据源）──────────────────────────
	// listModels 是 catalog 驱动接口的模型枚举（llm.md：GUI 选择依赖 catalog 成员资格）。
	// provider 缺席时逐个 provider 试（同 adapter 的多路由只取第一个成功者），失败静默。
	// 富化：workbuddy-connect 的 catalog 带 reasoning（可选档位/默认档位/onlyReasoning）、
	// 计费（free/credits/badges）、上下文窗——主对话页选择器同款数据，读不到就原样降级。
	async listModels() {
		const llm = this._llm();
		let providers = [];
		if (typeof llm.listProviders === "function") {
			try {
				const raw = llm.listProviders();
				// { id, name }[] —— 路由 id 与显示名分开携带
				providers = (Array.isArray(raw) ? raw : []).map(providerRouteOf).filter(Boolean);
			} catch { /* 注册表不可读就按无 provider 处理 */ }
		}
		const catalog = readCatalogModels();
		const catalogById = new Map(catalog.map((m) => [m.id, m]));
		const models = [];
		for (const provider of providers.slice(0, 12)) {
			if (typeof llm.listModels !== "function") break;
			try {
				const raw = await withTimeout(Promise.resolve(llm.listModels(provider)), 10000, "模型目录");
				const items = Array.isArray(raw) ? raw : raw?.models || [];
				for (const m of items.slice(0, 80)) {
					const id = typeof m === "string" ? m : m?.id || m?.model;
					if (!id) continue;
					const row = catalogById.get(id);
					const reasoning = row?.reasoning;
					const efforts = reasoning?.supports === true && Array.isArray(reasoning.supportedEfforts)
						? reasoning.supportedEfforts.filter((e) => EFFORT_VALUES.includes(e))
						: [];
					models.push({
						provider,
						model: id,
						label: (typeof m === "object" && (m?.name || m?.label)) || row?.name || id,
						// 富化字段（全部可缺，客户端按存在与否渲染）
						...(row?.billing?.free === true ? { free: true } : {}),
						...(row?.billing?.credits ? { credits: row.billing.credits } : {}),
						...(row?.billing?.badges?.length ? { badges: row.billing.badges } : {}),
						...(Number(row?.contextWindow) > 0 ? { contextWindow: Number(row.contextWindow) } : {}),
						...(efforts.length ? { efforts, defaultEffort: reasoning.defaultEffort, onlyReasoning: reasoning.onlyReasoning === true } : {}),
					});
				}
			} catch { /* 单 provider 失败不影响其它 */ }
		}
		// 兜底：宿主 llm 目录为空但本地 catalog 可用（workbuddy 已登录）时，用 catalog
		// 组 provider+model 对（provider 路由名取第一个已注册的，catalog 里是模型 id 集合）。
		// 这保证「模型选择器永不空」，llm 目录恢复后其结果优先。
		if (!models.length && catalog.length && providers.length) {
			for (const row of catalog.slice(0, 80)) {
				const reasoning = row?.reasoning;
				const efforts = reasoning?.supports === true && Array.isArray(reasoning.supportedEfforts)
					? reasoning.supportedEfforts.filter((e) => EFFORT_VALUES.includes(e))
					: [];
				models.push({
					provider: providers[0],
					model: row.id,
					label: row.name || row.id,
					...(row?.billing?.free === true ? { free: true } : {}),
					...(row?.billing?.credits ? { credits: row.billing.credits } : {}),
					...(row?.billing?.badges?.length ? { badges: row.billing.badges } : {}),
					...(Number(row?.contextWindow) > 0 ? { contextWindow: Number(row.contextWindow) } : {}),
					...(efforts.length ? { efforts, defaultEffort: reasoning.defaultEffort, onlyReasoning: reasoning.onlyReasoning === true } : {}),
					fallbackCatalog: true,
				});
			}
		}
		return {
			providers,
			models,
			defaultProvider: this.config.provider || "",
			defaultModel: this.config.model || "",
			defaultEffort: this.config.reasoningEffort || "",
			// 诊断字段：客户端空态提示据此给出可操作原因
			source: models.length ? (models[0]?.fallbackCatalog ? "catalog-fallback" : "llm-registry") : "empty",
			providerCount: providers.length,
		};
	}

	// ── RPC：状态与配置探测 ─────────────────────────────────────────
	async status() {
		await this._restorePersisted();
		const base = { configured: false, vaultPath: "", llm: false, engine: "bm25-cjk-bigram" };
		let vaultPath = "";
		try {
			vaultPath = await this._vaultPath();
			base.configured = true;
			base.vaultPath = vaultPath;
		} catch (error) {
			base.error = String(error?.message || error);
		}
		// 面板打开时的首次 status 就触发索引。关键：索引完成后再取 status，
		// 保证返回的就是新索引的数字（此前 {...展开旧 status} 会把冷启动的 0 覆盖进来）。
		if (vaultPath) {
			try {
				await this.index.ensureIndexed(vaultPath);
				const st = this.index.status();
				base.noteCount = st.noteCount;
				base.chunkCount = st.chunkCount;
				base.builtAt = st.builtAt;
				base.scanning = st.scanning;
			} catch (error) {
				base.indexError = String(error?.message || error);
			}
		}
		try {
			const llm = this._llm();
			base.llm = !!llm;
			if (typeof llm.listProviders === "function") {
				const providers = llm.listProviders();
				base.providers = Array.isArray(providers) ? providers.map(providerRouteOf).filter(Boolean) : [];
			}
		} catch {
			base.llm = false;
		}
		return base;
	}

	async configure(payload) {
		await this._restorePersisted();
		const vaultPath = String(payload?.vaultPath || "").trim();
		if (vaultPath) {
			this.config.vaultPath = vaultPath;
			this.vaultPath = "";
		}
		if (payload?.provider !== undefined) this.config.provider = String(payload.provider || "").trim();
		if (payload?.model !== undefined) this.config.model = String(payload.model || "").trim();
		if (payload?.reasoningEffort !== undefined) {
			const e = String(payload.reasoningEffort || "").trim();
			this.config.reasoningEffort = EFFORT_VALUES.includes(e) ? e : "";
		}
		if (payload?.topK !== undefined) this.config.topK = Math.max(1, Math.min(20, Number(payload.topK) || 8));
		// 持久化：重启后面板自动回到这个仓库/模型/档位
		await this._saveState({ vaultPath: this.config.vaultPath || "", provider: this.config.provider || "", model: this.config.model || "", reasoningEffort: this.config.reasoningEffort || "" });
		// 换 vault 强制全量重建
		if (vaultPath) await this.index.ensureIndexed(await this._vaultPath(), { force: true });
		return this.status();
	}

	async listNotes(payload) {
		const vaultPath = await this._vaultPath();
		await this.index.ensureIndexed(vaultPath);
		const sort = ["mtime", "name", "path"].includes(payload?.sort) ? payload.sort : "mtime";
		return this.index.listNotes({ limit: 400, sort });
	}

	async readNote(payload) {
		const vaultPath = await this._vaultPath();
		return this.index.readNote(vaultPath, String(payload?.path || ""));
	}

	async reindex() {
		const vaultPath = await this._vaultPath();
		await this.index.ensureIndexed(vaultPath, { force: true });
		return this.index.status();
	}

	async search(payload) {
		const vaultPath = await this._vaultPath();
		await this.index.ensureIndexed(vaultPath);
		const q = String(payload?.query || "");
		const topK = Math.max(1, Math.min(20, Number(payload?.topK) || 8));
		return { query: q, ...this.index.search(q, { topK }) };
	}

	// ── RPC：RAG 问答（一次性返回；流式增量走事件面 chat.delta）─────
	async chat(payload) {
		const question = String(payload?.question || "").trim();
		const history = Array.isArray(payload?.history) ? payload.history : [];
		if (!question) throw new Error("问题不能为空");

		const llm = this._llm();
		// 消息级覆盖（选择器选定）> 显式配置 > DSH 默认模型；档位同 chatStart 规则。
		const baseRoute = await this._resolveRoute(llm);
		const route = {
			provider: String(payload?.provider || "").trim() || baseRoute.provider,
			model: String(payload?.model || "").trim() || baseRoute.model,
		};
		const effortExplicit = payload?.effort !== undefined ? String(payload.effort || "").trim() : undefined;
		const effortRow = readCatalogModels().find((m) => m.id === route.model);
		const effort = effortExplicit !== undefined
			? effortExplicit
			: resolveEffort({ configDefault: this.config.reasoningEffort, row: effortRow });
		const hits = await this._multiHits(question, llm, route);
		const context = contextBlock(hits, Math.max(200, Number(this.config.chunkLimit) || 1200));
		const system = String(this.config.systemPrompt || "").trim() || BUILTIN_SYSTEM_PROMPT;
		const messages = buildMessages({
			system,
			context,
			history,
			question,
			historyLimit: this.config.historyLimit,
			route,
		});

		// 一次流尝试：返回 {text, terminal, shapes}。流建立失败才抛。
		const runStream = async (options) => {
			let acc = "";
			let term = null;
			const kinds = [];
			for await (const chunk of llm.stream(options)) {
				const failure = terminalFailure(chunk);
				if (failure) { term = failure; break; }   // 终止 chunk 后协议规定不再有内容
				const delta = visibleDelta(chunk);
				if (delta) {
					acc += delta;
					emitDelta(delta);
				} else if (kinds.length < 4 && chunk && typeof chunk === "object") {
					kinds.push(String(chunk.kind || chunk.type || JSON.stringify(chunk).slice(0, 100)));
				}
			}
			return { text: acc, terminal: term, shapes: kinds };
		};

		const emitDelta = typeof this.event === "function"
			? (delta) => { try { const p = this.event("chat.delta", { question, delta }); if (p && typeof p.catch === "function") p.catch(() => {}); } catch { /* 事件面不可用不影响回答 */ } }
			: () => {};

		// 第一跳：按消息级/配置路由。llm 契约要求每次请求显式指定 provider（llm.md：
		// "select the provider by name in every request"），只带 model 不带 provider
		// 或两者都不带 = 无路由，实测表现为零文本直接 finish。
		const options = { messages };
		if (route.provider) options.provider = route.provider;
		if (route.model) options.model = route.model;
		if (effort) options.reasoningEffort = effort;
		let result;
		try {
			result = await runStream(options);
		} catch (error) {
			throw new Error("模型调用失败：" + String(error?.message || error));
		}

		// 回退：路由不完整（无 provider）或空转时，逐个 provider 拉真实模型目录组
		// provider+model 成对候选（listModels(provider) 是唯一正确用法；无参返回空），
		// 再退回本地 catalog（只配 workbuddy 路由）。拿到文本立即采用并记住这对路由。
		// 用户主动停止（[ABORTED]）不回退——那是用户自己要停，不是通道故障。
		if ((!this.config.provider || !result.text.trim()) && !result.terminal?.startsWith("[ABORTED]")) {
			const pairs = [];
			const pushPair = (provider, model) => {
				const p = String(provider || "").trim();
				const m = String(model || "").trim();
				if (!p || !m) return; // 不成对一律不发（否则适配器报 model "undefined"）
				if (pairs.some((x) => x.provider === p && x.model === m)) return;
				pairs.push({ provider: p, model: m });
			};
			if (typeof llm.listProviders === "function" && typeof llm.listModels === "function") {
				try {
					const routes = (Array.isArray(llm.listProviders()) ? llm.listProviders() : []).map(providerRouteOf).filter(Boolean);
					for (const route of routes.slice(0, 6)) {
						try {
							const list = await withTimeout(Promise.resolve(llm.listModels(route)), 8000, "模型目录");
							for (const m of (Array.isArray(list) ? list : []).slice(0, 4)) pushPair(route, typeof m === "string" ? m : m?.id || m?.model);
						} catch { /* 单 provider 跳过 */ }
						if (pairs.length >= 12) break;
					}
				} catch { /* 注册表不可读 */ }
			}
			// catalog 兜底：WorkBuddy 模型 id 只在 workbuddy 路由上有效
			if (!pairs.length) {
				try {
					const raw = typeof llm.listProviders === "function" ? llm.listProviders() : [];
					const names = (Array.isArray(raw) ? raw : []).map(providerRouteOf).filter(Boolean);
					if (names.includes("workbuddy")) {
						for (const row of readCatalogModels().slice(0, 8)) {
							pairs.push({ provider: "workbuddy", model: row.id });
						}
					}
				} catch { /* 无 catalog */ }
			}
			for (const pair of pairs) {
				if (pair.provider === this.config.provider && pair.model === this.config.model) continue; // 跳过已试过的第一跳
				try {
					const retry = await runStream({ messages, provider: pair.provider, ...(pair.model ? { model: pair.model } : {}), ...(effort ? { reasoningEffort: effort } : {}) });
					if (retry.text.trim()) {
						result = retry;
						this.config.provider = pair.provider;   // 记住可用路由（会话内）
						if (pair.model) this.config.model = pair.model;
						break;
					}
					if (retry.terminal) result = retry; // 保留更明确的失败信息
				} catch { /* 下一对 */ }
			}
		}

		const text = result.text;
		const terminal = result.terminal;
		if (terminal && !text.trim()) {
			// 真实失败原因（NO_ADAPTER/AUTH/RATE_LIMIT/...），不再吞成「没有可见内容」
			throw new Error("模型调用失败：" + terminal);
		}
		if (!text.trim()) {
			const hint = result.shapes.length ? "（收到 " + result.shapes.length + " 个非文本 chunk：" + result.shapes.join(" / ") + "）" : "";
			throw new Error("模型没有返回可见内容" + (hint ? " " + hint : "（检查 provider/model 配置）"));
		}
		const answer = terminal ? text + "\n\n（流式提前结束：" + terminal + "）" : text;
		return { answer, citations: hits.map((h, i) => ({ n: i + 1, notePath: h.notePath, noteTitle: h.noteTitle, heading: h.heading, snippet: h.snippet })) };
	}

	// ── 流式会话（可中断）：chatStart 起流后台攒文本，chatPoll 取增量，chatStop 中断 ──
	// typert direct 调用是「一问一答」，没法在一次 RPC 里持续推流；这里用三段式：
	// chatStart 返回 sessionId，流在宿主后台跑，客户端 300ms 轮询 chatPoll 拿增量。
	static _streams = new Map(); // sessionId -> {text, done, error, controller, provider, model, ts}

	async chatStart(payload) {
		const question = String(payload?.question || "").trim();
		const history = Array.isArray(payload?.history) ? payload.history : [];
		if (!question) throw new Error("问题不能为空");
		await this._restorePersisted();
		const llm = this._llm();
		// 路由解析：消息级覆盖（选择器选定）> 显式配置 > DSH 默认模型 > 空则目录回退。
		// 「不带 provider」在实测里必定空转，所以这里必须拿到具体 provider 再发起流。
		const baseRoute = await this._resolveRoute(llm);
		const route = {
			provider: String(payload?.provider || "").trim() || baseRoute.provider,
			model: String(payload?.model || "").trim() || baseRoute.model,
		};
		// 推理档位：消息级选择（选择器选定，可传 "" 表示跟随上游默认）> resolveEffort 规则。
		const effortExplicit = payload?.effort !== undefined ? String(payload.effort || "").trim() : undefined;
		const effortRow = readCatalogModels().find((m) => m.id === route.model);
		const effort = effortExplicit !== undefined
			? effortExplicit
			: resolveEffort({ configDefault: this.config.reasoningEffort, row: effortRow });

		// 会话状态先建、先注册：检索/规划也是这几秒的耗时（复杂问题还会多打一次
		// planner 模型调用），历史版本把它们放在 sessionId 之前，这段窗口里客户端
		// 还没有 sessionId 可停——点停止完全空转，气泡卡在「检索知识库并生成回答…」。
		const sessionId = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
		const state = { text: "", think: "", done: false, error: "", controller: new AbortController(), provider: route.provider, model: route.model, effort, usage: null, ts: Date.now(), attempt: 1, stopping: false };
		ObsidianBoardGateway._streams.set(sessionId, state);
		// 只保留最近 6 个会话，防泄漏
		for (const [k, v] of ObsidianBoardGateway._streams) {
			if (ObsidianBoardGateway._streams.size > 6) { if (v.done) { ObsidianBoardGateway._streams.delete(k); break; } }
		}

		// 检索与规划阶段：可被 chatStop 中止（abort 后立刻返回 citations 空集，
		// 后台段看到 aborted 直接收尾，不再发起模型调用）。
		const abortable = (promise) => new Promise((resolve, reject) => {
			const signal = state.controller.signal;
			if (signal.aborted) { resolve({ __aborted: true }); return; }
			const onAbort = () => resolve({ __aborted: true });
			signal.addEventListener("abort", onAbort, { once: true });
			promise.then(
				(value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
				(error) => { signal.removeEventListener("abort", onAbort); reject(error); },
			);
		});
		const retrieval = await abortable(this._multiHits(question, llm, route));
		if (retrieval && retrieval.__aborted) {
			state.error = "已停止";
			state.done = true;
			return { sessionId, citations: [], usedProvider: state.provider, usedModel: state.model, usedEffort: state.effort };
		}
		const hits = retrieval;
		const context = contextBlock(hits, Math.max(200, Number(this.config.chunkLimit) || 1200));
		const system = String(this.config.systemPrompt || "").trim() || BUILTIN_SYSTEM_PROMPT;
		const messages = buildMessages({ system, context, history, question, historyLimit: this.config.historyLimit, route });

		// 后台跑流；目录回退逻辑与 chat 相同（provider+model 成对探测）。
		// 全程受 chatStart 的 300s 上限约束：任何一步挂住都会让轮询看到明确的超时错误，
		// 而不是无限转圈。120s 是历史值——onlyReasoning 模型（glm-5.3-flash / hy 系列）
		// 在 max/high 推理档的思考期可达 2-3 分钟，120s 会把正常长回答掐死成超时。
		(async () => {
			let timedOut = false;
			const deadline = setTimeout(() => {
				timedOut = true;
				try { state.controller.abort(); } catch { /* ignore */ }
			}, 300000);
			const runOne = async (options) => {
				const signal = state.controller.signal;
				const iterator = llm.stream({ ...options, signal })[Symbol.asyncIterator]();
				// abort 与「等下一个 chunk」赛跑：模型静默期（首字等待、上游缓冲、
				// 适配器卡住）根本没有 chunk 到达，只在循环顶部检查 aborted 永远读不到
				// 停止指令——实测表现就是「停止按钮只有思考增量在流的时候才生效」。
				let abortResolve = () => {};
				const abortPromise = new Promise((resolve) => {
					abortResolve = () => resolve({ __abort: true });
					if (signal.aborted) abortResolve();
					else signal.addEventListener("abort", abortResolve, { once: true });
				});
				try {
					while (true) {
						if (signal.aborted) return true;
						const pending = iterator.next();
						// 竞速落败方的 rejection 不该成为 unhandled rejection（原始 promise
						// 仍会把错误交给 race 抛出，这里只是挂一个吞掉的派生分支）
						pending.catch(() => {});
						const next = await Promise.race([pending, abortPromise]);
						if (next && next.__abort) return true;
						if (next.done) break;
						const chunk = next.value;
						const failure = terminalFailure(chunk);
						if (failure) { state.error = "模型调用失败：" + failure; return false; }
						// usage chunk：token 计量（协议：{type:'usage', usage:{inputTokens,...}}，
						// 先于 finish；usageOf 统一 camelCase/snake_case/旧形状）
						const usage = usageOf(chunk);
						if (usage) state.usage = usage;
						// 思考增量：单独通道攒给面板展示（onlyReasoning 模型的思考期可达分钟级，
						// 不展示就是「只转圈」；正文与思考互不混入）
						const think = thinkingDelta(chunk);
						if (think) state.think += think;
						const delta = visibleDelta(chunk);
						if (delta) state.text += delta;
					}
					return true;
				} finally {
					signal.removeEventListener("abort", abortResolve);
					// 提前退出（停止/失败）时释放上游迭代器，让适配器尽快收尾
					try { await iterator.return?.(); } catch { /* ignore */ }
				}
			};
			// 推理档位：effort 非空才下发（"" = 跟随上游默认）；模型不支持时上游忽略。
			const withEffort = (options) => (state.effort ? { ...options, reasoningEffort: state.effort } : options);
			try {
				const options = withEffort({ messages });
				if (state.provider) options.provider = state.provider;
				if (state.model) options.model = state.model;
				let ok = await runOne(options);
				// 空转/失败回退：三级递进 llm 目录 → provider 名 → 本地 catalog。
				// 注意：只要没文本、没中断就回退——首跳的终端错误（如 NO_ADAPTER）不能阻止
				// 回退，否则目录瞬断=直接放弃。每个 pair 前清 state.error（残留错误会吞掉
				// 后续成功的结果），并记录尝试轨迹供最终诊断。
				if (!state.text.trim() && !state.controller.signal.aborted) {
					const attempts = [];
					if (state.error) attempts.push("首跳：" + state.error);
					// 候选路由对：**必须 provider+model 成对**。
					// 宿主契约：llm.listModels(provider) 需要显式 provider（无参返回空数组），
					// 且 INVALID_MODEL_INFO 明确要求 model 是有效字符串——历史版本只拿到
					// provider 名就发流（deepseek-official/?、workbuddy/?），适配器直接报
					// `adapter returned invalid or duplicate model metadata ... model "undefined"`。
					// 截图里那一长串 INVALID_MODEL_INFO / "model undefined" 就是这条链。
					let pairs = [];
					const pushPair = (provider, model) => {
						const p = String(provider || "").trim();
						const m = String(model || "").trim();
						if (!p || !m) return; // 不成对一律不发
						if (pairs.some((x) => x.provider === p && x.model === m)) return;
						pairs.push({ provider: p, model: m });
					};
					// ① 逐个 provider 拉真实模型目录（正确用法：listModels(provider)）
					if (typeof llm.listProviders === "function" && typeof llm.listModels === "function") {
						try {
							const routes = (Array.isArray(llm.listProviders()) ? llm.listProviders() : []).map(providerRouteOf).filter(Boolean);
							for (const route of routes.slice(0, 6)) {
								try {
									const list = await withTimeout(Promise.resolve(llm.listModels(route)), 8000, "模型目录");
									for (const m of (Array.isArray(list) ? list : []).slice(0, 4)) {
										pushPair(route, typeof m === "string" ? m : m?.id || m?.model);
									}
								} catch { /* 单 provider 目录不可得：跳过 */ }
								if (pairs.length >= 12) break;
							}
						} catch { /* 注册表不可读 */ }
					}
					// ② workbuddy catalog 兜底：catalog 里的模型 id 只在 workbuddy 路由有效
					if (!pairs.length && typeof llm.listProviders === "function") {
						try {
							const names = (Array.isArray(llm.listProviders()) ? llm.listProviders() : []).map(providerRouteOf).filter(Boolean);
							if (names.includes("workbuddy")) {
								for (const row of readCatalogModels().slice(0, 8)) pushPair("workbuddy", row.id);
							}
						} catch { /* 无 catalog */ }
					}
					for (const pair of pairs) {
						if (state.controller.signal.aborted) break;
						try {
							// 新一次尝试：清空宿主缓冲，并且**递增 attempt**。
							// 关键：客户端按「绝对偏移 received」取增量，宿主一旦重置 text
							// 而偏移不重置，切片就错位——轻则新回答永远不出现（length 没超过
							// 旧偏移），重则把上一轮的残文和这一轮的正文拼成重复/错乱的输出
							// （这正是「总是输出异常」的一类来源）。客户端看到 attempt 变化
							// 会同步重置偏移并清掉气泡里上一轮的残文。
							state.text = "";
							state.think = "";
							state.error = ""; // 清残留：上一对的失败不能吞掉这一对的结果
							state.usage = null; // 用量也是上一轮的，别混算
							state.attempt += 1;
							ok = await runOne(withEffort({ messages, provider: pair.provider, ...(pair.model ? { model: pair.model } : {}) }));
							attempts.push(pair.provider + "/" + (pair.model || "?") + (state.error ? "：" + state.error : (state.text.trim() ? "有输出" : "零文本")));
							if (state.text.trim()) {
								state.provider = pair.provider;
								state.model = pair.model || state.model;
								// 记住可用路由：下次 chatStart 直接走它，不再空转一轮
								this.config.provider = pair.provider;
								if (pair.model) this.config.model = pair.model;
								await this._saveState({ provider: this.config.provider, model: this.config.model });
								break;
							}
						} catch (error) {
							attempts.push(pair.provider + "/" + (pair.model || "?") + "异常 " + String(error?.message || error).slice(0, 80));
						}
					}
					// 全部失败：带完整尝试轨迹，一眼看出哪条路由、什么原因；成功则清残留。
					// 用户主动停止显示中性文案，不冒充通道故障。
					if (!state.text.trim()) {
						state.error = state.controller.signal.aborted
							? (timedOut ? "回答超时（300s 无响应）——模型长时间未输出，可重试或换更低的推理档位。" : "已停止")
							: "模型没有返回内容（当前 " + (state.provider || "?") + "）。已尝试：" + attempts.join("；") + "。若主对话页同样失败＝模型通道本身的问题（重启 DSH 重连）；若主对话正常＝带着这段文字反馈排查。";
					} else {
						state.error = ""; // 回退成功：清掉链路中任何残留错误
					}
				}
			} catch (error) {
				// 停止引发的迭代器异常不是故障：收敛成中性终态
				state.error = state.controller.signal.aborted
					? "已停止"
					: "模型调用失败：" + String(error?.message || error);
			} finally {
				clearTimeout(deadline);
				if (timedOut && !state.error) state.error = "回答超时（300s 无响应）";
				// 已有正文的停止：保留正文，只标记已停止（客户端据此显示「已停止」而非错误）
				if (state.controller.signal.aborted && state.text.trim()) state.error = "";
				state.done = true;
			}
		})();

		return { sessionId, citations: hits.map((h, i) => ({ n: i + 1, notePath: h.notePath, noteTitle: h.noteTitle, heading: h.heading, snippet: h.snippet })), usedProvider: state.provider, usedModel: state.model, usedEffort: state.effort };
	}

	async chatPoll(payload) {
		const state = ObsidianBoardGateway._streams.get(String(payload?.sessionId || ""));
		if (!state) return { done: true, error: "会话不存在或已过期（超过 6 个会话被回收）" };
		const prevLen = Math.max(0, Number(payload?.received) || 0);
		const prevThinkLen = Math.max(0, Number(payload?.receivedThink) || 0);
		const delta = state.text.length > prevLen ? state.text.slice(prevLen) : "";
		const thinkDelta = state.think.length > prevThinkLen ? state.think.slice(prevThinkLen) : "";
		// 停止后立即视为终态：chatStop 已经把 abort 与终止状态都置好，这里不该让客户端
		// 继续轮询等后台段自己收敛——后台可能正卡在无 chunk 的 await 里（上游静默期）。
		// 这正是历史上「停止后气泡一直转圈」的第二个来源：客户端只在 poll.done 时才停。
		const stopped = state.stopping === true || state.controller.signal.aborted;
		return {
			done: state.done || stopped,
			delta,
			thinkDelta,
			thinking: !state.text.length && !!state.think.length && !state.done && !stopped, // 思考中：还没正文、思考在增长
			total: state.text.length,
			thinkTotal: state.think.length,
			// 尝试轮次：回退链换路由时宿主会清空缓冲（text/think/usage），
			// 客户端必须据此把「绝对偏移」一起重置，否则切片错位 → 输出错乱/重复。
			attempt: state.attempt,
			error: state.text.trim() ? "" : state.error,
			stopped,
			aborted: state.controller.signal.aborted,
			usage: state.usage,
			provider: state.provider,
			model: state.model,
			effort: state.effort || "",
		};
	}

	async chatStop(payload) {
		const state = ObsidianBoardGateway._streams.get(String(payload?.sessionId || ""));
		if (!state) return { stopped: false };
		// 幂等：重复点停止 / 已自然结束都不会改变终态
		try { state.controller.abort(); } catch { /* ignore */ }
		// 立刻标记停止：后台段可能正卡在没有 chunk 的 await 上（上游静默期），
		// 轮询不该等它自己收敛——先把中性终态写给客户端（不冒充错误，也没有
		// 半截正文时不留空气泡）。
		state.stopping = true;
		if (!state.text.trim() && !state.error) state.error = "已停止";
		return { stopped: true };
	}

	// ── RPC：保存回答为 vault 笔记（知识库闭环）────────────────────
	async saveNote(payload) {
		await this._restorePersisted();
		const vaultPath = await this._vaultPath();
		const title = String(payload?.title || "").trim() || "知识库回答 " + new Date().toISOString().slice(0, 16).replace("T", " ");
		const content = String(payload?.content || "");
		if (!content.trim()) throw new Error("内容为空，没有可保存的回答");
		// 文件名消毒：Windows 非法字符 + 长度上限
		const safe = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "知识库回答";
		const dir = join(vaultPath, "AI 回答");
		const { mkdir, writeFile, access } = await import("node:fs/promises");
		await mkdir(dir, { recursive: true });
		let path = join(dir, safe + ".md");
		// 同名追加序号
		for (let i = 2; i < 200; i++) {
			try { await access(path); path = join(dir, `${safe} ${i}.md`); } catch { break; }
		}
		const header = [
			"---",
			"tags: [ai-answer]",
			`created: ${new Date().toISOString()}`,
			`source: dsh-obsidian-board`,
		];
		const cites = Array.isArray(payload?.citations) ? payload.citations : [];
		for (const c of cites.slice(0, 20)) {
			if (c?.notePath) header.push(`refs: "[[${c.notePath.replace(/\.md$/i, "")}|${c.noteTitle || c.notePath}]]"`);
		}
		header.push("---", "");
		const body = header.join("\n") + content.trim() + "\n";
		await writeFile(path, body, "utf8");
		// 让索引立即看到新笔记
		await this.index.ensureIndexed(vaultPath, { force: true });
		return { saved: true, path: "AI 回答/" + path.split(/[\\/]/).pop(), title: path.split(/[\\/]/).pop().replace(/\.md$/i, "") };
	}
}

export default ObsidianBoardGateway;
