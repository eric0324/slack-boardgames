# Design

## Context

GameBuddy 有四個純邏輯 engine，adapter 用每款遊戲各一個 Map 存狀態、用 `lastKind` 決定按鈕交給誰。房間公告已經有「貼一次、之後原地更新」的做法（`lobby` event + `lobbyTs`）。動機見 proposal.md，規則見 specs。

## Goals / Non-Goals

**Goals:**
- 機密代號沿用「純邏輯 engine」模式，可以完整 unit test
- 既有四款遊戲的行為和測試不受影響

**Non-Goals:**
- 不支援 bot（隊長需要理解詞義）
- 不做戰績、不做多局計分
- 不做「提示數字 0／無限」的進階規則

## Decisions

### 1. 新增 `board` event：可以原地更新的牌桌

`{ type: 'board'; text: string; rows: { value: string; label: string; style?: 'primary' | 'danger' }[][] }`。adapter 第一次收到時貼出訊息並記住 ts，之後同一個頻道的 `board` 都用 `chat.update` 更新同一則訊息（和房間公告相同做法）。5 列 × 5 個按鈕，每列一個 actions block；按鈕 action_id 是 `ww:guess:<index>`，value 是 `<頻道>|<字卡位置>`。

已翻開的牌在按鈕文字前加上顏色 emoji（🟥 紅、🟦 藍、⬜ 中立、💀 刺客），紅隊的牌用 `danger` 樣式、藍隊用 `primary`；已翻開的牌按了不會有反應。

### 2. 隊長的答案用私訊文字

開始時私訊兩位隊長一張 5×5 的答案表（每格「emoji＋詞」），之後不再更新（翻牌狀態看頻道的牌桌就知道）。

### 3. 提示用 slash command

`/game codenames clue <詞> <數字>`：詞不能有空白、不能是牌桌上還沒翻開的詞，數字 1～9。

### 4. 詞庫放在 `src/codenamesWords.ts`

至少 200 個不重複、沒有空白、1～4 個字的中文詞，用測試檢查。

### 5. 計時

| 階段 | 時間 | 超時 |
|---|---|---|
| 隊長給提示 | 2 分鐘 | 換對方隊伍 |
| 隊員猜牌 | 3 分鐘 | 換對方隊伍 |
