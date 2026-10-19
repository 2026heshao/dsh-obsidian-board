// 回归：停止按钮的静默期响应 + 发送参数污染（[object Object]）
//
// 事故 1（停止按钮只有思考输出时才生效）：
//   宿主 runOne 只在「收到下一个 chunk 之后」检查 aborted。模型静默期（首字等待 /
//   上游缓冲 / 适配器卡住）没有 chunk 到达，abort 永远读不到 → 点了没反应。
//   修复：abort 与「等 chunk」Promise.race，并提前 return 上游迭代器。
//   另有「检索/规划阶段」没 sessionId 的窗口：修复为会话先注册 + 中止可打断检索。
//
// 事故 2（发送内容重复时变成 [object Object]）：
//   React onClick 把点击事件对象当第一个参数传给 send，send 原样 String(...) 后
//   当问题发出。修复：只接受 typeof string；onClick 全改显式包装。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 宿主：abort 与等 chunk 竞速 ──────────────────────────────────
t("runOne 用 asyncIterator 手动驱动（可与 abort 竞速）", host.includes("llm.stream({ ...options, signal })[Symbol.asyncIterator]()"));
t("abort 与 iterator.next() 走 Promise.race", /Promise\.race\(\[pending, abortPromise\]\)/.test(host));
t("race 落败分支挂 catch（不留 unhandled rejection）", /pending\.catch\(\(\) => \{\}\)/.test(host));
t("竞速胜出立即返回（静默期也能停）", /if \(next && next\.__abort\) return true;/.test(host));
t("提前退出释放上游迭代器", /await iterator\.return\?\.\(\)/.test(host));
t("abort 监听器在 finally 里摘除（不泄漏）", /signal\.removeEventListener\("abort", abortResolve\)/.test(host));

