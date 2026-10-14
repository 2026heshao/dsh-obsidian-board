// 压测 renderMarkdown：真实模型输出的各种 Markdown 形态，任何抛错都会让气泡变空
import { readFileSync } from "node:fs";

const clientSrc = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const start = clientSrc.indexOf("const MD_STYLE");
const end = clientSrc.indexOf("// ── 主页面");
const code = clientSrc.slice(start, end).replace(/const h = React\.createElement[\s\S]*?;/, "").replace(/\bh\(/g, "hFake(");
const hFake = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c !== null && c !== undefined && c !== false && c !== "") });
globalThis.hFake = hFake;
const box = new Function("hFake", code + "\nreturn { renderMarkdown, renderInline }; ")(hFake);

const cases = [
	["普通段落", "这是一段回答。"],
	["以代码围栏结尾未闭合", "说明如下：\n```js\nconst x = 1;"],
	["代码围栏带语言", "```typescript\ninterface A { b: string }\n```\n结束"],
	["嵌套列表", "- 一级\n  - 二级\n    - 三级"],
	["有序+无序混合", "1. 第一\n- 穿插\n2. 第二"],
	["引用嵌套列表", "> 引用\n> - 项1\n> - 项2"],
	["引用嵌套标题", "> ## 标题\n> 内容"],
	["四级标题（超出支持范围）", "#### 四级标题\n正文"],
	["表格（不支持，应按段落处理）", "| a | b |\n|---|---|\n| 1 | 2 |"],
	["行内引用+粗体+代码混合", "根据 [1] 的 **结论**，用 `npm install` 即可。"],
	["wikilink 带别名", "见 [[笔记A|别名B]] 与 [[笔记C]]。"],
	["纯空白", "   \n\n  "],
	["空字符串", ""],
	["只有换行", "\n\n\n"],
	["未闭合粗体", "这是 **未闭合的粗体"],
	["未闭合行内代码", "这是 `未闭合的代码"],
	["星号列表", "* 星号项\n* 第二项"],
	["加号列表", "+ 加号项"],
	["中文冒号列表", "1）第一\n2）第二"],
	["超长单行", "x".repeat(5000)],
	["含 HTML 标签", "<div>标签</div> 内容"],
	["含反斜杠路径", "路径 C:\\Users\\test\\file.md 与 D:\\桌面"],
	["含 emoji 与特殊符号", "✅ 完成 ⚠️ 注意 → 方向 #标签"],
	["分隔线变体", "---\n内容\n***\n更多"],
	["引用内代码块", "> ```\n> code\n> ```"],
	["列表内含引用", "- 项1\n> 引用"],
	["定义式冒号", "**标题**：内容"],
];

let pass = 0, fail = 0;
for (const [name, input] of cases) {
	try {
		const out = box.renderMarkdown(input, { onCite: () => {}, onWiki: () => {} });
		if (!Array.isArray(out)) { console.log("FAIL", name, "- 返回非数组"); fail++; continue; }
		pass++;
	} catch (e) {
		console.log("FAIL", name, "- THREW:", e.constructor.name, e.message);
		fail++;
	}
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
