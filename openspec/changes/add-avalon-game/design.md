# Design

## Context

GameBuddy 有三個純邏輯 engine（`engine.ts`、`undercover.ts`、`spyfall.ts`），adapter 用每款遊戲各一個 Map 存狀態、用 `lastKind` 決定按鈕交給誰。動機見 proposal.md，規則見 specs。

## Goals / Non-Goals

**Goals:**
- 阿瓦隆沿用「純邏輯 engine」模式，可以完整 unit test
- 既有三款遊戲的行為和測試不受影響

**Non-Goals:**
- 不做湖中女神、莫德雷德、奧伯倫（之後再評估）
- 不做戰績
- bot 不理解真人的發言內容
- 不抽共用模組

## Decisions

### 1. 新增 `src/avalon.ts`，介面和其他遊戲一致

`applyAvalon(state, action, rng) → { state, events }`，events 沿用 `GameEvent`。房間、輪流發言、再來一局照誰是臥底的寫法。

### 2. 隊長選人用「切換按鈕＋確認」

Slack 按鈕一次只能按一個，所以隊長選人的 prompt（kind `pickMember`）列出所有玩家，按一下加入、再按一下移除；另一則 prompt（kind `confirmTeam`）是「確認隊伍」按鈕，人數剛好時才能確認。每次切換只讓隊長看到目前的隊伍（ephemeral），避免洗版。

### 3. 出任務用私訊按鈕

任務 prompt（kind `quest`，audience `user`）私訊給每位隊員：好人只有「成功」按鈕，壞人有「成功」「失敗」兩個按鈕。結果只公開失敗票數，不公開誰投的。

### 4. 刺殺用壞人私訊群組

沿用狼人殺的 `wolfChat` event 開壞人群組（只拉真人），刺殺 prompt（kind `assassinate`，audience `wolves`）貼在群組裡，只有刺客按了才算。全部壞人都是 bot 時直接由 bot 刺殺。

### 5. 計時

| 階段 | 時間 | 超時 |
|---|---|---|
| 輪流發言 | 每人 40 秒 | 換下一位 |
| 隊長選人 | 90 秒 | 隨機補滿隊伍並送出 |
| 組隊投票 | 60 秒 | 沒投的算贊成 |
| 出任務 | 60 秒 | 沒出的算成功 |
| 刺殺 | 60 秒 | 隨機刺殺一位好人 |
