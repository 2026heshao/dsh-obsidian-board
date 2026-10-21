# dsh-obsidian-board

[English](#english) | [中文](#中文)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that turns your local **Obsidian vault** into a **dedicated RAG chat panel** inside the DSH GUI — a sidebar entry leading to a full three-pane page: note browser on the left, retrieval-augmented chat in the middle, cited note source on the right. The desktop app and the Web GUI ship the same browser-rendered client, so the panel behaves identically in both. Indexing and BM25 matching run **100% locally** (no embedding model, no vector database); the optional planner query rewrite and answer generation go through the model channel you already configured in DSH — only your question, the recent conversation and the retrieved snippets are sent, never the vault itself.

> **Not an MCP integration, not an Obsidian plugin** — this is a dual-half DSH plugin (host + browser client). The UI is injected into the DSH main window as a `main` slot page (same mechanism as switching conversations); model calls reuse the host `ctx.llm`; the knowledge base points at your local vault directory (Obsidian doesn't even need to be running).

> **Compatibility**: checked against a live DeepSeek Harness 44.7.0 install (host ships `@deepseek-ai/dsh-typert-protocol@0.2.1-rc.2` / cordis 4.0.5); the declared peer range `>=0.1.5-rc.1` still covers it. Since v0.2.5 the browser half additionally pulls `react`, `react-dom` and `@deepseek-ai/dsh-client-ui-primitives` out of the host's browser module table (that is how the model menu reuses the host's own primitives — the same three modules the sibling plugin `dsh-forget-session` already requires on 44.x); if a profile ever lacks them, the panel page fails to render rather than degrading. Changes after the 44.7.0 check are covered by the repo suite (`node --test`); the indexing and watcher numbers come from re-runs on a local synthetic 10k-note vault, while the UI batch (composer and model menu) has not had a fresh in-app regression pass.

## Features

- 🔍 **Local-first retrieval** — BM25 with CJK bigram tokenization, title/path boosting, Obsidian tag & alias awareness. No embedding model; indexing and BM25 matching make no network calls, and the vault itself never leaves your machine. Answer generation (plus the optional planner query rewrite) uses the DSH model channel you configured — question, recent conversation and retrieved snippets only.
- 🎯 **Finds what you actually wrote** — your own notes outrank collected third-party material (public skill libraries are down-weighted), long identifiers such as `github_pat_…` are matched literally, and meaningful hidden folders (e.g. `.workbuddy/`) are indexed instead of silently skipped.
- 🛑 **Stop that actually stops** — the stop button takes effect at any stage, including the retrieval/planning phase and the model's silent period before its first token. Stopped replies are shown as a neutral "stopped" state, not a red error. Double-press Escape does the same thing from anywhere on the page.
- ⌨️ **A composer that behaves like the main chat** — the input card is rebuilt against the host InputBar's geometry and interaction contract: send and stop share one primary button (the stop square appears while a reply streams and the box is empty), Enter while a reply is still generating queues the message instead of losing it (queued items list above the card, auto-send after the current answer finishes, each individually removable, and an explicit stop hands the text back to the input instead of dropping it), IME composition is respected so picking a candidate with Enter never sends a half-typed message, the box auto-grows, and focus returns to the input after you send. The focus indicator is drawn on the rounded card, so no rectangular outline floats over it.
- 🎚 **Model menu ported from the host** — the picker is the host `ModelSelect` ported rather than imitated: two-level "Model / Reasoning effort" menu, provider grouping with sticky headers, search once the list passes 4 entries, full keyboard navigation with focus hand-off, an upward-opening portal menu that repositions on scroll and resize, and per-row metadata (free / credits / context window / supported efforts). It shows the host's actual default model instead of a generic "default model" label, and the effort you see is the effort that gets sent. Selections apply to the panel's next message only — a per-message route override, your DSH global settings stay untouched.
- 🧵 **Output that never garbles or hangs** — the stream pipeline is keyed per attempt, so switching provider fallbacks can't splice two answers together or silently swallow a reply; each answer shows the model that actually produced it, and a reply regenerated on a fallback channel carries a "fallback channel" tag so the detour is visible, not hidden. Replies left mid-stream by a panel refresh are marked "interrupted" with a retry button instead of spinning forever.
- 📖 **Citations, honestly separated from recall** — every `[n]` in the answer and the chips below it open the exact note in the right-hand source pane. Chips are grouped by what the answer actually marked `[n]` (**cited**) versus what retrieval surfaced but the answer never cited (**related snippets**), using the same matcher that renders `[n]` in the body, and the `.md` export keeps the same two sections.
- 📊 **Rich Markdown answers** — tables, headings, links, italics and task lists render in answers and the source pane, sandboxed (no executable links).
- 📡 **Live vault sync** — optional file watching resolves the changed note straight from the watcher event and rebuilds **only that note**: ≈0.2 s (lean vault) to ≈0.26 s (rich vault) end-to-end on the 10k-note vault below, 150 ms debounce included, with zero full directory scans during the window. Events that can't be pinned to a single file — renames, deletes, batch changes that report no filename — fall back to a coalesced full incremental pass (≈1.2 s window), so nothing is silently missed.
- 📃 **Long vaults stay usable** — the note list paginates on scroll, and each answer shows its phase (retrieval → planning → generation).
- 🧭 **Guided setup** — an invalid vault path is caught at configure time with a clear validity hint, and answer timeouts are configurable.
- 🗂 **Automatic vault discovery** — reads Obsidian's own vault registry, scans common locations, offers a native directory picker, or takes a pasted path.
- ⚡ **Incremental indexing** — mtime-based. Measured on a synthetic 10k-note / 40k-chunk vault (local machine, Node 24): full index ≈2 s, a single changed note rebuilds in ≈50 ms. The `≈50 ms` covers build + commit + stats recompute of one note only: an end-to-end incremental pass still walks the directory and `stat`s every file, which measured ≈0.9–1.0 s on the same vault. The watcher takes the targeted path instead, so a save lands in ≈0.2–0.26 s (it was ≈1.5 s before targeting).
- 🧩 **Native panel experience** — registered under the sidebar "Panels" group (alongside the plugin manager and timer); the panel keeps its own chat history in the browser, separate from DSH session logs.
- ⬇️ **Export downloads, not vault writes** — "Export chat .md" triggers a real browser download (you pick the location; non-DOM hosts fall back to copying the full text to the clipboard) instead of silently writing into the vault.
- ↔️ **Resizable source pane** — drag the divider between the chat area and the right-hand note preview to resize it (keyboard accessible, double-click resets, width persists across reloads).

## Install

**Option 1 — dsh-market (in-app, easiest):** search the exact package name `dsh-obsidian-board` in the DSH plugin market and install (searching only `obsidian` also matches unrelated entries; the market display name is whatever the listing shows).

**Option 2 — CLI:**

```sh
dsh plugin --profile web add "dsh-obsidian-board"
```

**Option 3 — from source (this repo):**

```sh
dsh plugin --profile web add file:"<path to this repo clone>"
```

Or manually: add `"dsh-obsidian-board": "file:<path>"` to `dependencies` and `"dsh-obsidian-board"` to `dsh.profile.bundles` in `~/.dsh/profiles/<profile>/package.json`, then run `pnpm install` in that directory and restart DSH.

> Desktop app users: install into the `desktop` profile — swap `--profile web` for `--profile desktop` (and `~/.dsh/profiles/web` for `~/.dsh/profiles/desktop`) in the commands above. Everything else is identical.

## Configure

Set the vault path in your profile patch (`~/.dsh/profiles/<profile>/cordis.patch.yml`):

```yaml
- insert:
    - id: dsh-obsidian-board
      name: dsh-obsidian-board
      config:
        vaultPath: "D:\\notes\\MyVault"   # vault root (absolute; ~ works too)
        provider: ""                      # DSH llm provider route; empty = host default
        model: ""                         # model id; empty = provider default
        topK: 8                           # retrieved chunks fed to the answer (only those marked [n] are labelled as citations)
        chunkLimit: 1200                  # max chars per chunk in the prompt
        systemPrompt: ""                  # custom RAG system prompt (empty = built-in)
```

> `vaultPath` may stay empty — the panel shows a setup card on first open where you can discover/pick/paste the vault path interactively.

## Usage

1. Click **Obsidian** in the sidebar "Panels" group (or the sidebar footer entry).
2. First time: pick your vault → connect (indexing runs locally, no network calls; measured on synthetic vaults of short notes: 50 notes ≈ 9 ms, 200 ≈ 52 ms, 500 ≈ 0.12 s, 10k ≈ 2 s).
3. Ask things like *"what do my notes say about X?"* or *"summarize the points under #tag"*.
4. Click `[1]` `[2]` citations or the chips under the answer (grouped as **cited** / **related snippets**) → the note opens on the right.
5. Enter sends; Enter *while a reply is generating* queues the message instead of interrupting it. The chip under the input opens the model menu (model + reasoning effort) — it overrides the route for your next questions in this panel only, never your DSH global default.

## How it works

```
dsh-obsidian-board/
├── lib/
│   ├── index.js    # Host half: ObsidianBoardGateway (TypertRemoteService)
│   │               #   status/configure/discoverVaults/pickVault/revealVault/
│   │               #   listNotes/readNote/search/reindex/chat
│   │               #   BM25 runs locally; chat streams via ctx.llm (DSH model channel)
│   ├── typert.js   # RPC contract (dual-key codec, 0.1.5-rc.x and 0.1.6+ compatible)
│   ├── vault.js    # Zero-dependency Node indexer: scan/frontmatter/BM25/incremental
│   └── client.js   # Browser half: main-slot page + sidebar panellist/footer entries
├── cordis.patch.yml
└── locale/*.json, icon.svg
```

The panel chat **does not write to DSH session logs**: history is namespaced per vault in the panel and synced to the host via historyGet/historySet, so it survives panel reloads (localStorage as the local fallback). The host-side history is in-memory and cleared on service restart. Model calls go through the host `ctx.llm`, so quotas, retries, and provider routing behave exactly like your main DSH sessions.

## Known limits

- Retrieval is BM25 + CJK bigram + title/tag weighting — not semantic embedding search. Proper nouns, keywords, and tags work best; long paraphrased questions may miss recall (a local embedding model is planned as a follow-up; the interface is already reserved). Long identifiers (PATs, hashes, file names) are matched literally to compensate.
- Collected third-party material (paths like `_公网收集`, `vendor`, `node_modules`) is down-weighted so your own notes win — it is still retrievable, just ranked below your own writing.
- Hidden folders are indexed only when they are meaningful (`.workbuddy` is allow-listed); structural/caching folders (`.obsidian`, `.trash`, `.git`) are always skipped.
- The plugin's full configuration surface is defined by `Config` in `lib/index.js` (covering all fields incl. planner, timeout, scan/watch tuning) — the `cordis.patch.yml` snippet in this README is only an install template (6 keys); the in-panel configure card can edit every field.
- Panel history is namespaced per vault and synced to the host via historyGet/historySet; it survives panel reloads and supports JSON export/import. Host-side history is in-memory (cleared on service restart), with localStorage as the local fallback.
- The panel chat intentionally doesn't support DSH main-session tool calls / subagents (knowledge-base Q&A doesn't need them).
- The composer mirrors the main chat's send / stop / queue / model-menu behaviour, but deliberately has **no** attachments, **no** `/` commands and **no** `@` file references — same reason as above.

