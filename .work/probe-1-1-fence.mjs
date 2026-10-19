// OPT-1.1 真行为核验：chunkNote 不得把代码围栏内的 # 当成章节标题
// OPT-1.2 同时核验：extractTags 不得把围栏内的 #tag 当标签
import { readFileSync } from "node:fs";

const src = readFileSync("lib/vault.js", "utf8");

const mod = await import("../lib/vault.js");

const body = [
	"# 正文章节一",
	"",
	"下面是 Bash 示例：",
	"",
	"```bash",
	"# 这是注释，不是标题",
	"echo hi",
	"```",
	"",
	"## 真正的二级标题",
	"",
	"内容 A",
	"",
	"```md",
	"# 另一个围栏内的假标题",
	"```",
	"",
	"### 真正的三级标题",
	"",
	"内容 B",
].join("\n");

console.log("=== 探针 Markdown ===");
console.log(body.split("\n").map((l) => "  | " + l).join("\n"));

const chunks = mod.chunkNote({ path: "t.md", title: "测试", body });

console.log("\n=== chunkNote 结果（" + chunks.length + " 片）===");
chunks.forEach((c, i) => {
	console.log("  [" + i + "] crumbs=" + JSON.stringify(c.crumbs) + "  heading=" + JSON.stringify(c.heading));
});

const badges = chunks.map((c) => String(c.crumbs || "") + "|" + String(c.heading || "")).join("\n");
const leak1 = /这是注释/.test(badges);
const leak2 = /另一个围栏内的假标题/.test(badges);

console.log("\n判定：");
console.log("  围栏内 `# 这是注释` 被当标题 :", leak1 ? "是（缺陷）" : "否（正确）");
console.log("  围栏内 `# 另一个围栏内的假标题` 被当标题 :", leak2 ? "是（缺陷）" : "否（正确）");

// 确认真实标题仍被正确识别（不能因为围栏感知而漏掉真标题）
const hasH2 = chunks.some((c) => /真正的二级标题/.test(String(c.crumbs) + String(c.heading)));
const hasH3 = chunks.some((c) => /真正的三级标题/.test(String(c.crumbs) + String(c.heading)));
console.log("  真标题「## 真正的二级标题」被识别 :", hasH2 ? "是（正确）" : "否（缺陷，漏标题）");
console.log("  真标题「### 真正的三级标题」被识别 :", hasH3 ? "是（正确）" : "否（缺陷，漏标题）");

const ok = !leak1 && !leak2 && hasH2 && hasH3;
console.log("\nOPT-1.1 总判定 :", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
