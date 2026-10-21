// §8.1 定向增量监听：fs.watch 给出可定位的 .md 文件名时，只重建那一篇；
// 定位不了（null 文件名 / 越界 / rename 歧义 / 读失败）退回全量增量对账，不猜。
//
// 为什么要改：旧实现任何事件都跑 ensureIndexed → 全量 scan + 逐文件 stat，
// 10k 库实测端到端 ≈1.5s（含 500ms debounce），宣传里说的「50ms」只是单篇构建+提交。
// 顺带修掉的竞态：ensureIndexed 的「已建过就轻量增量」快捷分支原先不进 scanning 互斥锁，
// 监听器与查询路径可以并发跑两份 _incremental，交替 drop/commit + 压实 chunks 会互相踩索引。
//
// 风格与 test/vault-opt.test.mjs 一致：真实临时 vault + 真实 import；事件用真实 fs.watch 跑一遍，
// 逻辑分支用 _onWatchEvent 直接投喂（确定性好），全量/定向的区分靠 _scan 调用计数判定。
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { VaultIndex } from "../lib/vault.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeVault() {
	return await mkdtemp(join(tmpdir(), "dsh-ob-watch-"));
}

async function put(vault, relPath, content) {
	const full = join(vault, ...relPath.split("/"));
	await mkdir(join(full, ".."), { recursive: true });
	await writeFile(full, content, "utf8");
	return full;
}

// 将 _scan 计数包起来：调用它 = 走了一次全量目录扫描（定向路径不该碰）。
function countScans(idx) {
	const orig = idx._scan.bind(idx);
	const box = { n: 0 };
	idx._scan = (v) => { box.n++; return orig(v); };
	return box;
}

// 打开真实 watcher（建立 _watchVaultPath 等内部状态），随后立刻关掉 fd：事件改由
// _onWatchEvent 直接投喂，每条断言只对应一个已知事件，不受临时目录里其它写入的干扰。
// 真实 watcher 的端到端由 OPT-6.10 单独覆盖（不关掉 fd）。
function armWatch(idx, root) {
	idx.watch(root);
	if (idx._watcher) { idx._watcher.close(); idx._watcher = null; }
	return idx;
}

// 等 builtAt 变化（一次重建落地），最长 deadline 毫秒；超时返回 false 供断言。
async function waitRebuild(idx, before, deadline = 4000) {
	const t0 = Date.now();
	while (Date.now() - t0 < deadline) {
		if (idx.status().builtAt !== before) return true;
		await sleep(20);
	}
	return false;
}

// ── 1. 默认档位与可覆盖 ─────────────────────────────────────────────
test("OPT-6.1 默认 debounce 降到 150ms，且构造参数可覆盖", () => {
	const def = new VaultIndex();
	assert.equal(def.watchDebounceMs, 150, "定向重建单篇约 50ms，抖动窗口没必要 500ms");
	assert.equal(def.watchReconcileMs, 1200, "rename 对账给长窗口，把批量移动合并成一轮");
	const custom = new VaultIndex({ watchDebounceMs: 30, watchReconcileMs: 60 });
	assert.equal(custom.watchDebounceMs, 30);
	assert.equal(custom.watchReconcileMs, 60);
});

