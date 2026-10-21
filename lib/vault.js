// dsh-obsidian-board — 本地 vault 索引器（零依赖，纯 Node）。
//
// 设计取舍：
// - Obsidian vault 本质是 .md 文件目录，索引器不依赖 Obsidian 运行，也不要求 vault 结构；
// - 检索用 BM25（k1=1.2, b=0.75）+ 标题/路径命中加权 + Obsidian 别名/标签感知，
//   对中文按 bigram 切词、其他按词干化小写词切词——这是「能完全离线跑」与
//   「召回质量可用」之间的平衡点；embedding 属于二期（宿主里跑 transformers.js），接口留好；
// - chunk 按 markdown 结构切（标题层级），单 chunk 超长再按段落硬切，保留标题面包屑；
// - 索引常驻内存 + mtime 增量刷新：本机实测（合成库 10k 笔记 / 40k chunk，Node 24）全量索引约
//   2s；单篇「构建 + 提交 + 重算统计」约 50ms。
//   注意口径：全量 scan + 逐文件 stat 是 _incremental 的大头（同一库端到端约 0.9–1.0s），
//   别把 50ms 当端到端耗时；监走走 §8.1 定向路径（只重建事件里那一篇），
//   实测保存后可检索约 0.2–0.26s（含 150ms 合并窗口），定位不到单篇时才退回全量。

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

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

