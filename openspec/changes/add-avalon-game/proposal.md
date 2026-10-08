# Proposal

## Why

GameBuddy 已經有狼人殺、誰是臥底、間諜危機。阿瓦隆和狼人殺一樣是陣營推理，但 **沒有人會出局**，每個人從頭玩到尾，適合同事一起玩；而且能沿用狼人殺的私訊、壞人群組、投票和 bot 機制。

## What Changes

- 新增「阿瓦隆」（`/game avalon`）：5～10 人，好人（梅林、派西維爾、忠臣）對壞人（刺客、莫甘娜、爪牙）
- 每一輪：輪流發言 → 隊長選隊員 → 全體投票同不同意這支隊伍 → 通過的話隊員私下出任務（成功／失敗）
- 連續 5 次組隊沒通過壞人直接獲勝；3 個任務成功進入刺殺階段，3 個任務失敗壞人獲勝
- 刺殺階段：壞人在私訊群組討論，刺客選一位好人，刺中梅林壞人逆轉獲勝
- bot 可以補位
- `/game` 遊戲清單加入阿瓦隆

## Capabilities

### New Capabilities

- `avalon/setup`: 開房、人數、身分配置與夜晚資訊
- `avalon/rounds`: 輪流發言、隊長選人、組隊投票、出任務
- `avalon/win-condition`: 勝負判定、刺殺梅林、結束公開、再來一局
- `avalon/bots`: bot 發言、選人、投票、出任務、刺殺

### Modified Capabilities

- `game-commands`: `/game` 的遊戲代號加入 `avalon`，遊戲清單和使用說明加入阿瓦隆

## Impact

- 新增 `src/avalon.ts`（純邏輯 engine）
- `src/slack.ts`：新增阿瓦隆的狀態 Map、指令解析和按鈕對應；壞人群組沿用狼人殺的 `wolfChat`
- README、wiki 新增阿瓦隆；`/game` 的 usage hint 更新
