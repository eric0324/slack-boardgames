# Spec Delta

## Purpose

建立花火的房間、洗牌發牌，並讓玩家隨時查看別人的手牌和自己已知的提示。

## ADDED Requirements

### Requirement: 花火的房間
花火的房間 SHALL 和其他遊戲有相同的操作方式：`/game hanabi new` 開房、房間公告有「加入」「離開」「開始遊戲」按鈕、`start` 開始、`cancel` 取消、房主開始前離開就取消房間。人數 SHALL 在 2～5 位真人之間；花火 SHALL NOT 支援 bot，`addbot` SHALL 只讓房主看到「花火不支援 bot」。房間公告 SHALL 標示這是花火。一個頻道同時只能有一局遊戲。

#### Scenario: 房間已滿
- **WHEN** 房間已有 5 人，又有人按加入
- **THEN** 系統拒絕並只讓這個人看到「房間已滿」

#### Scenario: 不支援 bot
- **WHEN** 房主輸入 `/game hanabi addbot`
- **THEN** 系統拒絕並只讓房主看到「花火不支援 bot」

### Requirement: 牌堆與發牌
牌堆 SHALL 有紅、黃、綠、藍、白五種顏色，每種顏色有 1 ×3、2 ×2、3 ×2、4 ×2、5 ×1 共 10 張，總共 50 張。遊戲開始時洗牌，2～3 人每人發 5 張、4～5 人每人發 4 張；提示標記 8 個、失誤 0 次；隨機決定第一位玩家，之後依加入順序輪流。

#### Scenario: 4 人發牌
- **WHEN** 4 人開始遊戲
- **THEN** 每人 4 張手牌，牌堆剩 34 張

### Requirement: 看牌
每次輪到新的玩家時，頻道 SHALL 公告目前的煙火進度（每種顏色打到幾）、提示標記、失誤次數、牌堆剩幾張，並附上「👀 看牌」按鈕。任何玩家按「看牌」時，系統 SHALL 只讓這位玩家看到：其他每位玩家的手牌（顏色和數字），以及自己每張手牌目前已知的提示（顏色、數字或未知）；SHALL NOT 讓玩家看到自己手牌的實際內容。

#### Scenario: 看牌
- **WHEN** B 按下「看牌」
- **THEN** 只有 B 看到 A、C 的手牌，以及自己每張牌已知的提示

### Requirement: 遊戲清單與指令說明
`/game` 的遊戲清單 SHALL 列出花火的名稱、代號 `hanabi`、人數（2～5 人）和開房指令 `/game hanabi new`。輸入 `/game hanabi help` 或不認識的子指令時，系統 SHALL 只讓這位使用者看到花火的條列式指令說明。

#### Scenario: 查看指令
- **WHEN** 使用者輸入 `/game hanabi help`
- **THEN** 只有這位使用者看到花火所有指令的條列說明
