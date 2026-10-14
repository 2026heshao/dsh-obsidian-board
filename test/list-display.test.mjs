// 列表展示优化单测：通用名消歧 / 排序 / 目录分组
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex } from "../lib/vault.js";

const vault = join(tmpdir(), "dsh-ob-list-" + Date.now());
const mk = (rel, body = "# x\n内容。\n") => {
	const full = join(vault, rel);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, body);
};

// 模拟真实 vault 的病灶：大量同名 SKILL.md + 普通笔记
mk("skills/公网收集/addyosmani-agent-skills/SKILL.md");
mk("skills/公网收集/obra-superpowers/SKILL.md");
mk("skills/公网收集/vercel-web-design/SKILL.md");
mk("skills/_自定义/宣传页设计体系/SKILL.md");
mk("github/账号与仓库.md", "# 账号与仓库\nGitHub 账号信息。\n");
mk("README.md");
mk("笔记.md", "# 笔记\n普通笔记。\n");

const idx = new VaultIndex();
await idx.ensureIndexed(vault);

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n); } };

const all = idx.listNotes({ limit: 100 }).notes;
const skills = all.filter((n) => n.title === "SKILL");
t("收录 4 篇 SKILL", skills.length === 4);
t("SKILL 全部被识别为通用名", skills.every((n) => n.generic === true));
t("SKILL 标题改用父目录名", skills.every((n) => !/^SKILL$/i.test(n.display)));
t("4 篇 SKILL 的 display 互不相同", new Set(skills.map((n) => n.display)).size === 4);
t("重名时 display 含两级父目录（消除同层重名）", skills.every((n) => n.ambiguous ? n.display.includes("/") : true));
t("副标题给出可区分路径", skills.every((n) => typeof n.sub === "string" && n.sub.includes("skills")));

const readme = all.find((n) => n.title === "README");
t("根目录 README 通用名但无父目录 → 保留原名", readme && readme.generic && readme.display === "README");

const normal = all.find((n) => n.title === "账号与仓库");
t("普通笔记保留原标题", normal && normal.display === "账号与仓库" && normal.generic === false);
t("普通笔记副标题是目录", normal && normal.sub === "github");

// 排序
const byName = idx.listNotes({ limit: 100, sort: "name" }).notes.map((n) => n.display);
const sorted = [...byName].sort((a, b) => a.localeCompare(b, "zh"));
t("name 排序生效", JSON.stringify(byName) === JSON.stringify(sorted));

const byPath = idx.listNotes({ limit: 100, sort: "path" }).notes.map((n) => n.dir);
const pathSorted = [...byPath].sort((a, b) => a.localeCompare(b, "zh"));
t("path 排序生效", JSON.stringify(byPath) === JSON.stringify(pathSorted));

const byMtime = idx.listNotes({ limit: 100, sort: "mtime" }).notes.map((n) => n.mtimeMs);
t("mtime 排序生效（降序）", byMtime.every((v, i) => i === 0 || byMtime[i - 1] >= v));

// 搜索路径也走同一消歧（search 返回 noteTitle 原文，展示层用 display）
const hits = idx.search("addyosmani agent skills").hits;
t("搜索仍能定位到 SKILL 内容", hits.length > 0);

rmSync(vault, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
