# undercover/bots Specification

## Purpose
讓 bot 可以補位玩誰是臥底：輪到 bot 時用詞庫裡的描述句描述自己的詞，白板 bot 說模糊的話，投票時隨機選人，白板 bot 被放逐時也會猜詞，讓一個人也能把整局測完。

## Requirements

### Requirement: bot 描述
bot 的名字和顯示方式 SHALL 和狼人殺相同（🤖<英文名字>）。輪到 bot 描述時，系統 SHALL 立刻在頻道公告「🤖<名字>：<描述句>」並換下一位：
- 平民 bot 和臥底 bot：從自己拿到的詞的描述句中隨機選一句，同一局同一位 bot 盡量不重複
- 白板 bot：從一組通用的模糊台詞中隨機選一句（例如「這個東西大家應該都很熟悉吧」），SHALL NOT 包含任何一組詞
- PK 時的 bot 也用同樣的方式描述

#### Scenario: 平民 bot 描述
- **WHEN** 平民詞是牛奶，輪到平民 bot 描述
- **THEN** 頻道公告 bot 的一句牛奶描述句，裡面沒有出現「牛奶」或「豆漿」，接著立刻換下一位

#### Scenario: 白板 bot 描述
- **WHEN** 輪到白板 bot 描述
- **THEN** 頻道公告一句通用的模糊台詞

### Requirement: bot 投票
輪到投票時，存活的 bot SHALL 立刻從可以投的玩家中隨機投給一位，不投自己、不棄票。

#### Scenario: bot 投票
- **WHEN** 進入投票，房間裡有存活的 bot
- **THEN** 每個 bot 立刻投給一位不是自己的候選人

### Requirement: 白板 bot 猜詞
白板 bot 被放逐時，系統 SHALL 立刻替它猜詞：從「平民詞、臥底詞、詞庫中另一個隨機的詞」三者中隨機選一個，並和真人猜詞走同樣的公告與判定流程。

#### Scenario: 白板 bot 猜詞
- **WHEN** 白板 bot 被放逐
- **THEN** 頻道立刻公告白板 bot 猜的詞和是否猜中，並照規則判斷勝負

### Requirement: 一個人也能玩完整局
1 位真人加上 bot 補到 4～12 人時，即使真人完全不操作（只靠計時），遊戲 SHALL 一定會在有限的輪數內結束。

#### Scenario: 真人不操作也會結束
- **WHEN** 1 位真人加 bot 開始一局，真人什麼都不做
- **THEN** 遊戲靠計時和 bot 的行動推進，最後分出勝負
