# Proposal

## Why

GameBuddy 的五款遊戲都是推理或文字聯想。吹牛骰靠骰子和心理戰，規則一分鐘講完，一局 10 分鐘，人少也能玩，bot 也容易做，適合當暖場遊戲。

## What Changes

- 新增「吹牛骰」（`/game liarsdice`）：2～8 人（bot 也算），每人 5 顆骰子，骰子結果私訊
- 輪流喊「全場至少 N 個 X 點」，下一位要喊更大或「開」；開了以後公開所有骰子，輸的人少一顆骰子，骰子沒了就出局，最後剩骰子的人贏
- 1 點是萬用，但這一輪有人喊過 1 點就不再萬用
- bot 依機率喊數或開
- 新增前先把 adapter 改成「遊戲註冊表」，讓新遊戲不用再複製一整套分派程式碼（重構，行為不變）
- `/game` 遊戲清單加入吹牛骰

## Capabilities

### New Capabilities

- `liarsdice/setup`: 開房、人數、骰子私訊
- `liarsdice/rounds`: 喊數、開、輸贏與淘汰、計時
- `liarsdice/bots`: bot 喊數與開


## Impact

- 新增 `src/liarsdice.ts`
- `src/slack.ts`：重構成遊戲註冊表，再加入吹牛骰
- README、wiki、manifest usage hint
