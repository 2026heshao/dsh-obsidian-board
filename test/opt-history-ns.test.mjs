// OPT-4.1 回归：历史 localStorage 按 vault 命名空间（history:<vaultHash>）
// 历史 bug：全 vault 共用一个历史键，切仓库后对话串库。现契约：正式键 =
// history:<djb2(vaultPath)>；旧单键 HISTORY_KEY 只在首次接管某 vault 时读一次
// 做迁移，迁完旧键保留不删（留一版可回滚）。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. djb2 vaultHashOf 实现 ────────────────────────────────────────
t("vaultHashOf 纯函数存在", /const vaultHashOf = \(p\) => \{/.test(client));
t("djb2 初始种子 5381", client.includes("let hash = 5381;"));
t("djb2 混合步（(hash << 5) + hash + charCode）>>> 0", /\(\(hash << 5\) \+ hash \+ s\.charCodeAt\(i\)\) >>> 0/.test(client));
t("输出 8 位 hex（padStart(8, '0')）", /padStart\(8, '0'\)/.test(client));

// ── 2. 命名空间键：正式读写都走 history:<hash> ─────────────────────
t("正式键前缀 history:< 至少两处（接管读 + 持久化写）", (client.match(/'history:' \+/g) || []).length >= 2);
t("持久化写走命名空间键", /LS\.set\('history:' \+ vaultHashRef\.current, sanitizeHistory\(messages\)\.slice\(-40\)\);/.test(client));
t("vaultHashRef 未就绪时跳过落盘（不写错命名空间）", /if \(!vaultHashRef\.current\) return;/.test(client));
t("旧单键 HISTORY_KEY 不再被直接写入（只保留迁移读取）", !/LS\.set\(HISTORY_KEY,/.test(client));

// ── 3. 旧键一次性迁移逻辑存在 ──────────────────────────────────────
t("接管函数 adoptVaultHistory 存在", /const adoptVaultHistory = useCallback\(\(res\) => \{/.test(client));
t("同 hash 幂等短路（hash === vaultHashRef.current）", /if \(hash === vaultHashRef\.current\) return;/.test(client));
t("一次性读取旧键（LS.get(HISTORY_KEY, null)）", /const legacy = LS\.get\(HISTORY_KEY, null\);/.test(client));
t("旧数据非空才迁移并写入新命名空间", /if \(Array\.isArray\(legacy\) && legacy\.length\) \{\s*\n\s*LS\.set\(nsKey, legacy\);/.test(client));
t("迁移后旧键保留不删（无 LS.remove / removeItem HISTORY_KEY）", !/LS\.remove\(HISTORY_KEY\)|localStorage\.removeItem\(HISTORY_KEY\)/.test(client));

// ── 4. 行为模拟：从源码原样抽取 vaultHashOf 执行 ────────────────────
const fnMatch = client.match(/const vaultHashOf = \(p\) => \{[\s\S]*?\n\};/);
t("可抽取 vaultHashOf 函数体", !!fnMatch);
const vaultHashOf = fnMatch ? new Function(fnMatch[0] + "\nreturn vaultHashOf;")() : () => "default";
t("行为：空/非法路径统一 'default'", vaultHashOf("") === "default" && vaultHashOf(null) === "default" && vaultHashOf("   ") === "default");
t("行为：djb2 已知向量 djb2('a') = 0002b606", vaultHashOf("a") === "0002b606");
t("行为：输出恒为 8 位小写 hex", /^[0-9a-f]{8}$/.test(vaultHashOf("D:\\桌面\\某个仓库")));
t("行为：确定性（同路径两次一致）", vaultHashOf("D:\\vaultA") === vaultHashOf("D:\\vaultA"));
t("行为：不同 vault 路径散列不同（命名空间隔离的前提）", vaultHashOf("D:\\vaultA") !== vaultHashOf("D:\\vaultB"));
t("行为：命名空间键拼装 history:<hash>", "history:" + vaultHashOf("") === "history:default");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
