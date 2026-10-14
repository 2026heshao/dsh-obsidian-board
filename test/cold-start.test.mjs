// 回归测试：冷启动竞态 —— 空 config + state.json 有路径时，listNotes 必须自恢复
// 历史 bug：只有 status/configure/chatStart 调 _restorePersisted，listNotes 漏了；
// 冷启动时 listNotes 先到就抛「未配置 vault 路径」，上层吞错 → 状态卡有数字、列表空。
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const orig = Module._load;
Module._load = function (request) {
	if (request === "@deepseek-ai/dsh-typert-protocol") {
		return { TypertRemoteService: class { constructor(ctx, name) { this.ctx = ctx; this.name = name; } }, Remote: () => () => {} };
	}
	return orig.apply(this, arguments);
};
const { VaultIndex } = await import("../lib/vault.js");

let src = fs.readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
src = src
	.replace(/import [\s\S]*?"node:child_process";/, "const __a = null;")
	.replace(/import [\s\S]*?"node:os";/, "const __b = null;")
	.replace(/import [\s\S]*?"node:fs\/promises";/, "const __c = null;")
	.replace(/import [\s\S]*?"node:fs";/, "const __d = null;")
	.replace(/import [\s\S]*?"node:path";/, "const __e = null;")
	.replace(/import [\s\S]*?"@deepseek-ai\/dsh-typert-protocol";/, "class TypertRemoteService { constructor(ctx, name) { this.ctx = ctx; this.name = name; } }\nconst Remote = () => () => {};")
	.replace(/import \{ VaultIndex \} from "\.\/vault\.js";/, "const VaultIndex = globalThis.__VI;")
	.replace(/export const Config[\s\S]*?;\n/, "")
	.replace(/export class/, "class")
	.replace(/export default[\s\S]*$/, "");
globalThis.__VI = VaultIndex;

const makeGateway = () => {
	const box = new Function("obSpawn", "obHomedir", "obFs", "obStatSync", "obBasename", "obDirname", "obIsAbsolute", "obJoin", "obResolve", "obReadFile", "obReaddir", "obStat", src + `
const spawn = obSpawn; const homedir = obHomedir; const statSync = obStatSync;
const basename = obBasename; const dirname = obDirname; const isAbsolute = obIsAbsolute;
const join = obJoin; const resolve = obResolve; const readFile = obReadFile;
const readdir = obReaddir; const stat = obStat;
return { G: ObsidianBoardGateway };`)(
		() => ({ unref() {} }), os.homedir, fs, fs.statSync,
		path.basename, path.dirname, path.isAbsolute, path.join, path.resolve,
		fs.promises.readFile, fs.promises.readdir, fs.promises.stat,
	);
	const ctx = { get: () => null, on: () => {}, effect: () => {} };
	return { G: box.G, ctx };
};

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

// 依赖本机真实 state.json（已连接过 vault）
const stateFile = path.resolve(os.homedir(), ".dsh", "dsh-obsidian-board", "state.json");
const hasState = fs.existsSync(stateFile) && JSON.parse(fs.readFileSync(stateFile, "utf8")).vaultPath;

if (!hasState) {
	console.log("SKIP: 无 state.json（本机未连接过 vault）——跳过冷启动回归");
	process.exit(0);
}

// 场景 1（核心回归）：空 config → 直接 listNotes（不等 status）必须成功
{
	const { G, ctx } = makeGateway();
	const gw = new G(ctx, {}); // 完全同真实插件行（config 为空）
	let ok = false, count = 0, err = "";
	try {
		const r = await gw.listNotes({ sort: "mtime" });
		ok = true;
		count = (r.notes || []).length;
	} catch (e) { err = e.message; }
	t("冷启动直接 listNotes 不抛异常（历史 bug 点）", ok, err);
	t("冷启动 listNotes 返回非空列表", count > 0, "count=" + count);
}

// 场景 2：空 config → search 也必须自恢复
{
	const { G, ctx } = makeGateway();
	const gw = new G(ctx, {});
	let ok = false;
	try { await gw.search({ query: "GitHub", topK: 3 }); ok = true; } catch { /* ignore */ }
	t("冷启动 search 自恢复", ok);
}

// 场景 3：空 config → reindex 自恢复
{
	const { G, ctx } = makeGateway();
	const gw = new G(ctx, {});
	let ok = false;
	try { await gw.reindex(); ok = true; } catch { /* ignore */ }
	t("冷启动 reindex 自恢复", ok);
}

// 场景 4：真正未配置（无 state.json 内容）→ 必须给出可操作错误，而不是静默
{
	const { G, ctx } = makeGateway();
	const gw = new G(ctx, { vaultPath: "   " }); // 空白路径
	gw._restored = true; // 跳过恢复，模拟真的没有持久化路径
	let msg = "";
	try { await gw.listNotes({}); } catch (e) { msg = e.message; }
	t("真未配置时错误信息可操作（提到选择仓库位置）", /选择仓库位置|未配置/.test(msg), msg);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
