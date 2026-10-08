# avalon/bots Specification

## Purpose
讓 bot 可以補位玩阿瓦隆，讓一個人也能把整局測完。

## Requirements

### Requirement: bot 的行動
bot 的名字和顯示方式 SHALL 和其他遊戲相同（🤖<英文名字>）。bot 的行動 SHALL 立刻完成，不用等計時：
- 發言：從一組通用台詞中隨機說一句後立刻換下一位
- 當隊長：隨機選滿隊伍並送出；壞人 bot 一定把自己選進去
- 組隊投票：自己在隊伍裡就贊成，否則隨機贊成或反對
- 出任務：好人 bot 出成功，壞人 bot 出失敗
- 刺殺：刺客 bot 從好人中隨機選一位

#### Scenario: bot 投票
- **WHEN** 進入組隊投票，bot 在隊伍裡
- **THEN** bot 立刻投贊成

#### Scenario: 壞人 bot 出任務
- **WHEN** 壞人 bot 在任務隊伍裡
- **THEN** bot 立刻出失敗

### Requirement: 一個人也能玩完整局
1 位真人加上 bot 補到 5～10 人時，即使真人完全不操作（只靠計時），遊戲 SHALL 一定會結束。

#### Scenario: 真人不操作也會結束
- **WHEN** 1 位真人加 bot 開始一局，真人什麼都不做
- **THEN** 遊戲靠計時和 bot 的行動推進，最後分出勝負
