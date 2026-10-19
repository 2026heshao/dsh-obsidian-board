# 主理人独立行为验证记录

本文件记录**主理人亲自真执行**（非静态断言、非转述工程师报告）的验证结果。
铁律：无证据 = 未完成。工程师报告自称通过不算证据。

---

## OPT-5.1 readNote 的 realpath 双向归一（验证时间 19:35 前后）

**探针**：`.work/probe-5-1.mjs`（可重跑）

**构造**：临时目录下建 `vault/` 与 `outside/`，在 `vault/` 内建 `linkout -> ../outside` 的 **junction**（Windows 目录联接）。
`vault/normal.md` 为对照组，`outside/secret.md` 为不该被读到的文件。

**实测输出**：

```
linkKind = junction
[
  { label: "对照组-正常笔记",     path: "normal.md",          blocked: false, contentHead: "# normal\n\n正常内容\n" },
  { label: "逃逸-点段",           path: "../outside/secret.md", blocked: true,  error: "路径不允许包含 .." },
  { label: "逃逸-junction 目录",  path: "linkout/secret.md",   blocked: true,  error: "路径越出 vault 范围（真实路径解析后）：linkout/secret.md" }
]

VERDICT = PASS（正常可读，逃逸全部被拦）
```

**判定**：PASS。三条都符合预期：
- 正常笔记放行（没误伤）
- `..` 点段走快筛，零 IO 成本就拒掉
- junction 逃逸被 `realpath` 归一后识别，**且错误消息明确标注「真实路径解析后」**，用户能看懂为什么被拒

**备注**：这是 OPT-1.6 之后新补的实现。早前（19:0x）实测时 `readNote` 内**无 realpath、无 resolve**，junction 逃逸**可以读到 vault 外文件**，当时的证据已作为缺口上报并已修复。本条即为修复后的复验。

---

## OPT-1.6 笔记体积上限（验证时间 19:2x）

**边界实测**（精确到字节）：
- `2097058` 字节 → 放行
- `2097258` 字节 → 拒绝，错误消息**含实际字节数**与上限值

`DEFAULT_MAX_NOTE_BYTES = 2MB`。判定 PASS。

---

## OPT-1.5 可选文件监听（验证时间 19:2x）

- 默认不启用：`VaultIndex` 构造后 `status().watching === false`
- 显式 `watch()` 后可开启
- 新增 `.md` 文件后经防抖自动进入索引（真建文件、真等、真查）
- `unwatch()` 可关闭

判定 PASS。

---

## OPT-1.4 可配置目录的默认值等价性（验证时间 19:1x）

**探针**：`.work/probe-1-4-equivalence.mjs`

基线 `git show HEAD:lib/vault.js` vs 当前工作区，逐项比对 10 项扫描参数：`SKIP_DIRS`、`ALLOW_DOT_DIRS`、`maxDepth`、`VENDORED_WEIGHT`、`VENDORED_DIR_HINTS` 等，**缺省值全部逐字节等价**。

判定 PASS（可配置化没有偷偷改变默认行为）。

---

## OPT-1.8 高亮与按笔记聚合（验证时间 19:2x）

实现是**顶层 `grouped` 字段** + 每片独立 **`highlights` 数组**（早期我查错了字段名，误判为未实现）。

功能存在，但发现两个质量问题，已另立为 `.work/unlisted-defects.md` 的 DEF-E / DEF-F：
- **DEF-E**：3 条 highlights 名额被同一个字符位置的 bigram 碎片占满（`关键词`/`关键`/`键词`），实际只高亮 1 处
- **DEF-F**：`grouped` 是对已按笔记 ≤2 片截断后的 `hits` 再分组，拿不到第 3 片

---

## OPT-3.1 Markdown 渲染器（P0，验证时间 18:4x）

**探针**：`.work/verify-31-render.mjs`（复刻 smoke-render 的切片 + `new Function` 机制）

**实测产出节点计数**：
```json
{"h4":1,"span":21,"h5":1,"h6":1,"div":2,"b":2,"em":1,"a":1,"table":1,"thead":1,"tr":3,"th":3,"tbody":1,"td":6,"ul":1,"li":3,"input":2,"blockquote":1,"pre":1,"code":1}
```

判定 PASS，四项关键反向验证同时成立：
- 表格 3 行 × 3 列、`td x6` → 表格真实生效
- 围栏内 `# 注释` 的 `h1` 计数 = 0 → **没有误判代码块里的 # 为标题**
- `[点我](javascript:alert(1))` **未**生成 `<a>` → 只认 `https?://`，XSS 防护有效
- `[引用1]` 未渲染为引用按钮 → 引用只认 `[\d{1,2}]` 纯数字，行为正确
