import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const anchors = [
  "const h = React.createElement",
  "// ── 常量与工具",
  "const SIDEBAR_DEFAULT",
  "function clampSidebar",
  "const MD_STYLE",
  "// ── 主页面",
  "const ObsidianPage",
  "// ── 浏览器侧 typert 契约",
  "OBSIDIAN_CONTRIBUTION",
];

console.log("=== client.js 锚点（每个必须恰好出现 1 次，且相对顺序不变） ===");
let prev = -1;
let ok = true;
for (const a of anchors) {
  const first = src.indexOf(a);
  let count = 0;
  let i = -1;
  while ((i = src.indexOf(a, i + 1)) !== -1) count++;
  const orderOk = first > prev;
  if (first === -1 || !orderOk) ok = false;
  console.log(
    (first === -1 ? "缺失" : "idx " + first).padEnd(12) +
      " 出现 " + count + " 次".padEnd(8) +
      " 顺序" + (orderOk ? "OK" : "BAD").padEnd(5) +
      "  " + a
  );
  if (first > -1) prev = first;
}
console.log("锚点总体:", ok ? "全部成立" : "有破坏");

// 复刻 smoke-render 的切片
const s = src.indexOf("// ── 常量与工具");
const e = src.indexOf("// ── 浏览器侧 typert 契约");
const code = src.slice(s, e);
console.log("\n=== smoke-render 切片 ===");
console.log("start", s, "end", e, "长度", code.length);
console.log("切片内 const ObsidianPage =", code.includes("const ObsidianPage"));
console.log("切片内 return module.exports =", /return module\.exports;/.test(code));
console.log("切片内 闭合 }); =", /\}\);\s*$/.test(code));

// 复刻 mature / render-stress 的切片 + 正则改写
const m1 = src.indexOf("const MD_STYLE");
const m2 = src.indexOf("// ── 主页面");
let mdCode = src.slice(m1, m2);
console.log("\n=== mature/render-stress 切片 ===");
console.log("start", m1, "end", m2, "长度", mdCode.length);
const rewritten = mdCode
  .replace(/const h = React\.createElement[\s\S]*?;/, "")
  .replace(/\bh\(/g, "hFake(");
console.log("改写后是否仍含 h( =", /(^|[^A-Za-z0-9_$])h\(/.test(rewritten));
console.log("改写后 hFake( 个数 =", (rewritten.match(/hFake\(/g) || []).length);

// note-tree 切片
const n1 = src.indexOf("function buildNoteTree");
const n2 = src.indexOf("const ObsidianPage");
console.log("\n=== note-tree 切片 ===", n1, "→", n2, "长度", n2 - n1, "成立 =", n1 > -1 && n1 < n2);

// thinking 锚点：ThinkBlock + 主页面 + 那两个 index.js 锚点
const t1 = src.indexOf("function ThinkBlock");
console.log("\n=== thinking 切片（client 侧）===", t1, "→", m2, "成立 =", t1 > -1 && t1 < m2);
const thinkLine = "if (!!open !== wasOpen) { setWasOpen(!!open); setExpanded(!!open); }";
console.log("ThinkBlock 折叠原文整行存在 =", src.includes(thinkLine));

// MD_STYLE 新键检查
console.log("\n=== MD_STYLE 键 ===");
const mdStart = src.indexOf("const MD_STYLE");
const mdEnd = src.indexOf("};", mdStart);
const mdBlock = src.slice(mdStart, mdEnd);
const keys = [...mdBlock.matchAll(/^\t(\w+):\s*\{/gm)].map((m) => m[1]);
console.log(keys.join(", ") || "(解析失败)");
for (const need of ["h4", "h5", "h6", "table", "th", "td", "a", "em"]) {
  console.log("  需要", need, "=", keys.includes(need) ? "有" : "缺");
}
