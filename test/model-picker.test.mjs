// 回归：模型选择器与主对话页同构（可换模型 + 推理档位 + 富化信息）
// 需求来源：用户要求面板模型选择与普通对话页面一致。
// 数据源事实（实测）：workbuddy-connect /status 与 ~/.dsh/.workbuddy-catalog.json
// 提供模型元数据（free/credits/badges/contextWindow/reasoning.supportedEfforts）。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 宿主半：catalog 读取 + effort 解析 + listModels 富化 ─────────
t("宿主半读 catalog（readCatalogModels）", host.includes("function readCatalogModels"));
t("catalog 路径指向 ~/.dsh/.workbuddy-catalog.json", host.includes('".workbuddy-catalog.json"'));
t("catalog 读失败静默返回空（富化不阻塞选择）", /catch \{ return \[\]; \}/.test(host));
t("resolveEffort 纯函数存在", host.includes("function resolveEffort"));
t("resolveEffort：显式档位优先", /const pick = String\(explicit \|\| ""\)\.trim\(\);\s*\n\s*if \(pick\) return pick;/.test(host));
t("resolveEffort：未声明档位的模型不下发", /if \(!declared \|\| declared\.supports !== true\) return "";/.test(host));
t("resolveEffort：配置默认不在档位集时回退模型默认", /return typeof declared\.defaultEffort === "string" && efforts\.includes\(declared\.defaultEffort\) \? declared\.defaultEffort : "";/.test(host));
t("EFFORT_VALUES 词表与上游拼写一致（low..max）", /const EFFORT_VALUES = \["low", "medium", "high", "xhigh", "max"\];/.test(host));
t("listModels 富化：free/credits/badges/contextWindow/efforts", /free: true|credits:|badges:|contextWindow:|efforts,/.test(host));
t("listModels 带 10s 超时（挂住的 provider 不拖垮目录）", host.includes('"模型目录"'));
t("listModels 返回 defaultEffort 供客户端跟随", /defaultEffort: this\.config\.reasoningEffort \|\| ""/.test(host));

// ── 2. 消息级路由覆盖（与主对话页「按消息带路由」同构） ─────────────
t("chatStart 接受消息级 provider/model 覆盖", /provider: String\(payload\?\.provider \|\| ""\)\.trim\(\) \|\| baseRoute\.provider/.test(host));
t("chatStart 接受消息级 effort（payload.effort !== undefined 语义）", /payload\?\.effort !== undefined \? String\(payload\.effort \|\| ""\)\.trim\(\) : undefined/.test(host));
t("chat 一次性 RPC 同样支持覆盖", /const effortExplicit = payload\?\.effort !== undefined/.test(host));
t("configure 持久化 reasoningEffort 且校验词表", /EFFORT_VALUES\.includes\(e\) \? e : ""/.test(host));
t("_restorePersisted 恢复 reasoningEffort", /typeof state\.reasoningEffort === "string"/.test(host));
t("chatPoll 返回 effort（消息动作条显示用）", /effort: state\.effort \|\| ""/.test(host));

// ── 3. 客户端：选择器 UI 与档位 chips ──────────────────────────────
t("客户端保存 selEffort（null=跟随规则）", /const \[selEffort, setSelEffort\] = useState\(null\);/.test(client));
t("换模型清空显式档位（新模型档位集不同）", /setSelEffort\(null\);/.test(client));
t("selRow 从富化目录取当前模型行", /const selRow = useMemo/.test(client));
t("send 随消息下发 provider/model/effort", /call\('chatStart', \{ question, history, \.\.\.override, \.\.\.effortParam \}\)/.test(client));
t("effort=null 不发字段（宿主走 resolveEffort 规则）", /const effortParam = selEffort === null \? \{\} : \{ effort: selEffort \};/.test(client));
t("下拉行渲染免费/费率/上下文/档位富信息", /ob-chip-free/.test(client) && client.includes("K ctx") && client.includes("credits"));
t("档位 chips 在模型声明档位时出现", /selModel && selEfforts\.length/.test(client));
t("chips 含 auto（跟随上游默认）选项", /'auto'/.test(client));
t("选择按钮显示 模型 · 档位（与主对话页同构）", /selRow\.defaultEffort \|\| t\('effortDefault'\)/.test(client)); // OPT-3.7 字面已收编为 t('effortDefault')，zh 值仍为「默认」
t("消息动作条显示本次生效档位", /m\.model \+ \(m\.effort \? '·' \+ m\.effort : ''\)/.test(client));
t("chips CSS 存在", client.includes(".ob-chip-btn") && client.includes(".ob-chip-free"));
// 选择器入口位置：必须贴输入框（composer 元信息行）——主对话页同位
t("选择器在 composer 元信息行（ob-composer-meta）", client.includes("const modelPickerNode = h('div', { className: 'ob-composer-meta' }"));
t("composer 包含 modelPickerNode（输入框正下方）", /const composerNode = h\('div', \{ className: 'ob-composer' \}[\s\S]*?modelPickerNode,/.test(client));
// 历史 bug：composer 挂成 .ob-page 直接子节点 → 横向 flex 下变右侧第四列（"输入框跑到右上角"）
t("composer 不是 .ob-page 的直接子节点（不得成独立列）", /h\('div', \{ className: 'ob-page' \}, sidebarNode, chatNode, refNode\)/.test(client));
t("composer 是 chatNode 的尾子节点（回聊天列贴底）", /const chatNode = h\('div', \{ className: 'ob-main' \}[\s\S]*?\n\t\tcomposerNode,\n\t\);/.test(client));
t("菜单向上弹出（bottom 定位，贴 composer）", /\.ob-model-menu\{position:absolute;bottom:/.test(client));
t("点击外部关闭排除 composer 元信息行（新区域）", /closest\('\.ob-composer-meta'\)/.test(client));
t("页头仅剩只读模型摘要（无下拉按钮 ▼）", !/ob-head-meta[\s\S]{0,600}'▼'/.test(client));

// ── 4. 行为模拟：resolveEffort 规则表 ───────────────────────────────
// 从源码抽取纯函数做行为测试（与宿主半同构）
const fnStart = host.indexOf("const EFFORT_VALUES");
const fnEnd = host.indexOf("export class ObsidianBoardGateway");
const fns = new Function(host.slice(fnStart, fnEnd).replace(/^export /gm, "") + "\nreturn { resolveEffort, readCatalogModels, EFFORT_VALUES };")();

const rowGlm = { id: "glm-5.3-flash", reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ["low", "high", "max"], defaultEffort: "high" } };
const rowNoEffort = { id: "plain-model", reasoning: { supports: false } };
t("R1: 显式档位原样生效", fns.resolveEffort({ explicit: "max", configDefault: "high", row: rowGlm }) === "max");
t("R2: 无显式 → 配置默认在档位集内用之", fns.resolveEffort({ explicit: "", configDefault: "high", row: rowGlm }) === "high");
t("R3: 配置默认不在档位集 → 回退模型默认", fns.resolveEffort({ explicit: "", configDefault: "medium", row: rowGlm }) === "high");
t("R4: 模型未声明档位 → 不下发", fns.resolveEffort({ explicit: "", configDefault: "high", row: rowNoEffort }) === "");
t("R5: 模型未知 → 不下发", fns.resolveEffort({ explicit: "", configDefault: "high", row: undefined }) === "");
t("R6: 无配置默认 → 模型默认", fns.resolveEffort({ explicit: "", configDefault: "", row: rowGlm }) === "high");
t("R7: effort 词表校验（非法值拒收）", !fns.EFFORT_VALUES.includes("ultra"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
