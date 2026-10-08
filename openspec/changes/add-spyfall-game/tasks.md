# Tasks

> 每個 task 都照 TDD 進行：先寫對應 spec scenario 的測試，確認紅燈，再寫實作讓它綠燈。

## 1. 地點庫

- [x] 1.1 新增 `src/spyfallLocations.ts`：至少 30 個地點、每個地點至少 6 個角色和 4 句描述句，加上 bot 用的通用問題和間諜 bot 的通用回答；確認 spyfall/setup「地點庫」的 scenarios 測試通過

## 2. 間諜危機 engine：房間與發牌

- [x] 2.1 新增 `src/spyfall.ts`：房間（開房、加入、離開、加減 bot、開始、取消、4～10 人），確認 spyfall/setup「間諜危機的房間」的 scenarios 測試通過
- [x] 2.2 發牌：隨機間諜、抽地點、分配角色、私訊（平民：地點＋角色；間諜：地點清單），頻道公告不洩漏；確認「發牌」的 scenarios 測試通過

## 3. 間諜危機 engine：提問與投票

- [x] 3.1 接力提問（隨機第一位、選人按鈕排除剛剛問自己的人、40 秒選人超時隨機、回答完畢、8 分鐘總時限和剩 1 分鐘提醒、房主 next／vote），確認 spyfall/rounds「接力提問」的 scenarios 測試通過
- [x] 3.2 投票與 PK（同誰是臥底規則），確認「投票與 PK」的 scenarios 測試通過
- [x] 3.3 間諜猜地點（提問中隨時一次、被指控後 60 秒最後機會、其他人不能猜），確認「間諜猜地點」的 scenarios 測試通過

## 4. 間諜危機 engine：勝負

- [x] 4.1 勝負判定、結束公開地點／間諜／角色、再來一局，確認 spyfall/win-condition 的 scenarios 測試通過

## 5. 間諜危機 engine：bot

- [ ] 5.1 bot 提問（通用問題、隨機選人）、回答（平民用地點描述句、間諜用通用回答、盡量不重複）、投票、間諜 bot 被指控時猜地點；確認 spyfall/bots 的 scenarios 測試通過，並用多組隨機種子確認 1 真人＋bot 的整局一定會結束

## 6. Slack adapter 與文件

- [ ] 6.1 adapter 加入間諜危機：狀態 Map、`/game spyfall` 指令解析與說明、`/game` 遊戲清單、按鈕（askTarget、endAnswer 和共用按鈕）、計時、一個頻道只能一局；確認 game-commands 修改後的 scenarios 測試通過，既有兩款遊戲的測試維持通過
- [ ] 6.2 manifest 的 `/game` usage hint、README、wiki（首頁、間諜危機入口頁、規則頁、指令頁、側邊欄）

## 7. 整合驗證

- [ ] 7.1 部署到主機後，在真的 Slack 用 bot 補位玩完一局間諜危機，確認流程和 specs 一致
