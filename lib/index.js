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
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
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
		chunkLimit: { type: "number", description: "单条引用进提示词的最大字符数", default: 1200 },
		historyLimit: { type: "number", description: "面板会话保留的历史消息条数", default: 24 },
		systemPrompt: { type: "string", description: "自定义系统提示词（覆盖内置的 RAG 提示词）", default: "" },
	},
	default: {},
};

// 内置 RAG 系统提示词：强制「先检索、引用回答、不编造」。
const BUILTIN_SYSTEM_PROMPT = [
	"你是用户的 Obsidian 知识库问答助手。回答规则：",
	"1. 优先依据 <context> 里的笔记片段回答；引用时用 [n] 标注对应编号。",
	"2. context 不足以回答时明确说明「知识库中没有找到相关内容」，再给一般性回答并标注（未引用知识库）。",
	"3. 不编造笔记中不存在的内容；不确定就说不确定。",
	"4. 回答用与提问相同的语言，简洁、结构化。",
].join("\n");

// 组装 RAG 提示词：system + context + 历史 + 本轮问题。
function buildMessages({ system, context, history, question }) {
	const messages = [];
	messages.push({
		role: "system",
		content: [{ type: "text", text: system + (context ? "\n\n<context>\n" + context + "\n</context>" : "") }],
	});
	// 面板会话历史（截断到最近 N 条，防止上下文膨胀）
	const tail = history.slice(-Math.max(2, 24)).slice(-24);
	for (const m of tail) {
		if (!m || typeof m.content !== "string" || !m.content.trim()) continue;
		messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: [{ type: "text", text: m.content.slice(0, 4000) }] });
	}
	messages.push({ role: "user", content: [{ type: "text", text: question }] });
	return messages;
}

function contextBlock(hits, chunkLimit) {
	if (!hits.length) return "";
	return hits
		.map((hit, i) => {
			const body = hit.text.length > chunkLimit ? hit.text.slice(0, chunkLimit) + "…" : hit.text;
			return `[${i + 1}] 笔记「${hit.noteTitle}」${hit.heading ? " · " + hit.heading : ""}\n${body}`;
		})
		.join("\n\n---\n\n");
}

// 从 llm chunk 流里抽出可见文本增量（text-delta；reasoning-delta 不进面板正文）。
function visibleDelta(chunk) {
	if (!chunk || typeof chunk !== "object") return "";
	if (chunk.type === "text-delta") return typeof chunk.delta === "string" ? chunk.delta : "";
	if (chunk.kind === "text-delta") return typeof chunk.delta === "string" ? chunk.delta : "";
	return "";
}

async function mapHasVaultPath(map, dir) {
	return map.has(dir);
}

export class ObsidianBoardGateway extends TypertRemoteService {
	static inject = ["llm", "directoryPicker?"];
	constructor(ctx, config) {
		super(ctx, "obsidianBoard");
		this.config = config || {};
		this.index = new VaultIndex();
		this.vaultPath = "";
	}

	_vaultPath() {
		if (this.vaultPath) return this.vaultPath;
		const raw = String(this.config.vaultPath || "").trim();
		if (!raw) throw new Error("未配置 vault 路径：请在 cordis.patch.yml 的 dsh-obsidian-board 条目里填 config.vaultPath（vault 根目录绝对路径）");
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
	// 扫描常见存放位置的**一层**子目录，找出包含 .obsidian 的目录。只扫描、不深递归，
	// 总扫描数有硬上限，保证 2s 内返回。
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
		const picker = typeof this.ctx.get === "function" ? this.ctx.get("directoryPicker") : undefined;
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
		const vaultPath = this._vaultPath();
		if (process.platform === "win32") {
			spawn("explorer", [vaultPath], { detached: true, stdio: "ignore" }).unref();
			return { opened: true };
		}
		const cmd = process.platform === "darwin" ? "open" : "xdg-open";
		spawn(cmd, [vaultPath], { detached: true, stdio: "ignore" }).unref();
		return { opened: true };
	}

	async _hits(question) {
		const vaultPath = this._vaultPath();
		await this.index.ensureIndexed(vaultPath);
		const topK = Math.max(1, Math.min(20, Number(this.config.topK) || 8));
		return this.index.search(question, { topK }).hits;
	}

