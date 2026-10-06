# Slack 狼人殺 bot

在 Slack 頻道裡玩文字版狼人殺，由 bot 擔任主持人。支援 6～12 人，角色有狼人、村民、預言家、女巫、獵人，採用屠邊規則。

完整規則請見 `openspec/changes/add-slack-werewolf-mvp/specs/`。

## 建立 Slack App

1. 到 <https://api.slack.com/apps> 按 **Create New App → From an app manifest**，選擇你的 workspace，貼上下面的 manifest：

   ```yaml
   display_information:
     name: Werewolf
   features:
     bot_user:
       display_name: werewolf
       always_online: true
     slash_commands:
       - command: /werewolf
         description: 狼人殺
         usage_hint: new | start | vote | cancel
         should_escape: false
   oauth_config:
     scopes:
       bot:
         - commands
         - chat:write
         - im:write
         - mpim:write
   settings:
     interactivity:
       is_enabled: true
     socket_mode_enabled: true
   ```

2. **Basic Information → App-Level Tokens**：按 **Generate Token and Scopes**，加入 `connections:write` scope，產生 `xapp-` 開頭的 token
3. **Install App**：安裝到 workspace，複製 `xoxb-` 開頭的 Bot User OAuth Token
4. 在專案根目錄建立 `.env`：

   ```sh
   cp .env.example .env
   # 填入 SLACK_BOT_TOKEN（xoxb-...）和 SLACK_APP_TOKEN（xapp-...）
   ```

## 執行

```sh
npm install
npm start      # 用 Socket Mode 連上 Slack，不需要公開 URL
npm test       # 執行測試
```

## 怎麼玩

1. 先把 bot 邀請進要玩的頻道：`/invite @werewolf`（bot 不在頻道裡就無法發訊息）
2. `/werewolf new`：開房，按「加入」參加
3. `/werewolf start`：房主開始遊戲（6～12 人）
4. 每個人會收到 bot 的私訊，告訴你自己的身分；狼人會被拉進同一個多人私訊
5. 夜晚在私訊裡按按鈕行動，白天在頻道裡討論、按按鈕投票
6. `/werewolf vote`：房主提前結束討論，直接進入投票
7. `/werewolf cancel`：房主取消遊戲

## 架構

- `src/engine.ts`：遊戲規則，純邏輯，沒有 I/O。`applyAction(state, action, rng)` 回傳新的 state 和要送出的 events
- `src/slack.ts`：把 Slack 指令和按鈕轉成 action，把 events 轉成 Slack API 呼叫，並管理計時器
- `src/index.ts`：啟動 Bolt app

遊戲狀態只存在記憶體裡，bot 重啟後進行中的遊戲會消失。
