// vault.js 优化项测试（OPT-1.1 / 1.2 / 1.4 / 1.6 / 1.8 / 1.9 / 5.1）
//
// 与 test/vault.test.mjs 同风格：真实临时 vault + 真实 import，不切片源码。
// 覆盖点：
//   1.1 代码围栏内的 `# 标题` 不产生 chunk 边界
//   1.2 代码围栏内的 `#tag` 不进 tags
//   1.4 skipDirs / maxDepth / vendoredWeight / vendoredDirHints 可覆盖
//   1.6 readNote 拒绝非 MD_EXT 扩展名；超大文件报错含实际字节数
//   1.8 search 的 highlights（≤3 条）与 groupByNote 分组
//   1.9 listNotes 的 offset 翻页与 hasMore
//   5.1 readNote 用 realpath 终判：junction / 符号链接逃逸被拒、错误可诊断
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VaultIndex, chunkNote, isVendoredPath } from "../lib/vault.js";

// ── 临时 vault 工具 ─────────────────────────────────────────────────
async function makeVault() {
	const root = await mkdtemp(join(tmpdir(), "dsh-ob-opt-"));
	return root;
}

async function put(vault, relPath, content) {
	const full = join(vault, ...relPath.split("/"));
	await mkdir(join(full, ".."), { recursive: true });
	await writeFile(full, content, "utf8");
	return full;
}

async function indexed(vault, opts) {
	const idx = new VaultIndex(opts);
	await idx.ensureIndexed(vault);
	return idx;
}

function paths(idx) {
	return idx.listNotes({ limit: 2000 }).notes.map((n) => n.path);
}

// ── 1.1 代码围栏内不切 chunk ────────────────────────────────────────
test("OPT-1.1 围栏内的 `#` 行不产生 chunk 边界", () => {
	const note = {
		path: "a.md",
		title: "a",
		body: [
			"# 一级标题",
			"",
			"正文 A",
			"",
			"```bash",
			"# 这是 shell 注释，不是标题",
			"echo hi",
			"```",
			"",
			"正文 B",
		].join("\n"),
	};
	const chunks = chunkNote(note);
	assert.equal(chunks.length, 1, "围栏注释不应把笔记切成两片");
	assert.equal(chunks[0].heading, "一级标题");
	assert.ok(chunks[0].text.includes("正文 A") && chunks[0].text.includes("正文 B"));
	assert.ok(!chunks.some((c) => c.heading === "这是 shell 注释，不是标题"));
});

test("OPT-1.1 波浪号围栏同样生效，围栏外标题恢复切分", () => {
	const note = {
		path: "b.md",
		title: "b",
		body: [
			"# 甲",
			"",
			"~~~",
			"# 围栏内",
			"~~~",
			"",
			"# 乙",
			"",
			"正文乙",
		].join("\n"),
	};
	const chunks = chunkNote(note);
	assert.deepEqual(chunks.map((c) => c.heading), ["甲", "乙"]);
});

// ── 1.2 围栏内不提取标签 ────────────────────────────────────────────
test("OPT-1.2 代码围栏内的 #tag 不进 tags，正文标签仍生效", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "tagged.md", [
			"# 标签",
			"",
			"正文标签 #real-tag",
			"",
			"```js",
			"// #not-a-tag 只是注释",
			"const x = 1;",
			"```",
			"",
		].join("\n"));
		const idx = await indexed(vault);
		const row = idx.listNotes().notes.find((n) => n.path === "tagged.md");
		assert.ok(row, "笔记应入索引");
		assert.ok(row.tags.includes("real-tag"), "围栏外标签应保留：" + JSON.stringify(row.tags));
		assert.ok(!row.tags.includes("not-a-tag"), "围栏内伪标签应被排除：" + JSON.stringify(row.tags));
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

