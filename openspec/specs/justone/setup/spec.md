# justone/setup Specification

## Purpose
建立一字千金的房間並準備牌堆。

## Requirements

### Requirement: 一字千金的房間
一字千金的房間 SHALL 和其他遊戲有相同的操作方式：`/game justone new` 開房、房間公告有「加入」「離開」「開始遊戲」按鈕、`start` 開始、`cancel` 取消、房主開始前離開就取消房間。人數 SHALL 在 3～7 位真人之間；一字千金 SHALL NOT 支援 bot，`addbot` SHALL 只讓房主看到「一字千金不支援 bot」。房間公告 SHALL 標示這是一字千金。一個頻道同時只能有一局遊戲。

#### Scenario: 人數不足
- **WHEN** 房間只有 2 人，房主按下開始
- **THEN** 系統拒絕並只讓房主看到「至少需要 3 人」

#### Scenario: 不支援 bot
- **WHEN** 房主輸入 `/game justone addbot`
- **THEN** 系統拒絕並只讓房主看到「一字千金不支援 bot」

### Requirement: 牌堆
遊戲開始時，系統 SHALL 從詞庫隨機抽 13 個不重複的詞當牌堆，並隨機決定第一位猜詞的人，之後依加入順序輪流。

#### Scenario: 開始
- **WHEN** 遊戲開始
- **THEN** 頻道公告遊戲開始、牌堆 13 張和第一位猜詞的人

### Requirement: 遊戲清單與指令說明
`/game` 的遊戲清單 SHALL 列出一字千金的名稱、代號 `justone`、人數（3～7 人）和開房指令 `/game justone new`。輸入 `/game justone help` 或不認識的子指令時，系統 SHALL 只讓這位使用者看到一字千金的條列式指令說明。

#### Scenario: 查看指令
- **WHEN** 使用者輸入 `/game justone help`
- **THEN** 只有這位使用者看到一字千金所有指令的條列說明
