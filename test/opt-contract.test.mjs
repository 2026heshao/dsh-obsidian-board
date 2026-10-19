// OPT-6.1 CI 闸门：typert 单一来源 ↔ 客户端生成区一致性（契约漂移即 CI 红）。
// 历史事故模式：typert.js 与 client.js descriptor 两份产物漏同步一处 =
// 「面板能开、一调用就炸」或「加载即拒」（0.1.5-rc.x 查 schema.parse、0.1.6+ 查 create）。
// 本测试不 import lib：只读契约段文本 + 调生成器 --check，避免宿主依赖拖进闸门。
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const typertSrc = readFileSync(new URL("../lib/typert.js", import.meta.url), "utf8");
const clientSrc = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

// ── 1. 生成器 --check：标记区现状必须与 TYPERT 派生产物逐字节一致 ────
test("OPT-6.1 生成器 --check 通过（契约单一来源无漂移）", () => {
	const r = spawnSync(process.execPath, ["scripts/gen-client-contract.mjs", "--check"], {
		cwd: pkgRoot,
		encoding: "utf8",
	});
	assert.equal(r.status, 0, `--check 退出码 ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
	assert.match(String(r.stdout), /TYPERT 17 invocations/);
});

test("OPT-6.1 typert.js 终态：17 个 invocations", () => {
	assert.equal(17, (typertSrc.match(/mv\('/g) || []).length);
});

test("OPT-6.1 客户端契约含 historyGet / historySet 各恰好 1 处", () => {
	for (const method of ["historyGet", "historySet"]) {
		assert.equal(1, (clientSrc.match(new RegExp(`method: '${method}'`, "g")) || []).length, method);
	}
});

test("OPT-6.1 生成标记各恰好 1 处，且整体位于 smoke-render 切片之外", () => {
	// 切片纪律：切片终点锚点「── 浏览器侧 typert 契约」之后才允许出现生成标记
	const sliceEnd = clientSrc.indexOf("// ── 浏览器侧 typert 契约");
	assert.ok(sliceEnd >= 0, "切片终点锚点缺失");
	for (const mark of ["// <gen:contract>", "// </gen:contract>"]) {
		const count = clientSrc.split(mark).length - 1;
		assert.equal(1, count, `${mark} 出现 ${count} 次（应恰好 1 次）`);
		assert.ok(clientSrc.indexOf(mark) > sliceEnd, `${mark} 侵入切片（必须在「── 浏览器侧 typert 契约」之后）`);
	}
});
