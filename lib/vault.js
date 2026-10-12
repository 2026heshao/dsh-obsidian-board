// dsh-obsidian-board — 本地 vault 索引器（零依赖，纯 Node）。
//
// 设计取舍：
// - Obsidian vault 本质是 .md 文件目录，索引器不依赖 Obsidian 运行，也不要求 vault 结构；
// - 检索用 BM25（k1=1.2, b=0.75）+ 标题/路径命中加权 + Obsidian 别名/标签感知，
//   对中文按 bigram 切词、其他按词干化小写词切词——这是「能完全离线跑」与
//   「召回质量可用」之间的平衡点；embedding 属于二期（宿主里跑 transformers.js），接口留好；
// - chunk 按 markdown 结构切（标题层级），单 chunk 超长再按段落硬切，保留标题面包屑；
// - 索引常驻内存 + mtime 增量刷新：vault 万级笔记以内，全量扫描 <1s，增量刷新 <50ms。

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

// ── 切词 ────────────────────────────────────────────────────────────
// CJK 单字信息量低、bigram 召回稳；拉丁词走小写 + 轻量复数归一。
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF]/;

export function tokenize(text) {
	const tokens = [];
	const lowered = String(text).toLowerCase();
	// 拉丁/数字词
	for (const m of lowered.matchAll(/[a-z0-9_][a-z0-9_'+.-]*/g)) {
		let w = m[0].replace(/^['+.-]+|['+.-]+$/g, "");
		if (w.length >= 2 && !/^\d+$/.test(w)) {
			if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
			tokens.push(w);
		}
	}
	// CJK bigram（单字也保留，权重低——用于单字专有名词）
	for (const m of lowered.matchAll(/[\u2E80-\u9FFF\uF900-\uFAFF]{1,}/g)) {
		const run = m[0];
		if (run.length === 1) { tokens.push(run); continue; }
		for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
	}
	return tokens;
}

// ── Obsidian 元数据解析 ─────────────────────────────────────────────
function parseFrontmatter(raw) {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return { frontmatter: null, body: raw };
	return { frontmatter: m[1], body: raw.slice(m[0].length) };
}

function extractTags(frontmatter, body) {
	const tags = new Set();
	if (frontmatter) {
		for (const m of frontmatter.matchAll(/(^|\n)\s*tags\s*:\s*(.+)/g)) {
			for (const t of m[2].matchAll(/[\w\u4e00-\u9fff/-]+/g)) tags.add(t[0].toLowerCase());
		}
		for (const m of frontmatter.matchAll(/^\s*-\s+([\w\u4e00-\u9fff/-]+)\s*$/gm)) tags.add(m[1].toLowerCase());
	}
	for (const m of body.matchAll(/(^|\s)#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/-]*)/g)) tags.add(m[2].toLowerCase());
	return [...tags];
}

function extractAliases(frontmatter) {
	if (!frontmatter) return [];
	const m = frontmatter.match(/(^|\n)\s*aliases\s*:\s*([^\n]+)/);
	if (!m) return [];
	return [...m[2].matchAll(/[\w\u4e00-\u9fff][^,，]*/g)].map((x) => x[0].trim()).filter(Boolean);
}

// ── chunk 切分 ──────────────────────────────────────────────────────
const MAX_CHUNK_CHARS = 1600;

function splitLongText(text, limit) {
	const paras = text.split(/\n\s*\n/);
	const parts = [];
	let cur = "";
	for (const p of paras) {
		if ((cur + "\n\n" + p).length > limit && cur) { parts.push(cur); cur = p; }
		else cur = cur ? cur + "\n\n" + p : p;
	}
	if (cur) parts.push(cur);
	return parts;
}

// 按标题层级切 chunk，chunk 带「笔记标题 > 标题面包屑」。
export function chunkNote(note) {
	const chunks = [];
	const lines = note.body.split(/\r?\n/);
	let crumbs = []; // 当前标题层级
	let buf = [];
	let bufStart = -1;
	const flush = () => {
		if (!buf.length) return;
		const text = buf.join("\n").trim();
		if (text.length >= 2) {
			const crumbText = crumbs.length ? crumbs.map((c) => c.title).join(" > ") : "";
			const pieces = text.length > MAX_CHUNK_CHARS ? splitLongText(text, MAX_CHUNK_CHARS) : [text];
			for (const piece of pieces) {
				chunks.push({
					notePath: note.path,
					noteTitle: note.title,
					crumbs: crumbText,
					heading: crumbs.length ? crumbs[crumbs.length - 1].title : "",
					text: piece,
					startLine: bufStart,
				});
			}
		}
		buf = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const hm = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
		if (hm) {
			flush();
			const level = hm[1].length;
			crumbs = crumbs.filter((c) => c.level < level);
			crumbs.push({ level, title: hm[2] });
			bufStart = i + 1;
		} else {
			if (!buf.length) bufStart = i;
			buf.push(line);
		}
	}
	flush();
	return chunks;
}

// ── vault 扫描 ──────────────────────────────────────────────────────
const MD_EXT = new Set([".md", ".markdown"]);
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", ".dsh", "node_modules", ".smart-env"]);

export async function scanVault(vaultPath) {
	const files = [];
	async function walk(dir, depth) {
		if (depth > 12) return;
		let entries;
		try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (e.name.startsWith(".") && e.name !== ".") continue;
			if (SKIP_DIRS.has(e.name)) continue;
			const full = join(dir, e.name);
			if (e.isDirectory()) await walk(full, depth + 1);
			else if (MD_EXT.has(e.name.slice(e.name.lastIndexOf(".")).toLowerCase())) files.push(full);
		}
	}
	await walk(vaultPath, 0);
	return files;
}

// ── BM25 索引 ───────────────────────────────────────────────────────
export class VaultIndex {
	constructor() {
		this.vaultPath = "";
		this.chunks = [];        // {notePath, noteTitle, crumbs, heading, text, tokens: Map, len}
		this.byNote = new Map(); // notePath -> {title, mtimeMs, aliases, tags, chunkIdx: []}
		this.df = new Map();     // token -> doc count
		this.avgLen = 0;
		this.builtAt = 0;
		this.scanning = false;
	}

	async ensureIndexed(vaultPath, { force = false } = {}) {
		if (this.scanning) return { queued: true };
		if (!force && this.builtAt && this.vaultPath === vaultPath) {
			// 轻量增量：只对 mtime 变化的笔记重建 chunk。
			return this._incremental(vaultPath);
		}
		this.scanning = true;
		try {
			if (force || this.vaultPath !== vaultPath) await this._full(vaultPath);
			else await this._incremental(vaultPath);
		} finally {
			this.scanning = false;
		}
		return { queued: false };
	}

	async _full(vaultPath) {
		this.vaultPath = vaultPath;
		this.chunks = [];
		this.byNote = new Map();
		this.df = new Map();
		const files = await scanVault(vaultPath);
		for (const file of files) {
			try { await this._indexFile(file, vaultPath); } catch { /* 单文件失败不拖垮全量 */ }
		}
		this._recomputeStats();
		this.builtAt = Date.now();
	}

	async _incremental(vaultPath) {
		const files = await scanVault(vaultPath);
		const seen = new Set();
		let dirty = false;
		for (const file of files) {
			seen.add(file);
			const rec = this.byNote.get(file);
			let mtime;
			try { mtime = (await stat(file)).mtimeMs; } catch { continue; }
			if (!rec || rec.mtimeMs !== mtime) {
				dirty = true;
				if (rec) this._dropNote(file);
				try { await this._indexFile(file, vaultPath); } catch { /* 同上 */ }
			}
		}
		for (const path of [...this.byNote.keys()]) {
			if (!seen.has(path)) { this._dropNote(path); dirty = true; }
		}
		if (dirty) { this._recomputeStats(); this.builtAt = Date.now(); }
	}

	async _indexFile(file, vaultPath) {
		const raw = await readFile(file, "utf8");
		const { frontmatter, body } = parseFrontmatter(raw);
		const rel = relative(vaultPath, file).split(sep).join("/");
		const title = basename(file).replace(/\.(md|markdown)$/i, "");
		const mtimeMs = (await stat(file)).mtimeMs;
		const note = {
			path: rel,
			title,
			mtimeMs,
			aliases: extractAliases(frontmatter),
			tags: extractTags(frontmatter, body),
			chunkIdx: [],
		};
		const chunks = chunkNote({ path: rel, title, body });
		for (const chunk of chunks) {
			// 标题面包屑重复进正文计权：标题词在检索里更重。
			const boost = note.title + "\n" + chunk.crumbs + "\n" + chunk.heading;
			const tokenList = tokenize(boost + "\n" + chunk.text);
			const tokens = new Map();
			for (const t of tokenList) tokens.set(t, (tokens.get(t) || 0) + 1);
			const idx = this.chunks.length;
			this.chunks.push({ ...chunk, tokens, len: tokenList.length });
			note.chunkIdx.push(idx);
		}
		this.byNote.set(file, note);
	}

	_dropNote(file) {
		const rec = this.byNote.get(file);
		if (!rec) return;
		// 增量路径把旧 chunk 标记为孤儿，等下次全量清理；检索时跳过。
		for (const idx of rec.chunkIdx) if (this.chunks[idx]) this.chunks[idx].stale = true;
		this.byNote.delete(file);
	}

	_recomputeStats() {
		// 清理孤儿并压实
		if (this.chunks.some((c) => c.stale)) {
			const remap = new Map();
			const kept = [];
			for (let i = 0; i < this.chunks.length; i++) {
				if (this.chunks[i].stale) continue;
				remap.set(i, kept.length);
				kept.push(this.chunks[i]);
			}
			this.chunks = kept;
			for (const note of this.byNote.values()) note.chunkIdx = note.chunkIdx.map((i) => remap.get(i)).filter((i) => i !== undefined);
		}
		this.df = new Map();
		let total = 0;
		for (const c of this.chunks) {
			total += c.len;
			for (const t of c.tokens.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
		}
		this.avgLen = this.chunks.length ? total / this.chunks.length : 0;
	}

	// ── 检索 ────────────────────────────────────────────────────────
	// BM25 + 标题/别名命中加分 + 标签命中加分。topK 默认 8。
	search(query, { topK = 8, tagBoost = 3, titleBoost = 8 } = {}) {
		if (!this.chunks.length || !query.trim()) return { hits: [], noteCount: this.byNote.size, chunkCount: this.chunks.length };
		const N = this.chunks.length;
		const k1 = 1.2, b = 0.75;
		const qTokens = tokenize(query);
		const qTags = query.toLowerCase().match(/#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/-]*)/g)?.map((t) => t.slice(1)) || [];
		const qLower = query.toLowerCase();
		const scores = new Map();
		for (let i = 0; i < N; i++) {
			const c = this.chunks[i];
			if (c.stale) continue;
			let s = 0;
			for (const t of qTokens) {
				const tf = c.tokens.get(t);
				if (!tf) continue;
				const df = this.df.get(t) || 0;
				const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
				s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.len / (this.avgLen || 1)));
			}
			if (s <= 0) continue;
			// 标题/别名命中：查询整体出现在标题里是强信号
			if (c.noteTitle && (c.noteTitle.toLowerCase().includes(qLower) || qLower.includes(c.noteTitle.toLowerCase()))) s += titleBoost;
			if (c.crumbs && qTokens.length && qTokens.every((t) => c.crumbs.toLowerCase().includes(t))) s += titleBoost / 2;
			scores.set(i, s);
		}
		// 标签路由：带 #tag 的查询把对应笔记整体加权
		if (qTags.length) {
			for (const [file, note] of this.byNote) {
				if (!note.tags.some((t) => qTags.includes(t))) continue;
				for (const idx of note.chunkIdx) {
					const cur = scores.get(idx) || 0;
					scores.set(idx, cur + tagBoost);
				}
			}
		}
		const hits = [...scores.entries()]
			.sort((a, b2) => b2[1] - a[1])
			.slice(0, topK)
			.map(([idx, score]) => {
				const c = this.chunks[idx];
				return {
					notePath: c.notePath,
					noteTitle: c.noteTitle,
					heading: c.crumbs || c.heading,
					snippet: c.text.length > 500 ? c.text.slice(0, 500) + "…" : c.text,
					text: c.text,
					score: Math.round(score * 100) / 100,
				};
			});
		return { hits, noteCount: this.byNote.size, chunkCount: this.chunks.length };
	}

	// 笔记列表（侧栏浏览器用）
	listNotes({ limit = 500 } = {}) {
		const notes = [...this.byNote.values()]
			.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases, tags: n.tags.slice(0, 6), mtimeMs: Math.round(n.mtimeMs) }))
			.sort((a, b) => b.mtimeMs - a.mtimeMs);
		return { notes: notes.slice(0, limit), total: notes.length };
	}

	// 读整篇笔记（引用展开用）
	async readNote(vaultPath, relPath) {
		const safe = relPath.split("/").join(sep);
		if (safe.includes("..")) throw new Error("路径不允许包含 ..");
		const full = join(vaultPath, safe);
		// 防穿越：解析后必须仍在 vault 内
		if (!full.startsWith(vaultPath + sep) && full !== vaultPath) throw new Error("路径越出 vault 范围");
		const raw = await readFile(full, "utf8");
		return { path: relPath, content: raw, mtimeMs: Math.round((await stat(full)).mtimeMs) };
	}

	status() {
		return {
			vaultPath: this.vaultPath,
			noteCount: this.byNote.size,
			chunkCount: this.chunks.length,
			builtAt: this.builtAt,
			scanning: this.scanning,
			engine: "bm25-cjk-bigram",
		};
	}
}
