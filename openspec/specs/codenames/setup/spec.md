# codenames/setup Specification

## Purpose
建立機密代號的房間、隨機分隊並擺出 5×5 的字卡牌桌；隊長私下知道每張字卡屬於哪一隊。

## Requirements

### Requirement: 機密代號的房間
機密代號的房間 SHALL 和其他遊戲有相同的操作方式：`/game codenames new` 開房（開房者為房主並自動加入）、房間公告上有「加入」「離開」「開始遊戲」按鈕、`/game codenames start` 開始、`/game codenames cancel` 取消、房主開始前離開就取消房間。人數 SHALL 在 4～12 位真人之間；機密代號 SHALL NOT 支援 bot，房主輸入 `addbot` 時 SHALL 只讓房主看到「機密代號不支援 bot」。房間公告 SHALL 標示這是機密代號。一個頻道同時只能有一局遊戲（不分遊戲種類）。

#### Scenario: 開房
- **WHEN** 使用者 A 輸入 `/game codenames new`
- **THEN** 頻道出現標示「機密代號」的房間公告，A 是房主

#### Scenario: 人數不足
- **WHEN** 房間只有 3 人，房主按下開始
- **THEN** 系統拒絕並只讓房主看到「至少需要 4 人」

#### Scenario: 不支援 bot
- **WHEN** 房主輸入 `/game codenames addbot`
- **THEN** 系統拒絕並只讓房主看到「機密代號不支援 bot」

### Requirement: 分隊與隊長
遊戲開始時，系統 SHALL 把玩家隨機分成紅隊和藍隊（人數相差最多 1 人），每隊隨機選一位當隊長，其他人是隊員。系統 SHALL 隨機決定先攻的隊伍。頻道 SHALL 公告兩隊的隊長和隊員，以及哪一隊先攻。

#### Scenario: 5 人分隊
- **WHEN** 5 人開始遊戲
- **THEN** 一隊 3 人、一隊 2 人，每隊各有 1 位隊長

### Requirement: 牌桌
系統 SHALL 從詞庫隨機抽 25 個不重複的詞排成 5×5 的牌桌，並隨機分配：先攻隊 9 張、後攻隊 8 張、中立 7 張、刺客 1 張。頻道 SHALL 貼出牌桌，每張字卡是一個按鈕，按鈕上 SHALL NOT 透露還沒翻開的字卡屬於誰。之後每次翻牌，同一則牌桌訊息 SHALL 原地更新，已翻開的字卡顯示顏色（🟥 紅隊、🟦 藍隊、⬜ 中立、💀 刺客）。詞庫 SHALL 至少有 200 個不重複、沒有空白、1～4 個字的詞。

#### Scenario: 牌桌配置
- **WHEN** 紅隊先攻
- **THEN** 牌桌有 9 張紅隊、8 張藍隊、7 張中立、1 張刺客

#### Scenario: 翻牌後更新
- **WHEN** 有人翻開一張藍隊的字卡
- **THEN** 頻道上同一則牌桌訊息更新，這張字卡顯示 🟦

### Requirement: 隊長的答案
遊戲開始時，系統 SHALL 私訊兩位隊長一張答案表，列出 25 張字卡各自屬於紅隊、藍隊、中立或刺客。隊員 SHALL NOT 收到答案。

#### Scenario: 隊長收到答案
- **WHEN** 遊戲開始
- **THEN** 兩位隊長收到列出每張字卡顏色的私訊，隊員沒有收到
