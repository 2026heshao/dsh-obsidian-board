// 回归：知识库"明明有却搜不到" + 消息 source 契约 + provider/model 成对
//
// 事故 1（总是输出异常）：宿主 MessageBase 要求每条消息 { id, content, source }。
//   宿主 llm 的 forAdapter() 读 assistant 消息的 `message.source.replayState`；
//   缺 source → "Cannot read properties of undefined (reading 'replayState')"。
//   首轮无历史能成功，次轮起带 assistant 历史必崩。
//
// 事故 2（回退链报 INVALID_MODEL_INFO / model "undefined"）：
//   llm.listModels() 必须传 provider（无参返回空），历史版本只拿 provider 名就发流。
//
// 事故 3（知识库搜不到）：① 隐藏目录被整体跳过（.workbuddy/memory 是真实笔记）；
//   ② 第三方收集语料占 60% chunk，把用户自有笔记挤出 topK；
//   ③ 长标识符（github_pat_ 这类）被 bigram 切碎，权重不足。
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const vaultSrc = readFileSync(new URL("../lib/vault.js", import.meta.url), "utf8");

// ── 1. 消息 source 契约（事故 1）────────────────────────────────────
t("buildMessages 注入 id（宿主 MessageBase 要求）", /id: randomUUID\(\)/.test(host));
t("system 消息 source={kind:'system-prompt'}", /source: \{ kind: "system-prompt" \}/.test(host));
t("user 消息 source={kind:'user'}", /source: isAssistant \? modelSource\(\) : \{ kind: "user" \}/.test(host));
t("assistant 消息 source={kind:'model',provider,model}", /const modelSource = \(\) => \(\{ kind: "model", provider/.test(host));
t("randomUUID 从 node:crypto 导入", /import \{ randomUUID \} from "node:crypto"/.test(host));
t("两处 buildMessages 调用都传 route", (host.match(/buildMessages\(\{[\s\S]{0,200}?route[,\s}]/g) || []).length >= 2);

// ── 2. provider+model 成对（事故 2）────────────────────────────────
t("回退链有 pushPair 成对守卫（拒空 model）", (host.match(/const pushPair = \(provider, model\)/g) || []).length >= 1); // OPT-2.6 非流式 chat 已下线，仅存流式回退链一处
t("pushPair 拒绝空 model（不成对不发）", /if \(!p \|\| !m\) return;/.test(host));
t("回退链逐个 provider 调 listModels(provider)", /llm\.listModels\(route\)/.test(host));
t("不再存在无参 listModels() 调用", !/llm\.listModels\(\)/.test(host));
t("不再存在 provider-only 候选（model: \"\"）", !/pairs\.push\(\{ provider: name, model: "" \}\)/.test(host));

// ── 3. 扫描：隐藏目录白名单（事故 3①）──────────────────────────────
t("ALLOW_DOT_DIRS 放行 .workbuddy", /ALLOW_DOT_DIRS = new Set\(\["\.workbuddy"\]\)/.test(vaultSrc));
t("scanVault 支持 includeDotDirs 选项", /scanVault\(vaultPath, \{ includeDotDirs = true \} = \{\}\)/.test(vaultSrc));
t("白名单外的点目录仍跳过", /if \(!includeDotDirs \|\| !ALLOW_DOT_DIRS\.has\(e\.name\)\) continue;/.test(vaultSrc));

// ── 4. 语料降权 + 字面串加权（事故 3②③）──────────────────────────
t("存在 VENDORED_WEIGHT 降权系数", /const VENDORED_WEIGHT = [\d.]+/.test(vaultSrc));
t("isVendoredPath 识别 _公网收集", vaultSrc.includes('"_公网收集"'));
t("检索中对收藏语料降权", /if \(isVendoredPath\(c\.notePath\)\) s \*= VENDORED_WEIGHT/.test(vaultSrc));
t("长标识符字面串命中加权", /hay\.includes\(lit\)/.test(vaultSrc));
t("字面串提取覆盖 latin 标识符与中文", /\[A-Za-z0-9_\]\[A-Za-z0-9_\.-\]\{5,\}/.test(vaultSrc));

// ── 5. 行为验证：真实文件系统（临时 vault）─────────────────────────
const { VaultIndex, scanVault, isVendoredPath } = await import("../lib/vault.js");
const vault = join(tmpdir(), "dsh-ob-recall-" + Date.now());
mkdirSync(join(vault, ".workbuddy", "memory"), { recursive: true });
mkdirSync(join(vault, "github"), { recursive: true });
mkdirSync(join(vault, "skills", "_公网收集", "public-skills", "security"), { recursive: true });

// 用户自己的笔记（含凭据）
writeFileSync(join(vault, "github", "账号与仓库.md"),
	"# 账号与仓库\n\ngithub 令牌：github_pat_11ABCDEFG0mjl0JAtYXaRx_Ninf6HS5ef9IaTiBFAiJ3duqpvZsUJ8fN9ay2AuhezZH5YX6K7MParfbuJF\n");
// 隐藏目录里的用户记忆（历史版本被整体跳过）
writeFileSync(join(vault, ".workbuddy", "memory", "2026-10-03.md"),
	"# 2026-10-03 记忆\n今天记录了 github token 的轮换流程与注意事项。\n");
// 第三方收集语料：用同一批通用词制造噪声
for (let i = 0; i < 6; i++) {
	writeFileSync(join(vault, "skills", "_公网收集", "public-skills", "security", `noise${i}.md`),
		`# token api workflow security guide ${i}\n` + "token api workflow security github repository credential 综述。\n".repeat(30));
}

const files = await scanVault(vault);
t("扫描放行 .workbuddy/memory", files.some((f) => f.includes(".workbuddy")));
t("扫描仍跳过 .obsidian 之外的点目录（无 .obsidian 时无副作用）", !files.some((f) => f.includes(".trash")));

const idx = new VaultIndex();
await idx.ensureIndexed(vault);
t("索引包含隐藏目录里的笔记", idx.status().noteCount === 8, "noteCount=" + idx.status().noteCount);

const r1 = idx.search("github令牌", { topK: 3 });
const patRank = r1.hits.findIndex((h) => /github_pat_/.test(h.text));
t("含 github_pat_ 的笔记进前列（历史 bug 点）", patRank >= 0 && patRank <= 1, "rank=" + patRank + " " + JSON.stringify(r1.hits.map((h) => h.notePath)));

const r2 = idx.search("找出github仓库的token", { topK: 5 });
const userNoteRank = r2.hits.findIndex((h) => h.notePath === "github/账号与仓库.md" || h.notePath.includes(".workbuddy"));
t("用户自有笔记不被公网语料挤出 top5", userNoteRank >= 0, JSON.stringify(r2.hits.map((h) => h.notePath)));
const vendoredTop = r2.hits.findIndex((h) => isVendoredPath(h.notePath));
t("公网语料不占据第一名", vendoredTop !== 0, JSON.stringify(r2.hits.map((h) => h.notePath)));

const r3 = idx.search("github_pat_11ABCDEFG", { topK: 3 });
t("长标识符原样命中（字面串加权）", /github_pat_/.test(r3.hits[0]?.text || ""), JSON.stringify(r3.hits.map((h) => h.notePath)));

rmSync(vault, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
