# liarsdice/bots Specification

## Purpose
讓 bot 可以補位玩吹牛骰。

## Requirements

### Requirement: bot 喊數與開
bot 的名字和顯示方式 SHALL 和其他遊戲相同。輪到 bot 時 SHALL 立刻行動：bot 用自己的骰子估計全場某個點數的期望數量（自己的骰子加上其他骰子的機率：1 點萬用時每顆 1/3，否則 1/6），上一個喊數的數量比期望值多 1 以上就開，否則從自己最多的點數喊一個剛好比上一個大的數。

#### Scenario: bot 開
- **WHEN** 全場 10 顆骰子，上一個喊數是「9 個 5」，輪到 bot
- **THEN** bot 立刻開

### Requirement: 一個人也能玩完整局
1 位真人加上 bot 時，即使真人完全不操作，遊戲 SHALL 一定會結束。

#### Scenario: 真人不操作也會結束
- **WHEN** 1 位真人加 bot 開始一局，真人什麼都不做
- **THEN** 遊戲靠計時和 bot 的行動推進，最後分出勝負
