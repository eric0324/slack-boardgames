# Slack 狼人殺 bot

在 Slack 頻道裡玩文字版狼人殺，由 bot 擔任主持人。支援 6～12 人，角色有狼人、村民、預言家、女巫、獵人，採用屠邊規則。

玩法和指令請看 [wiki](https://github.com/eric0324/slack-werewolve/wiki)：[遊戲規則](https://github.com/eric0324/slack-werewolve/wiki/遊戲規則)、[指令](https://github.com/eric0324/slack-werewolve/wiki/指令)。

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
         usage_hint: new | addbot [n] | removebot [n] | start | next | vote | cancel | stats [@someone]
         should_escape: true
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

戰績會存在 `data/stats.db`（SQLite），可以用環境變數 `STATS_DB` 改位置；換電腦跑 bot 時記得一起搬過去。

最後把 bot 邀請進要玩的頻道（`/invite @werewolf`），輸入 `/werewolf new` 就能開房。
