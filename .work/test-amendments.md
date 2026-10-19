# 既有测试修正登记（T-1）— 唯一一处

> 原则：**不为了让测试变绿而弱化测试**。只有「测试断言的是既有缺陷的实现细节，而优化项明确要求改变该缺陷」时，才允许修正测试，且修正后断言必须**比原来更强或至少等价**。
> 本文件登记每一处此类修正，供事后审计。

---

## T-1 `test/thinking.test.mjs:26`

**原文断言**：
```js
t("规划跳锁 low 档（廉价预调用不深思）", /planEffort === "high" \? "low" : planEffort/.test(host));
```

**问题性质**：这不是在断言「行为」，而是在断言**旧缺陷代码的字面文本**。
- 优化清单 §2.4（`dsh-obsidian-board-v0.2.3-optimization-items.md`）的目标恰恰是消除这个映射：把用户 `high` 档一路砍到 `low` 会让规划器改写质量下降、检索词变糙、召回率下降。
- 因此只要 OPT-2.4 正确实施，这条断言**必然**转红。它锁死的是错误行为。

**OPT-2.4 的新实现**（`lib/index.js`，I2 批次已落地）：
```js
const PLAN_EFFORT_MAP = { low: "low", medium: "medium", high: "medium", xhigh: "high", max: "high" };
...
const planEffort = String(this.config.reasoningEffort ?? "high").trim();
if (planEffort) options.reasoningEffort = PLAN_EFFORT_MAP[planEffort] || planEffort;
```

**修正方向（更强，不是更弱）**：把「字面文本匹配」升级为「**行为断言**」——真实取出 `PLAN_EFFORT_MAP` 求值，逐档核对，并显式断言 `high !== "low"`（即缺陷已消除）。
这样测的是语义，不是排版；将来谁重构映射表写法，测试仍然有效。

**待落地的替换代码**（等 I2 定稿后执行）：
```js
// OPT-2.4 修正：原断言锁定的是「high → low」这条**旧缺陷**的字面文本。
// 现在改为行为断言：真实求值 PLAN_EFFORT_MAP，逐档核对 + 显式断言缺陷已消除。
{
	const m = host.match(/const PLAN_EFFORT_MAP = (\{[^}]*\});/);
	let map = null;
	try { map = m ? new Function("return (" + m[1] + ");")() : null; } catch { map = null; }
	t("规划档位映射表存在且可求值", !!map);
	t("high 不再砍到 low（OPT-2.4 缺陷已消除）", !!map && map.high !== "low");
	t("high 只降一档到 medium", !!map && map.high === "medium");
	t("xhigh / max 降到 high", !!map && map.xhigh === "high" && map.max === "high");
	t("low / medium 原样透传", !!map && map.low === "low" && map.medium === "medium");
}
```

**断言数量**：原 1 条 → 新 5 条，覆盖面严格变大。

**责任人**：主理人执行，待 I2 批次收工后落笔（避免与 I2 正在写入的 `lib/index.js` 产生无关冲突）。测试文件与 `lib/index.js` 不冲突，但 `PLAN_EFFORT_MAP` 的最终形态需以 I2 定稿为准。

---

## 已排查确认**不**需要修正的测试

| 测试 | 断言内容 | 判定 |
|---|---|---|
| `planner.test.mjs:11-13` | `needsPlanning("长句")===true`、`("k8s")===false`、`("为什么要用 RRF")===true` | ✅ 行为断言，非代码文本。I2 改 `needsPlanning` 必须保持这三条成立，**不得为通过而改测试** |
| `recall-and-source.test.mjs:41-43` | `ALLOW_DOT_DIRS` / `scanVault` / 点目录白名单 | ✅ 源码字面断言但**锁定的是正确行为**（`lib/vault.js:200` 已按此写法修正，见验收记录） |
| `vault.test.mjs` | 真实 import 执行 | ✅ 行为测试 |
| `smoke-render.test.mjs` | 真实组件树结构 | ✅ 行为测试 |

**结论：全部 15 个套件中，只有 `thinking.test.mjs:26` 一条属于「锁定旧缺陷」，其余均为有效断言，一律不得改动。**
