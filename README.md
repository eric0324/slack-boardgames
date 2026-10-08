# Slack GameBuddy

在 Slack 頻道裡玩桌遊，由 bot 擔任主持人。

目前支援的遊戲：

- **狼人殺**（`/game werewolf`，或 `/werewolf`）：6～12 人，角色有狼人、狼王、村民、預言家、女巫、騎士，採用屠邊規則；人不夠時可以加 bot 補位
- **誰是臥底**（`/game undercover`）：4～12 人，身分有平民、臥底、白板；輪流描述自己拿到的詞，投票找出臥底；人不夠時可以加 bot 補位
- **間諜危機**（`/game spyfall`）：4～10 人，大家知道同一個地點，只有間諜不知道；接力互相提問，時間到投票抓間諜，間諜也可以隨時猜地點；人不夠時可以加 bot 補位
- **阿瓦隆**（`/game avalon`）：5～10 人，好人（梅林、派西維爾、忠臣）對壞人（刺客、莫甘娜、爪牙）；輪流發言、隊長組隊、投票、出任務，沒有人會出局；人不夠時可以加 bot 補位
- **機密代號**（`/game codenames`）：4～12 位真人，紅藍兩隊比賽，隊長用一個詞當提示，隊員翻 5×5 牌桌上的字卡，避開刺客
- **吹牛骰**（`/game liarsdice`）：2～8 人，每人 5 顆骰子，輪流喊「全場至少 N 個 X 點」或開，輸的人少一顆骰子，最後剩骰子的人贏；可以加 bot
- **一字千金**（`/game justone`）：3～7 位真人的合作遊戲，一人猜詞，其他人私下各給一個提示，重複的提示會被刪掉，13 張牌看能猜對幾張
- **政變**（`/game coup`）：3～6 人的虛張聲勢遊戲，每人 2 張暗牌，可以宣稱任何角色的能力，別人可以質疑或阻擋，最後還有影響力的人贏；可以加 bot
- **花火**（`/game hanabi`）：2～5 位真人的合作遊戲，看得到別人的牌、看不到自己的，靠提示合力依序打出五種顏色的煙火

輸入 `/game` 可以看到所有遊戲和開房指令。

各遊戲的玩法和指令請看 [wiki](https://github.com/eric0324/slack-gamebuddy/wiki)。花火：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/花火-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/花火-指令)。政變：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/政變-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/政變-指令)。一字千金：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/一字千金-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/一字千金-指令)。吹牛骰：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/吹牛骰-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/吹牛骰-指令)。機密代號：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/機密代號-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/機密代號-指令)。阿瓦隆：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/阿瓦隆-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/阿瓦隆-指令)。間諜危機：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/間諜危機-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/間諜危機-指令)。誰是臥底：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/誰是臥底-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/誰是臥底-指令)。狼人殺：[遊戲規則](https://github.com/eric0324/slack-gamebuddy/wiki/狼人殺-遊戲規則)、[指令](https://github.com/eric0324/slack-gamebuddy/wiki/狼人殺-指令)。

## 建立 Slack App

1. 到 <https://api.slack.com/apps> 按 **Create New App → From an app manifest**，選擇你的 workspace，貼上下面的 manifest：

   ```yaml
   display_information:
     name: GameBuddy
   features:
     bot_user:
       display_name: gamebuddy
       always_online: true
     slash_commands:
       - command: /game
         description: 桌遊（狼人殺、誰是臥底、間諜危機、阿瓦隆、機密代號、吹牛骰、一字千金、政變、花火）
         usage_hint: werewolf new | undercover new | spyfall new | avalon new | codenames new | liarsdice new | justone new | coup new | hanabi new | help
         should_escape: true
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

最後把 bot 邀請進要玩的頻道（`/invite @gamebuddy`），輸入 `/game` 就能看到可以玩的遊戲。

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
   curl -fsSL https://raw.githubusercontent.com/eric0324/slack-gamebuddy/main/deploy/setup.sh | bash
   ```

4. 填入 token 並啟動：

   ```sh
   sudo -u werewolf nano /opt/werewolf/app/.env
   sudo systemctl start werewolf
   sudo journalctl -u werewolf -f   # 看到 [werewolf] Bot is running 就成功了
   ```

之後要更新到最新版本：`sudo bash /opt/werewolf/app/deploy/update.sh`

⚠️ 主機上的 bot 跑起來後，**記得關掉自己電腦上的 bot**，兩個同時連著 Slack 會讓每個指令被處理兩次。戰績存在主機的 `/opt/werewolf/app/data/stats.db`。
