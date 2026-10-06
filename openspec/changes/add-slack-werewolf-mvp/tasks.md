# Tasks

> 每個 task 都照 TDD 進行：先寫對應 spec scenario 的測試，確認紅燈，再寫實作讓它綠燈。

## 1. 專案設定

- [x] 1.1 建立 `package.json`、`tsconfig.json`、`.gitignore`、`.env.example`，安裝 `@slack/bolt`、`typescript`、`vitest`、`tsx`，確認 `npx vitest run` 可以執行（0 個測試也算通過）

## 2. Engine：房間（game-lobby）

- [x] 2.1 定義 `GameState`、`Action`、`GameEvent` 型別和 `applyAction` 的骨架，實作開房、加入、離開、房主離開就取消，確認 game-lobby 中「開房」「加入與離開房間」的 scenarios 測試通過
- [x] 2.2 實作開始遊戲的檢查（只有房主能開始、需要 6～12 人、開始後不能再加入）和取消遊戲，確認「開始遊戲」「取消遊戲」的 scenarios 測試通過

## 3. Engine：發牌（role-assignment）

- [x] 3.1 實作角色配置表和注入 `rng` 的隨機發牌，確認 6～12 人的配置數量、每人剛好一個角色的測試通過
- [x] 3.2 開始遊戲時，對每個人發出身分私訊 event，對狼人發出 `wolfChat` event，頻道公告不帶任何身分；確認「私下通知身分」「狼人互相認識」的 scenarios 測試通過

## 4. Engine：夜晚（night-phase）

- [x] 4.1 實作進入夜晚、狼人投票決定目標（多數決、平手隨機、全員選完立刻決定、超時沒有目標）和 phaseId timeout 機制，確認「夜晚流程與時限」「狼人擊殺」的 scenarios 測試通過
- [x] 4.2 實作預言家查驗（只回報好人或狼人、每晚一次、超時放棄），確認「預言家查驗」的 scenarios 測試通過
- [x] 4.3 實作女巫用藥（解藥用過就看不到刀口、只有首夜可以自救、一晚一瓶、超時不用），確認「女巫用藥」的 scenarios 測試通過
- [x] 4.4 實作夜晚結算，確認「夜晚結算」的 scenarios 測試通過

## 5. Engine：勝負（win-condition）

- [x] 5.1 實作屠邊判定函式（包括 6 人局沒有獵人、兩邊同時成立時好人獲勝），確認「屠邊勝負規則」的 scenarios 測試通過
- [x] 5.2 實作遊戲結束時公開身分，結束後所有 action 都無效、可以重新開房，確認「遊戲結束公開身分」的 scenarios 測試通過

## 6. Engine：白天（day-phase）

- [x] 6.1 實作天亮公布死訊（隨機順序、不透露死因、平安夜），以及死訊公布後立刻判斷勝負，確認「天亮公布死訊」和「判定時機：天亮就分出勝負」的測試通過（「死亡玩家的限制」需要投票功能，移到 6.3）
- [x] 6.2 實作討論時間（剩 1 分鐘提醒、時間到或房主 `endDiscussion` 就進入投票），確認「討論時間」的 scenarios 測試通過
- [x] 6.3 實作放逐投票（改票、棄票、全員投完立刻結束、公開每個人的投票）和死亡玩家不能投票，確認「放逐投票」「死亡玩家的限制」的 scenarios，以及「預言家已經死亡」（第二夜不發查驗提示）的測試通過
- [x] 6.4 實作平票 PK（PK 發言時間、只能投平票的玩家、PK 中的玩家不能投票、仍平票就沒人出局），確認「平票 PK」的 scenarios 測試通過
- [x] 6.5 實作獵人開槍（被刀和被放逐才能開槍、被毒不能、勝負已定就不能開槍、開槍後再判斷勝負），確認「獵人開槍」和「判定時機」剩下的 scenarios 測試通過
- [x] 6.6 寫一個整局流程的 integration test（固定 `rng`，從開房一路玩到某一方獲勝），確認測試通過

## 7. Slack adapter

- [x] 7.1 實作 `/werewolf new|start|cancel|vote` 指令和「加入」「離開」按鈕，轉成 engine action，並把房間公告更新成最新名單；用假的 Slack client 確認指令和按鈕會產生正確的 action 和 API 呼叫
- [x] 7.2 實作 event 轉換：`announce` 對應 `chat.postMessage`、`dm` 對應 `conversations.open` + `chat.postMessage`、`wolfChat` 對應 MPIM、`ephemeral` 對應 `chat.postEphemeral`、`prompt` 對應帶按鈕的 Block Kit 訊息；用假的 Slack client 確認每種 event 都呼叫了正確的 API
- [x] 7.3 實作夜晚、投票、獵人的按鈕 handler，以及 `startTimer` 對應的 `setTimeout` → `timeout` action；用假的 client 和 fake timers 確認按鈕和超時都會送出正確的 action
- [x] 7.4 實作 `src/index.ts`（讀取 `.env`，用 Socket Mode 啟動），在 `README.md` 寫下 Slack App 的建立步驟（scopes、slash command、Socket Mode），確認 `npm start` 可以連上 Slack

