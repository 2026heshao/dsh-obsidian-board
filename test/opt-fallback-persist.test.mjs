// OPT-2.2 回归：回退成功不再写 config / _saveState（持久层保持用户显式配置）
// 历史 bug：回退链命中备选路由后把 pair 写进 this.config 并 _saveState 落盘，
// 用户的显式模型配置被静默覆盖（重启后「我的配置怎么变了」）。
// 现契约：只记会话内存 state.fallback，客户端经 chatPoll.fallback 一次性提示。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

// ── 1. 会话内存记录存在 ─────────────────────────────────────────────
t("回退成功写 state.fallback（provider+model 成对）", /state\.fallback = \{ provider: pair\.provider, model: pair\.model \|\| state\.model \};/.test(host));
t("OPT-2.2 注释锚点存在（意图可追溯）", host.includes("OPT-2.2 回退成功不再写 config / _saveState"));
t("chatPoll 一次性透出 fallback", /fallback: state\.fallback \|\| null,/.test(host));

// ── 2. 回退成功分支内不得出现持久化写入（切片级负断言）──────────────
const fbIdx = host.indexOf("state.fallback = { provider: pair.provider");
t("能定位回退成功分支", fbIdx > 0);
const branch = host.slice(Math.max(0, fbIdx - 900), fbIdx + 300);
t("分支内无 _saveState() 调用", !/_saveState\(/.test(branch));
t("分支内无 this.config. 写入", !/this\.config\./.test(branch));
t("全文件不存在 config.provider = pair.provider（历史越权写法绝迹）", !/config\.provider = pair\.provider/.test(host));
t("分支仍保留会话内存路由记录（state.provider / state.model）", /state\.provider = pair\.provider;/.test(branch));
t("分支命中即 break（不再继续烧后续候选）", /break;/.test(branch));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
