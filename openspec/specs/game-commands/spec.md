# game-commands Specification

## Purpose
提供統一的 `/game` 指令入口，讓同一個 Slack App 可以玩多款桌遊：列出可以玩的遊戲、把子指令交給對應的遊戲，並保留狼人殺原本的 `/werewolf` 指令當作捷徑。

## Requirements

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

### Requirement: 一個頻道同時只有一局
一個頻道同時 SHALL 只能有一局遊戲，不分遊戲種類。頻道已經有進行中的房間或遊戲時，開任何一款新遊戲 SHALL 被拒絕。遊戲結束或取消後，頻道 SHALL 可以開任何一款遊戲。

#### Scenario: 狼人殺進行中想開誰是臥底
- **WHEN** 頻道有一局狼人殺正在進行，有人輸入 `/game undercover new`
- **THEN** 系統拒絕，只讓這位使用者看到「這個頻道已經有遊戲了」

#### Scenario: 結束後換一款遊戲
- **WHEN** 狼人殺結束後，有人輸入 `/game undercover new`
- **THEN** 成功開一個誰是臥底的房間

### Requirement: 指令和按鈕交給正確的遊戲
頻道內的子指令（例如 start、next、vote、cancel）和遊戲按鈕 SHALL 交給這個頻道目前那局遊戲處理。對誰是臥底使用狼人殺專屬的指令（或反過來）時，系統 SHALL 只讓輸入的人看到「這個指令不適用於目前的遊戲」。

#### Scenario: 用 /game werewolf 指令操作誰是臥底的房間
- **WHEN** 頻道正在玩誰是臥底，有人輸入 `/game werewolf start`
- **THEN** 系統不處理，只讓這位使用者看到「這個指令不適用於目前的遊戲」
