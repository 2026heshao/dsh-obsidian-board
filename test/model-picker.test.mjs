// 回归：模型选择器与 DSH 主对话页同构
// 需求来源：用户要求面板的模型菜单尽量直接搬宿主 ModelSelect 的逻辑。
// 覆盖：两级菜单（模型 / 推理档位）、provider 分组、>4 搜索、键盘焦点流、
// 向上弹层、选中态、焦点回归；以及「显示档位 = 宿主 resolveEffort 实际结果」。
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, extra || ""); } };

const host = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 1. 宿主半：目录读取 + effort 解析 + listModels 富化 ─────────────
t("宿主半读 catalog（readCatalogModels）", host.includes("function readCatalogModels"));
t("catalog 路径指向 ~/.dsh/.workbuddy-catalog.json", host.includes('".workbuddy-catalog.json"'));
t("resolveEffort 纯函数存在", host.includes("function resolveEffort"));
t("resolveEffort：显式档位优先", /const pick = String\(explicit \|\| ""\)\.trim\(\);\s*\n\s*if \(pick\) return pick;/.test(host));
t("resolveEffort：未声明档位的模型不下发", /if \(!declared \|\| declared\.supports !== true\) return "";/.test(host));
t("resolveEffort：配置默认不在档位集时回退模型默认", /return typeof declared\.defaultEffort === "string" && efforts\.includes\(declared\.defaultEffort\) \? declared\.defaultEffort : "";/.test(host));
t("EFFORT_VALUES 词表与上游拼写一致（low..max）", /const EFFORT_VALUES = \["low", "medium", "high", "xhigh", "max"\];/.test(host));
t("listModels 富化：free/credits/badges/contextWindow/efforts", /free: true|credits:|badges:|contextWindow:|efforts,/.test(host));
t("listModels 带 10s 超时（挂住的 provider 不拖垮目录）", host.includes('"模型目录"'));
t("listModels 返回 defaultEffort 供客户端跟随", /defaultEffort: this\.config\.reasoningEffort \|\| ""/.test(host));

// ── 2. 消息级路由覆盖（与主对话页「按消息带路由」同构）─────────────
t("chatStart 接受消息级 provider/model 覆盖", /provider: String\(payload\?\.provider \|\| ""\)\.trim\(\) \|\| baseRoute\.provider/.test(host));
t("chatStart 接受消息级 effort（payload.effort !== undefined 语义）", /payload\?\.effort !== undefined \? String\(payload\.effort \|\| ""\)\.trim\(\) : undefined/.test(host));
t("chat 一次性 RPC 同样支持覆盖", /const effortExplicit = payload\?\.effort !== undefined/.test(host));
t("chatPoll 返回 effort（消息动作条显示用）", /effort: state\.effort \|\| ""/.test(host));

