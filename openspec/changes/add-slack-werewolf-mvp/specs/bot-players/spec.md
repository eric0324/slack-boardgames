# Spec Delta

## Purpose

讓房主用 bot 玩家補足人數，人不夠或想一個人測試時也能開局；bot 會在輪到它時隨機、立刻做出合法的行動。

## ADDED Requirements

### Requirement: 加入與移除 bot
房主 SHALL 可以在房間階段用 `/werewolf addbot [數量]` 加入 bot 玩家，用 `/werewolf removebot [數量]` 移除 bot 玩家；沒有寫數量時就是 1。移除時 SHALL 從最後加入的 bot 開始移除。bot 和真人一樣計入人數上限 12 人，也計入開始遊戲所需的 6 人。

#### Scenario: 加入多個 bot
- **WHEN** 房間有 1 位真人，房主輸入 `/werewolf addbot 5`
- **THEN** 名單變成 6 人，其中 5 位是 bot，房間公告跟著更新

#### Scenario: 加入 bot 超過上限
- **WHEN** 房間已經有 10 人，房主輸入 `/werewolf addbot 5`
- **THEN** 只加入 2 個 bot 讓名單到 12 人，並且只讓房主看到「房間已滿」的提示

#### Scenario: 移除 bot
- **WHEN** 房間裡有 Bot1、Bot2、Bot3，房主輸入 `/werewolf removebot 2`
- **THEN** Bot3 和 Bot2 被移除，只剩 Bot1

#### Scenario: 沒有 bot 可以移除
- **WHEN** 房間裡沒有 bot，房主輸入 `/werewolf removebot`
- **THEN** 名單不變，只讓房主看到「房間裡沒有 bot」

#### Scenario: 非房主或遊戲已經開始
- **WHEN** 非房主輸入 `/werewolf addbot`，或遊戲開始後有人輸入 `/werewolf addbot` 或 `/werewolf removebot`
- **THEN** 系統拒絕，只讓輸入的人看到錯誤訊息

### Requirement: bot 的顯示方式
bot 沒有 Slack 帳號，系統 SHALL 在所有訊息和按鈕中把 bot 顯示成「🤖Bot<編號>」（例如 🤖Bot1）。bot 的身分和真人一樣，SHALL 在遊戲結束時才公開。

#### Scenario: 名單顯示 bot
- **WHEN** 房間裡有一個 bot
- **THEN** 房間公告的名單裡顯示「🤖Bot1」

### Requirement: bot 自動行動
輪到 bot 行動時，系統 SHALL 立刻替 bot 從合法的選項中隨機選擇，不等待計時：
- 狼人：從存活的非狼人玩家中隨機選一位擊殺（不會選「不殺人」）
- 預言家：從除了自己以外的存活玩家中隨機查驗一位
- 女巫：從當下可以選的選項（使用解藥、對某人下毒、不使用）中隨機選一個
- 放逐投票和 PK 投票：當天發言時懷疑的玩家如果是候選人就投給他，否則從可以投的玩家中隨機投給一位（不投自己、不棄票）
- 獵人：從存活玩家和「不開槍」中隨機選一個
- 騎士：不發動決鬥
- 狼王：開槍時和獵人一樣，從存活玩家和「不開槍」中隨機選一個

bot 的行動 SHALL 和真人的行動走一樣的規則和公告（例如狼人對話會出現「🤖Bot1 選擇擊殺 X」，投票結果也會公開 bot 投給誰）。

#### Scenario: bot 狼人立刻選擇目標
- **WHEN** 夜晚開始，其中一名狼人是 bot
- **THEN** 這個 bot 立刻選好一位存活的非狼人作為擊殺目標，不需要等計時

#### Scenario: 全部都是 bot 時夜晚立刻結束
- **WHEN** 除了已經行動完的真人之外，其他有夜晚能力的角色都是 bot
- **THEN** 夜晚立刻結算並進入天亮

#### Scenario: bot 投票
- **WHEN** 進入放逐投票，房間裡有 bot
- **THEN** 每個存活的 bot 立刻投給一位不是自己的候選人

### Requirement: bot 不會收到訊息
系統 SHALL NOT 嘗試私訊 bot 或把行動提示送給 bot。狼人的私密對話 SHALL 只包含真人狼人；狼人全部都是 bot 時，就不建立狼人的私密對話。

#### Scenario: bot 拿到身分
- **WHEN** 遊戲開始，bot 被分到預言家
- **THEN** 系統不會為這個 bot 開啟任何私訊

#### Scenario: 狼人有真人也有 bot
- **WHEN** 狼人是真人 A 和 🤖Bot1
- **THEN** 狼人的私密對話只有 A，裡面的狼人名單會列出 A 和 🤖Bot1

### Requirement: bot 的發言台詞
bot 在輪流發言、遺言和 PK 發言時，SHALL 從台詞庫隨機組合出一句話，在頻道公告「🤖BotN：<台詞>」，接著立刻換下一位，不用等計時。台詞 SHALL 跟 bot 的真實身分無關，也 SHALL NOT 自稱任何特定角色，避免誤導或洩漏資訊。台詞的組成：
- **輪流發言**：開場語 + 懷疑某位玩家的句子 +（一半機率）懷疑的理由 + 結尾語，懷疑的對象從除了自己以外的存活玩家中隨機選
- **遺言**：遺言的開頭感嘆 + 提到一位存活玩家的句子
- **PK 發言**：替自己辯護的句子 + 把矛頭指向另一位平票玩家的句子

台詞庫 SHALL 有足夠的變化：輪流發言的組合 SHALL 超過一萬種，連續產生 500 句輪流發言時，不重複的句子 SHALL 超過 400 句。

bot 在輪流發言時懷疑的玩家，SHALL 記住到當天結束，當天投票時用來決定投給誰（見「bot 自動行動」）。

#### Scenario: bot 輪流發言
- **WHEN** 輪到 🤖Bot1 發言
- **THEN** 頻道公告「🤖Bot1：……」，內容提到一位不是自己的存活玩家，接著立刻輪到下一位

#### Scenario: bot 投給它懷疑的人
- **WHEN** 🤖Bot1 發言時懷疑 C，當天的放逐投票 C 是候選人
- **THEN** 🤖Bot1 投給 C

#### Scenario: 懷疑的人已經不是候選人
- **WHEN** 🤖Bot1 懷疑的 C 在投票前死了（例如被騎士決鬥），或 PK 時 C 不在平票名單中
- **THEN** 🤖Bot1 從可以投的玩家中隨機投給一位

#### Scenario: bot 講遺言
- **WHEN** 🤖Bot1 在第一夜死亡
- **THEN** 頻道公告「🤖Bot1：……」的遺言，而不是「（沒有遺言）」

#### Scenario: bot 的 PK 發言
- **WHEN** 🤖Bot1 在 PK 中輪到發言
- **THEN** 頻道公告一句替自己辯護的台詞

#### Scenario: 台詞有足夠的變化
- **WHEN** 連續產生 500 句輪流發言的台詞
- **THEN** 其中不重複的句子超過 400 句

#### Scenario: 台詞不自稱角色
- **WHEN** 任何 bot 說出任何一句台詞
- **THEN** 台詞中不會出現狼人、狼王、預言家、女巫、獵人、騎士、村民這些角色名稱

