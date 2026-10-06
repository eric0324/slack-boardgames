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

- `Action`：`new`、`join`、`leave`、`start`、`cancel`、`wolfVote`、`seerCheck`、`witchAct`、`dayVote`、`hunterShoot`、`endDiscussion`、`timeout`
- `GameEvent`：`announce`（頻道公告）、`lobby`（房間公告的最新內容）、`dm`（私訊）、`wolfChat`（狼人私密對話）、`ephemeral`（只給某個人看）、`prompt`（帶按鈕的行動提示）、`startTimer`（請 adapter 設定計時）
- 遊戲結束時 engine 把 `phase` 設成 `ended`，並送出公開身分的 `announce`，不另外設計 `gameOver` event
- 實作上 `applyAction` 會先複製一份 state 再直接修改這份複本；如果 action 無效，就回傳原本的 state
- 隨機數由外部注入 `rng`，測試時可以固定結果

**為什麼不用 class 或 state machine 套件**：純函式最好測、最直觀，規模也還不需要 XState 這類工具。

### 2. 計時由 adapter 負責，engine 只發出 `startTimer` event

Engine 發出 `startTimer({ id, ms })`，adapter 用 `setTimeout` 計時，時間到了就送 `timeout({ id })` 回 engine。每個計時器都有一個不重複的 `id`，engine 記錄每個 id 對應哪一個計時器（`wolves`、`witch`、`phase`）。收到不是目前有效計時器的 timeout，就直接忽略。這樣取消遊戲或提前進入下個階段時，不需要另外清掉計時器也不會出錯。

一開始的設計是「每個階段一個 phaseId」。但夜晚裡，狼人和預言家的 60 秒與女巫的 60 秒會重疊，所以改成每個計時器各自一個 id。同一個頻道重新開房時，id 會接續上一局繼續往上加，避免舊遊戲的計時器誤觸新遊戲。

**為什麼不在 engine 裡計時**：engine 要維持沒有 I/O、沒有時間依賴，測試時直接送 `timeout` action 就能模擬時間到。

### 3. 並發：每局遊戲的 action 同步處理

Node.js 是單執行緒，`applyAction` 是同步函式，所以同一局的多個 action 一定會依序執行，不會有 race condition。Adapter 會先 ack，再同步呼叫 engine，最後才非同步送出 Slack 訊息。

### 4. 私密資訊的管道

| 資訊 | 管道 | 原因 |
|---|---|---|
| 身分、預言家查驗結果、女巫和獵人的提示 | bot 私訊（`conversations.open` + `chat.postMessage`） | 需要能回頭查看 |
| 狼人密談、擊殺選擇 | 多人私訊（MPIM，`conversations.open` 帶入所有狼人） | 不需要建立和清理 private channel，只要 `mpim:write` |
| 錯誤提示、投票確認 | ephemeral | 臨時訊息，消失也沒關係 |

Slack 的按鈕文字只能是純文字，不能用 `<@id>` 顯示名字。所以 adapter 會從 slash command 和按鈕 payload 記下玩家的 username，拿來當按鈕文字，不需要額外的 `users:read` scope。按鈕的 `action_id` 是 `ww:<kind>:<index>`，`value` 是 `<遊戲頻道>|<選項值>`，所以在私訊裡按的按鈕也能找到對應的遊戲。

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

`engine.ts` 最後大約 575 行。因為各階段之間互相呼叫（結算 → 天亮 → 獵人 → 討論 → 投票 → 夜晚），拆檔反而要來回跳著看，所以維持單一檔案。

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
