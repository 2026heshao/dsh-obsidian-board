# 编码核对铁律（主理人自验后落盘）

## 事故经过

核对 `lib/vault.js` 的 OPT-1.4 默认值时，用 `pwsh Get-Content` 看到：

```
const VENDORED_DIR_HINTS = ["_鍏綉鏀堕泦", "_鏀堕泦", "vendor", ...];
// 鈹€鈹€ BM25 绱㈠紩 鈹€鈹€鈹€
```

看起来文件已被严重破坏（`_公网收集` 变成 `_鍏綉鏀堕泦`），且此前记录的 DEF-1（`package.json` 的 description 含 `鈥?`）也像是同类损坏。

## 实际结论（node 正确 UTF-8 读取后）

`.work/probe-encoding.mjs` 对 4 个文件逐一检查：

| 文件 | 字节 | BOM | roundTrip | U+FFFD | CJK 数 | mojibake 行 |
|---|---|---|---|---|---|---|
| `lib/vault.js` | 31678 | no | **true** | **0** | 2006 | **none** |
| `lib/index.js` | 72231 | no | **true** | **0** | 5769 | **none** |
| `lib/client.js` | 86990 | no | **true** | **0** | 4960 | **none** |
| `package.json` | 1711 | no | **true** | **0** | 0 | **none** |

且 `vault.js` 明确包含 `公网收集` / `索引` / `路径不允许` / `笔记` 四个探针串。

`.work/probe-def1.mjs` 对 `package.json.description` 逐码点检查：

```
description 原文 : "Obsidian vault as a local RAG chat panel inside DeepSeek Harness (desktop app and Web GUI) — dedicated Obsidian ..."
非 ASCII 码点   : U+2014  "—"
含 mojibake 特征 : false
```

→ **文件全是干净 UTF-8；显示的乱码是 PowerShell 控制台的输出编码问题。**

## 两条修正

1. **DEF-1 撤销**。`package.json` 的 description 没有 mojibake，`U+2014` 是正常的 em dash。此前记在 `.work/architect-qa-resolved.md` 的 DEF-1 作废。
2. **禁止用 PowerShell 读源码内容做人工核对**。`Get-Content` / `Select-String` 在中文 Windows 控制台会把 UTF-8 多字节序列按 GBK 渲染，产出假乱码。所有需要「看字符串内容」的核对，一律走 node 脚本。

## 允许使用 PowerShell 的场合

只用于**不含中文语义**的机械性检查：

- `git status` / `git diff --stat` / `git diff --numstat`
- `Select-String -Pattern '<纯 ASCII 正则>'` 的**行号**定位（不读 `Line` 文本内容）
- 文件字节数、行数、时间戳
- 运行 `node --test` 并取尾部输出

## 必须走 node 的场合

- 判断某个中文字符串/注释/常量是否存在
- 判断文件是否被 mojibake 损坏
- 比较两个文件的文本内容是否逐字节一致
- 任何需要阅读中文文案的断言核对

## 可复用脚本

- `.work/probe-encoding.mjs` —— 4 文件编码体检（BOM / roundTrip / U+FFFD / CJK / mojibake 行号 / 中文探针）
- `.work/probe-def1.mjs` —— 对任意字符串做逐码点 dump + mojibake 判定

扩容方式：改 `probe-encoding.mjs` 顶部的 `files` 数组即可覆盖更多文件。