## License

MIT

---

<a id="中文"></a>
# 中文

把本地 **Obsidian vault** 变成 DeepSeek Harness 里的**专属知识库对话页面**（桌面端与 Web 端通用）：侧栏多一个「Obsidian」入口，点开就是一个完整面板——左侧笔记浏览器、中间 RAG 聊天、右侧引用原文。索引与 BM25 召回全部本地完成，回答走 DSH 已配置的模型通道（只发送问题、最近对话与命中片段，整库不上传）。

> **不是 MCP 接入，也不是 Obsidian 插件**——这是一个 DSH 客户端+宿主双半插件：UI 注入进 DSH 主窗口（`main` slot 页面，与切换对话同构），模型调用复用宿主 `ctx.llm`，知识库指向你本地的 vault 目录（无需 Obsidian 运行）。

> **兼容性**：已在真实安装的 DeepSeek Harness 44.7.0（宿主内置 `@deepseek-ai/dsh-typert-protocol@0.2.1-rc.2` / cordis 4.0.5）上做过兼容性核对；声明的 peer 范围 `>=0.1.5-rc.1` 继续覆盖。自 v0.2.5 起，客户端半还会从宿主的浏览器模块表里取 `react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives` 三项（模型菜单复用宿主自带 primitives 的代价——同目录的姊妹插件 `dsh-forget-session` 在 44.x 上就是按同样方式 require 这三个模块）；万一某个 profile 缺这几项，面板页面会直接渲染不出来而不是降级。44.7.0 核对之后的改动由仓库测试（`node --test`）覆盖，索引与监听的性能数字是本机 10k 合成库复测所得；UI 批次（输入框与模型菜单）未在实机做过一轮完整回归。