## 8. 整合驗證

- [ ] 8.1 在真的 Slack workspace 用 6 個帳號（或請同事一起）玩完一整局，確認開房、發牌、夜晚、白天、勝負的流程都和 specs 一致，並記錄發現的問題

## 9. 按鈕確認訊息

- [x] 9.1 狼人選擇或改選時在狼人對話公布「誰選擇擊殺誰」、女巫行動後私訊確認、獵人選擇不開槍後私訊確認；確認 night-phase 和 day-phase 新增的確認 scenarios 測試通過

## 10. Bot 玩家

- [x] 10.1 Engine 支援 `addBot`、`removeBot` action（只有房主、只有房間階段、上限 12 人、從最後加入的開始移除），bot 顯示成「🤖Bot<編號>」；確認 bot-players 中「加入與移除 bot」「bot 的顯示方式」的 scenarios 測試通過
- [x] 10.2 Engine 在每次處理完 action 後，替所有輪到行動的 bot 隨機、立刻行動（狼人不刀狼人、投票不投自己也不棄票）；確認「bot 自動行動」的 scenarios 測試通過，並補一個 6 人局中 5 個 bot 的整局測試，確認遊戲會跑到結束
- [x] 10.3 Slack adapter 支援 `/werewolf addbot [n]`、`/werewolf removebot [n]`，不私訊 bot、不把提示送給 bot、狼人私密對話只拉真人、按鈕上的 bot 顯示名字；用假的 Slack client 確認「bot 不會收到訊息」的 scenarios 測試通過，並更新 README 的玩法說明

## 11. 公告 GIF 與 emoji

- [x] 11.1 Engine 的 `announce` event 加上代表時刻的 `gif` 欄位（例如 `night`、`dawnDeath`、`dawnPeace`），公告開頭加上 emoji，開始公告提醒查看私訊；確認 announcement-gifs 中 emoji、提醒私訊，以及各時刻對應正確 `gif` 的測試通過
- [x] 11.2 新增 `src/gifs.ts` 設定檔，從 Giphy 挑選每個時刻的初始 GIF（使用小尺寸版本的網址），並確認每個網址都讀得到；Slack adapter 把有 `gif` 的公告送成文字加 image block，隨機選一張，沒有設定時只送文字；用假的 Slack client 確認「多張 GIF 隨機選」「沒有設定 GIF」的 scenarios 測試通過，README 說明怎麼替換 GIF

## 12. 輪流發言

- [x] 12.1 Engine 用輪流發言取代自由討論：隨機起點、依加入順序、跳過死亡玩家、每人 40 秒、發言者結束或房主 `next` 跳過、bot 自動過、講完進入 2 分鐘自由討論再投票，PK 發言也改成輪流（PK 沒有自由討論）；確認 day-phase「輪流發言」和「PK 發言」的 scenarios 測試通過，並更新原本依賴 5 分鐘討論的測試
- [x] 12.2 Slack adapter 支援「結束發言」按鈕和 `/werewolf next` 指令，更新 README 玩法說明和 manifest 的指令提示；用假的 Slack client 確認按鈕和指令會轉成正確的 action

## 13. 遺言

- [x] 13.1 Engine 加入遺言：第一夜死者（依死訊順序）和被放逐者有 30 秒遺言，可以結束發言或被房主跳過，bot 沒有遺言，勝負已定就不講，獵人先講遺言再開槍；確認 day-phase「遺言」的 scenarios 測試通過，並更新受影響的既有測試

## 14. 狼人空刀

- [x] 14.1 狼人擊殺選項加入「不殺人」（算一票、多數決、和玩家同票時隨機），狼人對話公布選擇和「今晚不殺人」，bot 狼人不選不殺人；確認 night-phase「狼人選擇不殺人」「不殺人得票最多」的 scenarios 測試通過

## 15. 狼人倒數提醒

- [x] 15.1 狼人時限剩 30 秒時，若還有存活狼人沒選，在狼人對話提醒並列出還沒選的狼人；全部選好就不提醒；確認 night-phase「剩 30 秒提醒還沒選的狼人」「狼人都選好了就不提醒」的 scenarios 測試通過

## 16. 規則 wiki

- [x] 16.1 開始公告附上 wiki「遊戲規則」頁面的連結；確認 announcement-gifs「開始公告附上規則連結」的 scenario 測試通過
- [x] 16.2 依照目前的 specs 撰寫 GitHub wiki 的「遊戲規則」頁面和首頁，推送到 wiki repo，並確認連結打得開
