# Spec Delta

## Purpose

讓 bot 可以補位玩間諜危機：輪到 bot 提問時隨機選人並說一句通用的問題，被問時平民 bot 用地點的描述句回答、間諜 bot 用模糊的話回答，投票隨機，間諜 bot 被指控時也會猜地點，讓一個人也能把整局測完。

## ADDED Requirements

### Requirement: bot 提問與回答
bot 的名字和顯示方式 SHALL 和其他遊戲相同（🤖<英文名字>）。
- 輪到 bot 提問時，系統 SHALL 立刻替 bot 隨機選一位可以問的玩家，並在頻道公告「🤖<名字>：<問題>」，問題從一組通用問題中隨機選（例如「你覺得這裡的人多嗎？」），SHALL NOT 包含任何地點名稱
- bot 被問時，系統 SHALL 立刻公告 bot 的回答並換 bot 當提問者：平民 bot 從這局地點的描述句中隨機選一句，間諜 bot 從一組通用的模糊回答中隨機選一句；同一局同一位 bot 盡量不重複
- 間諜 bot SHALL NOT 在提問階段主動猜地點

#### Scenario: bot 提問
- **WHEN** 輪到 bot 提問
- **THEN** 頻道公告 bot 問了某位玩家一個通用問題，不用等計時

#### Scenario: 平民 bot 回答
- **WHEN** 地點是夜市，平民 bot 被問
- **THEN** 頻道公告 bot 的回答是夜市的一句描述句，裡面沒有出現「夜市」

#### Scenario: 間諜 bot 回答
- **WHEN** 間諜 bot 被問
- **THEN** 頻道公告一句通用的模糊回答

### Requirement: bot 投票與猜地點
進入投票時，存活的 bot SHALL 立刻從可以投的玩家中隨機投給一位，不投自己、不棄票。間諜 bot 被指控時，系統 SHALL 立刻替它從地點庫中隨機猜一個地點，並和真人猜地點走同樣的公告與判定流程。

#### Scenario: bot 投票
- **WHEN** 進入投票，房間裡有 bot
- **THEN** 每個 bot 立刻投給一位不是自己的玩家

#### Scenario: 間諜 bot 被指控
- **WHEN** 間諜 bot 被指控
- **THEN** 頻道立刻公告間諜 bot 猜的地點和是否猜中

### Requirement: 一個人也能玩完整局
1 位真人加上 bot 補到 4～10 人時，即使真人完全不操作（只靠計時），遊戲 SHALL 一定會結束。

#### Scenario: 真人不操作也會結束
- **WHEN** 1 位真人加 bot 開始一局，真人什麼都不做
- **THEN** 遊戲靠計時和 bot 的行動推進，最後分出勝負
