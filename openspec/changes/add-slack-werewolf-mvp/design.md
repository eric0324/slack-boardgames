# Design

## Context

這是全新專案，目前還沒有任何程式碼。動機請見 proposal.md 的 Why，各項行為規則請見 `specs/`。

限制：
- Slack 的互動（slash command、按鈕）必須在 3 秒內 ack
- Slack 沒有辦法禁止特定使用者在頻道發言，bot 也只能刪除自己的訊息
- `chat.postEphemeral` 送出的訊息重新整理後可能消失，所以不適合拿來放身分這類需要回頭查看的資訊

## Goals / Non-Goals

**Goals:**
- 遊戲規則全部放在一個沒有 I/O 的 engine 裡，可以用 unit test 完整覆蓋
- Slack adapter 盡量薄，只負責「Slack 事件 → engine action」和「engine event → Slack 訊息」這兩種轉換

**Non-Goals:**
- 持久化：遊戲狀態只放在記憶體裡
- 警長、白痴、守衛等其他角色，以及自訂角色配置
- 隱藏夜晚的時間差（例如預言家已死，夜晚會比較短，玩家可能藉此推理）
- 多 workspace 發佈（只安裝在自己的 workspace）

## Decisions

### 1. Engine 用「state + action → state + events」的純函式

```ts
applyAction(state: GameState, action: Action, rng: () => number): { state: GameState; events: GameEvent[] }
```

- `Action`：`join`、`leave`、`start`、`cancel`、`wolfVote`、`seerCheck`、`witchAct`、`dayVote`、`hunterShoot`、`endDiscussion`、`timeout`
- `GameEvent`：`announce`（頻道公告）、`dm`（私訊）、`wolfChat`（狼人私密對話）、`ephemeral`（只給某個人看）、`prompt`（帶按鈕的行動提示）、`startTimer`（請 adapter 設定計時）、`gameOver`
- 隨機數由外部注入 `rng`，測試時可以固定結果

**為什麼不用 class 或 state machine 套件**：純函式最好測、最直觀，規模也還不需要 XState 這類工具。

### 2. 計時由 adapter 負責，engine 只發出 `startTimer` event

Engine 發出 `startTimer({ phaseId, ms })`，adapter 用 `setTimeout` 計時，時間到了就送 `timeout({ phaseId })` 回 engine。每個階段都有唯一的 `phaseId`，engine 收到不是目前階段的 timeout 就直接忽略。這樣取消遊戲或提前進入下個階段時，不需要另外清掉計時器也不會出錯。

**為什麼不在 engine 裡計時**：engine 要維持沒有 I/O、沒有時間依賴，測試時直接送 `timeout` action 就能模擬時間到。

### 3. 並發：每局遊戲的 action 同步處理

Node.js 是單執行緒，`applyAction` 是同步函式，所以同一局的多個 action 一定會依序執行，不會有 race condition。Adapter 會先 ack，再同步呼叫 engine，最後才非同步送出 Slack 訊息。

### 4. 私密資訊的管道

| 資訊 | 管道 | 原因 |
|---|---|---|
| 身分、預言家查驗結果、女巫和獵人的提示 | bot 私訊（`conversations.open` + `chat.postMessage`） | 需要能回頭查看 |
| 狼人密談、擊殺選擇 | 多人私訊（MPIM，`conversations.open` 帶入所有狼人） | 不需要建立和清理 private channel，只要 `mpim:write` |
| 錯誤提示、投票確認 | ephemeral | 臨時訊息，消失也沒關係 |

### 5. 檔案結構

```
src/
  engine.ts      # 型別、角色配置表、applyAction（純邏輯）
  slack.ts       # Bolt app：指令和按鈕 → action，event → Slack API
  index.ts       # 讀取環境變數，啟動 app
test/
  engine.test.ts # 對應 specs 的 scenarios
  slack.test.ts  # 用假的 Slack client 驗證 event 轉換
```

`engine.ts` 預估會超過 100 行。如果寫到太長，再依角色或階段拆檔，但一開始先放在同一個檔案。

### 6. 技術選擇

- `@slack/bolt` + Socket Mode：不需要公開 URL，本機就能開發和執行
- `vitest`：設定少，支援 TypeScript
- `tsx`：開發時直接執行 TypeScript

## Risks / Trade-offs

- [bot 重啟會讓進行中的遊戲消失] → MVP 接受這個限制；engine 的 state 是純資料，之後要序列化存到 SQLite 很容易
- [Slack rate limit：`chat.postMessage` 大約每秒 1 則] → 每個階段的訊息量很少；私訊分散在不同對話，不會集中在同一個 rate limit
- [夜晚長度會透露已死亡的角色] → 已列為 Non-Goal，之後可以改成固定的夜晚長度
- [玩家截圖分享身分] → 這是社交層面的問題，bot 無法防止
- [死亡玩家在頻道發言] → 只能靠提醒和玩家自律

## Migration Plan

全新專案，沒有遷移問題。部署方式：在自己的 workspace 建立 Slack App，設定 `.env` 的 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN`，然後執行 `npm start`。
