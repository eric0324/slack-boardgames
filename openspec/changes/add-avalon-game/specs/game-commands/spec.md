# Spec Delta

## MODIFIED Requirements

### Requirement: /game 指令
系統 SHALL 提供 `/game <遊戲> <子指令>` 的指令格式，遊戲代號為 `werewolf`（狼人殺）、`undercover`（誰是臥底）、`spyfall`（間諜危機）和 `avalon`（阿瓦隆）。`/game werewolf <子指令>` SHALL 和原本的 `/werewolf <子指令>` 效果完全相同；`/werewolf` SHALL 繼續可以使用。

#### Scenario: 用 /game 開狼人殺
- **WHEN** 使用者輸入 `/game werewolf new`
- **THEN** 效果和 `/werewolf new` 相同，開一個狼人殺房間

#### Scenario: 用 /game 開誰是臥底
- **WHEN** 使用者輸入 `/game undercover new`
- **THEN** 開一個誰是臥底的房間

#### Scenario: 用 /game 開間諜危機
- **WHEN** 使用者輸入 `/game spyfall new`
- **THEN** 開一個間諜危機的房間

#### Scenario: 用 /game 開阿瓦隆
- **WHEN** 使用者輸入 `/game avalon new`
- **THEN** 開一個阿瓦隆的房間

#### Scenario: /werewolf 捷徑仍然有效
- **WHEN** 使用者輸入 `/werewolf start`
- **THEN** 效果和 `/game werewolf start` 相同

### Requirement: 遊戲清單與使用說明
使用者輸入 `/game`、`/game help`，或輸入不認識的遊戲代號時，系統 SHALL 只讓這位使用者看到可以玩的遊戲清單（遊戲名稱、代號、人數、開房指令）和 wiki 連結。輸入 `/game <遊戲> help` 時，系統 SHALL 只讓這位使用者看到該遊戲的條列式指令說明。

#### Scenario: 查看遊戲清單
- **WHEN** 使用者輸入 `/game`
- **THEN** 只有這位使用者看到狼人殺、誰是臥底、間諜危機和阿瓦隆的名稱、代號、人數和開房指令

#### Scenario: 查看誰是臥底的指令
- **WHEN** 使用者輸入 `/game undercover help`
- **THEN** 只有這位使用者看到誰是臥底所有指令的條列說明

#### Scenario: 查看間諜危機的指令
- **WHEN** 使用者輸入 `/game spyfall help`
- **THEN** 只有這位使用者看到間諜危機所有指令的條列說明

#### Scenario: 查看阿瓦隆的指令
- **WHEN** 使用者輸入 `/game avalon help`
- **THEN** 只有這位使用者看到阿瓦隆所有指令的條列說明
