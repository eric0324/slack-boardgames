# Design

## Context

GameBuddy 已經有狼人殺（`src/engine.ts`）和誰是臥底（`src/undercover.ts`）兩個純邏輯 engine，adapter（`src/slack.ts`）用每款遊戲各一個 Map 存狀態、用 `lastKind` 決定按鈕交給誰。動機見 proposal.md，規則見 specs。

## Goals / Non-Goals

**Goals:**
- 間諜危機沿用「純邏輯 engine」模式，可以完整 unit test
- 既有兩款遊戲的行為和測試不受影響

**Non-Goals:**
- 不做多回合計分（一局就分勝負）
- 不做戰績
- bot 不理解真人的提問內容
- 不抽共用模組；房間和投票的程式碼和誰是臥底有重複，等之後再評估

## Decisions

### 1. 新增 `src/spyfall.ts`，介面和誰是臥底一致

`applySpyfall(state, action, rng) → { state, events }`，events 沿用 `GameEvent`。房間、投票、PK、再來一局的寫法照誰是臥底，讓三款遊戲的行為一致。

### 2. 接力提問用兩個子步驟

提問階段（`qa`）裡有兩個子步驟：
- `choose`：提問者選人，prompt kind `askTarget`，選項是可以問的玩家，計時 40 秒，超時隨機選
- `answer`：被問的人回答，prompt kind `endAnswer`（「回答完畢」按鈕），計時 40 秒

整個提問階段另有一個 8 分鐘的總計時器（剩 1 分鐘時再提醒一次），和上面的步驟計時器分開，用不同的 timer id，跟狼人殺夜晚同時有兩個計時器的做法一樣。總時間到時，不管目前在哪個子步驟都直接進入投票。

### 3. 間諜猜地點用 slash command

`/game spyfall guess <地點>`，和誰是臥底白板猜詞一樣，不需要額外權限。提問階段任何時候都能猜一次；被指控後進入 `lastGuess` 階段，60 秒。

### 4. 地點庫放在 `src/spyfallLocations.ts`

格式：`{ name, roles: string[], hints: string[] }[]`，另外有 bot 用的通用問題清單 `QUESTIONS` 和間諜 bot 的通用回答 `SPY_ANSWERS`。用測試檢查數量、角色數、描述句不包含地點名稱、名稱不重複、通用問題和間諜回答不包含任何地點名稱。

### 5. adapter

新增 `spyfallGames` Map、`/game spyfall <sub>` 解析，`lastKind` 加上 `'spyfall'`，按鈕依 `lastKind` 交給間諜危機（新增 `askTarget`、`endAnswer` 兩種按鈕）。

## Risks / Trade-offs

- [第三份重複的房間／投票程式碼] → 先接受；三款遊戲都有完整測試，之後抽共用模組時有測試保護
- [真人在提問中打字但沒按按鈕] → 有 40 秒計時和房主的 `next` 指令，不會卡住
- [地點庫品質] → 人工撰寫，實際玩過再調整
