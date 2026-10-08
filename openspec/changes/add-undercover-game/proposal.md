# Proposal

## Why

專案已經改名為 GameBuddy（slack-gamebuddy），準備支援多款桌遊。「誰是臥底」規則簡單、一局約 10 分鐘，而且能沿用狼人殺已經做好的房間、私訊、輪流發言、投票和 bot 機制，很適合當第二款遊戲。同時也需要一個統一的指令入口，之後加遊戲不用再申請新的 slash command。

## What Changes

- 新增統一指令 `/game`：`/game <遊戲> <子指令>`，例如 `/game undercover new`、`/game werewolf new`；`/werewolf` 保留為狼人殺的捷徑
- 一個頻道同時只能有一局遊戲，不分遊戲種類
- 新增「誰是臥底」：4～12 人，身分有平民、臥底、白板；私訊發詞（不告訴玩家自己是哪個身分）、輪流描述、投票放逐、平票 PK、出局公開身分、白板被投出時可以猜平民詞
- 勝負：臥底和白板都出局時平民勝；存活的臥底＋白板 ≥ 存活平民時臥底陣營勝；白板猜中平民詞時臥底陣營勝
- 內建詞庫（至少 60 組詞，每個詞附上描述句），bot 可以補位並用描述句發言
- 遊戲結束公開所有人的身分和詞，並提供「再來一局」

## Capabilities

### New Capabilities

- `game-commands`: `/game` 統一指令、遊戲清單與使用說明、`/werewolf` 捷徑、一個頻道只能有一局（不分遊戲）
- `undercover/setup`: 開房、人數、身分配置、私訊發詞、詞庫
- `undercover/rounds`: 輪流描述、投票、平票 PK、出局公開身分、白板猜詞
- `undercover/win-condition`: 勝負判定、結束公開、再來一局
- `undercover/bots`: bot 補位、依詞庫描述句發言、投票、白板 bot 猜詞

### Modified Capabilities

（無。狼人殺既有的 `/werewolf` 指令行為不變，`/game werewolf` 是新增的入口）

## Impact

- 新增 `src/undercover.ts`（純邏輯 engine）、`src/undercoverWords.ts`（詞庫）
- `src/slack.ts`：遊戲狀態改成記錄遊戲種類，依種類把指令、按鈕、計時交給對應的 engine；新增 `/game` 指令解析
- Slack App manifest 新增 `/game` slash command，需要在 Slack 更新 App Manifest
- wiki 新增「誰是臥底」頁面
- 戰績查詢這次不包含誰是臥底（`/game stats` 先只查狼人殺）
