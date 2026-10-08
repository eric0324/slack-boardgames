# Proposal

## Why

GameBuddy 目前的四款遊戲都是「找出壞人」的推理遊戲。機密代號是兩隊比賽的聯想遊戲，氣氛完全不同：隊長要想出一個詞串起好幾張字卡，隊員要猜中自己隊的字卡、避開刺客。很適合用 Slack 的按鈕排成 5×5 的牌桌。

## What Changes

- 新增「機密代號」（`/game codenames`）：4～12 位真人（不支援 bot），隨機分成紅、藍兩隊，每隊隨機一位隊長
- 頻道貼出 5×5 字卡按鈕，翻牌後原地更新；隊長私訊收到答案（每張牌是哪一隊、中立或刺客）
- 輪流進行：隊長用 `/game codenames clue <詞> <數字>` 給提示，隊員按字卡猜，可以猜「數字＋1」張
- 先翻完自己隊所有字卡的隊伍獲勝；翻到刺客的隊伍直接輸
- 內建中文詞庫（至少 200 個詞）
- `/game` 遊戲清單加入機密代號

## Capabilities

### New Capabilities

- `codenames/setup`: 開房、人數、分隊、牌桌與詞庫、隊長私訊答案
- `codenames/turns`: 給提示、猜牌、結束猜牌、計時
- `codenames/win-condition`: 勝負判定、結束公開、再來一局

### Modified Capabilities

- `game-commands`: `/game` 的遊戲代號加入 `codenames`，遊戲清單和使用說明加入機密代號

## Impact

- 新增 `src/codenames.ts`（純邏輯 engine）、`src/codenamesWords.ts`（詞庫）
- `src/engine.ts`：新增 `board` event（可以原地更新的按鈕牌桌）
- `src/slack.ts`：新增機密代號的狀態 Map、指令解析、按鈕對應、牌桌訊息的貼出與更新
- README、wiki 新增機密代號；`/game` 的 usage hint 更新