## 特性

- 🔍 **本地优先检索**——BM25 + 中文 bigram 切词、标题/路径加权、Obsidian 标签与别名感知。不用 embedding；索引与 BM25 召回不发任何网络请求，vault 整库不出本机——回答生成（以及可选的 planner 查询改写）走你在 DSH 配好的模型通道，只发送问题、最近对话与命中片段。
- 🎯 **找得到你真正写的东西**——自有笔记优先于收集来的第三方语料（公开 skill 库降权）、`github_pat_…` 这类长标识符按字面精确匹配、有意义的隐藏目录（如 `.workbuddy/`）也会纳入索引而非被静默跳过。
- 🛑 **停止真的能停**——停止按钮在**任何阶段**都生效，包括检索/规划阶段、以及模型吐首字前的静默期；被停止的回复显示中性「已停止」状态，而不是红色报错。页面任意位置连按两次 Esc 同样能停。
- ⌨️ **输入框与主对话页同构**——输入卡按宿主 InputBar 的几何与交互契约重做：发送与停止共用一个主按钮（生成中且输入框为空时变成停止方块）；生成中按 Enter 不再打断当前回答，而是把消息排进队列（队列条目列在输入卡上方，本轮回答结束后自动发送，可单条移除；显式停止时会把待发的文本退回输入框，不静默吞掉）；输入法合成期按 Enter 只选词不发送，中文候选词不会把半截消息发出去；输入框自动增高，发送后焦点回到输入框。聚焦态的高亮画在圆角卡片上，不会再浮出一个和卡片不贴合的直角蓝框。
- 🎚 **模型菜单直接搬宿主实现**——不是「照着画」，是把宿主 `ModelSelect` 移植过来：「模型 / 推理档位」两级菜单、provider 分组 + 吸顶分组头、超过 4 条自动出搜索框、完整键盘导航与焦点回归、向上弹出的 portal 菜单并在滚动/缩放时重新定位、每行带免费/费率/上下文窗口/可用档位信息。未显式选择时显示的是宿主配置的真实默认模型，而不是笼统的「默认模型」；看到的档位就是实际下发的档位。选择只作用于本面板的下一条消息（消息级路由覆盖），不改你在 DSH 的全局默认。
- 🧵 **输出不再错乱、不再卡死**——流式管线按「尝试轮次」对齐增量，provider 回退切换时不会把两次回答拼在一起、也不会静默吞掉整段回答；每条回答都会标注真正产出它的模型，走备用通道重生成的回答还会额外标出「备用通道」——绕路要看得见，才算真的标了来源。面板被刷新打断的半截回答会标记为「已中断」并给出重试按钮，而不是永远转圈。
- 📖 **引用与召回分开说**——回答里的 `[n]` 与底部引用 chips 都能点开右栏对应笔记原文。chips 按「正文真的标了 `[n]`」分成**引用**与**相关片段**两组，判据与正文渲染 `[n]` 用的是同一条正则；导出的 `.md` 同样分两节写，不把召回一律冒充成引用。
- 📊 **Markdown 富渲染**——回答与原文栏支持表格、标题、链接、斜体、任务列表，沙箱化渲染（无可执行链接）。
- 📡 **vault 变更自动同步**——可选文件监听：从事件里的文件名直接定位到变动的那篇，**只重建那一篇**（10k 库实测端到端约 0.2–0.26s，含 150ms 防抖，期间零全量扫描）；定位不到单篇的事件（改名、删除、批量变动不给文件名）退回全量增量对账（约 1.2s 合并窗口），不漏改动。
- 📃 **长列表依然顺手**——笔记列表滚动触底分页，回答过程可见阶段（检索 → 规划 → 生成）。
- 🧭 **配置有引导**——vault 路径无效会在配置时报错并给出有效性提示，回答超时可配置。
- 🗂 **自动发现仓库**——读 Obsidian 自己的仓库注册表、扫描常见位置、支持系统目录选择对话框，或直接粘贴路径。
- ⚡ **增量索引**——按 mtime 增量刷新。本机实测（合成库 10k 笔记 / 40k chunk，Node 24）：全量索引约 2s，单篇「构建 + 提交 + 重算统计」约 50ms。口径注意：端到端增量仍要走一次目录扫描 + 逐文件 stat，同一库实测约 0.9–1.0s；文件监走走的是定向路径，保存后约 0.2–0.26s 就能检索到新内容（改造前约 1.5s）。
- 🧩 **原生面板体验**——注册在侧栏「全局面板」组（与插件管理、定时任务同组）；面板对话历史独立存于浏览器，与 DSH 会话日志互不干扰。
- ⬇️ **导出即下载**——「导出对话 .md」触发浏览器真实下载（保存位置由你决定；无下载 API 的宿主环境降级为复制全文到剪贴板），不再静默写入 vault。
- ↔️ **原文栏可拖宽**——对话区与右侧笔记预览之间的分割线可拖动缩放（键盘可达、双击复位、宽度跨刷新记忆）。

