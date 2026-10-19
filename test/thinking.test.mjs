// 回归：onlyReasoning 模型（glm-5.3-flash 等）的思考期可视化
// 历史 bug：宿主半丢弃 reasoning-delta → onlyReasoning 模型思考期（分钟级）面板只转圈，
// 用户视角 = 「AI 只转圈思考不输出」。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 宿主半：thinkingDelta 收集 + 轮询转发 ───────────────────────
t("宿主半存在 thinkingDelta 提取器", host.includes("function thinkingDelta"));
t("reasoning-delta / thinking-delta 双拼写识别", /reasoning\[-_\]\?delta\|thinking\[-_\]\?delta/i.test(host));
t("runOne 收集思考增量到 state.think", /const think = thinkingDelta\(chunk\);\s*\n\s*if \(think\) state\.think \+= think;/.test(host));
t("chatPoll 返回 thinkDelta 增量", /thinkDelta[,;]/.test(host));
t("chatPoll 返回 thinking 阶段标记", /thinking: !state\.text\.length && !!state\.think\.length/.test(host));
t("chatPoll 接收 receivedThink 断点续传游标", host.includes("prevThinkLen"));
t("正文通道不混入思考块（reasoning 块不算 text）", /chunk\.block && typeof chunk\.block === "object" && \/reasoning\|thinking\/i\.test\(String\(chunk\.block\.kind \|\| ""\)\)\) return "";/.test(host));

// ── 2. reasoningEffort 降档配置 ────────────────────────────────────
t("Config 声明 reasoningEffort 且默认 high", /reasoningEffort:\s*\{[\s\S]*?default: "high"/.test(host));
t("面板问答带 reasoningEffort 发起流", host.includes("withEffort"));
t("空转回退分支也带 withEffort", /runOne\(withEffort\(/.test(host));
t("回退时清空 think 防脏数据", host.includes('state.think = ""'));
t("规划跳降档走 PLAN_EFFORT_MAP（high→medium，不再砍到 low）", /options\.reasoningEffort = PLAN_EFFORT_MAP\[planEffort\] \|\| planEffort;/.test(host));
const planMapCode = host.match(/const PLAN_EFFORT_MAP = \{[^}]*\};/);
const PLAN_MAP = planMapCode ? new Function(planMapCode[0] + "\nreturn PLAN_EFFORT_MAP;")() : {};
t("PLAN_EFFORT_MAP 行为：high 输入映射出 medium（廉价预调用不深思）", PLAN_MAP.high === "medium" && PLAN_MAP.low === "low" && PLAN_MAP.medium === "medium" && PLAN_MAP.xhigh === "high" && PLAN_MAP.max === "high");

// ── 3. 客户端半：消费 thinkDelta + 思考可视化 ──────────────────────
t("轮询上报 receivedThink 游标", client.includes("receivedThink"));
t("appendThink 按 replyId 定位追加（与 appendDelta 同构防串台）", /const appendThink = \(delta\) => setMessages/.test(client) && /next\[idx\] = \{ \.\.\.next\[idx\], thinking: \(next\[idx\]\.thinking \|\| ''\) \+ delta \};/.test(client));
t("isThinking 标记不与 m.thinking 文本撞名", client.includes("isThinking: true") && !client.includes("patchReply({ thinking: true })"));
t("思考中提示文案存在（不显示卡死转圈）", client.includes("深度思考中"));
t("ThinkBlock 可折叠组件存在", client.includes("function ThinkBlock"));
t("ThinkBlock 出正文后自动折叠（open 翻转跟随）", /if \(\!\!open !== wasOpen\) \{ setWasOpen\(\!\!open\); setExpanded\(\!\!open\); \}/.test(host.replace(/\n/g, " ").replace(client.slice(client.indexOf("function ThinkBlock"), client.indexOf("// ── 主页面")), "")) || /if \(\!\!open !== wasOpen\) \{ setWasOpen\(\!\!open\); setExpanded\(\!\!open\); \}/.test(client));
t("思考块 CSS 存在", client.includes(".ob-think-body"));

// ── 4. 行为模拟：宿主流收集逻辑（与 index.js 同构） ─────────────────
// 抽取 deltaOf/thinkingDelta/visibleDelta 三个纯函数做行为测试
const fnStart = host.indexOf("function visibleDelta(chunk)");
const fnEnd = host.indexOf("async function mapHasVaultPath");
const sandboxCode = host.slice(fnStart, fnEnd).replace(/^export /gm, "");
const streamFns = new Function(sandboxCode + "\nreturn { visibleDelta, thinkingDelta };")();

// 场景 A：reasoning-delta 形状
t("A: reasoning-delta 进思考通道", streamFns.thinkingDelta({ type: "reasoning-delta", delta: "正在分析笔记…" }) === "正在分析笔记…");
t("A: reasoning-delta 不进正文", streamFns.visibleDelta({ type: "reasoning-delta", delta: "正在分析笔记…" }) === "");
t("A: text-delta 进正文", streamFns.visibleDelta({ type: "text-delta", delta: "结论是…" }) === "结论是…");
t("A: text-delta 不进思考", streamFns.thinkingDelta({ type: "text-delta", delta: "结论是…" }) === "");

// 场景 B：thinking-delta 拼写兼容
t("B: thinking-delta 拼写进思考通道", streamFns.thinkingDelta({ type: "thinking-delta", text: "考虑中" }) === "考虑中");

// 场景 C：块形状 {block:{kind:'reasoning', text}}
t("C: reasoning 块进思考通道", streamFns.thinkingDelta({ kind: "text-delta", block: { kind: "reasoning", text: "块状思考" } }) === "块状思考");
t("C: reasoning 块不进正文", streamFns.visibleDelta({ kind: "text-delta", block: { kind: "reasoning", text: "块状思考" } }) === "");
t("C: text 块仍进正文", streamFns.visibleDelta({ kind: "text-delta", block: { kind: "text", text: "块状正文" } }) === "块状正文");

// 场景 D：原协议形状不回归（stream-update.test 的既有契约）
t("D: 块形状 {kind:'block-start', block:{text}} 仍进正文", streamFns.visibleDelta({ kind: "block-start", block: { text: "x" } }) === "x" || streamFns.visibleDelta({ kind: "text-delta", block: { text: "x" } }) === "x");
t("D: 非对象 chunk 返回空串", streamFns.visibleDelta(null) === "" && streamFns.thinkingDelta(undefined) === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
