# Design

## Decisions

### 1. adapter 改成遊戲註冊表（重構）

目前每款遊戲在 `src/slack.ts` 都有自己的 Map、`dispatchX`、指令函式、按鈕分支和計時分支，加到第 9 款會很難維護。改成一個註冊表：

```ts
interface GameDef<S, A> { apply(state, action, rng): { state, events }; parse(text, user, channel): A | null; button(kind, value, user, channel): A | null; help: string; phaseOf(state): string }
```

`games: Map<Kind, Map<channel, state>>`，`active()`、`button()`、計時都用同一段程式碼查表。狼人殺維持原本的 `/werewolf`、戰績等特殊處理。這一步是純重構，既有測試必須維持綠燈。

### 2. 喊數用 slash command，開用按鈕

`/game liarsdice bid <數量> <點數>`；輪到的人在頻道看到「開！」按鈕。slash command 本身其他人看不到，喊數成立後由 bot 在頻道公告。

### 3. 骰子用私訊

每一輪開始時私訊每位玩家自己的骰子（例如 ⚀⚂⚂⚄⚅），頻道只公告每個人剩幾顆和全場總數。

### 4. 喊數大小

點數大小：2 < 3 < 4 < 5 < 6 < 1。新的喊數要「數量更多」，或「數量相同、點數更大」。

### 5. 計時

每次輪到 60 秒。超時：已經有人喊過就自動「開」；這輪第一位就自動喊「1 個 2」。