## 安装

**方式一——dsh-market（应用内，最简单）：** 在 DSH 插件市场按精确包名搜 `dsh-obsidian-board` 安装（只搜 `obsidian` 会同时命中其他无关条目；市场里的显示名以条目自身为准）。

**方式二——CLI：**

```sh
dsh plugin --profile web add "dsh-obsidian-board"
```

**方式三——从本仓库源码：**

```sh
dsh plugin --profile web add file:"<本仓库 clone 路径>"
```

或手动：在 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 加 `"dsh-obsidian-board": "file:<路径>"`、`dsh.profile.bundles` 加 `"dsh-obsidian-board"`，然后在该目录 `pnpm install` 并重启 DSH。

> 桌面端装进 `desktop` profile：把上面命令里的 `--profile web` 换成 `--profile desktop`（`~/.dsh/profiles/web` 换成 `~/.dsh/profiles/desktop`），其余步骤相同。

## 配置

编辑 profile 补丁（`~/.dsh/profiles/<profile>/cordis.patch.yml`）里 `dsh-obsidian-board` 条目的 `config`：

```yaml
- insert:
    - id: dsh-obsidian-board
      name: dsh-obsidian-board
      config:
        vaultPath: "D:\\笔记库\\MyVault"   # vault 根目录（绝对路径；支持 ~ 开头）
        provider: ""                       # DSH llm provider 路由名；空=宿主默认路由
        model: ""                          # 模型 id；空=provider 默认
        topK: 8                            # 每次送进回答的召回片段数（正文真标了 [n] 的才算引用）
        chunkLimit: 1200                   # 单片段最大字符数
        systemPrompt: ""                   # 自定义 RAG 系统提示词（空=内置）
```

