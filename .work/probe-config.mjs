import { readFileSync } from "node:fs";

const t = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

// 复刻 cold-start / mojibake 的切片正则
const stripped = t.replace(/export const Config[\s\S]*?;\n/, "");
console.log("[1] 原长", t.length, "→ 去掉 Config 后", stripped.length, "（删去", t.length - stripped.length, "字节）");

const start = t.indexOf("export const Config");
const firstSemi = t.indexOf(";\n", start);
const slice = t.slice(start, firstSemi + 2);
console.log("[2] Config 起点", start, "首个 ;\\n 位置", firstSemi);
console.log("[3] 切片内层 ;\\n 个数 =", (slice.match(/;\n/g) || []).length, "（必须为 1，即只有结尾那个）");
console.log("[4] 切片最后 60 字符 =", JSON.stringify(slice.slice(-60)));
console.log("[5] 去掉 Config 后是否仍以 export default 收尾 =", /export default\s+\w+;\s*$/.test(stripped));
console.log("[6] 去掉 Config 后是否仍含 export class ObsidianBoardGateway =", stripped.includes("export class ObsidianBoardGateway"));

// 三个 index.js 全局硬禁令复查
console.log("[7] 全文 export class 出现次数 =", (t.match(/export class/g) || []).length, "（必须为 1）");
console.log("[8] 全文 export default 出现次数 =", (t.match(/export default/g) || []).length, "（必须为 1）");
const lastExportDefault = t.lastIndexOf("export default");
const tail = t.slice(lastExportDefault);
console.log("[9] export default 之后是否只有一行 =", JSON.stringify(tail));

// stop-cycle 的两个下标
const a = t.indexOf("ObsidianBoardGateway._streams.set(sessionId, state)");
const b = t.indexOf("await abortable(this._multiHits(");
console.log("[10] _streams.set idx =", a, " abortable( idx =", b, " 顺序成立 =", a > -1 && b > -1 && a < b);

// EFFORT_VALUES → export class 切片
const e1 = t.indexOf("const EFFORT_VALUES");
const e2 = t.indexOf("export class ObsidianBoardGateway");
console.log("[11] model-picker 切片", e1, "→", e2, " 长度", e2 - e1, " 成立 =", e1 > -1 && e1 < e2);

// Config 字段清单（看 I1 加了什么）
console.log("\n=== Config 内字段 ===");
for (const m of slice.matchAll(/^\t\t(\w+):\s*\{/gm)) console.log("  " + m[1]);
