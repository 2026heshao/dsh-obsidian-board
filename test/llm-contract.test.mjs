// 回归测试：宿主 llm 流契约（0.2.0-rc.2 真实形状，app.asar 源码核实）。
// 历史事故：text-delta 读 delta 字段（真实是 text）、finish 形状不识别（真实是
// {type:'finish', reason:{kind,failure}}）、usage 用 snake_case、provider 目录取显示名。
// 这些错位叠加 = 「模型没有返回内容」+ 尝试轨迹里全是不能路由的显示名（截图 bug）。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

const indexSrc = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const fnSrc = indexSrc.slice(indexSrc.indexOf("function visibleDelta"), indexSrc.indexOf("async function mapHasVaultPath"));
const failSrc = indexSrc.slice(indexSrc.indexOf("function terminalFailure"), indexSrc.indexOf("// 给任意 promise 加超时"));
const box = new Function(fnSrc + failSrc + "\nreturn { visibleDelta, thinkingDelta, terminalFailure, isUserAbort, usageOf, providerRouteOf, providerNameOf };")();
const { visibleDelta, thinkingDelta, terminalFailure, isUserAbort, usageOf, providerRouteOf, providerNameOf } = box;

// ── 1. 宿主真实 delta 形状（字段是 text）────────────────────────────
t("text-delta 用 text 字段", visibleDelta({ type: "text-delta", index: 0, text: "你好" }) === "你好");
t("text-delta 兼容 delta 字段", visibleDelta({ type: "text-delta", index: 0, delta: "你好" }) === "你好");
t("reasoning-delta 走思考通道", thinkingDelta({ type: "reasoning-delta", index: 0, text: "思考中" }) === "思考中");
t("reasoning-delta 不进正文", visibleDelta({ type: "reasoning-delta", index: 0, text: "思考中" }) === "");
t("text-delta 不进思考通道", thinkingDelta({ type: "text-delta", index: 0, text: "正文" }) === "");
t("block-start 不产生文本", visibleDelta({ type: "block-start", index: 0, blockType: "text" }) === "");

// ── 2. 宿主真实 finish 形状 ─────────────────────────────────────────
t("finish stop 正常", terminalFailure({ type: "finish", reason: { kind: "stop" } }) === null);
t("finish max-tokens 非失败", terminalFailure({ type: "finish", reason: { kind: "max-tokens" } }) === null);
t("finish tool-calls 非失败", terminalFailure({ type: "finish", reason: { kind: "tool-calls" } }) === null);
const err = terminalFailure({ type: "finish", reason: { kind: "error", failure: { message: "no adapter registered for provider \"DeepSeek Account\"", code: "NO_ADAPTER" } } });
t("finish error 提取 code+message", err === "NO_ADAPTER：no adapter registered for provider \"DeepSeek Account\"");
const abort = terminalFailure({ type: "finish", reason: { kind: "aborted", failure: { message: "request aborted", code: "ABORTED" } } });
t("finish aborted 标记 [ABORTED]", abort === "[ABORTED] ABORTED：request aborted");
t("isUserAbort 识别中止", isUserAbort(abort) === true && isUserAbort(err) === false);
t("宽松旧形状仍兼容", terminalFailure({ type: "error", failure: { code: "AUTH", message: "bad key" } }) === "AUTH：bad key");

// ── 3. usage chunk（camelCase 优先）────────────────────────────────
const u1 = usageOf({ type: "usage", usage: { inputTokens: 320, outputTokens: 64, reasoningTokens: 12 } });
t("usage camelCase", u1 && u1.input === 320 && u1.output === 64 && u1.reasoning === 12);
const u2 = usageOf({ type: "usage", usage: { prompt_tokens: 5, completion_tokens: 7 } });
t("usage snake_case 兼容", u2 && u2.input === 5 && u2.output === 7);
t("非 usage chunk 返回 null", usageOf({ type: "text-delta", text: "x" }) === null);
t("全零 usage 返回 null", usageOf({ type: "usage", usage: { inputTokens: 0, outputTokens: 0 } }) === null);

// ── 4. provider 目录（id 是路由，name 是显示名）─────────────────────
t("provider 取 id", providerRouteOf({ id: "workbuddy", name: "WorkBuddy" }) === "workbuddy");
t("provider 字符串直通", providerRouteOf("our-free-model") === "our-free-model");
t("provider 显示名单独取", providerNameOf({ id: "workbuddy", name: "WorkBuddy" }) === "WorkBuddy");
t("垃圾对象不产生路由名", providerRouteOf({}) === "" && providerRouteOf(null) === "");

// ── 5. 完整真实流重放（宿主 chunk 序列）─────────────────────────────
const realStream = [
	{ type: "block-start", index: 0, blockType: "text" },
	{ type: "reasoning-delta", index: 1, text: "用户问的是知识库…" },
	{ type: "text-delta", index: 2, text: "根据你的笔记，" },
	{ type: "text-delta", index: 2, text: "答案是 A [1]。" },
	{ type: "usage", usage: { inputTokens: 1200, outputTokens: 88 } },
	{ type: "finish", reason: { kind: "stop" } },
];
let acc = "", think = "", usage = null, term = null;
for (const c of realStream) {
	const u = usageOf(c); if (u) usage = u;
	term = terminalFailure(c); if (term) break;
	think += thinkingDelta(c);
	acc += visibleDelta(c);
}
t("真实流正文完整", acc === "根据你的笔记，答案是 A [1]。");
t("真实流思考分离", think === "用户问的是知识库…");
t("真实流 usage 捕获", usage && usage.input === 1200 && usage.output === 88);
t("真实流正常终止", term === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