> vaultPath 留空也可以：第一次打开面板时会有配置卡，在面板里直接发现/选择/粘贴路径连接。

## 使用

1. 侧栏「全局面板」里点 **Obsidian**（或侧栏底部入口）
2. 首次使用：选 vault → 连接（建索引在本地跑、不联网；合成短笔记实测：50 篇约 9ms、200 篇约 52ms、500 篇约 0.12s、万级库约 2s）
3. 直接提问：「我关于 X 的笔记说了什么」「总结 #标签 下的要点」
4. 回答里的 `[1]` `[2]` 引用与底部 chips（引用 / 相关片段两组）可点击 → 右栏打开笔记原文
5. Enter 发送；**生成中**按 Enter 是排队而不是打断当前回答。输入框下方的模型按钮打开模型菜单（模型 + 推理档位），选择只作用于本面板后续的提问（消息级路由覆盖），不会改你在 DSH 的全局默认

## 架构

```
dsh-obsidian-board/
├── lib/
│   ├── index.js    # 宿主半：ObsidianBoardGateway（TypertRemoteService）
│   │               #   status/configure/discoverVaults/pickVault/revealVault/
│   │               #   listNotes/readNote/search/reindex/chat
│   │               #   检索本地 BM25；chat 走 ctx.llm.stream（DSH 模型通道）
│   ├── typert.js   # RPC 契约（双键 codec，兼容 0.1.5-rc.x 与 0.1.6+）
│   ├── vault.js    # 纯 Node 零依赖索引器：扫描/frontmatter/BM25/增量刷新
│   └── client.js   # 客户端半：main slot 页面 + panellist/footer 入口
├── cordis.patch.yml
└── locale/*.json, icon.svg
```

