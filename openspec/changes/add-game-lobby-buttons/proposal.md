## Why

遊戲越來越多（9 款），要開房得記住每款遊戲的代號再打 `/game <代號> new`。改成輸入 `/game` 就跳出一個「大廳」，每款遊戲旁邊有「開房」按鈕，點一下就開房，省去打指令。

## What Changes

- `/game`、`/game help`、不認識的遊戲代號：原本的文字清單改成大廳訊息（只有輸入的人看得到），每款遊戲一列：名稱、人數、一句介紹，加上「開房」按鈕
- 按「開房」等同輸入 `/game <代號> new`：按的人當房主；頻道已經有遊戲時一樣拒絕
- 大廳訊息保留 wiki 連結和「`/game <代號> help` 看指令」的提示

## Impact

- Specs：`game-commands`（遊戲清單與使用說明）
- Code：`src/slack.ts`（大廳訊息、`lobbyOpen` 按鈕）
- Docs：wiki 首頁「開始玩」、README 簡介