// ── 代码围栏状态机（OPT-1.1 / OPT-1.2）─────────────────────────────
// markdown 的 ``` / ~~~ 围栏里是**代码原文**，不是文档结构：里面的 `# 注释`
// 不是标题、`#tag` 不是标签。基线版本没有这个状态机，笔记里一段 shell 注释
// 就能把 chunk 切碎（检索得分被稀释）、把伪标签塞进标签集合。
// 返回闭包：每调用一次吞掉一行，返回该行是否处于围栏内（分隔行本身也算围栏内）。
function createFenceTracker() {
	let char = "";
	let len = 0;
	return (line) => {
		const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (!char) {
			if (!m) return false;
			char = m[1][0];
			len = m[1].length;
			return true;
		}
		// 收尾围栏：字符相同、长度不短于开头，且其后没有信息串
		if (m && m[1][0] === char && m[1].length >= len && !m[2].trim()) { char = ""; len = 0; }
		return true;
	};
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
		const lines = frontmatter.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			// OPT-1.3：只认 `tags:` 键本身（允许缩进），不再整块扫 `- item`——
			// 基线会把 `related:` / `authors:` 等任意列表项误当标签。
			const m = /^\s*tags\s*:\s*(.*)$/.exec(lines[i]);
			if (!m) continue;
			// 行内写法：tags: [AI, RAG] / tags: ai, rag
			for (const t of m[1].matchAll(/[\w\u4e00-\u9fff/-]+/g)) tags.add(t[0].toLowerCase());
			// 块列表写法：紧跟在 tags: 之后的行首 `- item`（YAML 允许顶格或缩进）
			for (let j = i + 1; j < lines.length; j++) {
				if (/^\s*$/.test(lines[j])) break;
				const li = /^\s*-\s+([\w\u4e00-\u9fff/-]+)\s*$/.exec(lines[j]);
				if (!li) break;
				tags.add(li[1].toLowerCase());
			}
		}
	}
	// OPT-1.2：正文标签只从围栏外提取，代码块里的 #tag 不算标签。
	const track = createFenceTracker();
	const kept = [];
	for (const line of body.split(/\r?\n/)) if (!track(line)) kept.push(line);
	for (const m of kept.join("\n").matchAll(/(^|\s)#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/-]*)/g)) tags.add(m[2].toLowerCase());
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
	const inFence = createFenceTracker();
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
		// OPT-1.1：围栏内的 `#` 是注释，不是标题边界。
		const fenced = inFence(line);
		const hm = fenced ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
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
// scanVault 内用同名局部变量承载「可覆盖的活动白名单」，其缺省值需在遮蔽前留存。
const ALLOW_DOT_DIRS_DEFAULT = ALLOW_DOT_DIRS;
const DEFAULT_MAX_DEPTH = 12;

// OPT-1.4：扫描参数全部可覆盖；缺省值 = 基线硬编码值（行为逐字节等价）。
// 对外签名保持 `(vaultPath, { includeDotDirs })` 形态——`recall-and-source.test.mjs`
// 用源码正则锁定这一行，属不可破坏契约；skipDirs / allowDotDirs / maxDepth 从
// 同一个 opts 对象读取（用 arguments 取回整份 opts，避免签名膨胀）。
export async function scanVault(vaultPath, { includeDotDirs = true } = {}) {
	const opts = arguments[1] ?? {};
	const skipDirs = opts.skipDirs ?? SKIP_DIRS;
	// 局部 ALLOW_DOT_DIRS 遮蔽模块级同名常量：既让白名单可被 opts 覆盖，
	// 又保留 `ALLOW_DOT_DIRS.has(...)` 这行既有形态（测试对它做源码正则断言）。
	const ALLOW_DOT_DIRS = opts.allowDotDirs ?? ALLOW_DOT_DIRS_DEFAULT;
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
	const files = [];
	async function walk(dir, depth) {
		if (depth > maxDepth) return;
		let entries;
		try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (skipDirs.has(e.name)) continue;
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
const DEFAULT_MAX_NOTE_BYTES = 2 * 1024 * 1024;
const DEFAULT_READ_CONCURRENCY = 8;
// 定向重建单篇约 50ms（见 promo/qa/bench-results.log），抖动窗口没必要拉到 500ms：
// 保存后 150ms 就开始重建，编辑连续保存时仍会在窗口里合并（每次写入都命中同一待处理集合）。
const DEFAULT_WATCH_DEBOUNCE_MS = 150;
// rename 类事件分不清「新增 / 删除 / 改名」，定向处理之后还要跑一次全量增量对账；
// 对账窗口给得长一些，把一次批量移动（如 Obsidian 重命名带 temp 文件的交换）合并成一轮。
const DEFAULT_WATCH_RECONCILE_MS = 1200;

export function isVendoredPath(notePath, hints = VENDORED_DIR_HINTS) {
	const p = String(notePath || "").toLowerCase();
	if (hints.some((h) => p.includes(String(h).toLowerCase()))) return true;
	// 形如 skills/<作者>/<repo>/... 的第三方仓库克隆：以 `.git` 旁的 README/SKILL 集合为特征。
	// 只在明确的三段以上第三方 skill 路径下生效，避免误伤用户自建的 skills/。
	if (/^skills\/_[^/]+\//.test(p)) return true;
	return false;
}

// ── 工具：有界并发 / HTML 转义 ───────────────────────────────────────
// OPT-1.7：并发池。结果按输入下标回填，调用方按原顺序提交即与串行实现完全一致。
async function mapPool(items, concurrency, worker) {
	const results = new Array(items.length);
	const width = Math.max(1, Math.min(Math.trunc(concurrency) || 1, items.length || 1));
	let cursor = 0;
	const runners = [];
	for (let n = 0; n < width; n++) {
		runners.push((async () => {
			for (;;) {
				const i = cursor++;
				if (i >= items.length) return;
				results[i] = await worker(items[i], i);
			}
		})());
	}
	await Promise.all(runners);
	return results;
}

function escapeHtml(text) {
	return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class VaultIndex {
	// OPT-1.4：全部可覆盖，缺省值 = 基线硬编码值。
	constructor({
		skipDirs = SKIP_DIRS,
		allowDotDirs = ALLOW_DOT_DIRS,
		maxDepth = DEFAULT_MAX_DEPTH,
		vendoredWeight = VENDORED_WEIGHT,
		vendoredDirHints = VENDORED_DIR_HINTS,
		maxNoteBytes = DEFAULT_MAX_NOTE_BYTES,
		readConcurrency = DEFAULT_READ_CONCURRENCY,
		watchDebounceMs = DEFAULT_WATCH_DEBOUNCE_MS,
		watchReconcileMs = DEFAULT_WATCH_RECONCILE_MS,
	} = {}) {
		this.skipDirs = skipDirs instanceof Set ? skipDirs : new Set(skipDirs ?? SKIP_DIRS);
		this.allowDotDirs = allowDotDirs instanceof Set ? allowDotDirs : new Set(allowDotDirs ?? ALLOW_DOT_DIRS);
		this.maxDepth = maxDepth;
		this.vendoredWeight = vendoredWeight;
		this.vendoredDirHints = Array.isArray(vendoredDirHints) ? vendoredDirHints : VENDORED_DIR_HINTS;
		this.maxNoteBytes = maxNoteBytes;
		this.readConcurrency = Math.max(1, Math.trunc(readConcurrency) || 1);
		this.watchDebounceMs = Math.max(0, Number(watchDebounceMs) || 0);
		this.watchReconcileMs = Math.max(0, Number(watchReconcileMs) || 0);
		this.vaultPath = "";
		this.chunks = [];        // {notePath, noteTitle, crumbs, heading, text, tokens: Map, len}
		this.byNote = new Map(); // notePath -> {title, mtimeMs, aliases, tags, chunkIdx: []}
		this.df = new Map();     // token -> doc count
		this.avgLen = 0;
		this.builtAt = 0;
		this.scanning = false;
		this._watcher = null;
		this._watchTimer = null;
		this._watchVaultPath = "";
		this._watchError = "";
		// 定向监听状态：待重建的绝对路径集合 + 「需要一次全量对账」标记（rename/删除/越界/null
		// 文件名都可能让「哪篇变了」不可知，对账兜住这批定向处理覆盖不到的删改）。
		this._watchPending = new Set();
		this._watchNeedFull = false;
	}

	async ensureIndexed(vaultPath, { force = false } = {}) {
		if (this.scanning) return { queued: true };
		// 全量 / 增量 / 定向三类重建共用同一把 scanning 互斥锁：以前「已建过就轻量增量」这条
		// 快捷分支不进锁，监听器与查询路径可以并发跑两份 _incremental，两份交替 drop/commit +
		// _recomputeStats 压实 chunks 时会互相踩索引。定向重建落地后重建更频繁，这个竞态必须堵掉。
		this.scanning = true;
		try {
			if (!force && this.builtAt && this.vaultPath === vaultPath) await this._incremental(vaultPath);
			else if (force || this.vaultPath !== vaultPath) await this._full(vaultPath);
			else await this._incremental(vaultPath);
		} finally {
			this.scanning = false;
		}
		return { queued: false };
	}

	_scan(vaultPath) {
		return scanVault(vaultPath, {
			skipDirs: this.skipDirs,
			allowDotDirs: this.allowDotDirs,
			maxDepth: this.maxDepth,
		});
	}

	async _full(vaultPath) {
		this.vaultPath = vaultPath;
		this.chunks = [];
		this.byNote = new Map();
		this.df = new Map();
		const files = await this._scan(vaultPath);
		// OPT-1.7：有界并发读文件；提交严格按 files 顺序，chunk 顺序与串行实现逐字节一致。
		const built = await mapPool(files, this.readConcurrency, (file) => this._safeBuild(file, vaultPath));
		for (let i = 0; i < files.length; i++) if (built[i]) this._commitNote(built[i]);
		this._recomputeStats();
		this.builtAt = Date.now();
	}

	async _incremental(vaultPath) {
		const files = await this._scan(vaultPath);
		const seen = new Set();
		const mtimes = await mapPool(files, this.readConcurrency, async (file) => {
			try { return (await stat(file)).mtimeMs; } catch { return null; }
		});
		const dirty = [];
		for (let i = 0; i < files.length; i++) {
			seen.add(files[i]);
			if (mtimes[i] === null) continue;
			const rec = this.byNote.get(files[i]);
			if (!rec || rec.mtimeMs !== mtimes[i]) dirty.push(files[i]);
		}
		const built = await mapPool(dirty, this.readConcurrency, (file) => this._safeBuild(file, vaultPath));
		for (let i = 0; i < dirty.length; i++) {
			// 先标记旧 chunk 为孤儿再提交新 chunk：与基线的「drop+index 逐文件交替」等价
			// （孤儿只在 _recomputeStats 里压实，追加顺序不受影响）。
			this._dropNote(dirty[i]);
			if (built[i]) this._commitNote(built[i]);
		}
		let dirtyAny = dirty.length > 0;
		for (const path of [...this.byNote.keys()]) {
			if (!seen.has(path)) { this._dropNote(path); dirtyAny = true; }
		}
		if (dirtyAny) { this._recomputeStats(); this.builtAt = Date.now(); }
	}

	// OPT-1.7：读+切分成纯数据，不碰实例状态，才能并发。
	async _buildNote(file, vaultPath) {
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
		const chunks = chunkNote({ path: rel, title, body }).map((chunk) => {
			// 标题面包屑重复进正文计权：标题词在检索里更重。
			const boost = note.title + "\n" + chunk.crumbs + "\n" + chunk.heading;
			const tokenList = tokenize(boost + "\n" + chunk.text);
			const tokens = new Map();
			for (const t of tokenList) tokens.set(t, (tokens.get(t) || 0) + 1);
			return { ...chunk, tokens, len: tokenList.length };
		});
		return { file, note, chunks };
	}

	async _safeBuild(file, vaultPath) {
		try { return await this._buildNote(file, vaultPath); } catch { return null; /* 单文件失败不拖垮全量 */ }
	}

	_commitNote({ file, note, chunks }) {
		for (const chunk of chunks) {
			note.chunkIdx.push(this.chunks.length);
			this.chunks.push(chunk);
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

	_isVendored(notePath) {
		return isVendoredPath(notePath, this.vendoredDirHints);
	}

	// ── 检索 ────────────────────────────────────────────────────────
	// BM25 + 标题/别名命中加分 + 标签命中加分。topK 默认 8。
	// OPT-1.8：groupByNote 为真时追加 grouped（按笔记聚合），缺省不出现该键。
	search(query, { topK = 8, tagBoost = 3, titleBoost = 8, groupByNote = false } = {}) {
		if (!this.chunks.length || !query.trim()) {
			const empty = { hits: [], noteCount: this.byNote.size, chunkCount: this.chunks.length };
			if (groupByNote) empty.grouped = { notes: [] };
			return empty;
		}
		const N = this.chunks.length;
		const k1 = 1.2, b = 0.75;
		// OPT-1.4：降权系数与目录线索可由实例覆盖。绑定成本地名，热循环里不重复取属性，
		// 同时保留下面那行既有算式形态（recall-and-source.test 对它有源码断言）。
		const VENDORED_WEIGHT = this.vendoredWeight;
		const isVendoredPath = (notePath) => this._isVendored(notePath);
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
		// OPT-1.8：命中词上下文高亮。长词优先（更有信息量），最多 3 条，与 snippet 并存。
		const hlTerms = [...new Set([...uniqLiterals, ...qTokens])]
			.filter((t) => String(t).length >= 2)
			.sort((a, b2) => b2.length - a.length)
			.slice(0, 16)
			.map((t) => String(t).toLowerCase());
		const buildHighlights = (text) => {
			const out = [];
			if (!text) return out;
			const lower = text.toLowerCase();
			for (const term of hlTerms) {
				const at = lower.indexOf(term);
				if (at < 0) continue;
				const ctxStart = Math.max(0, at - 36);
				const ctxEnd = Math.min(text.length, at + term.length + 36);
				const marked = escapeHtml(text.slice(ctxStart, at))
					+ "<mark>" + escapeHtml(text.slice(at, at + term.length)) + "</mark>"
					+ escapeHtml(text.slice(at + term.length, ctxEnd));
				const flat = (ctxStart > 0 ? "…" : "") + marked.replace(/\s+/g, " ") + (ctxEnd < text.length ? "…" : "");
				if (!out.includes(flat)) out.push(flat);
				if (out.length >= 3) break;
			}
			return out;
		};
		const hits = picked
			.map(([idx, score]) => {
				const c = this.chunks[idx];
				return {
					notePath: c.notePath,
					noteTitle: c.noteTitle,
					heading: c.crumbs || c.heading,
					snippet: c.text.length > 500 ? c.text.slice(0, 500) + "…" : c.text,
					text: c.text,
					highlights: buildHighlights(c.text),
					score: Math.round(score * 100) / 100,
				};
			});
		const result = { hits, noteCount: this.byNote.size, chunkCount: this.chunks.length };
		if (groupByNote) {
			const byNote = new Map();
			const order = [];
			for (const h of hits) {
				let g = byNote.get(h.notePath);
				if (!g) {
					g = { notePath: h.notePath, noteTitle: h.noteTitle, bestScore: h.score, hits: [] };
					byNote.set(h.notePath, g);
					order.push(g);
				}
				g.hits.push(h);
				if (h.score > g.bestScore) g.bestScore = h.score;
			}
			order.sort((a, b2) => b2.bestScore - a.bestScore);
			result.grouped = { notes: order };
		}
		return result;
	}

	// 笔记列表（侧栏浏览器用）
	// 展示优化：像 SKILL.md / README.md / index.md 这类**通用文件名**在库里成百上千，
	// 全部同名无法区分——标题改用父目录名（`skills/xxx/SKILL.md` → `xxx`），
	// 并给出去重后的显示路径（相对最近公共前缀）+ 目录，供侧栏分组与副标题用。
	// OPT-1.9：offset 翻页 + hasMore；limit 上限放宽到 2000（缺省仍 500）。
	// 未传 offset = 旧行为（offset 0 且 hasMore false），老调用方看到的结构不变。
	listNotes({ limit = 500, offset, sort = "mtime" } = {}) {
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
		const paged = offset !== undefined && offset !== null;
		const off = paged ? Math.max(0, Math.trunc(Number(offset)) || 0) : 0;
		const lim = Number.isFinite(limit) ? Math.min(2000, Math.max(0, Math.trunc(limit))) : 500;
		const page = rows.slice(off, off + lim);
		return { notes: page, total: rows.length, offset: off, hasMore: paged && off + page.length < rows.length };
	}

	// 读整篇笔记（引用展开用）
	// OPT-1.6：只允许 MD_EXT 内扩展名；超过 maxNoteBytes 抛明确错误（含实际字节数）。
	// OPT-5.1：为什么快筛之后仍需 realpath —— join() 只做字符串拼接，`linkout -> ../outside`
	//   这种符号链接/junction 会让拼出来的路径前缀仍长在 vault 之下（字符串看着合法），
	//   但真实文件早已在 vault 外；Windows 的 8.3 短名同理只是字符串层面的别名。
	//   所以顺序是：快筛（拒绝 `..` → 前缀比对 → 扩展名白名单 → 体积上限）先挡掉绝大多数
	//   垃圾输入且零 IO 成本，再用 realpath 把「vault 根」与「实际目标」两侧都归一化为真实
	//   路径做终判；归一化后仍以 `realVault + sep` 前缀比对，避免 `/vault-evil` 冒充 `/vault`。
	async readNote(vaultPath, relPath) {
		const safe = String(relPath ?? "").split("/").join(sep);
		if (safe.includes("..")) throw new Error("路径不允许包含 ..");
		// 先归一化 vault 根（去掉尾部分隔符、相对路径转绝对），否则 `D:\vault\` 这种配置
		// 会让 `vaultPath + sep` 变成双分隔符，把合法笔记误判成越界。
		const rootAbs = resolve(String(vaultPath ?? ""));
		const full = join(rootAbs, safe);
		// 快筛 1：字符串层面必须仍在 vault 内（低成本，先挡畸形输入）
		if (!full.startsWith(rootAbs + sep) && full !== rootAbs) throw new Error("路径越出 vault 范围");
		const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
		if (!MD_EXT.has(ext)) throw new Error(`只允许读取 Markdown 笔记（${[...MD_EXT].join(" / ")}），收到：${relPath}`);

		// 终判 1：vault 根自身必须可解析。用户把仓库位置配错时给可诊断错误，而不是原始 ENOENT。
		let realVault;
		try {
			realVault = await realpath(rootAbs);
		} catch (err) {
			const code = (err && err.code) || "UNKNOWN";
			throw new Error(`vault 路径不可用：${vaultPath}（${code}）——请检查配置的仓库位置是否存在且可读`);
		}

		// 终判 2：目标必须真实存在。不存在要报「笔记不存在」，绝不能把 ENOENT 吞成成功。
		let realTarget;
		try {
			realTarget = await realpath(full);
		} catch (err) {
			if (err && err.code === "ENOENT") throw new Error(`笔记不存在：${relPath}`);
			const code = (err && err.code) || "UNKNOWN";
			throw new Error(`无法解析笔记路径：${relPath}（${code}）`);
		}

		// 终判 3：归一化后的真实路径仍必须落在 vault 根内——这才是挡 junction / 符号链接逃逸的那道闸。
		if (realTarget !== realVault && !realTarget.startsWith(realVault + sep)) {
			throw new Error(`路径越出 vault 范围（真实路径解析后）：${relPath}`);
		}

		const info = await stat(realTarget);
		if (!info.isFile()) throw new Error(`不是普通文件：${relPath}`);
		if (info.size > this.maxNoteBytes) {
			throw new Error(`笔记过大：${info.size} 字节，超过上限 ${this.maxNoteBytes} 字节（可调整 VaultIndex 的 maxNoteBytes）`);
		}
		const raw = await readFile(realTarget, "utf8");
		return { path: relPath, content: raw, mtimeMs: Math.round(info.mtimeMs) };
	}

	// OPT-1.5：可选的文件监听。默认不启用，由上层显式 watch() 打开。
	// §8.1：能定位到具体笔记时只重建那一篇（定向），定位不了才回到全量增量扫描。
	// debounce（定向 150ms / 对账 1200ms）合并编辑抖动，只对 .md/.markdown 触发。
	watch(vaultPath = this.vaultPath) {
		this.unwatch();
		if (!vaultPath) throw new Error("watch 需要 vault 路径");
		this._watchVaultPath = vaultPath;
		// 路径运算一律用归一化后的绝对根；ensureIndexed 仍收原始 vaultPath（与 index.vaultPath
		// 同值），否则会因字符串不同触发一次无谓的全量重建。
		const rootAbs = resolve(vaultPath);
		let watcher;
		try {
			watcher = fsWatch(rootAbs, { recursive: true }, (event, filename) => {
				this._onWatchEvent(rootAbs, event, filename);
			});
		} catch (err) {
			this._watchVaultPath = "";
			throw new Error(`无法监听 vault（${vaultPath}）：${err?.message || err}`);
		}
		watcher.on("error", (err) => {
			this._watchError = String(err?.message || err);
			this.unwatch();
		});
		if (typeof watcher.unref === "function") watcher.unref();
		this._watchError = "";
		this._watcher = watcher;
		return { watching: true, vaultPath, debounceMs: this.watchDebounceMs, reconcileMs: this.watchReconcileMs };
	}

	// 单个事件 → 「定向可行？」的判定。判据只有两条硬条件：拿得到文件名、且解析后仍在 vault 内。
	// 其余（rename 语义歧义、null 文件名、目录、越界）统统退回全量对账，不猜。
	_onWatchEvent(rootAbs, event, filename) {
		// Windows 的 recursive watch 在批量/目录变动时会给 null；macOS 偶发不给名字。
		if (!filename) {
			this._watchNeedFull = true;
			this._scheduleWatchRescan();
			return;
		}
		const name = String(filename).replace(/[\\/]+$/, "");
		if (!name) return;
		const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
		if (!MD_EXT.has(ext)) return; // 非笔记：保持旧行为，完全不触发重建
		const abs = resolve(rootAbs, name);
		// 越界防线：filename 理论上只是相对路径，但 `..\` / 绝对名 / 符号链接目录都能把路径带出
		// vault（A8）。越界就不进定向集合，交给全量扫描按 skipDirs 规则处理，绝不索引 vault 外文件。
		if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
			this._watchNeedFull = true;
			this._scheduleWatchRescan();
			return;
		}
		this._watchPending.add(abs);
		// rename 同时覆盖「新建 / 删除 / 改名」，单看一个名字分不清是哪一个：定向处理让新路径立刻可查，
		// 对账负责捡回消失的旧路径（改名出去的孤儿只能靠 scan 比对发现）。
		if (event === "rename") this._watchNeedFull = true;
		this._scheduleWatchTargeted();
	}

	// 定向重建窗口：把 debounce 期间出现过的路径各重建一次。
	_scheduleWatchTargeted() {
		if (this._watchTimer) return; // 窗口已在：本批路径已入 _watchPending，无需另起
		this._watchTimer = setTimeout(async () => {
			this._watchTimer = null;
			if (this.scanning) {
				// 有重建在跑（查询路径或全量对账）：等它结束，同一窗口稍后再收。
				this._scheduleWatchTargeted();
				return;
			}
			const files = [...this._watchPending];
			this._watchPending.clear();
			if (files.length) {
				this.scanning = true; // 与全量/查询路径互斥，见 ensureIndexed 注释
				try {
					const vault = this._watchVaultPath;
					const built = await mapPool(files, this.readConcurrency, (file) => this._safeBuild(file, vault));
					for (let i = 0; i < files.length; i++) {
						// 先标孤儿再提交：与 _incremental 的 drop+index 顺序一致（压实只在 _recomputeStats）。
						this._dropNote(files[i]);
						if (built[i]) this._commitNote(built[i]);
						else this._watchNeedFull = true; // 读不到＝已删/改名出去/瞬时占用：交给对账复核
					}
					this._recomputeStats();
					this.builtAt = Date.now();
				} catch (err) {
					this._watchError = String(err?.message || err);
				} finally {
					this.scanning = false;
				}
			}
			if (this._watchNeedFull) this._scheduleWatchRescan();
		}, this.watchDebounceMs);
		if (typeof this._watchTimer.unref === "function") this._watchTimer.unref();
	}

	_scheduleWatchRescan() {
		if (this._watchTimer) return;
		this._watchTimer = setTimeout(async () => {
			this._watchTimer = null;
			const vault = this._watchVaultPath;
			if (!vault) return;
			this._watchNeedFull = false; // 先清标记：扫描期间新到的事件会重新置位（不丢）
			try {
				const r = await this.ensureIndexed(vault);
				// 扫描进行中：等这一轮结束再合并一次，避免漏掉本批改动。
				if (r && r.queued) this._scheduleWatchRescan();
			} catch (err) {
				this._watchError = String(err?.message || err);
			}
		}, this.watchReconcileMs);
		if (typeof this._watchTimer.unref === "function") this._watchTimer.unref();
	}

	unwatch() {
		if (this._watchTimer) { clearTimeout(this._watchTimer); this._watchTimer = null; }
		if (this._watcher) { this._watcher.close(); this._watcher = null; }
		this._watchVaultPath = "";
		this._watchPending.clear();
		this._watchNeedFull = false;
		return { watching: false };
	}

	status() {
		return {
			vaultPath: this.vaultPath,
			noteCount: this.byNote.size,
			chunkCount: this.chunks.length,
			builtAt: this.builtAt,
			scanning: this.scanning,
			engine: "bm25-cjk-bigram",
			watching: !!this._watcher,
			watchError: this._watchError,
		};
	}
}
