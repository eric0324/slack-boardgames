# Proposal

## Why

政變是純粹的虛張聲勢遊戲：每個人手上兩張暗牌，但可以假裝有任何角色的能力，別人可以質疑。一局 15 分鐘，3 人就能玩，比狼人殺更直接的心理戰。

## What Changes

- 新增「政變」（`/game coup`）：3～6 人（bot 也算），標準五種角色：公爵、刺客、隊長、大使、女伯爵，每種 3 張
- 每人 2 張暗牌（私訊）和 2 枚金幣；輪到的人選一個行動，宣稱角色的行動可以被質疑，部分行動可以被阻擋，阻擋也可以被質疑
- 失去所有影響力（兩張牌都翻開）的人出局，最後一人獲勝
- bot 用簡單策略：偶爾說謊、隨機質疑、有牌就阻擋
- `/game` 遊戲清單加入政變

## Capabilities

### New Capabilities

- `coup/setup`: 開房、人數、發牌與金幣
- `coup/turns`: 行動、質疑、阻擋、失去影響力、交換、勝負
- `coup/bots`: bot 行動與反應


## Impact

- 新增 `src/coup.ts`
- `src/slack.ts`：註冊政變
- README、wiki、manifest usage hint
