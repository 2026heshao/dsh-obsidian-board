# C5 任务书草稿（client.js · R5 批次）

> 状态：DRAFT——**派发前必须重新 grep 核实行号**（C3/C4 都在写 client.js，行号必然漂移）。
> 只许写 `lib/client.js` + `locale/zh.json` + `locale/en.json`（后者默认不动）。前置：C4 已交付。

## 任务 1：OPT-3.7 i18n（内联文案表）
- 实测事实：client.js **完全不读** `locale/*.json`（唯一命中是 `localeCompare`）；locale 只有 `meta.title`/`meta.description` 两键。
- 方案：在 **:348→:382 固定插入区**（`// ── 常量与工具` 之前、smoke-render 切片之内）加内联文案表：
  ```js
  const UI_TEXT = { /* zh 默认，en 可选；只覆盖用户可见面板文案 */ };
  const t = (k) => UI_TEXT[k] ?? k;
  ```
- 落地范围（务实裁剪）：把状态卡 / 空态 / composer placeholder / 按钮文案这些**用户可见面板主文案**接 `t()`；错误消息（宿主回传的 error 字符串）**不**进文案表。
- 约束：`t`/`UI_TEXT` 是切片内符号（INV-4）；不得引用切片外符号（`h` 除外）。smoke-render 断言的固定字符串（`默认模型`、`基于知识库提问`、`向你的知识库提问`、`ob-composer-meta`、`ob-model-area`、`ob-btn primary`、`ob-status`）**必须原样保留在渲染输出里**——若某断言串恰好被 `t()` 改写，把对应表项的 zh 值写成原字符串。

## 任务 2：OPT-3.8 模型选择器搜索/分组
- 落点：模型选择器区域（基线 :1116-1145，`ob-model-area`；派发时 grep `ob-model-area` 重定位）。
- 加：搜索输入框（按 model id/title 过滤）+ 按 provider 分组渲染（沿用现有 modelList 结构，不新拉数据）。
- 约束：不改 `applyModel`/`selRow` 契约；下拉外点关闭逻辑（基线 :585-594）保持；新增节点全部走 `h(`。

## 验收
`node --test test/note-tree.test.mjs test/render-stress.test.mjs test/smoke-render.test.mjs test/stream-update.test.mjs` 全绿。

## 交付格式（I）
改动清单 / 契约变更 / 验收摘要原文 / 风险遗留 + `IS_PASS: YES/NO`。
