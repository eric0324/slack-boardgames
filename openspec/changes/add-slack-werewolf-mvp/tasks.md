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

## 17. 不在遊戲中的人

- [x] 17.1 不在玩家名單上的人按遊戲按鈕時忽略並回覆「你不在這局遊戲中」；確認 game-lobby「不在遊戲中的人不能參與」的 scenarios 測試通過

## 18. 再來一局

- [x] 18.1 Engine：遊戲分出勝負後送出「再來一局」按鈕，加入 `rematch` action（只有上一局的真人玩家、開空房間、已有房間時拒絕、取消的遊戲不能用）；確認 win-condition「再來一局」的 scenarios 測試通過
- [x] 18.2 Slack adapter 把「再來一局」按鈕轉成 `rematch` action，並更新 wiki 的指令頁；用假的 Slack client 確認按鈕會開出新的房間公告

## 19. 騎士

- [x] 19.1 Engine：角色配置表加入騎士（9 人以上取代一位村民），騎士算神職，身分私訊有能力說明；確認 role-assignment「12 人局的配置」「9 人以上才有騎士」和 win-condition 相關測試通過
- [x] 19.2 Engine：騎士決鬥（輪流發言時私訊決鬥按鈕、只能在輪流發言或自由討論時發動、一局一次、決鬥到狼人直接入夜、決鬥到好人騎士出局並調整發言順序、決鬥後判斷勝負、bot 不決鬥）；確認 day-phase「騎士決鬥」的 scenarios 測試通過
- [x] 19.3 Slack adapter 把決鬥按鈕轉成 action，更新 wiki 的遊戲規則和指令頁；用假的 Slack client 確認按鈕轉換正確

## 20. 狼王

- [x] 20.1 Engine：角色配置表加入狼王（10 人以上取代一位普通狼人），狼王在擊殺、查驗、勝負中都算狼人，狼人對話標出狼王，身分私訊有能力說明；確認 role-assignment 狼王相關 scenarios 測試通過
- [x] 20.2 Engine：把獵人開槍一般化成「開槍者」，狼王除了被毒死之外任何死法都能開槍（放逐、被刀、被開槍帶走、被騎士決鬥），支援連鎖開槍；確認 day-phase「狼王開槍」的 scenarios 測試通過
- [x] 20.3 更新 wiki 的遊戲規則頁（角色配置、狼王能力）

## 21. 戰績查詢

- [x] 21.1 Engine：遊戲分出勝負時送出 `gameRecord` event（頻道、獲勝陣營、每位玩家的角色），有 bot 或取消的遊戲不送；確認 player-stats「記錄遊戲結果」中 engine 相關的 scenarios 測試通過
- [x] 21.2 新增 `src/stats.ts`：用 better-sqlite3 把紀錄存在 SQLite（預設 `data/stats.db`，games 和 game_players 兩張表）、依頻道和玩家計算總計／陣營／角色的場數與勝率，並格式化成查詢結果；確認「查詢戰績」的 scenarios 和「bot 重新啟動後戰績還在」測試通過
- [x] 21.3 Slack adapter 支援 `/werewolf stats [@某人]`（解析使用者 mention），收到 `gameRecord` 時存檔；manifest 的 slash command 改成 `should_escape: true` 以取得使用者 id；更新 README、wiki 指令頁；用假的 Slack client 確認查詢流程

## 22. bot 台詞

- [x] 22.1 Engine：新增台詞庫（開場、懷疑、結尾、遺言、PK 辯護），bot 輪流發言、遺言、PK 發言時隨機組合一句台詞並立刻換下一位，記住當天懷疑的人，投票時優先投給他；確認 bot-players「bot 的發言台詞」的 scenarios 測試通過，並更新原本測「過」和「（沒有遺言）」的測試
- [x] 22.2 更新 wiki 遊戲規則頁的 bot 段落

## 23. 條列式使用說明

- [x] 23.1 Slack adapter 的使用說明改成條列式（每個指令一行，含誰可以用和說明，最後附 wiki 指令頁連結），`/werewolf help`、空白和不認識的子指令都回覆；確認 game-lobby「使用說明」的 scenarios 測試通過

## 24. 更多公告 GIF

- [x] 24.1 Engine：騎士決鬥結果（成功／失敗）、平票 PK、狼王開槍的公告加上對應的 `gif` key；確認 announcement-gifs 新增的 scenarios 測試通過
- [x] 24.2 從 Giphy 挑選這四個時刻的 GIF，並把所有時刻擴充到每個至少 6 張，確認網址讀得到、檔案不超過 2.5MB、內容合適，加進 `src/gifs.ts`；確認預設設定檔每個時刻至少 6 張且不重複的測試通過

## 25. 開始遊戲按鈕

- [x] 25.1 Slack adapter 在房間公告加上「開始遊戲」按鈕，轉成 `start` action；用假的 Slack client 確認房主按下會開始遊戲、非房主和人數不足時只有按的人看到提示，並更新 wiki 指令頁

## 26. 縮短自由討論

- [x] 26.1 自由討論從 2 分鐘改成 1 分 30 秒，公告文字跟著改；確認 day-phase「全部講完進入自由討論」「自由討論時間到」的測試通過，並更新 wiki 和 README 中的時間

## 27. 移除自由討論

- [x] 27.1 輪流發言結束後直接進入投票，移除自由討論階段；`/werewolf vote` 和騎士決鬥都只能在輪流發言時使用；確認 day-phase「全部講完直接進入投票」「房主提前結束發言」和騎士決鬥相關測試通過，並更新使用說明、wiki 中提到自由討論的地方

## 28. 更多 bot 台詞

- [x] 28.1 擴充 `src/botLines.ts`：每類台詞加更多句子，輪流發言加上一半機率出現的「理由」片段，遺言和 PK 改成兩段組合；確認 bot-players「台詞有足夠的變化」「台詞不自稱角色」的測試通過

## 29. bot 隨機命名

- [x] 29.1 新增中二名字庫（形容詞 × 名詞），加入 bot 時隨機取不重複的名字，顯示成「🤖<名字>」，名字不含角色相關的字、空白和冒號；確認 bot-players「bot 的顯示方式」的 scenarios 測試通過，並更新依賴「🤖BotN」的既有測試和 wiki

## 30. bot 改用英文名字

- [x] 30.1 bot 名字庫改成簡單的英文名字（至少 30 個），同一個房間不重複；確認 bot-players「bot 的顯示方式」的 scenarios 測試通過，並更新 wiki

## 31. bot 依身分發言

- [ ] 31.1 Engine 記錄 bot 需要的資訊：預言家的查驗紀錄、女巫的用藥紀錄、bot 公開報過的查驗（真的和假的）、悍跳的狼人；預言家 bot 夜晚優先查沒查過的人
- [ ] 31.2 台詞庫加入身分台詞（自稱預言家報查驗、悍跳、女巫／獵人／騎士亮身分、跟著查殺投票）；botSpeak 和 bot 投票依身分決定懷疑對象；確認 bot-players「bot 依身分發言」的 scenarios 測試通過，並更新原本「台詞不自稱角色」的測試和 wiki
