# Proposal

## Why

GameBuddy 已經有狼人殺和誰是臥底，玩家想要更多種類的推理遊戲。「間諜危機」跟誰是臥底一樣是找出「不一樣的那個人」，但玩法是互相提問，節奏和策略都不同；而且能沿用誰是臥底已經做好的房間、私訊發牌、投票、PK 和 bot 機制，開發成本低。

## What Changes

- 新增「間諜危機」（`/game spyfall`）：4～10 人，1 位間諜，其他人私訊收到同一個地點和各自的角色，間諜只知道自己是間諜和所有可能的地點
- 接力提問：輪到的人用按鈕選一位玩家提問，被問的人回答後接著問下一個人（不能反問剛剛問自己的人），總共 8 分鐘
- 時間到（或房主提前結束）投一次票，平票進 PK；被指控的是間諜時間諜還有最後一次猜地點的機會
- 間諜在提問期間隨時可以猜一次地點：猜中間諜贏、猜錯間諜輸
- 內建地點庫（至少 30 個，每個地點有角色和描述句），bot 可以補位並用描述句提問、回答
- `/game` 遊戲清單加入間諜危機

## Capabilities

### New Capabilities

- `spyfall/setup`: 開房、人數、發牌（地點與角色）、地點庫
- `spyfall/rounds`: 接力提問、提問時間、投票與 PK、間諜猜地點
- `spyfall/win-condition`: 勝負判定、結束公開、再來一局
- `spyfall/bots`: bot 提問、回答、投票、間諜 bot 猜地點

### Modified Capabilities

- `game-commands`: `/game` 的遊戲代號加入 `spyfall`，遊戲清單和使用說明加入間諜危機

## Impact

- 新增 `src/spyfall.ts`（純邏輯 engine）、`src/spyfallLocations.ts`（地點庫）
- `src/slack.ts`：新增間諜危機的狀態 Map、指令解析和按鈕對應
- README、wiki 新增間諜危機；`/game` 的 usage hint 更新