// ── 2. 定向 change：只重建这一篇，不做全量扫描 ──────────────────────
test("OPT-6.2 可定位的 change 事件走定向重建，不触发全量 scan", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n定向基线词 zzzbase");
		await put(root, "b.md", "# B\n\n另一篇笔记 zzzother");
		const idx = new VaultIndex({ watchDebounceMs: 30, watchReconcileMs: 200 });
		await idx.ensureIndexed(root);
		armWatch(idx, root);
		const scans = countScans(idx);
		assert.equal(idx.status().noteCount, 2);

		await put(root, "a.md", "# A\n\n定向基线词 zzzbase 新增标记词 zzttargeted");
		idx._onWatchEvent(resolve(root), "change", "a.md");
		assert.ok(await waitRebuild(idx, idx.status().builtAt), "定向重建未在窗口内落地");

		assert.equal(scans.n, 0, "定向路径不该做全量 scan");
		assert.equal(idx._watchNeedFull, false, "change 事件不该要求全量对账");
		assert.equal(idx.status().noteCount, 2, "定向重建不该改笔记总数");
		const hits = idx.search("zzttargeted").hits.map((h) => h.notePath);
		assert.ok(hits.includes("a.md"), `新标记词检索不到：${JSON.stringify(hits)}`);
		assert.ok(idx.search("zzzother").hits.length, "未变动的笔记仍在索引里（没被误删）");
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 3. rename 新增：先定向可见，再补一次全量对账 ────────────────────
test("OPT-6.3 新建笔记（rename）定向立即可查，并安排 rename 对账", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n只有 a 的内容 zzzonly");
		const idx = new VaultIndex({ watchDebounceMs: 30, watchReconcileMs: 120 });
		await idx.ensureIndexed(root);
		armWatch(idx, root);
		const scans = countScans(idx);

		await put(root, "new/c.md", "# C\n\n新笔记标记词 zznewnote");
		idx._onWatchEvent(resolve(root), "rename", join("new", "c.md"));
		assert.equal(idx._watchNeedFull, true, "rename 分不清新增/删除/改名，必须要求对账");
		assert.ok(await waitRebuild(idx, idx.status().builtAt), "定向未落地");
		assert.equal(scans.n, 0, "定向阶段不该先扫全库");
		assert.ok(idx.search("zznewnote").hits.map((h) => h.notePath).includes("new/c.md"), "新笔记定向后应可检索");

		// 等对账窗口跑完整轮
		const t0 = Date.now();
		while (Date.now() - t0 < 3000 && scans.n === 0) await sleep(20);
		assert.equal(scans.n, 1, "rename 之后应发生一次全量对账");
		assert.equal(idx._watchNeedFull, false, "对账跑完应清掉标记");
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 4. 删除：定向读失败 → 立刻摘除，对账确认 ────────────────────────
test("OPT-6.4 删除的笔记被摘除（定向 drop + 对账收敛）", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n保留 zzzkeep");
		const gone = await put(root, "gone.md", "# G\n\n要被删掉 zzzgone");
		const idx = new VaultIndex({ watchDebounceMs: 30, watchReconcileMs: 120 });
		await idx.ensureIndexed(root);
		armWatch(idx, root);
		assert.ok(idx.search("zzzgone").hits.length, "基线：删除前应能检索到");

		await rm(gone);
		idx._onWatchEvent(resolve(root), "rename", "gone.md");
		assert.ok(await waitRebuild(idx, idx.status().builtAt));
		assert.equal(idx.status().noteCount, 1, "读不到的路径应摘除，而不是留在索引里");
		assert.equal(idx.search("zzzgone").hits.length, 0, "删除后不该还能检索到（孤儿 chunk 应被压实）");
		const t0 = Date.now();
		while (Date.now() - t0 < 3000 && idx._watchNeedFull) await sleep(20);
		assert.equal(idx._watchNeedFull, false, "对账后标记应清空");
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 5. 非笔记事件完全不触发 ─────────────────────────────────────────
test("OPT-6.5 非 .md/.markdown 事件不触发任何重建", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n基线 zzzbase");
		const idx = new VaultIndex({ watchDebounceMs: 20, watchReconcileMs: 60 });
		await idx.ensureIndexed(root);
		const before = idx.status().builtAt;
		const scans = countScans(idx);
		idx._onWatchEvent(resolve(root), "change", "image.png");
		idx._onWatchEvent(resolve(root), "change", "note.md.tmp"); // Obsidian 式临时文件
		idx._onWatchEvent(resolve(root), "rename", "sub");           // 目录名（无扩展名）
		await sleep(200);
		assert.equal(idx.status().builtAt, before, "非笔记事件不该触发重建");
		assert.equal(scans.n, 0);
		assert.equal(idx._watchPending.size, 0);
		assert.equal(idx._watchNeedFull, false);
		assert.equal(idx._watchTimer, null, "不该留下待处理计时器");
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 6. null 文件名退回全量 ──────────────────────────────────────────
test("OPT-6.6 拿不到文件名（Windows 批量变动会给 null）退回全量增量", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n基线 zzzbase");
		const idx = new VaultIndex({ watchDebounceMs: 20, watchReconcileMs: 60 });
		await idx.ensureIndexed(root);
		armWatch(idx, root);
		const scans = countScans(idx);
		idx._onWatchEvent(resolve(root), "rename", null);
		assert.equal(idx._watchNeedFull, true, "null 文件名必须要求全量对账");
		assert.equal(idx._watchPending.size, 0, "null 不该进定向集合");
		const t0 = Date.now();
		while (Date.now() - t0 < 3000 && scans.n === 0) await sleep(20);
		assert.equal(scans.n, 1, "全量兜底路径仍要跑起来（旧行为不能丢）");
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 7. A8 越界防线：vault 外的 .md 绝不进索引 ───────────────────────
test("OPT-6.7 ../ 越界与 vault 外绝对名不进定向集合，只退回全量", async () => {
	const parent = await makeVault();
	const root = join(parent, "vault");
	await mkdir(root, { recursive: true });
	try {
		await put(root, "a.md", "# A\n\n库内 zzzinside");
		// vault 的**同级**目录放一篇带独特标记词的笔记：它不属于索引范围。
		await writeFile(join(parent, "outside.md"), "# O\n\n库外标记词 zzzyoutside\n", "utf8");
		const idx = new VaultIndex({ watchDebounceMs: 20, watchReconcileMs: 80 });
		await idx.ensureIndexed(root);
		armWatch(idx, root);
		const scans = countScans(idx);

		idx._onWatchEvent(resolve(root), "change", `..${sep}outside.md`);
		assert.equal(idx._watchPending.size, 0, "越界路径不得进定向集合（否则会把 vault 外文件建进索引）");
		assert.equal(idx._watchNeedFull, true, "越界应退回全量扫描，由 scan 规则决定纳入范围");

		idx._onWatchEvent(resolve(root), "change", join(parent, "outside.md")); // 绝对名
		assert.equal(idx._watchPending.size, 0);
		await sleep(300);
		assert.ok(scans.n >= 1, "越界事件应触发一次全量对账");
		assert.equal(idx.search("zzzyoutside").hits.length, 0, "库外笔记不该出现在索引里");
		assert.ok(idx.search("zzzinside").hits.length, "库内笔记照常");
	} finally { await rm(parent, { recursive: true, force: true }); }
});

// ── 8. scanning 互斥：重建不重叠 ────────────────────────────────────
test("OPT-6.8 有重建在跑时定向窗口只等待，不并发写索引", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n互斥基线 zzzmutex");
		const idx = new VaultIndex({ watchDebounceMs: 20, watchReconcileMs: 60 });
		await idx.ensureIndexed(root);
		const before = idx.status().builtAt;
		idx.scanning = true; // 模拟查询路径 / 全量对账正在进行
		idx._onWatchEvent(resolve(root), "change", "a.md");
		idx._scheduleWatchTargeted();
		await sleep(120);
		assert.equal(idx.status().builtAt, before, "scanning 期间不该提交重建");
		assert.equal(idx._watchPending.size, 1, "待处理路径必须留着，等锁释放再处理");
		idx.scanning = false;
		assert.ok(await waitRebuild(idx, before), "锁释放后定向重建应补跑");
		assert.equal(idx._watchPending.size, 0);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("OPT-6.9 ensureIndexed 的轻量增量分支也进互斥锁（并发只排队不重叠）", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n并发 zzzconcurrent");
		const idx = new VaultIndex();
		await idx.ensureIndexed(root); // 建好，之后都走「已建过 → 轻量增量」分支
		idx.scanning = true;
		const r = await idx.ensureIndexed(root);
		assert.deepEqual(r, { queued: true }, "已建库的增量分支原先不进锁：并发两份 _incremental 会互相踩 chunks");
		idx.scanning = false;
		// 真实并发：同时发两次，最多一次真跑，另一次排队
		let inside = 0, overlap = 0;
		const orig = idx._incremental.bind(idx);
		idx._incremental = async (v) => { inside++; if (inside > 1) overlap++; try { await sleep(30); return await orig(v); } finally { inside--; } };
		await Promise.all([idx.ensureIndexed(root), idx.ensureIndexed(root)]);
		assert.equal(overlap, 0, "两次并发请求不得同时跑 _incremental");
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 10. 真实 fs.watch 端到端（不是只喂假事件）───────────────────────
test("OPT-6.10 真实 fs.watch：保存笔记后定向重建在 1s 内落地", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n真实监听基线 zzzrealseed");
		const idx = new VaultIndex(); // 默认 150ms 窗口
		await idx.ensureIndexed(root);
		idx.watch(root);
		try {
			const before = idx.status().builtAt;
			await writeFile(join(root, "a.md"), await readFile(join(root, "a.md"), "utf8") + "\n真实监听标记词 zzze2e\n", "utf8");
			const t0 = Date.now();
			let done = false;
			while (Date.now() - t0 < 6000) {
				if (idx.status().builtAt !== before) { done = true; break; }
				await sleep(20);
			}
			assert.ok(done, "真实 fs.watch 未在 6s 内触发重建");
			const latency = Date.now() - t0;
			assert.ok(latency < 1000, `端到端延迟应低于旧的 ~1500ms 口径，实测 ${latency}ms`);
			assert.ok(idx.search("zzze2e").hits.map((h) => h.notePath).includes("a.md"), "保存的新内容应检索到");
		} finally { idx.unwatch(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

// ── 11. unwatch 清场 ────────────────────────────────────────────────
test("OPT-6.11 unwatch 清空待处理集合与对账标记", async () => {
	const root = await makeVault();
	try {
		await put(root, "a.md", "# A\n\n清场 zzzclear");
		const idx = new VaultIndex({ watchDebounceMs: 500 });
		await idx.ensureIndexed(root);
		idx.watch(root);
		idx._onWatchEvent(resolve(root), "rename", "a.md");
		assert.equal(idx._watchPending.size, 1);
		assert.equal(idx._watchNeedFull, true);
		const r = idx.unwatch();
		assert.deepEqual(r, { watching: false });
		assert.equal(idx._watchPending.size, 0, "换库/关闭后不能把旧 vault 的路径带进下一轮");
		assert.equal(idx._watchNeedFull, false);
		assert.equal(idx._watchTimer, null);
	} finally { await rm(root, { recursive: true, force: true }); }
});
