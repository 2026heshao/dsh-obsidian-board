# 分区漏点登记（主理人齐活林审核发现）

> 架构师的 batch 分区表在「跨文件契约」上有真实缺口。本文逐条登记，
> 每条都必须显式指派给某一批次，否则功能永远不生效（配置声明了但没接线 = 死字段）。

## GAP-1 `new VaultIndex()` 未接线（严重：5 个配置字段全为死字段）

**现状**（`lib/index.js:346`，I1 改后行号）：
```js
constructor(ctx, config) {
    super(ctx, "obsidianBoard");
    this.config = config || {};
    this.index = new VaultIndex();   // ← 一个参数都没传
    this.vaultPath = "";
}
```

**问题链**：
1. I1 在 `Config` 声明了 7 个字段（含 `extraVendoredDirs` / `extraSkipDirs` / `extraDotDirs` / `vendoredWeight` / `scanMaxDepth`）。
2. vault.js 批次把这 5 个值做成了 `VaultIndex` **构造函数选项**（`lib/vault.js:252` `constructor({ skipDirs, allowDotDirs, maxDepth, vendoredWeight, vendoredDirHints, maxNoteBytes, readConcurrency, watchDebounceMs } = {})`）。
3. **但 `lib/index.js:346` 仍是无参构造** → 用户在 `cordis.patch.yml` 里写这些键，索引器完全不读。

**根因**：架构师契约表第 1 条写「Config 7 新字段 = I1」，第 5 条写「consumption = vault.js」，但**两侧之间的接线行 `lib/index.js:346` 谁都不负责**。

**指派**：归 **I2**（index.js 第二批次，已持有 1.4 宿主侧）。I2 任务书必须新增一条：
```js
this.index = new VaultIndex({
    skipDirs: cfgArray(this.config.extraSkipDirs),
    allowDotDirs: cfgArray(this.config.extraDotDirs),
    maxDepth: cfgNumber(this.config.scanMaxDepth, 12),
    vendoredWeight: cfgNumber(this.config.vendoredWeight, 0.45),
    vendoredDirHints: [...VENDORED_DIR_HINTS_BASE, ...cfgArray(this.config.extraVendoredDirs)],
});
```
⚠ 注意 `vendoredDirHints` 是**追加**不是**替换**——换成 `extraVendoredDirs` 直接替换会把基线内置的 `skills/_*` 等识别丢掉。

**验收**：`new VaultIndex({ vendoredWeight: 1 })` 的 `index.vendoredWeight === 1`；不传时为 `0.45`。且必须有一条测试证明「Config 里设 `scanMaxDepth: 3` → 深层笔记不进索引」。

## GAP-2 `maxNoteBytes` 无 Config 出口（轻微：仅不可配）

vault.js 有 `maxNoteBytes = DEFAULT_MAX_NOTE_BYTES`（`lib/vault.js:259`），但 I1 的 Config 7 字段里**没有**对应键，`lib/index.js` 全文 `/maxNoteBytes/` 命中 0。

- **影响**：OPT-1.6 的「大文件保护」有默认值可用，功能成立；只是用户无法调整阈值。
- **判定**：**接受**，本轮不改。理由：优化清单 1.6 只要求「有大小上限」，未要求可配置；且新增 Config 字段要同步 `cordis.patch.yml`，收益不抵成本。记为遗留。

## GAP-3 `cordis.patch.yml` 未同步新配置项（需决策）

`cordis.patch.yml` 当前只有 6 个键（`vaultPath`/`provider`/`model`/`topK`/`chunkLimit`/`systemPrompt`），**连基线的 `historyLimit`、`reasoningEffort` 都不在里面**——说明该文件的既有惯例是「只列常用键」，不是 schema 全量镜像。

- **判定**：**接受现状**。Config schema 是权威，patch 只是「示例/覆盖点」。若强求同步，反而与基线惯例不一致（对称性破坏）。
- **但**：`OPT-7.2`（README 边界同步）必须写明「配置项以 `lib/index.js` 的 `Config` 为准，`cordis.patch.yml` 仅示例」，避免用户以为 patch 里没有就不能配。

## GAP-4 `plannerEnabled` 的双重语义（已确认无问题）

I1 在 `lib/index.js:661` 做了真实短路（不只是 status 上报），符合「不留死字段」原则。下游若在别处消费，统一用 `this.config.plannerEnabled === false` 判定。**无缺口**，仅登记约定。
