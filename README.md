# dsh-obsidian-board

[English](#english) | [中文](#中文)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that turns your local **Obsidian vault** into a **dedicated RAG chat panel** inside the DSH GUI — a sidebar entry leading to a full three-pane page: note browser on the left, retrieval-augmented chat in the middle, cited note source on the right. The desktop app and the Web GUI ship the same browser-rendered client, so the panel behaves identically in both. All retrieval and indexing run **100% locally** (BM25 + CJK bigram); answers go through the model channel you already configured in DSH.

> **Not an MCP integration, not an Obsidian plugin** — this is a dual-half DSH plugin (host + browser client). The UI is injected into the DSH main window as a `main` slot page (same mechanism as switching conversations); model calls reuse the host `ctx.llm`; the knowledge base points at your local vault directory (Obsidian doesn't even need to be running).

> **Compatibility**: fully tested on DeepSeek Harness 44.7.0 (host ships `@deepseek-ai/dsh-typert-protocol@0.2.1-rc.2` / cordis 4.0.5); the declared peer range `>=0.1.5-rc.1` still covers it — no code changes needed in v0.2.3.

## Features

- 🔍 **Local-first retrieval** — BM25 with CJK bigram tokenization, title/path boosting, Obsidian tag & alias awareness. No embedding model, no network, no data leaves your machine.
- 🎯 **Finds what you actually wrote** — your own notes outrank collected third-party material (public skill libraries are down-weighted), long identifiers such as `github_pat_…` are matched literally, and meaningful hidden folders (e.g. `.workbuddy/`) are indexed instead of silently skipped.
- 🛑 **Stop that actually stops** — the stop button takes effect at any stage, including the retrieval/planning phase and the model's silent period before its first token. Stopped replies are shown as a neutral "stopped" state, not a red error.
- 🧵 **Output that never garbles or hangs** — the stream pipeline is keyed per attempt, so switching provider fallbacks can't splice two answers together or silently swallow a reply; each answer shows the model that actually produced it. Replies left mid-stream by a panel refresh are marked "interrupted" with a retry button instead of spinning forever.
- 📖 **Clickable citations** — every `[n]` in the answer and the citation chips below it open the exact note in the right-hand source pane.
- 🗂 **Automatic vault discovery** — reads Obsidian's own vault registry, scans common locations, offers a native directory picker, or takes a pasted path.
- ⚡ **Incremental indexing** — mtime-based; full scan of a 10k-note vault in under a second, incremental refresh in ~50 ms.
- 🧩 **Native panel experience** — registered under the sidebar "Panels" group (alongside the plugin manager and timer); the panel keeps its own chat history in the browser, separate from DSH session logs.

## Install

**Option 1 — dsh-market (in-app, easiest):** search `obsidian` in the DSH plugin market and install.

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
        topK: 8                           # chunks cited per answer
        chunkLimit: 1200                  # max chars per chunk in the prompt
        systemPrompt: ""                  # custom RAG system prompt (empty = built-in)
```

> `vaultPath` may stay empty — the panel shows a setup card on first open where you can discover/pick/paste the vault path interactively.

## Usage

1. Click **Obsidian** in the sidebar "Panels" group (or the sidebar footer entry).
2. First time: pick your vault → connect (indexing is instant and local).
3. Ask things like *"what do my notes say about X?"* or *"summarize the points under #tag"*.
4. Click `[1]` `[2]` citations or the chips under the answer → the note opens on the right.

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

The panel chat **does not write to DSH session logs**: history lives in browser localStorage and the host half is stateless (clearing after restart is expected). Model calls go through the host `ctx.llm`, so quotas, retries, and provider routing behave exactly like your main DSH sessions.

## Known limits

- Retrieval is BM25 + CJK bigram + title/tag weighting — not semantic embedding search. Proper nouns, keywords, and tags work best; long paraphrased questions may miss recall (a local embedding model is planned as a follow-up; the interface is already reserved). Long identifiers (PATs, hashes, file names) are matched literally to compensate.
- Collected third-party material (paths like `_公网收集`, `vendor`, `node_modules`) is down-weighted so your own notes win — it is still retrievable, just ranked below your own writing.
- Hidden folders are indexed only when they are meaningful (`.workbuddy` is allow-listed); structural/caching folders (`.obsidian`, `.trash`, `.git`) are always skipped.
- Panel history lives in localStorage — clearing browser data clears it.
- The panel chat intentionally doesn't support DSH main-session tool calls / subagents (knowledge-base Q&A doesn't need them).

## License

MIT

---

<a id="中文"></a>
# 中文

把本地 **Obsidian vault** 变成 DeepSeek Harness 里的**专属知识库对话页面**（桌面端与 Web 端通用）：侧栏多一个「Obsidian」入口，点开就是一个完整面板——左侧笔记浏览器、中间 RAG 聊天、右侧引用原文。检索（BM25 + 中文 bigram）与索引全部本地完成，回答走 DSH 已配置的模型通道。

> **不是 MCP 接入，也不是 Obsidian 插件**——这是一个 DSH 客户端+宿主双半插件：UI 注入进 DSH 主窗口（`main` slot 页面，与切换对话同构），模型调用复用宿主 `ctx.llm`，知识库指向你本地的 vault 目录（无需 Obsidian 运行）。

> **兼容性**：已在 DeepSeek Harness 44.7.0（宿主内置 `@deepseek-ai/dsh-typert-protocol@0.2.1-rc.2` / cordis 4.0.5）上全量测试通过；声明的 peer 范围 `>=0.1.5-rc.1` 继续覆盖，本版本无需代码改动。

## 特性

- 🔍 **本地优先检索**——BM25 + 中文 bigram 切词、标题/路径加权、Obsidian 标签与别名感知。不用 embedding、不联网、数据不出本机。
- 🎯 **找得到你真正写的东西**——自有笔记优先于收集来的第三方语料（公开 skill 库降权）、`github_pat_…` 这类长标识符按字面精确匹配、有意义的隐藏目录（如 `.workbuddy/`）也会纳入索引而非被静默跳过。
- 🛑 **停止真的能停**——停止按钮在**任何阶段**都生效，包括检索/规划阶段、以及模型吐首字前的静默期；被停止的回复显示中性「已停止」状态，而不是红色报错。
- 🧵 **输出不再错乱、不再卡死**——流式管线按「尝试轮次」对齐增量，provider 回退切换时不会把两次回答拼在一起、也不会静默吞掉整段回答；每条回答都会标注真正产出它的模型。面板被刷新打断的半截回答会标记为「已中断」并给出重试按钮，而不是永远转圈。
- 📖 **引用可点击**——回答里的 `[n]` 与底部引用 chips 都能点开右栏对应笔记原文。
- 🗂 **自动发现仓库**——读 Obsidian 自己的仓库注册表、扫描常见位置、支持系统目录选择对话框，或直接粘贴路径。
- ⚡ **增量索引**——按 mtime 增量刷新：万级笔记全量扫描 <1s，增量 <50ms。
- 🧩 **原生面板体验**——注册在侧栏「全局面板」组（与插件管理、定时任务同组）；面板对话历史独立存于浏览器，与 DSH 会话日志互不干扰。

## 安装

**方式一——dsh-market（应用内，最简单）：** 在 DSH 插件市场搜 `obsidian` 安装。

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
        topK: 8                            # 每次回答引用的片段数
        chunkLimit: 1200                   # 单片段最大字符数
        systemPrompt: ""                   # 自定义 RAG 系统提示词（空=内置）
```

> vaultPath 留空也可以：第一次打开面板时会有配置卡，在面板里直接发现/选择/粘贴路径连接。

## 使用

1. 侧栏「全局面板」里点 **Obsidian**（或侧栏底部入口）
2. 首次使用：选 vault → 连接（索引本地毫秒级完成）
3. 直接提问：「我关于 X 的笔记说了什么」「总结 #标签 下的要点」
4. 回答里的 `[1]` `[2]` 引用与底部引用 chips 可点击 → 右栏打开笔记原文

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

面板对话**不写入 DSH session log**：历史存浏览器 localStorage，宿主半无状态（重启后面板历史清空是预期）。模型调用走宿主 `ctx.llm`，所以配额、重试、provider 路由与 DSH 主会话完全一致。

## 已知边界

- 检索引擎是 BM25 + 中文 bigram + 标题/标签加权，不是 embedding 语义检索——专有名词、关键词、标签检索效果最好，长句意译可能漏召回（二期可挂本地 embedding 模型，接口已留好）。PAT / 哈希 / 文件名这类长标识符已按字面精确匹配补偿。
- 收集来的第三方语料（`_公网收集`、`vendor`、`node_modules` 等路径）会**降权**，让你的自有笔记排在前面——不是剔除，真要查这些资料仍可召回，只是排序靠后。
- 隐藏目录只在「有意义」时才纳入索引（`.workbuddy` 已在白名单）；`.obsidian`、`.trash`、`.git` 这类结构/缓存目录始终跳过。
- 面板历史存 localStorage，清浏览器数据会丢
- 面板会话不支持 DSH 主会话的工具调用/子代理（这是设计取舍：知识库问答不需要）

## License

MIT
