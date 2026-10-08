# Proposal

## Why

GameBuddy 目前沒有合作遊戲。一字千金是大家一起對抗系統：一個人猜詞，其他人私下各給一個提示詞，重複的提示會被刪掉，所以要想得跟別人不一樣又能讓人猜到。氣氛輕鬆，不用互相懷疑。

## What Changes

- 新增「一字千金」（`/game justone`）：3～7 位真人（不支援 bot）
- 13 張牌：每輪輪流一人猜詞，其他人用 `/game justone clue <詞>` 私下給提示，bot 自動刪掉重複的提示，猜詞的人用 `/game justone guess <詞>` 猜或按「跳過」
- 依官方規則計分（猜錯會多丟一張牌），最後依分數給評價
- 詞庫沿用機密代號的詞庫
- `/game` 遊戲清單加入一字千金

## Capabilities

### New Capabilities

- `justone/setup`: 開房、人數、牌堆
- `justone/rounds`: 給提示、刪除重複、猜詞、計分、結束評價


## Impact

- 新增 `src/justone.ts`；沿用 `src/codenamesWords.ts`
- `src/slack.ts`：註冊一字千金
- README、wiki、manifest usage hint