// ── 2. 宿主：检索/规划阶段可中止 ────────────────────────────────────
t("会话状态在检索之前创建并注册", host.indexOf("ObsidianBoardGateway._streams.set(sessionId, state)") < host.indexOf("await abortable(this._multiHits("));
t("检索用 abortable 包装", /const retrieval = await abortable\(this\._multiHits\(/.test(host));
t("检索被中止时直接落定终态并返回空 citations", /if \(retrieval && retrieval\.__aborted\) \{[\s\S]{0,200}state\.done = true/.test(host));
t("abortable 同时监听 abort 与 resolve/reject 并摘除监听", /signal\.addEventListener\("abort", onAbort, \{ once: true \}\)/.test(host) && /signal\.removeEventListener\("abort", onAbort\)/.test(host));

// ── 3. 宿主：chatStop 立即可见 + 幂等 ───────────────────────────────
t("chatStop 立刻给空正文会话写入中性终态", /state\.stopping = true;/.test(host) && /if \(!state\.text\.trim\(\) && !state\.error\) state\.error = "已停止";/.test(host));
t("chatStop 对 abort 抛错免疫（幂等）", /try \{ state\.controller\.abort\(\); \} catch/.test(host));
t("停止引发的迭代器异常收敛为中性终态", /state\.controller\.signal\.aborted\s*\?\s*"已停止"\s*:\s*"模型调用失败："/.test(host));
t("已有正文的停止保留正文（不写 error）", /if \(state\.controller\.signal\.aborted && state\.text\.trim\(\)\) state\.error = "";/.test(host));

// ── 4. 客户端：send 参数污染防护 ────────────────────────────────────
t("send 只接受字符串参数（事件对象被拒）", /typeof overrideQuestion === 'string' \? overrideQuestion : draft/.test(client));
t("send 不再用 ?? 直接取参（会吃下事件对象）", !/\?\? draft\)\.trim\(\)/.test(client));
t("发送按钮 onClick 显式包装（不透传事件）", /onClick: \(\) => send\(\), disabled: !draft\.trim\(\)/.test(client));
t("不存在 onClick: send 裸引用", !/onClick: send[,)]/.test(client));

// ── 5. 客户端：停止的三条路径 ───────────────────────────────────────
t("stopRequested ref 声明", /const stopRequested = useRef\(false\)/.test(client));
t("停止立即解冻 UI（不等宿主确认）", /stopRequested\.current = true;\s*\n\s*setBusy\(false\);/.test(client));
t("chatStart 返回后尊重停止意向（不再轮询）", /if \(stopRequested\.current\) \{\s*\n\s*patchReply\(\{ pending: false, stopped: true \}\);/.test(client));
t("轮询循环每轮先看停止意向", /for \(;;\) \{[\s\S]{0,300}if \(stopRequested\.current\)/.test(client));
t("停止意向在轮次开始时复位", /const mySeq = \+\+streamSeq\.current;\s*\n\s*stopRequested\.current = false;/.test(client));
t("流轮次 token 存在（防旧轮 finally 清新轮）", /const streamSeq = useRef\(0\)/.test(client));
t("finally 仅在仍是最新一轮时回收状态", /if \(streamSeq\.current === mySeq\) \{/.test(client));
t("停止抛错也走中性终态", /patchReply\(stopRequested\.current\s*\n?\s*\?\s*\{ pending: false, stopped: true \}/.test(client));

// ── 6. 客户端：停止的空回复文案 ─────────────────────────────────────
// 三种中性终态必须分开表述（已停止 / 已中断 / 模型无输出）——不能静默留白。
t("已停止的空回复显示中性文案", /m\.stopped \? '（已停止）' : m\.interrupted \? '（已中断/.test(client));
t("已中断的空回复有独立文案", /m\.interrupted \? '（已中断——面板被刷新或流被切换打断，可重试）'/.test(client));
t("模型无输出的空回复有兜底文案", /: '（模型没有输出内容）'/.test(client));
t("宿主侧已停止错误被识别为 stopped 而非 error", /poll\.aborted === true \|\| poll\.error === '已停止'/.test(client));

// ── 6b. 停止后立即收尾（不再等宿主后台段自己收敛）──────────────────
// 历史 bug：客户端只在 poll.done 时才停，而后台段可能正卡在上游静默期的
// await 里永远不置 done → 气泡永久转圈。
t("宿主 chatPoll 暴露 stopped 终态", /const stopped = state\.stopping === true \|\| state\.controller\.signal\.aborted;/.test(host));
t("宿主 done 把 stopped 也算作终态", /done: state\.done \|\| stopped,/.test(host));
t("宿主 stopping 期间 thinking 不再为真", /thinking: !state\.text\.length && !!state\.think\.length && !state\.done && !stopped,/.test(host));
t("客户端消费 poll.stopped 并立即收尾", /if \(poll\.stopped\) \{\s*\n\s*patchReply\(\{ pending: false, stopped: true \}\);\s*\n\s*return;\s*\n\s*\}/.test(client));

// ── 6c. 瞬时态绝不落盘（永久转圈的根因）────────────────────────────
t("落盘前统一净化历史（OPT-4.1 写入 history:<vaultHash> 命名空间键）", /if \(!vaultHashRef\.current\) return;/.test(client) && /LS\.set\('history:' \+ vaultHashRef\.current, sanitizeHistory\(messages\)\.slice\(-40\)\);/.test(client));
t("净化清掉 pending 与 isThinking（OPT-4.3 改为 let next 复用赋值，行为等价）", /next = \{ \.\.\.m, pending: false, isThinking: false \};/.test(client));
t("挂载时净化已存在的存储", /useState\(\(\) => sanitizeHistory\(LS\.get\(HISTORY_KEY, \[\]\)\)\)/.test(client));
t("无正文的 assistant 标记为已中断", /if \(m\.role === 'assistant' && !String\(m\.content \|\| ''\)\.trim\(\) && !m\.error\) next\.interrupted = true;/.test(client));

// ── 6d. 终态可重试 ─────────────────────────────────────────────────
t("中断/停止的消息给重试入口（OPT-4.3 后 isLast prop 承载末位语义）", /\(m\.interrupted \|\| m\.stopped\) && isLast/.test(client));
t("无正文的终态气泡也有重试行（不留死胡同）", /\(m\.interrupted \|\| m\.stopped\) && m\.role === 'assistant' && !String\(m\.content \|\| ''\)\.trim\(\) && isLast/.test(client));
t("动作条显示已中断标记", /m\.interrupted \? h\('span', \{ className: 'ob-usage' \}, '（已中断）'\)/.test(client));

// ── 7. 行为模拟：参数校验（与 client.js 同构）──────────────────────
const pickQuestion = (overrideQuestion, draft) => String(typeof overrideQuestion === 'string' ? overrideQuestion : draft).trim();
t("行为：事件对象被拒，回落 draft", pickQuestion({ type: 'click' }, '真实问题') === '真实问题');
t("行为：undefined 回落 draft", pickQuestion(undefined, '草稿') === '草稿');
t("行为：null 回落 draft", pickQuestion(null, '草稿') === '草稿');
t("行为：字符串参数优先", pickQuestion('重试问题', '旧草稿') === '重试问题');
t("行为：不会产生 [object Object]", pickQuestion({}, 'q') !== '[object Object]' && pickQuestion({ type: 'click' }, 'q') === 'q');

// ── 8. 行为模拟：abort 竞速（与 runOne 同构）────────────────────────
const raceAbort = async (chunks, signal) => {
	let abortResolve = () => {};
	const abortPromise = new Promise((resolve) => {
		abortResolve = () => resolve({ __abort: true });
		if (signal.aborted) abortResolve();
		else signal.addEventListener('abort', abortResolve, { once: true });
	});
	const it = chunks[Symbol.asyncIterator]();
	let text = '';
	try {
		while (true) {
			if (signal.aborted) return { text, aborted: true };
			const pending = it.next();
			pending.catch(() => {});
			const next = await Promise.race([pending, abortPromise]);
			if (next && next.__abort) return { text, aborted: true };
			if (next.done) break;
			text += next.value;
		}
		return { text, aborted: false };
	} finally {
		signal.removeEventListener('abort', abortResolve);
		try { await it.return?.(); } catch { /* ignore */ }
	}
};

// 场景 A：静默期（首个 chunk 永不到达）也能被 abort 打断 —— 这正是历史 bug
const silentStream = {
	[Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: () => Promise.resolve({ done: true }) }),
};
{
	const ac = new AbortController();
	const run = raceAbort(silentStream, ac.signal);
	setTimeout(() => ac.abort(), 10);
	const started = Date.now();
	const r = await run;
	t("A: 静默期 abort 能打断（历史 bug 点）", r.aborted === true && Date.now() - started < 1000);
}
// 场景 B：正常流不被 abort 干扰
{
	const ac = new AbortController();
	const stream = { [Symbol.asyncIterator]: () => { const xs = ['a', 'b', 'c']; let i = 0; return { next: () => Promise.resolve(i < xs.length ? { done: false, value: xs[i++] } : { done: true }), return: () => Promise.resolve({ done: true }) }; } };
	const r = await raceAbort(stream, ac.signal);
	t("B: 正常流完整收集", r.text === 'abc' && r.aborted === false);
}
// 场景 C：中途 abort 保留已收文本
{
	const ac = new AbortController();
	let released = 0;
	const stream = {
		[Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => setTimeout(() => resolve({ done: false, value: 'x' }), 5)), return: () => { released++; return Promise.resolve({ done: true }); } }),
	};
	const run = raceAbort(stream, ac.signal);
	setTimeout(() => ac.abort(), 12);
	const r = await run;
	t("C: 中途停止保留已收正文", r.aborted === true && r.text.length > 0, JSON.stringify(r));
	t("C: 上游迭代器被释放", released >= 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
