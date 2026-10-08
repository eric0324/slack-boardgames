# Proposal

## Why

花火是經典的合作遊戲：每個人看得到別人的牌、看不到自己的，只能靠有限的提示合力按順序打出五種顏色的煙火。Slack 的「只有自己看得到」訊息剛好適合「看別人的牌」。

## What Changes

- 新增「花火」（`/game hanabi`）：2～5 位真人（不支援 bot），基本版 5 色 50 張牌、8 個提示標記、3 次失誤
- 輪到的人選一個動作：出牌、棄牌、給提示（顏色或數字）
- 頻道有「看牌」按鈕，按了只有自己看得到別人的手牌和自己已知的提示
- 依官方規則結束與計分（最高 25 分）
- `/game` 遊戲清單加入花火

## Capabilities

### New Capabilities

- `hanabi/setup`: 開房、人數、牌堆與發牌、看牌
- `hanabi/turns`: 出牌、棄牌、提示、結束與計分


## Impact

- 新增 `src/hanabi.ts`
- `src/slack.ts`：註冊花火
- README、wiki、manifest usage hint
