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
// 结构/缓存目录：永远不索引（Obsidian 自身状态、版本库、依赖）。
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", ".dsh", "node_modules", ".smart-env"]);
// 默认跳过的「隐藏内容目录」：点号开头都不是 Obsidian 笔记（附件缓存、插件数据等）。
// 例外 `.workbuddy`（DSH 的 WorkBuddy 记忆目录）是用户真实笔记所在——实测该目录下的
// memory/*.md 含有用户自己的关键记录，历史版本把它整体跳过，用户看到的就是
// 「知识库里明明有，面板却永远搜不到」。按需放行（见 includeDotDirs）。
const DEFAULT_SKIP_DOT = true;
const ALLOW_DOT_DIRS = new Set([".workbuddy"]);

export async function scanVault(vaultPath, { includeDotDirs = true } = {}) {
	const files = [];
	async function walk(dir, depth) {
		if (depth > 12) return;
		let entries;
		try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (SKIP_DIRS.has(e.name)) continue;
			const isDot = e.name.startsWith(".") && e.name !== ".";
			if (isDot) {
				// 点目录：默认跳过；但白名单目录（.workbuddy）在开启时放行
				if (!includeDotDirs || !ALLOW_DOT_DIRS.has(e.name)) continue;
			}
			const full = join(dir, e.name);
			if (e.isDirectory()) await walk(full, depth + 1);
			else if (MD_EXT.has(e.name.slice(e.name.lastIndexOf(".")).toLowerCase())) files.push(full);
		}
	}
	await walk(vaultPath, 0);
	return files;
}

// ── BM25 索引 ───────────────────────────────────────────────────────
// 收藏/收集语料的识别与降权：这些是**外部收集**来的通用文档，不是用户自己的记录。
// 实测某真实 vault 中 60% 的 chunk 落在 `skills/_公网收集`，它们含大量通用技术词
// （token / api / workflow / security…），任何技术提问都会被它们挤占 topK，
// 用户自己的笔记反而落榜——这正是「我确定里面有，却搜不出来」的结构性原因。
// 降权系数 0.45：仍可在「就是要找公共资料」时召回，但不再压过自有笔记。
const VENDORED_WEIGHT = 0.45;
const VENDORED_DIR_HINTS = ["_公网收集", "_收集", "vendor", "third-party", "thirdparty", "node_modules", "site-packages"];