### 与 DSH 主会话的关系

面板对话**不写入 DSH session log**：面板历史按仓库隔离并与宿主端 historyGet/historySet 同步（localStorage 兜底），面板重载后仍在；宿主端历史为内存态，服务重启即清。模型调用走宿主 `ctx.llm`，所以配额、重试、provider 路由与 DSH 主会话完全一致。

## 已知边界

- 检索引擎是 BM25 + 中文 bigram + 标题/标签加权，不是 embedding 语义检索——专有名词、关键词、标签检索效果最好，长句意译可能漏召回（二期可挂本地 embedding 模型，接口已留好）。PAT / 哈希 / 文件名这类长标识符已按字面精确匹配补偿。
- 收集来的第三方语料（`_公网收集`、`vendor`、`node_modules` 等路径）会**降权**，让你的自有笔记排在前面——不是剔除，真要查这些资料仍可召回，只是排序靠后。
- 隐藏目录只在「有意义」时才纳入索引（`.workbuddy` 已在白名单）；`.obsidian`、`.trash`、`.git` 这类结构/缓存目录始终跳过。
- 插件的完整配置面以 `lib/index.js` 的 `Config` 为准（含 planner、超时、扫描/监听调优等全部字段）——本 README 里 `cordis.patch.yml` 片段只是接入模板（仅 6 键）；面板内配置卡可编辑全部字段。
- 面板历史按仓库隔离（history:<vaultHash> 键），支持导出/导入 JSON，并与宿主端 historyGet/historySet 同步；宿主端为内存态（服务重启即清），本地 localStorage 兜底。
- 面板会话不支持 DSH 主会话的工具调用/子代理（这是设计取舍：知识库问答不需要）
- 输入框对齐了主对话页的发送 / 停止 / 排队 / 模型菜单，但**不含**附件、`/` 指令与 `@` 文件引用——同上，知识库问答不需要

## License

MIT
