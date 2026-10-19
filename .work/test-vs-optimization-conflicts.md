# 测试与优化冲突清单（断言旧缺陷的测试）

> 主理人（齐活林）在 R1 期间实测发现。这类测试**不是真回归**，而是把「待修的缺陷」写成了断言。
> 处理原则：优化落地后必须同步更新断言到「新正确行为」，否则全量 `node --test` 永远红。

## 已确认（1 条）

### T-1 `test/thinking.test.mjs:26` — 断言 OPT-2.4 的旧缺陷

```js
t("规划跳锁 low 档（廉价预调用不深思）", /planEffort === "high" \? "low" : planEffort/.test(host));
```

- **冲突原因**：该正则断言的是旧代码字面 `planEffort === "high" ? "low" : planEffort`。
- **OPT-2.4 要求**（优化清单 `:83-85`）：`high → medium`（而非 `low`），并「把映射表提成常量并注释理由」。
- **I1 已实现**（`lib/index.js`）：
  ```js
  const PLAN_EFFORT_MAP = { low: "low", medium: "medium", high: "medium", xhigh: "high", max: "high" };
  ```
  调用点：`const planEffort = String(this.config.reasoningEffort ?? "high").trim();` + `options.reasoningEffort = PLAN_EFFORT_MAP[planEffort] || planEffort;`
- **判定**：I1 实现与优化清单一致，**实现正确**；测试需更新。
- **建议新断言**（任选其一或组合）：
  1. `/PLAN_EFFORT_MAP/.test(host)` —— 映射表已提成常量
  2. `/high:\s*"medium"/.test(host)` —— high 只降到 medium
  3. **反向断言**：`!/=== "high" \? "low"/.test(host)` —— 旧跳档已消失
  4. 更语义化：从切片里 `eval` 出 `PLAN_EFFORT_MAP`，断言 `PLAN_EFFORT_MAP.high === "medium" && PLAN_EFFORT_MAP.xhigh === "high"`

## 系统性排查结果（已做）

对 `test/` 全目录 grep 下列「被优化项改变的字面文本」，**除 T-1 外均无命中**：

| 被优化的字面 | 出处 | 结果 |
|---|---|---|
| `slice(0, 4000)` | OPT-2.9 历史截断 | 测试未断言 |
| `limit: 400` | OPT-1.9 listNotes 上限 | 测试未断言 |
| `refs:` | OPT-2.1 重复 YAML key | 测试未断言 |
| `isComposing` | OPT-3.2 IME 守卫 | 测试未断言 |
| `=== "high" ? "low"` | OPT-2.4 | **T-1 命中** |
| `300000` | OPT-2.12 超时硬编码 | 测试未断言 |
| `size > 6` | OPT-2.7 会话池清理 | 测试未断言 |

结论：**T-1 是唯一一处**。其余测试是行为/结构断言，不会与优化冲突。

## 责任归属

- 归 **QA 批次**（最后统一跑全量）修复断言，**不由实现批次顺手改测试**——
  实现批次若改测试，会掩盖真回归，且违反「单批只碰授权区间」。