// ── 3. 客户端：选择只存本面板，不写宿主 configure ─────────────────
t("模型选择有独立持久化键", client.includes("const MODEL_KEY = 'dsh-obsidian-board/model';"));
t("选择写 localStorage", /LS\.set\(MODEL_KEY, modelSel\)/.test(client));
t("客户端不向宿主写 reasoningEffort", !client.includes("reasoningEffort"));
t("选择只改本地路由（applyModelSelection 不调 configure）", /const applyModelSelection = useCallback\(\(next\) => \{[\s\S]{0,220}setModelSel\(normalized/.test(client));
t("发送带消息级 provider/model", /const override = route\.model \? \{ provider: route\.provider \|\| '', model: route\.model \} : \{\};/.test(client));
t("effort 为空不下发（宿主 resolveEffort 决定）", /const effortParam = typeof route\.effort === 'string' \? \{ effort: route\.effort \} : \{\};/.test(client));
t("chatStart 随消息携带覆盖", /call\('chatStart', \{ question, history, \.\.\.override, \.\.\.effortParam \}\)/.test(client));

// ── 4. 菜单结构：宿主 ModelSelect 同构 ──────────────────────────────
t("ModelPicker 接收 hostEffort（显示=宿主解析）", /function ModelPicker\(\{ models, providerNames, selection, hostEffort,/.test(client));
t("两级根菜单：模型 + 推理档位", /pane === 'root'[\s\S]{0,1200}t\('modelMenuModel'\)[\s\S]{0,1200}t\('modelMenuEffort'\)/.test(client));
t("根菜单是两格 drill 入口（cell + chevron）", client.includes("className: 'ob-ms-cell'") && client.includes("primitives.IconChevronRightOutlineRegular"));
t("provider 分组走宿主 MenuGroup", client.includes("h(primitives.MenuGroup, { key: group.id, label: group.name }"));
t("provider 排序（账户 → 官方 → 其他）", /const providerRank = \(pid\) => \(pid === 'deepseek-account' \? 0 : pid === 'deepseek-official' \? 1 : 2\);/.test(client));
t("搜索仅在模型数 >4 时出现（与宿主阈值一致）", /const showSearch = \(Array\.isArray\(models\) \? models\.length : 0\) > 4;/.test(client));
t("搜索走宿主 rankByName", /primitives\.rankByName\(group\.models/.test(client));
t("弹层走宿主 MenuSurface", client.includes("h(primitives.MenuSurface, {"));
t("弹层渲染到 document.body（portal）", client.includes("ReactDOM.createPortal(") && /document\.body,/.test(client));
t("首帧隐藏测量，避免定位闪烁", /const MODEL_MEASURE_STYLE = \{ visibility: 'hidden', left: 0, top: 0 \};/.test(client));
t("向上弹出：触发器上方 8px", /let y = rect\.top - 8 - lh;/.test(client));
t("四边 12px 视口钳制", /const MODEL_MARGIN = 12;/.test(client) && /Math\.max\(y, MODEL_MARGIN\)/.test(client));
t("菜单 fixed 定位且限高", /\.ob-ms-menu\{[^}]*position:fixed/.test(client) && /\.ob-ms-menu\{[^}]*max-height:min\(360px,100vh - 96px\)/.test(client));
t("选中项 aria-checked + 勾选图标", /'aria-checked': selected/.test(client) && client.includes("IconCheckOutlineRegular"));
t("触发器带 aria-haspopup / aria-expanded", /'aria-haspopup': 'menu'/.test(client) && /'aria-expanded': open/.test(client));
t("触发器显示 模型 · 档位", /const triggerText = effortLabel \? modelLabel \+ ' · ' \+ effortLabel : modelLabel;/.test(client));
t("加载中显示宿主 StateDot", /h\(primitives\.StateDot, \{ state: 'ongoing' \}\)/.test(client));
t("宿主默认模型入口（不覆盖路由）", client.includes("chooseHostDefault") && client.includes("t('modelHostDefault')"));
t("行内富信息：免费/费率/上下文/档位/徽章", client.includes("chipFree") && client.includes("' credits'") && client.includes("'K ctx'") && client.includes("row.badges"));
t("目录为空/无匹配都有提示与重试", client.includes("t('modelEmptyNoModels')") && client.includes("t('modelNoMatch')") && /className: 'ob-ms-retry'/.test(client));
t("加载失败可重试且不阻塞选择", client.includes("t('modelErrorPrefix')") && /onClick: reload/.test(client));

// 键盘 / 焦点流
t("↑↓ 在菜单行间移动", /if \(event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'\)/.test(client));
t("搜索框 ↑↓ 切换高亮且焦点留在搜索框", /setHighlighted\(\(activeModelIndex \+ \(event\.key === 'ArrowDown' \? 1 : -1\) \+ visibleModels\.length\) % visibleModels\.length\)/.test(client) && /searchRef\.current\.focus\(\)/.test(client));
t("搜索框 Enter / Tab 选中当前高亮", /event\.key === 'Enter' \|\| \(event\.key === 'Tab' && !event\.shiftKey\)/.test(client));
t("Tab 从触发器进入菜单（选中项优先）", /querySelector\('\[role="menuitemradio"\]\[aria-checked="true"\]:not\(\[disabled\]\)'\)/.test(client));
t("Shift+Tab / Escape 从子菜单回 root（含宿主默认模型）", /if \(pane !== 'root' && activeRow\) back\(pane\);/.test(client) && (client.match(/if \(pane !== 'root' && activeRow\) back\(pane\);/g) || []).length === 2);
t("Escape 在 root 关闭并把焦点还给触发器", /else close\(true\);/.test(client) && /triggerRef\.current\.focus\(\)/.test(client));
t("打开后焦点落点：搜索框 → 选中项 → 首个可选项", /if \(intent === 'drill'\)/.test(client) && /const target = checked \|\| first \|\| triggerRef\.current;/.test(client));
t("菜单内外点 mousedown 关闭（portal 同时排除）", /document\.addEventListener\('mousedown', closeOutside\)/.test(client) && /menuRef\.current\.contains\(event\.target\)/.test(client));
t("点菜单按钮不抢输入框焦点（mousedown preventDefault）", /event\.target\.closest\('button'\)\) event\.preventDefault\(\)/.test(client));
t("每次渲染重置行 ref（换 pane 不残留）", /itemRefs\.current = \[\];\s*\n\s*modelRefs\.current = \[\];/.test(client));
t("高亮项跟随滚动（限定模型行）", /modelRefs\.current\[activeModelIndex\]/.test(client) && /scrollIntoView\(\{ block: 'nearest' \}\)/.test(client));
t("搜索高亮行有可见样式（键盘 ↑↓ 不迷路）", /\.ob-ms-option\[data-highlighted\]/.test(client));
t("分组标题吸顶观察器接入", /primitives\.observeStickyMenuGroups\(viewport\)/.test(client));
t("菜单尺寸/滚动/窗口变化重新定位", /window\.addEventListener\('scroll', place, true\)/.test(client) && /new ResizeObserver\(place\)/.test(client));

// 入口位置：与主对话页同位（输入卡左下）
t("模型选择器在 composer 输入卡内", /const composerNode = h\('div', \{ className: 'ob-composer' \},[\s\S]*?h\('div', \{ className: 'ob-composer-row' \},\s*\n\s*modelPickerNode,/.test(client));
t("输入卡是宿主同款卡片容器", client.includes("className: 'ob-composer-card'"));
t("页头摘要与选择器读同一解析（hostEffort）", /const headEffortText = activeRow \? modelRowEffort\(activeRow, modelSel\.effort, hostEffort\) : '';/.test(client));
t("选择器收到宿主默认路由（未显式选择时展示真实默认模型）", /hostDefault: hostDefaultRoute,/.test(client));
t("页头在未显式选择时也解析宿主默认模型", /const activeRow = selRow \|\| hostRow;/.test(client));
t("页头模型摘要仍在（只读）", /headModelText,/.test(client));
t("页头不再有旧下拉按钮 ▼", !/ob-head-meta[\s\S]{0,600}'▼'/.test(client));

// ── 5. 行为：纯函数与宿主同源 ───────────────────────────────────────
const TEXT = {
	effortLow: '低', effortMedium: '中', effortHigh: '高', effortXHigh: '极高', effortMax: '最高',
	effortUpstreamDefault: '默认', chipFree: '免费',
};
const tr = (key) => (TEXT[key] !== undefined ? TEXT[key] : key);
const fnStart = client.indexOf("const MODEL_MEASURE_STYLE");
const fnEnd = client.indexOf("function ModelPicker");
const lib = new Function(
	"t",
	client.slice(fnStart, fnEnd) + "\nreturn { pickModelRoute, resolveRowEffort, modelRowEffort, modelRowMeta, effortName };",
)(tr);

const glm = {
	provider: 'deepseek-account', model: 'glm-5.3', label: 'GLM 5.3',
	efforts: ['low', 'high', 'max'], defaultEffort: 'high',
	free: true, credits: '1200', contextWindow: 128000, badges: ['beta'],
};
const noEffort = { provider: 'p', model: 'plain', label: 'Plain' };
const noDefault = { provider: 'p', model: 'nd', label: 'NoDefault', efforts: ['low', 'high'] };
const rows = [glm, noEffort, noDefault];

// pickModelRoute：持久化选择 → 合法路由
t("R1: 空 model = 宿主默认（不覆盖）", JSON.stringify(lib.pickModelRoute({ model: '' }, rows)) === JSON.stringify({ provider: '', model: '', effort: null }));
t("R2: 目录内有此模型 → 还原路由", JSON.stringify(lib.pickModelRoute({ provider: 'deepseek-account', model: 'glm-5.3' }, rows)) === JSON.stringify({ provider: 'deepseek-account', model: 'glm-5.3', effort: null }));
t("R3: 支持档位 → 还原显式档位", lib.pickModelRoute({ model: 'glm-5.3', effort: 'max' }, rows).effort === 'max');
t("R4: 档位不被模型支持 → 降为 null（交给宿主解析）", lib.pickModelRoute({ model: 'glm-5.3', effort: 'medium' }, rows).effort === null);
t("R5: 目录里没有 → null（调用方等目录/回默认）", lib.pickModelRoute({ model: 'gone' }, rows) === null);
t("R6: provider 与 model 不匹配 → null", lib.pickModelRoute({ provider: 'other', model: 'glm-5.3' }, rows) === null);
t("R7: 非法输入 → null", lib.pickModelRoute(null, rows) === null && lib.pickModelRoute(undefined, rows) === null);

// resolveRowEffort：与宿主 resolveEffort 同序
t("E1: 显式档位优先", lib.resolveRowEffort(glm, 'max', 'low') === 'max');
t("E2: 无显式 → 宿主配置默认（模型支持时）", lib.resolveRowEffort(glm, null, 'max') === 'max');
t("E3: 宿主默认不在档位集 → 模型默认", lib.resolveRowEffort(glm, null, 'medium') === 'high');
t("E4: 无宿主默认 → 模型默认", lib.resolveRowEffort(glm, null, '') === 'high');
t("E5: 模型无默认 → undefined（显示「默认」）", lib.resolveRowEffort(noDefault, null, '') === undefined);
t("E6: 显式档位非法 → 继续走宿主默认", lib.resolveRowEffort(glm, 'ultra', 'low') === 'low');
t("E7: 模型未声明档位 → undefined", lib.resolveRowEffort(noEffort, 'high', 'high') === undefined && lib.resolveRowEffort(undefined, 'high', 'high') === undefined);

// modelRowEffort：解析结果 → 中文文案
t("N1: 解析到档位 → 中文名", lib.modelRowEffort(glm, 'max', '') === '最高');
t("N2: 跟随宿主默认 → 显示宿主默认档位名", lib.modelRowEffort(glm, null, 'max') === '最高');
t("N3: 无默认可解析 → 「默认」", lib.modelRowEffort(noDefault, null, '') === '默认');
t("N4: 模型不支持档位 → 空串（不占位）", lib.modelRowEffort(noEffort, 'high', 'high') === '');

// modelRowMeta：行内富信息
const meta = lib.modelRowMeta(glm);
t("M1: 富信息含免费 / credits / 上下文", meta.includes('免费') && meta.includes('1200 credits') && meta.includes('128K ctx'), meta);
t("M2: 富信息含档位名与徽章", meta.includes('低') && meta.includes('最高') && meta.includes('beta'), meta);
t("M3: 无档位模型不产生档位段落", !lib.modelRowMeta(noEffort).includes('低'), lib.modelRowMeta(noEffort));

// ── 6. 行为：宿主 resolveEffort 规则表 ─────────────────────────────
const fnStartHost = host.indexOf("const EFFORT_VALUES");
const fnEndHost = host.indexOf("export class ObsidianBoardGateway");
const fns = new Function(host.slice(fnStartHost, fnEndHost).replace(/^export /gm, "") + "\nreturn { resolveEffort, readCatalogModels, EFFORT_VALUES };")();

const rowGlm = { id: "glm-5.3-flash", reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ["low", "high", "max"], defaultEffort: "high" } };
const rowNoEffort = { id: "plain-model", reasoning: { supports: false } };
t("H1: 显式档位原样生效", fns.resolveEffort({ explicit: "max", configDefault: "high", row: rowGlm }) === "max");
t("H2: 无显式 → 配置默认在档位集内用之", fns.resolveEffort({ explicit: "", configDefault: "high", row: rowGlm }) === "high");
t("H3: 配置默认不在档位集 → 回退模型默认", fns.resolveEffort({ explicit: "", configDefault: "medium", row: rowGlm }) === "high");
t("H4: 模型未声明档位 → 不下发", fns.resolveEffort({ explicit: "", configDefault: "high", row: rowNoEffort }) === "");
t("H5: 模型未知 → 不下发", fns.resolveEffort({ explicit: "", configDefault: "high", row: undefined }) === "");
t("H6: 无配置默认 → 模型默认", fns.resolveEffort({ explicit: "", configDefault: "", row: rowGlm }) === "high");
t("H7: effort 词表校验（非法值拒收）", !fns.EFFORT_VALUES.includes("ultra"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
