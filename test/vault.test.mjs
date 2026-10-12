// vault.js 功能测试：构造临时 vault，验证扫描/索引/检索/读取全链路。
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex, tokenize } from "../lib/vault.js";

const vault = join(tmpdir(), "dsh-ob-test-" + Date.now());
mkdirSync(join(vault, "projects"), { recursive: true });

writeFileSync(join(vault, "RAG笔记.md"), `---
tags: [AI, RAG]
aliases: [检索增强]
---
# 概念
RAG 是检索增强生成，先检索再生成。

# 实践
用 BM25 做混合检索，效果稳定。embedding 可以后补。
`);
writeFileSync(join(vault, "projects", "dsh-plugin.md"), `# DSH 插件开发
插件分宿主半和客户端半。

## 装配
package.json 声明 dsh.bundle.patch 和 dsh.client。
main slot 注册后可以在中栏拥有一整个页面。
`);
writeFileSync(join(vault, "daily.md"), "今天天气不错，出去跑步五公里。\n");

const index = new VaultIndex();
await index.ensureIndexed(vault);
const st = index.status();
console.log("status:", JSON.stringify(st));
if (st.noteCount !== 3) throw new Error("noteCount != 3");
if (st.chunkCount < 3) throw new Error("chunkCount < 3");

// 中文语义检索
const r1 = index.search("检索增强生成怎么做");
console.log("r1 top3:", r1.hits.slice(0, 3).map((h) => h.noteTitle + " :: " + h.heading + " :: " + h.score));
if (!r1.hits.length || r1.hits[0].noteTitle !== "RAG笔记") throw new Error("中文检索未命中 RAG笔记");

// 英文 + 路径检索
const r2 = index.search("DSH 插件 main slot");
console.log("r2 top2:", r2.hits.slice(0, 2).map((h) => h.noteTitle + " :: " + h.score));
if (!r2.hits.length || r2.hits[0].noteTitle !== "dsh-plugin") throw new Error("英文检索未命中 dsh-plugin");

// 标签路由
const r3 = index.search("总结一下 #AI 的要点");
console.log("r3 top2:", r3.hits.slice(0, 2).map((h) => h.noteTitle + " :: " + h.score));
if (!r3.hits.length || r3.hits[0].noteTitle !== "RAG笔记") throw new Error("标签路由未命中 RAG笔记");

// 别名（检索增强 是 RAG笔记 的别名，应通过标题路径/正文命中）
const r4 = index.search("检索增强");
console.log("r4 top2:", r4.hits.slice(0, 2).map((h) => h.noteTitle + " :: " + h.score));
if (!r4.hits.length) throw new Error("别名检索无结果");

// 无关查询
const r5 = index.search("量子纠缠薛定谔方程");
console.log("r5 hits:", r5.hits.length, "(应为 0 或极低分)");
if (r5.hits.length && r5.hits[0].score > 6) throw new Error("无关查询误报过高");

// listNotes 与 readNote
const list = index.listNotes();
if (list.total !== 3) throw new Error("listNotes total != 3");
const note = await index.readNote(vault, "projects/dsh-plugin.md");
if (!note.content.includes("宿主半")) throw new Error("readNote 内容不符");

// 路径穿越防护
let blocked = false;
try { await index.readNote(vault, "../outside.md"); } catch { blocked = true; }
if (!blocked) throw new Error("路径穿越未被拦截");

// 增量刷新
writeFileSync(join(vault, "new-note.md"), "# 新笔记\n增量刷新测试内容 unique-token-xyz。\n");
await index.ensureIndexed(vault);
const r6 = index.search("unique-token-xyz");
if (!r6.hits.length) throw new Error("增量索引未收录新笔记");

console.log("tokenize sample:", tokenize("RAG 检索增强 generation").slice(0, 12).join(","));
rmSync(vault, { recursive: true, force: true });
console.log("\nALL VAULT TESTS PASSED");