export function isVendoredPath(notePath) {
	const p = String(notePath || "").toLowerCase();
	if (VENDORED_DIR_HINTS.some((h) => p.includes(String(h).toLowerCase()))) return true;
	// 形如 skills/<作者>/<repo>/... 的第三方仓库克隆：以 `.git` 旁的 README/SKILL 集合为特征。
	// 只在明确的三段以上第三方 skill 路径下生效，避免误伤用户自建的 skills/。
	if (/^skills\/_[^/]+\//.test(p)) return true;
	return false;
}

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
		// 目录/索引类笔记降权：这类笔记是全库文件名清单，什么查询都命中，
		// 会把真正的正文笔记挤出 topK，模型拿到「原料」就只剩文件名列表。
		const isIndexLike = (title, text) => {
			const t = (title || "").toLowerCase();
			if (/目录|索引|moc|index|导航|sitemap|目录页/.test(t)) return true;
			// 正文里链接/文件名密度过高（每 30 字符就出现一个 [[...]] 或 .md）也算
			const links = (text.match(/\[\[/g) || []).length + (text.match(/\.md/g) || []).length;
			return text.length > 0 && links / (text.length / 30) > 0.8;
		};
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
			if (isIndexLike(c.noteTitle, c.text)) s *= 0.25; // 降权而不是剔除：真要找目录时仍能召回
			// 收藏语料降权：第三方收集来的文档（公开 skill 库、教程合集等）是**外部知识**，
			// 不是用户自己的记录。实测某 vault 里 60% 的 chunk 来自 `skills/_公网收集`，
			// 它们含大量通用技术词，把用户自己的笔记挤出 topK——用户视角就是
			// 「我笔记里明明有，它却找不出来」。降权而非剔除：真问这些主题时仍可召回。
			if (isVendoredPath(c.notePath)) s *= VENDORED_WEIGHT;
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
		// 字面串命中加权：问题里出现的「长词/标识符」（github_pat_、ghp_、某个专名、
		// 一段文件名）在正文里**原样出现**时，往往就是用户要找的那一块。
		// 两个都必须做：
		//   ① 对已有 BM25 候选加 bonus（提升排序）；
		//   ② **把只靠字面命中的 chunk 加进候选**——因为 tokenizer 会把
		//      `github_pat_11ABCDEFG…` 这类长串当成**一个 token**，用户粘贴它的前缀
		//      （或只记得前半段）时精确匹配失败、BM25 得 0，该 chunk 根本进不了候选集，
		//      于是「明明有却搜不到」（实测真实场景）。字面包含必须能独立召回。
		const literals = [];
		for (const m of String(query).matchAll(/[A-Za-z0-9_][A-Za-z0-9_.-]{5,}/g)) literals.push(m[0].toLowerCase());
		for (const m of String(query).matchAll(/[\u4e00-\u9fff]{3,}/g)) literals.push(m[0]);
		const uniqLiterals = [...new Set(literals)].slice(0, 8);
		if (uniqLiterals.length) {
			for (let i = 0; i < N; i++) {
				const c = this.chunks[i];
				if (!c || c.stale) continue;
				const hay = (c.text + "\n" + c.noteTitle + "\n" + (c.crumbs || "")).toLowerCase();
				let bonus = 0;
				for (const lit of uniqLiterals) if (hay.includes(lit)) bonus += 2.5;
				if (!bonus) continue;
				// 长串命中（≥12 字符）是强信号：粘贴凭据片段/完整文件名时希望它直接冒头
				if (uniqLiterals.some((lit) => lit.length >= 12 && hay.includes(lit))) bonus += 6;
				scores.set(i, (scores.get(i) || 0) + bonus);
			}
		}
		const ranked = [...scores.entries()]
			.sort((a, b2) => b2[1] - a[1]);
		// 按笔记分散：单篇最多 2 片进 topK。一篇长笔记的多个 chunk 会把 topK 全占，
		// 模型只看到一两篇原文，综合无从谈起；分散后多笔记多视角进入原料。
		const perNote = new Map();
		const picked = [];
		for (const [idx, score] of ranked) {
			const c = this.chunks[idx];
			const n = perNote.get(c.notePath) || 0;
			if (n >= 2) continue;
			perNote.set(c.notePath, n + 1);
			picked.push([idx, score]);
			if (picked.length >= topK) break;
		}
		const hits = picked
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
	// 展示优化：像 SKILL.md / README.md / index.md 这类**通用文件名**在库里成百上千，
	// 全部同名无法区分——标题改用父目录名（`skills/xxx/SKILL.md` → `xxx`），
	// 并给出去重后的显示路径（相对最近公共前缀）+ 目录，供侧栏分组与副标题用。
	listNotes({ limit = 500, sort = "mtime" } = {}) {
		const GENERIC = /^(skill|readme|index|index\.zh|notes?|main|docs?|untitled|未命名|新建文档|template|templates?)\.md$/i;
		const rows = [...this.byNote.values()].map((n) => {
			const dir = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
			const dirName = dir ? dir.slice(dir.lastIndexOf("/") + 1) : "";
			// 通用文件名 → 标题用父目录名（无父目录时才退回原名）
			const generic = GENERIC.test(n.title + ".md") || GENERIC.test(n.title);
			const display = generic && dirName ? dirName : n.title;
			return {
				path: n.path,
				title: n.title,
				display,
				generic,
				dir,
				dirName,
				// 副标题：目录路径（根目录为空），前端据 generic 决定是否显示完整路径
				sub: dir,
				aliases: n.aliases,
				tags: n.tags.slice(0, 6),
				mtimeMs: Math.round(n.mtimeMs),
			};
		});
		// 同名 display 去重：追加父目录上一级以区分（skills/A/SKILL.md vs skills/B/SKILL.md）
		const byDisplay = new Map();
		for (const r of rows) {
			const key = (r.display || "").toLowerCase();
			const list = byDisplay.get(key) || [];
			list.push(r);
			byDisplay.set(key, list);
		}
		for (const list of byDisplay.values()) {
			if (list.length < 2) continue;
			for (const r of list) {
				const segs = r.path.split("/");
				const parent = segs.length >= 2 ? segs[segs.length - 2] : "";
				const grand = segs.length >= 3 ? segs[segs.length - 3] : "";
				r.display = grand ? grand + "/" + parent : parent || r.display;
				r.ambiguous = true;
			}
		}
		if (sort === "name") rows.sort((a, b) => (a.display || "").localeCompare(b.display || "", "zh"));
		else if (sort === "path") rows.sort((a, b) => (a.dir || "").localeCompare(b.dir || "", "zh") || (a.display || "").localeCompare(b.display || "", "zh"));
		else rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
		return { notes: rows.slice(0, limit), total: rows.length };
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
