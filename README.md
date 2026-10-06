# Slack 狼人殺 bot

在 Slack 頻道裡玩文字版狼人殺，由 bot 擔任主持人。支援 6～12 人，角色有狼人、狼王、村民、預言家、女巫、騎士，採用屠邊規則。

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
         - channels:history
         - groups:history
   settings:
     event_subscriptions:
       bot_events:
         - message.channels
         - message.groups
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

bot 會讀取遊戲頻道裡真人打的字（例如「我是預言家，查殺 @某人」），讓 bot 玩家參考；所以需要 `channels:history`、`groups:history` 權限和 `message.*` event。訊息只在 bot 程式裡比對，不會送到任何外部服務。

戰績會存在 `data/stats.db`（SQLite），可以用環境變數 `STATS_DB` 改位置；換電腦跑 bot 時記得一起搬過去。

最後把 bot 邀請進要玩的頻道（`/invite @werewolf`），輸入 `/werewolf new` 就能開房。

## 部署到 Google Cloud（免費的 e2-micro）

bot 用 Socket Mode 主動連 Slack，不需要公開網址，只要一台一直開著的小主機。Google Cloud 的 Always Free 方案有一台 e2-micro 可以用。

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案並綁定帳單（免費方案也需要信用卡）
2. **Compute Engine → VM 執行個體 → 建立執行個體**：
   - 區域：`us-west1`、`us-central1` 或 `us-east1`（只有這三個在免費範圍內）
   - 機器類型：`e2-micro`
   - 開機磁碟：Ubuntu 24.04 LTS（x86/64），**標準永久磁碟** 30GB 以內
   - 防火牆：不用開 HTTP／HTTPS
3. 建好後按 **SSH** 連進主機，執行：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/eric0324/slack-werewolve/main/deploy/setup.sh | bash
   ```

4. 填入 token 並啟動：

   ```sh
   sudo -u werewolf nano /opt/werewolf/app/.env
   sudo systemctl start werewolf
   sudo journalctl -u werewolf -f   # 看到 [werewolf] Bot is running 就成功了
   ```

之後要更新到最新版本：`sudo bash /opt/werewolf/app/deploy/update.sh`

⚠️ 主機上的 bot 跑起來後，**記得關掉自己電腦上的 bot**，兩個同時連著 Slack 會讓每個指令被處理兩次。戰績存在主機的 `/opt/werewolf/app/data/stats.db`。
