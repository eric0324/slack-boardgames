## Why

GIF 原本是為狼人殺設計的，後來加入的誰是臥底、間諜危機、阿瓦隆只有開局、PK、放逐、結束有圖，很多精彩時刻（任務失敗、猜中地點、刺殺梅林）只有文字。既有的 GIF 每個時刻 6～9 張，玩久了也容易重複。

## What Changes

- 新增 7 種 GIF 時刻：阿瓦隆的隊伍通過、隊伍被否決、任務成功、任務失敗、進入刺殺；間諜危機和誰是臥底共用的猜對、猜錯
- 既有的「決鬥成功／失敗」也用在「抓到了／抓錯了」的時刻（間諜危機指控、阿瓦隆刺殺、誰是臥底放逐到臥底）
- 某個時刻直接讓遊戲結束時，GIF 改附在結束公告上（取代勝利 GIF），避免連續兩張
- 每個時刻至少 10 張 GIF（既有時刻也擴充）

## Impact

- Specs：`announcement-gifs`
- Code：`src/engine.ts`（GifKey）、`src/gifs.ts`、`src/undercover.ts`、`src/spyfall.ts`、`src/avalon.ts`
