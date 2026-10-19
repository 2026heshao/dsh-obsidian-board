// OPT-2.5 回归：listModels 目录拉取并行化（Promise.allSettled）
// 历史 bug：串行逐个 provider 拉（每个 8s 超时），12 个 provider 最坏 96s；
// 并行后总耗时 ≤ 8s，先完成的 provider 结果照常聚合，单点失败/超时兜底空数组。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

// ── 1. 文本断言：并行发起 + 聚合 ────────────────────────────────────
t("OPT-2.5 注释锚点存在", host.includes("OPT-2.5"));
t("listModels 用 Promise.allSettled 并行拉目录", /const settled = await Promise\.allSettled\(providers\.slice\(0, 12\)\.map\(async \(provider\) => \{/.test(host));
t("并发上限 12 个 provider", /providers\.slice\(0, 12\)/.test(host));
t("每个 provider 独立 8s 超时", /withTimeout\(Promise\.resolve\(llm\.listModels\(provider\)\), 8000, "模型目录"\)/.test(host));
t("单 provider 失败/超时兜底空数组（不拖垮目录）", /catch \{ \/\* 单 provider 失败\/超时不影响其它 \*\/ return \[\]; \}/.test(host));
t("fulfilled 结果照常聚合进 models", /if \(r\.status === "fulfilled" && Array\.isArray\(r\.value\)\) models\.push\(\.\.\.r\.value\);/.test(host));
t("每 provider 模型数上限 80", /items\.slice\(0, 80\)/.test(host));

// ── 2. 行为模拟：从源码原样抽取 enrichRow 执行（富化不回归）────────
const effMatch = host.match(/const EFFORT_VALUES = \[[^\]]*\];/);
const rowStart = host.indexOf("const enrichRow = (provider, id, m, row) => {");
const rowEnd = rowStart > 0 ? host.indexOf("\n\t\tif (typeof llm.listModels", rowStart) : -1;
t("可抽取 EFFORT_VALUES 与 enrichRow", !!effMatch && rowStart > 0 && rowEnd > rowStart);
const enrichRow = (effMatch && rowEnd > rowStart)
	? new Function(effMatch[0] + "\n" + host.slice(rowStart, rowEnd) + "\nreturn enrichRow;")()
	: () => ({});
const r1 = enrichRow("p", "m1", "m1", { name: "模型一", billing: { free: true, credits: 3, badges: ["fast"] }, contextWindow: "200000", reasoning: { supports: true, supportedEfforts: ["low", "ultra", "max"], defaultEffort: "high" } });
t("行为：free/credits/badges/contextWindow 富化齐全", r1.free === true && r1.credits === 3 && r1.badges.length === 1 && r1.contextWindow === 200000);
t("行为：efforts 过滤到合法词表（ultra 被剔除）", JSON.stringify(r1.efforts) === JSON.stringify(["low", "max"]) && r1.defaultEffort === "high");
const r2 = enrichRow("p", "m2", undefined, { name: "无档位" });
t("行为：未声明档位的模型不带 efforts 键", !("efforts" in r2));
const r3 = enrichRow("p", "m3", { label: "别名" }, {});
t("行为：label 优先用目录/条目名，缺省回退 id", r3.label === "别名" && enrichRow("p", "m4", "m4", {}).label === "m4");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
