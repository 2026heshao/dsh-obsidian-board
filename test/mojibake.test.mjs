// _fixMojibake 类方法端到端验证（stub 掉 typert 依赖后真加载类）
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const orig = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "@deepseek-ai/dsh-typert-protocol") {
		return { TypertRemoteService: class { constructor() {} }, Remote: () => () => {} };
	}
	return orig.apply(this, arguments);
};

const { VaultIndex } = await import("../lib/vault.js").then((m) => m.default ?? m);

let src = fs.readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
// 把所有静态 import 换成已注入的局部变量
src = src
	.replace(/import [\s\S]*?"node:child_process";/, "const __spawnUnused = null;")
	.replace(/import [\s\S]*?"node:os";/, "const __osUnused = null;")
	.replace(/import [\s\S]*?"node:fs\/promises";/, "const __fspUnused = null;")
	.replace(/import [\s\S]*?"node:fs";/, "const __fsUnused = null;")
	.replace(/import [\s\S]*?"node:path";/, "const __pathUnused = null;")
	.replace(/import [\s\S]*?"@deepseek-ai\/dsh-typert-protocol";/, "class TypertRemoteService { constructor() {} }\nconst Remote = () => () => {};")
	.replace(/import \{ VaultIndex \} from "\.\/vault\.js";/, "const VaultIndex = globalThis.__VI;")
	.replace(/export const Config[\s\S]*?;\n/, "")
	.replace(/export class/, "class")
	.replace(/export default[\s\S]*$/, "");
globalThis.__VI = VaultIndex;

const box = new Function("obSpawn", "obHomedir", "obFs", "obStatSync", "obBasename", "obDirname", "obIsAbsolute", "obJoin", "obResolve", "obReadFile", "obReaddir", "obStat", src + "\nconst spawn = obSpawn; const homedir = obHomedir; const statSync = obStatSync; const basename = obBasename; const dirname = obDirname; const isAbsolute = obIsAbsolute; const join = obJoin; const resolve = obResolve; const readFile = obReadFile; const readdir = obReaddir; const stat = obStat; return { G: ObsidianBoardGateway };")(
	() => ({ unref() {} }), os.homedir, fs, fs.statSync,
	path.basename, path.dirname, path.isAbsolute, path.join, path.resolve,
	fs.promises.readFile, fs.promises.readdir, fs.promises.stat,
);

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n); } };
t("mojibake 自愈（妗岄潰→桌面）", box.G._fixMojibake("D:\\妗岄潰\\AI Port\\my_kb").includes("桌面"));
t("好路径原样返回", box.G._fixMojibake("D:\\桌面\\AI Port\\my_kb") === "D:\\桌面\\AI Port\\my_kb");
t("不存在路径原样返回", box.G._fixMojibake("D:\\不存在\\目录") === "D:\\不存在\\目录");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
