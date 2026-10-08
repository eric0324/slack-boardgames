# Spec Delta

## Purpose

建立政變的房間並發牌、發金幣。

## ADDED Requirements

### Requirement: 政變的房間
政變的房間 SHALL 和其他遊戲有相同的操作方式：`/game coup new` 開房、房間公告有「加入」「離開」「開始遊戲」按鈕、房主可以用 `addbot [數量]`、`removebot [數量]` 加減 bot、`start` 開始、`cancel` 取消、房主開始前離開就取消房間。人數 SHALL 在 3～6 人之間（bot 也算），房間公告 SHALL 標示這是政變。一個頻道同時只能有一局遊戲。

#### Scenario: 人數不足
- **WHEN** 房間只有 2 人，房主按下開始
- **THEN** 系統拒絕並只讓房主看到「至少需要 3 人」

### Requirement: 發牌與金幣
牌堆 SHALL 有公爵、刺客、隊長、大使、女伯爵各 3 張共 15 張。遊戲開始時洗牌，每位玩家 SHALL 拿 2 張暗牌和 2 枚金幣，並私訊每位玩家自己的手牌和所有角色能力的說明。頻道 SHALL 公告遊戲開始、玩家順序（隨機第一位）和每個人的金幣，SHALL NOT 洩漏任何人的手牌。

#### Scenario: 發牌
- **WHEN** 4 人開始遊戲
- **THEN** 每人收到 2 張牌的私訊並有 2 枚金幣，牌堆剩 7 張

### Requirement: 遊戲清單與指令說明
`/game` 的遊戲清單 SHALL 列出政變的名稱、代號 `coup`、人數（3～6 人）和開房指令 `/game coup new`。輸入 `/game coup help` 或不認識的子指令時，系統 SHALL 只讓這位使用者看到政變的條列式指令說明。

#### Scenario: 查看指令
- **WHEN** 使用者輸入 `/game coup help`
- **THEN** 只有這位使用者看到政變所有指令的條列說明