	// ── RPC：模型目录（模型选择器数据源）──────────────────────────
	// listModels 是 catalog 驱动接口的模型枚举（llm.md：GUI 选择依赖 catalog 成员资格）。
	// provider 缺席时逐个 provider 试（同 adapter 的多路由只取第一个成功者），失败静默。
	async listModels() {
		const llm = this._llm();
		let providers = [];
		if (typeof llm.listProviders === "function") {
			try {
				const raw = llm.listProviders();
				providers = (Array.isArray(raw) ? raw : []).map((p) => (typeof p === "string" ? p : p?.name || String(p))).filter(Boolean);
			} catch { /* 注册表不可读就按无 provider 处理 */ }
		}
		const models = [];
		for (const provider of providers.slice(0, 12)) {
			if (typeof llm.listModels !== "function") break;
			try {
				const raw = await llm.listModels(provider);
				const items = Array.isArray(raw) ? raw : raw?.models || [];
				for (const m of items.slice(0, 60)) {
					const id = typeof m === "string" ? m : m?.id || m?.model;
					if (!id) continue;
					models.push({ provider, model: id, label: (typeof m === "object" && m?.label) || id });
				}
			} catch { /* 单 provider 失败不影响其它 */ }
		}
		return { providers, models, defaultProvider: this.config.provider || "", defaultModel: this.config.model || "" };
	}

	// ── RPC：状态与配置探测 ─────────────────────────────────────────
	async status() {
		const base = { configured: false, vaultPath: "", llm: false, ...this.index.status(), engine: "bm25-cjk-bigram" };
		try {
			const vaultPath = this._vaultPath();
			base.configured = true;
			base.vaultPath = vaultPath;
		} catch (error) {
			base.error = String(error?.message || error);
		}
		try {
			const llm = this._llm();
			base.llm = !!llm;
			if (typeof llm.listProviders === "function") {
				const providers = llm.listProviders();
				base.providers = Array.isArray(providers) ? providers.map((p) => (typeof p === "string" ? p : p?.name || String(p))).filter(Boolean) : [];
			}
		} catch {
			base.llm = false;
		}
		return base;
	}

	async configure(payload) {
		const vaultPath = String(payload?.vaultPath || "").trim();
		if (vaultPath) {
			this.config.vaultPath = vaultPath;
			this.vaultPath = "";
		}
		if (payload?.provider !== undefined) this.config.provider = String(payload.provider || "").trim();
		if (payload?.model !== undefined) this.config.model = String(payload.model || "").trim();
		if (payload?.topK !== undefined) this.config.topK = Math.max(1, Math.min(20, Number(payload.topK) || 8));
		// 换 vault 强制全量重建
		if (vaultPath) await this.index.ensureIndexed(this._vaultPath(), { force: true });
		return this.status();
	}

	async listNotes() {
		const vaultPath = this._vaultPath();
		await this.index.ensureIndexed(vaultPath);
		return this.index.listNotes({ limit: 400 });
	}

	async readNote(payload) {
		const vaultPath = this._vaultPath();
		return this.index.readNote(vaultPath, String(payload?.path || ""));
	}

	async reindex() {
		const vaultPath = this._vaultPath();
		await this.index.ensureIndexed(vaultPath, { force: true });
		return this.index.status();
	}

	async search(payload) {
		const vaultPath = this._vaultPath();
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

		const vaultPath = this._vaultPath();
		await this.index.ensureIndexed(vaultPath);
		const hits = await this._hits(question);
		const context = contextBlock(hits, Math.max(200, Number(this.config.chunkLimit) || 1200));
		const system = String(this.config.systemPrompt || "").trim() || BUILTIN_SYSTEM_PROMPT;
		const messages = buildMessages({
			system,
			context,
			history,
			question,
		});

		const llm = this._llm();
		const options = {
			messages,
		};
		if (this.config.provider) options.provider = this.config.provider;
		if (this.config.model) options.model = this.config.model;

		let text = "";
		const emitDelta = typeof this.event === "function"
			? (delta) => { try { const p = this.event("chat.delta", { question, delta }); if (p && typeof p.catch === "function") p.catch(() => {}); } catch { /* 事件面不可用不影响回答 */ } }
			: () => {};
		try {
			for await (const chunk of llm.stream(options)) {
				const delta = visibleDelta(chunk);
				if (delta) {
					text += delta;
					emitDelta(delta);
				}
			}
		} catch (error) {
			const message = String(error?.message || error);
			if (!text) throw new Error("模型调用失败：" + message);
			text += "\n\n（流式中断：" + message + "）";
		}
		if (!text.trim()) throw new Error("模型没有返回可见内容（检查 provider/model 配置）");
		return { answer: text, citations: hits.map((h, i) => ({ n: i + 1, notePath: h.notePath, noteTitle: h.noteTitle, heading: h.heading, snippet: h.snippet })) };
	}
}

export default ObsidianBoardGateway;
