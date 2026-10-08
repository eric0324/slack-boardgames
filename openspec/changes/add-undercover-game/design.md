# Design

## Context

狼人殺的架構是「純邏輯 engine（`src/engine.ts`）＋ Slack adapter（`src/slack.ts`）」：engine 收 action、回傳新 state 和 events，adapter 把 events 轉成 Slack API 呼叫、管理計時器。動機見 proposal.md，規則見 specs。

## Goals / Non-Goals

**Goals:**
- 誰是臥底用同樣的「純邏輯 engine」模式，可以完整 unit test
- adapter 支援多款遊戲，但不動到狼人殺 engine 的行為（既有 250 個測試維持通過）

**Non-Goals:**
- 這次不把狼人殺和誰是臥底的共同邏輯（房間、輪流發言、投票）抽成共用模組；先各自實作，等第三款遊戲時再評估要不要抽
- 戰績查詢不包含誰是臥底
- bot 不會理解真人的描述（不做聊天比對）

## Decisions

### 1. 新增獨立的 `src/undercover.ts` engine

介面和狼人殺一致：`applyUndercover(state, action, rng) → { state, events }`。events 沿用狼人殺的 `GameEvent` 形狀（`announce`、`ephemeral`、`dm`、`lobby`、`prompt`、`startTimer`），adapter 的 `send()` 不用為誰是臥底另外寫一套。

**為什麼不共用狼人殺的 engine**：狼人殺 engine 已經很大，而且有很多狼人殺專屬的狀態（夜晚、藥水、騎士…）。誰是臥底的流程簡單很多，獨立實作比較好讀，也不會讓狼人殺的測試受影響。代價是房間、輪流發言、投票的程式碼有一部分重複。

### 2. adapter 記錄每個頻道在玩哪一款遊戲

兩款遊戲各用一個 Map 存狀態（`games` 給狼人殺、`undercoverGames` 給誰是臥底），另外用 `lastKind` 記錄每個頻道最近一局是哪款遊戲。「一個頻道只能一局」由 `active(channel)` 檢查兩個 Map 裡有沒有還沒結束的遊戲。按鈕的 action_id 維持 `ww:<kind>:<index>`，共用的按鈕種類（join、leave、start、endSpeech、dayVote、pkVote、rematch）依 `lastKind` 決定交給誰；計時器在設定時就記住是哪款遊戲的。

原本打算改成單一 Map 記錄 `{ kind, state }`，但那樣狼人殺既有的 Slack 測試（直接讀 `host.games`）全部要改，所以改用兩個 Map，行為相同。

### 3. `/game` 指令解析

`/game` → 遊戲清單；`/game werewolf <sub>` → 原本的狼人殺解析（`/werewolf <sub>` 也走這裡）；`/game undercover <sub>` → 誰是臥底的子指令：`new`、`addbot [n]`、`removebot [n]`、`start`、`next`、`vote`、`cancel`、`guess <詞>`、`help`。`/game stats` 先等同狼人殺的戰績查詢。manifest 新增 `/game` slash command。

### 4. 詞庫放在 `src/undercoverWords.ts`

格式：`{ a: { word, hints: string[] }, b: { word, hints: string[] } }[]`。用測試檢查：至少 60 組、每個詞至少 3 句描述、描述句不包含自己的詞和同組另一個詞。另外有一組白板 bot 用的通用模糊台詞。

### 5. 白板猜詞用 slash command

白板被放逐後輸入 `/game undercover guess <詞>`。用 slash command 比較簡單，不需要額外申請讀取私訊的權限，也不需要做 Slack modal。猜詞期間是一個獨立的階段，有 60 秒計時。

## Risks / Trade-offs

- [房間、輪流發言、投票的程式碼和狼人殺重複] → 先接受；兩邊都有完整測試，之後要抽共用模組時有測試保護
- [隨機投票的 bot 可能一直平票，遊戲拖很久] → bot 不棄票、PK 平手才會沒人出局，機率會越來越低；用多組隨機種子的整局測試確認一定會結束
- [詞庫品質] → 詞庫由人工撰寫，測試只能檢查格式和不洩漏詞，好不好玩要實際玩過再調整
