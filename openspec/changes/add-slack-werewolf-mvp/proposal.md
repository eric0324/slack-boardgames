# Proposal

## Why

想在 Slack workspace 裡和同事玩文字版狼人殺，但需要一個人當主持人，負責發牌、收夜晚行動、計票、判斷勝負，這個人就沒辦法一起玩，而且容易出錯或洩漏資訊。這個 bot 要接手主持的工作，讓所有人都能當玩家。

## What Changes

- 新增 Slack bot，在頻道裡用 slash command 開房、加入、開始和取消遊戲
- 支援 6～12 人，依人數自動配置角色（狼人、村民、預言家、女巫、獵人），隨機發牌，用私訊通知每個人的身分
- 自動主持夜晚：狼人在專屬的私密對話裡選擊殺目標、預言家查驗、女巫用藥
- 自動主持白天：公布死訊、計時討論、按鈕投票放逐、平票 PK、獵人開槍
- 採用屠邊規則判斷勝負，遊戲結束時公開所有人的身分
- 每個階段都有時限，超時就照預設行為處理（例如棄票、不發動技能）
- 房主可以用 `/werewolf addbot`、`/werewolf removebot` 加入或移除 bot 玩家，人數不夠或一個人測試時也能開局

## Capabilities

### New Capabilities

- `game-lobby`: 開房、加入、離開、開始、取消遊戲，一個頻道同時只能進行一局
- `role-assignment`: 依人數決定角色配置，隨機發牌，私下通知身分，讓狼人知道隊友是誰
- `night-phase`: 夜晚行動，包含狼人擊殺、預言家查驗、女巫解藥與毒藥，以及夜晚結算
- `day-phase`: 公布夜晚死訊、討論計時、放逐投票、平票 PK、獵人開槍
- `win-condition`: 屠邊勝負判定、判定時機，以及遊戲結束時公開身分
- `bot-players`: 房主可以加入或移除 bot 玩家補足人數，bot 輪到時隨機、立刻行動

### Modified Capabilities

（無，這是新專案）

## Impact

- 新的 TypeScript / Node.js 專案，相依套件包括 `@slack/bolt` 和 `vitest`
- 需要在 Slack 建立 App：開啟 Socket Mode，加上 slash command `/werewolf`，以及 `commands`、`chat:write`、`im:write`、`mpim:write` 這幾個 scope
- 遊戲狀態只存在記憶體裡，bot 重啟會讓進行中的遊戲消失（MVP 先接受這個限制）
