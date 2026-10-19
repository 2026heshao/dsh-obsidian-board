// OPT-2.1 回归：saveNote 的 refs 改为合法 YAML 列表（每文件一个 refs: 键）
// 历史 bug：refs 曾写成单行字符串值 refs: "[[A]] [[B]]"——引用更新后文件里出现
// 两个 refs: 键（重复 key 是非法 YAML），Obsidian 直接丢字段。
// 断言策略：文本断言 + new Function 行为模拟（与既有套件同风格）。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

// ── 1. 文本断言：YAML 列表构造存在、旧重复 key 写法绝迹 ─────────────
t("saveNote RPC 存在", /async saveNote\(payload\)/.test(host));
t("citations 数组守卫存在", /const cites = Array\.isArray\(payload\?\.citations\) \? payload\.citations : \[\];/.test(host));
t("refs 为 YAML 列表项构造（  - \"[[...]]\" 形状）", /\.map\(\(c\) => `  - "\[\[\$\{c\.notePath\.replace\(/.test(host));
t("refs 键只在有引用时写入（header.push(\"refs:\", ...refs)）", /if \(refs\.length\) header\.push\("refs:", \.\.\.refs\);/.test(host));
t("引用数量上限 20（防 frontmatter 爆炸）", /cites\.filter\(\(c\) => c\?\.notePath\)\.slice\(0, 20\)/.test(host));
t("旧的单行字符串值写法已不存在（header.push(\"refs: \"…）", !/header\.push\("refs: "/.test(host));
t("旧的 refs: \"[[…]]\" 拼接写法已不存在", !/refs: "\[\[/.test(host));

// ── 2. 行为模拟：从源码原样抽取 refs 构造表达式执行 ─────────────────
const refMatch = host.match(/const refs = (cites\.filter[\s\S]*?);/);
t("可抽取 refs 构造表达式", !!refMatch);
const makeRefs = refMatch ? new Function("cites", "return " + refMatch[1]) : () => [];
const sample = [
	{ notePath: "AI 回答/概念.md", noteTitle: "概念" },
	{ notePath: "notes/实践.md", noteTitle: "" },
	{ noteTitle: "无路径引用应被过滤" },
	null,
];
const refsOut = makeRefs(sample);
t("行为：非空引用产出 YAML 列表（2 条，无路径引用被过滤）", refsOut.length === 2, JSON.stringify(refsOut));
t("行为：列表项为合法 YAML 列表行（.md 只在链接目标剥掉，别名缺省回退原路径）", refsOut[0] === `  - "[[AI 回答/概念|概念]]"` && refsOut[1] === `  - "[[notes/实践|notes/实践.md]]"`, JSON.stringify(refsOut));
t("行为：25 条引用被截断到 20", makeRefs(Array.from({ length: 25 }, (_, i) => ({ notePath: "n" + i + ".md" }))).length === 20);
t("行为：零引用产出空数组（不写 refs 键的前提成立）", makeRefs([]).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
