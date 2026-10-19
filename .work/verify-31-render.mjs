// 实测 OPT-3.1：真实渲染一段含表格 / h4-h6 / 链接 / 斜体 / 任务列表的 markdown，
// 打印渲染出的节点树，验证 P0 缺陷是否真的修好（不依赖任何测试断言）。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const start = src.indexOf("// ── 常量与工具");
const end = src.indexOf("// ── 主页面");
const code = src.slice(start, end);

const box = new Function("h", "useState", "useEffect", "useCallback", "useMemo", "useRef",
	code + "\nreturn { renderMarkdown, renderInline, MD_STYLE };")(
	(tag, props, ...kids) => ({ type: tag, props: props || {}, children: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) }),
	() => [undefined, () => {}], () => {}, (f) => f, (f) => f(), { current: null },
);

// 把节点树压成可读的轮廓
function outline(node, depth = 0) {
	const pad = "  ".repeat(depth);
	if (node === null || node === undefined) return "";
	if (typeof node === "string" || typeof node === "number") return pad + JSON.stringify(String(node)) + "\n";
	if (Array.isArray(node)) return node.map((n) => outline(n, depth)).join("");
	const t = node.type;
	const label = typeof t === "function" ? "Component" : t;
	const kids = (node.children || []).map((k) => outline(k, depth + 1)).join("");
	return pad + "<" + label + ">" + "\n" + kids;
}

const sample = `#### 四级标题
##### 五级标题
###### 六级标题

这是一段带 **粗体** 和 *斜体* 的正文，还有 [标准链接](https://example.com) 和 [引用1]。

| 方案 | 优点 | 缺点 |
| --- | :-- | --: |
| RRF | 无需调参 | 需要多路召回 |
| 线性加权 | 简单 | 权重要调 |

- [ ] 未完成任务
- [x] 已完成任务
- 普通列表项

> 引用块里的 **粗体**
> 第二行

\`\`\`js
# 这是代码里的注释，不是标题
const a = 1;
\`\`\`
`;

const tree = box.renderMarkdown(sample, { onCite: () => {}, onWiki: () => {} });

console.log("=== 渲染节点树轮廓 ===");
console.log(outline(tree));

// 统计关键标签是否真的产出了
const flat = [];
(function walk(n) {
	if (!n) return;
	if (Array.isArray(n)) return n.forEach(walk);
	if (typeof n !== "object") return;
	flat.push(n.type);
	(n.children || []).forEach(walk);
})(tree);

const seen = {};
for (const t of flat) seen[t] = (seen[t] || 0) + 1;
console.log("=== 实际产出的标签计数 ===");
console.log(JSON.stringify(seen, null, 0));

const must = ["table", "thead", "tbody", "tr", "th", "td", "h4", "h5", "h6", "a", "em", "input", "blockquote", "pre", "b"];
console.log("\n=== P0-3.1 关键能力核对 ===");
for (const tag of must) {
	const ok = (seen[tag] || 0) > 0;
	console.log((ok ? "OK   " : "MISS ") + tag + " x" + (seen[tag] || 0));
}

// 反向验证：代码围栏里的 "# 这是代码里的注释" 不应被当成标题
const flatStr = JSON.stringify(tree);
const fenceLeak = flatStr.includes('"这是代码里的注释"') && (seen.h1 || 0) > 0;
console.log("\n=== 反向验证：围栏内 # 注释未被当作标题 ===");
console.log("h1 计数 = " + (seen.h1 || 0) + "（应为 0）");

// 反向验证：非 http(s) 链接不生成 <a>
const danger = box.renderMarkdown("[点我](javascript:alert(1))", {});
const dangerHasA = JSON.stringify(danger).includes('"a"');
console.log("\n=== 反向验证：javascript: 伪协议不生成 <a> ===");
console.log((dangerHasA ? "FAIL " : "OK   ") + "未生成 <a>；输出=" + JSON.stringify(danger).slice(0, 150));
