# 生效链路核实（主理人实测，2026-10-19）

## 结论：改工作区 = 立即改生效插件，无需同步

```
C:\Users\LENOVO\.dsh\profiles\desktop\node_modules\dsh-obsidian-board
    → ReparsePoint (Directory Junction)
    → D:\桌面\AI Port\DSH plugins\dsh-obsidian-board
```

### 实测证据
1. `Get-Item` 显示 `Attributes: Directory, ReparsePoint`，`Target: D:\桌面\AI Port\DSH plugins\dsh-obsidian-board`
2. 写探测文件到工作区 `.work\junction-probe.txt` → 立即能从安装路径读到同样内容 `probe-1135124580`
3. 删除工作区文件 → 安装路径侧同步消失
4. 安装目录内的条目就是工作区条目（含 `.work`、`test`、`node_modules`）

### 对交付的意义
- **改完即生效**，不需要 copy/rsync 步骤。
- 但反过来：**任何破坏性试验都会直接污染生效插件**。因此：
  - 禁止在 `lib/` 上做「跑一半的中间态」写入（例如先删后用）；
  - 每批改动后必须 `node --test` 通过才允许留在盘上；
  - 建议每批开始前 `git stash`/`git diff` 确保可回滚（工作区是 git repo，HEAD `0d164fe`）。
- 用户若需「重启 DSH 后看到新面板」，只需重启 GUI；**不需要重装**。

## 验收命令
- ✅ `cd "D:\桌面\AI Port\DSH plugins\dsh-obsidian-board"; node --test`
- ❌ `node --test test/` —— Node v24.19.0 报 `Cannot find module ...\test`
