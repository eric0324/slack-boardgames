# Spec Delta

## Purpose

建立吹牛骰的房間並發骰子。

## ADDED Requirements

### Requirement: 吹牛骰的房間
吹牛骰的房間 SHALL 和其他遊戲有相同的操作方式：`/game liarsdice new` 開房、房間公告有「加入」「離開」「開始遊戲」按鈕、房主可以用 `addbot [數量]`、`removebot [數量]` 加減 bot、`start` 開始、`cancel` 取消、房主開始前離開就取消房間。人數 SHALL 在 2～8 人之間（bot 也算），房間公告 SHALL 標示這是吹牛骰。一個頻道同時只能有一局遊戲。

#### Scenario: 人數不足
- **WHEN** 房間只有 1 人，房主按下開始
- **THEN** 系統拒絕並只讓房主看到「至少需要 2 人」

#### Scenario: 房間已滿
- **WHEN** 房間已有 8 人，又有人按加入
- **THEN** 系統拒絕並只讓這個人看到「房間已滿」

### Requirement: 骰子
遊戲開始時每位玩家 SHALL 有 5 顆骰子。每一輪開始時，系統 SHALL 替所有還有骰子的玩家重新擲骰，並私訊每位玩家自己的骰子點數；頻道 SHALL 只公告每位玩家剩幾顆骰子和全場骰子總數，SHALL NOT 洩漏任何人的點數。

#### Scenario: 骰子私訊
- **WHEN** 一輪開始
- **THEN** 每位玩家收到自己骰子點數的私訊，頻道只公告每人剩幾顆和總數

### Requirement: 遊戲清單與指令說明
`/game` 的遊戲清單 SHALL 列出吹牛骰的名稱、代號 `liarsdice`、人數（2～8 人）和開房指令 `/game liarsdice new`。輸入 `/game liarsdice help` 或不認識的子指令時，系統 SHALL 只讓這位使用者看到吹牛骰的條列式指令說明。

#### Scenario: 查看指令
- **WHEN** 使用者輸入 `/game liarsdice help`
- **THEN** 只有這位使用者看到吹牛骰所有指令的條列說明
