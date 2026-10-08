# Tasks

> 每個 task 都照 TDD 進行：先寫對應 spec scenario 的測試，確認紅燈，再寫實作讓它綠燈。

## 1. 詞庫

- [x] 1.1 新增 `src/undercoverWords.ts`：至少 60 組詞、每個詞至少 3 句描述句，加上白板 bot 用的通用台詞；確認 undercover/setup「詞庫」的 scenarios 測試通過

## 2. 誰是臥底 engine：房間與發詞

- [x] 2.1 新增 `src/undercover.ts`：房間（開房、加入、離開、加減 bot、開始、取消、4～12 人），確認 undercover/setup「誰是臥底的房間」的 scenarios 測試通過
- [x] 2.2 身分配置表和隨機發牌、隨機抽詞與決定平民詞、私訊發詞（不告知身分、白板另外提示），確認「身分配置」「私訊發詞」的 scenarios 測試通過

## 3. 誰是臥底 engine：每一輪

- [x] 3.1 輪流描述（隨機起點、依加入順序、40 秒、結束發言、房主 next／vote），確認 undercover/rounds「輪流描述」的 scenarios 測試通過
- [x] 3.2 投票與 PK（同狼人殺規則），確認「投票與 PK」的 scenarios 測試通過
- [x] 3.3 出局公開身分、白板猜詞（`guess`、60 秒、只有一次、忽略大小寫和前後空白），確認「出局公開身分」「白板猜詞」的 scenarios 測試通過

## 4. 誰是臥底 engine：勝負

- [x] 4.1 勝負判定、結束公開身分和詞、再來一局，確認 undercover/win-condition 的 scenarios 測試通過

## 5. 誰是臥底 engine：bot

- [x] 5.1 bot 描述（依詞庫描述句、白板 bot 用通用台詞、同一局盡量不重複）、bot 投票、白板 bot 猜詞，確認 undercover/bots 的 scenarios 測試通過，並用多組隨機種子確認 1 真人＋bot 的整局一定會結束

## 6. Slack adapter 與 /game

- [x] 6.1 `GameHost` 記錄每個頻道的遊戲種類，指令、按鈕、計時依種類交給對應的 engine；一個頻道只能一局（不分遊戲）；確認 game-commands「一個頻道同時只有一局」「指令和按鈕交給正確的遊戲」的 scenarios 測試通過，狼人殺既有測試維持通過
- [x] 6.2 `/game` 指令解析、遊戲清單與各遊戲的使用說明、`/werewolf` 捷徑；確認 game-commands「/game 指令」「遊戲清單與使用說明」的 scenarios 測試通過
- [x] 6.3 manifest 新增 `/game` slash command，更新 README、wiki（首頁遊戲表格、「誰是臥底」入口頁、規則頁、指令頁、側邊欄）

## 7. 整合驗證

- [x] 7.1 部署到主機後，在真的 Slack 用 bot 補位玩完一局誰是臥底，確認流程和 specs 一致