// ── 1.4 扫描/降权参数可覆盖 ─────────────────────────────────────────
test("OPT-1.4 skipDirs 可覆盖，且不传时缺省仍跳过 .git", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "keep/a.md", "# a\n\n正文 a\n");
		await put(vault, "custom-skip/b.md", "# b\n\n正文 b\n");
		await put(vault, "node_modules/c.md", "# c\n\n正文 c\n");

		const custom = await indexed(vault, { skipDirs: new Set(["custom-skip"]) });
		const customPaths = paths(custom);
		assert.ok(customPaths.includes("keep/a.md"));
		assert.ok(!customPaths.includes("custom-skip/b.md"), "自定义 skipDirs 应生效");
		assert.ok(customPaths.includes("node_modules/c.md"), "覆盖后 node_modules 不再被跳过（证明是整体替换）");

		const byDefault = await indexed(vault);
		const defaultPaths = paths(byDefault);
		assert.ok(defaultPaths.includes("custom-skip/b.md"), "缺省不跳过自定义目录");
		assert.ok(!defaultPaths.includes("node_modules/c.md"), "缺省仍跳过 node_modules");
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test("OPT-1.4 maxDepth 可覆盖", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "keep/a.md", "# a\n\n正文 a\n");
		await put(vault, "d1/d2/d3/deep.md", "# deep\n\n正文 deep\n");

		const shallow = await indexed(vault, { maxDepth: 1 });
		assert.ok(paths(shallow).includes("keep/a.md"));
		assert.ok(!paths(shallow).includes("d1/d2/d3/deep.md"), "超过 maxDepth 的笔记不应入索引");

		const deep = await indexed(vault, { maxDepth: 12 });
		assert.ok(paths(deep).includes("d1/d2/d3/deep.md"));
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test("OPT-1.4 vendoredWeight 可覆盖（1 = 不降权，得分更高）", async () => {
	const vault = await makeVault();
	try {
		const body = "# token\n\n" + "token api workflow security ".repeat(20);
		await put(vault, "skills/_公网收集/collected.md", body);

		const down = await indexed(vault);
		const flat = await indexed(vault, { vendoredWeight: 1 });
		const scoreDown = down.search("token").hits[0].score;
		const scoreFlat = flat.search("token").hits[0].score;
		assert.ok(scoreDown > 0 && scoreFlat > 0, "两例都应命中");
		assert.ok(scoreFlat > scoreDown, `不降权得分应更高：${scoreFlat} vs ${scoreDown}`);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test("OPT-1.4 vendoredDirHints 可覆盖", () => {
	assert.equal(isVendoredPath("skills/_公网收集/x.md"), true, "缺省线索仍生效");
	assert.equal(isVendoredPath("mydir/x.md"), false);
	assert.equal(isVendoredPath("mydir/x.md", ["mydir"]), true, "自定义线索应生效");
});

// ── 1.6 readNote 扩展名与体积校验 ───────────────────────────────────
test("OPT-1.6 readNote 拒绝非 markdown 扩展名", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "a.txt", "纯文本");
		await put(vault, "a.md", "# a\n\n正文\n");
		const idx = await indexed(vault);
		await assert.rejects(
			() => idx.readNote(vault, "a.txt"),
			(err) => /只允许读取 Markdown/.test(err.message) && /a\.txt/.test(err.message),
		);
		const ok = await idx.readNote(vault, "a.md");
		assert.ok(ok.content.includes("正文"));
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test("OPT-1.6 readNote 超限时报错含实际字节数", async () => {
	const vault = await makeVault();
	try {
		const content = "# big\n\n" + "x".repeat(400);
		await put(vault, "big.md", content);
		const idx = await indexed(vault, { maxNoteBytes: 100 });
		const bytes = Buffer.byteLength(content, "utf8");
		await assert.rejects(
			() => idx.readNote(vault, "big.md"),
			(err) => /笔记过大/.test(err.message) && err.message.includes(String(bytes)) && /100/.test(err.message),
			`错误文案应含实际字节数 ${bytes}`,
		);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

// ── 1.9 listNotes 翻页 ─────────────────────────────────────────────
test("OPT-1.9 listNotes 支持 offset 翻页与 hasMore", async () => {
	const vault = await makeVault();
	try {
		for (let i = 0; i < 5; i++) await put(vault, `n${i}.md`, `# n${i}\n\n正文 ${i}\n`);
		const idx = await indexed(vault);

		// 不传 offset = 旧行为：offset 恒为 0、hasMore 恒为 false
		const legacy = idx.listNotes({ limit: 2 });
		assert.equal(legacy.notes.length, 2);
		assert.equal(legacy.total, 5);
		assert.equal(legacy.offset, 0);
		assert.equal(legacy.hasMore, false);

		// 缺省 limit 仍是 500
		assert.equal(idx.listNotes().notes.length, 5);

		const p1 = idx.listNotes({ limit: 2, offset: 2 });
		assert.equal(p1.offset, 2);
		assert.equal(p1.notes.length, 2);
		assert.equal(p1.hasMore, true);

		const p2 = idx.listNotes({ limit: 2, offset: 4 });
		assert.equal(p2.notes.length, 1);
		assert.equal(p2.hasMore, false, "翻到末页仍有剩余时才算 hasMore");

		// 分页拼接应等于全量顺序（顺序稳定）
		const all = idx.listNotes().notes.map((n) => n.path);
		const paged = [
			...idx.listNotes({ limit: 2, offset: 0 }).notes,
			...idx.listNotes({ limit: 2, offset: 2 }).notes,
			...idx.listNotes({ limit: 2, offset: 4 }).notes,
		].map((n) => n.path);
		assert.deepEqual(paged, all);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

// ── 1.8 highlights 与按笔记聚合 ─────────────────────────────────────
test("OPT-1.8 search 返回 highlights（≤3 条）且保留 snippet", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "rag.md", "# RAG\n\n" + "检索增强生成（RAG）把检索结果拼进上下文。".repeat(6) + "\n");
		const idx = await indexed(vault);

		const r = idx.search("检索增强");
		assert.ok(r.hits.length > 0, "应有命中");
		const h = r.hits[0];
		assert.ok(Array.isArray(h.highlights), "highlights 必须是数组");
		assert.ok(h.highlights.length > 0, "命中项应有高亮上下文");
		assert.ok(h.highlights.length <= 3, "高亮最多 3 条，实际 " + h.highlights.length);
		assert.equal(typeof h.snippet, "string");
		assert.ok(h.snippet.length > 0, "snippet 必须与 highlights 并存");

		// 无命中的查询：hits 为空，不产生异常
		const none = idx.search("完全不存在的词组xyzzy");
		assert.deepEqual(none.hits, []);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test("OPT-1.8 groupByNote 为真时才出现 grouped", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "a.md", "# a\n\nalpha beta\n");
		await put(vault, "b.md", "# b\n\nalpha gamma\n");
		const idx = await indexed(vault);

		const plain = idx.search("alpha");
		assert.ok(!("grouped" in plain), "缺省不应出现 grouped 键");

		const grouped = idx.search("alpha", { groupByNote: true });
		assert.ok(grouped.grouped && Array.isArray(grouped.grouped.notes), "应在 grouped.notes 返回聚合");
		assert.ok(grouped.grouped.notes.length > 0);
		const g = grouped.grouped.notes[0];
		assert.equal(typeof g.notePath, "string");
		assert.equal(typeof g.noteTitle, "string");
		assert.equal(typeof g.bestScore, "number");
		assert.ok(Array.isArray(g.hits) && g.hits.length > 0);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

// ── 5.1 readNote 的 realpath 终判 ──────────────────────────────────
// 造一个指向 vault 外的 junction/符号链接；`join()` 拼出来的路径前缀仍长在 vault 下，
// 纯字符串前缀比对会放行，只有 realpath 归一化后才能发现真实文件在 vault 外。
async function makeEscapeLink(vault) {
	const outside = await mkdtemp(join(tmpdir(), "dsh-ob-escape-out-"));
	await writeFile(join(outside, "secret.md"), "# 机密\n\nvault 外内容\n", "utf8");
	const link = join(vault, "linkout");
	await symlink(outside, link, "junction");
	return { outside, link };
}

test("OPT-5.1 realpath 拒绝符号链接/junction 逃逸出 vault", async (t) => {
	const vault = await makeVault();
	let outside = null;
	try {
		await put(vault, "plain.md", "# 正常\n\n正文\n");
		try {
			({ outside } = await makeEscapeLink(vault));
		} catch (err) {
			// 无符号链接权限的环境：跳过而不是假绿
			t.skip(`当前环境无法创建目录链接：${err && err.code}`);
			return;
		}
		const idx = new VaultIndex();
		await assert.rejects(
			() => idx.readNote(vault, "linkout/secret.md"),
			(err) => /越出 vault 范围/.test(err.message) && /linkout\/secret\.md/.test(err.message),
			"junction 逃逸必须被 realpath 拦下",
		);
		// 反斜杠写法同样要拦（Windows 上两种分隔符都合法）
		await assert.rejects(
			() => idx.readNote(vault, "linkout\\secret.md"),
			(err) => /越出 vault 范围/.test(err.message),
		);
		// 正向不回归：vault 内的普通笔记仍应读得到
		const ok = await idx.readNote(vault, "plain.md");
		assert.ok(ok.content.includes("正文"));
	} finally {
		try { await rm(join(vault, "linkout"), { force: true }); } catch { /* 目录链接可能需先 rmdir */ }
		await rm(vault, { recursive: true, force: true });
		if (outside) await rm(outside, { recursive: true, force: true });
	}
});

test("OPT-5.1 目标不存在 / vault 路径不存在都给出可诊断错误", async () => {
	const vault = await makeVault();
	try {
		await put(vault, "plain.md", "# a\n\n正文\n");
		const idx = new VaultIndex();

		// 目标不存在：明确「笔记不存在」，不能吞成成功
		await assert.rejects(
			() => idx.readNote(vault, "nope.md"),
			(err) => /笔记不存在/.test(err.message) && /nope\.md/.test(err.message),
		);

		// vault 路径不存在：给可诊断错误，不抛原始 ENOENT
		const missing = join(vault, "no-such-vault");
		await assert.rejects(
			() => idx.readNote(missing, "plain.md"),
			(err) => /vault 路径不可用/.test(err.message) && /no-such-vault/.test(err.message) && /ENOENT/.test(err.message),
		);

		// 前置快筛顺序不变：`..` 与扩展名白名单仍先于任何 IO 生效
		await assert.rejects(() => idx.readNote(vault, "../outside.md"), /路径不允许包含 \.\./);
		await put(vault, "a.txt", "纯文本");
		await assert.rejects(() => idx.readNote(vault, "a.txt"), /只允许读取 Markdown/);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});
