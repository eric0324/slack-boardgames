## Why

目前誰是臥底要「臥底和白板都出局」平民才獲勝，臥底全部被抓到後還得繼續找白板，節奏拖沓。改成臥底全部出局就直接結束。

## What Changes

- 平民獲勝條件改成：**所有臥底都出局**（不管白板是否還活著）
- 有 2 位臥底時，兩位都出局才結束
- 臥底陣營獲勝條件不變（存活臥底＋白板 ≥ 存活平民，或白板猜中平民詞）
- 白板被放逐時的猜詞機會不變

## Impact

- Specs：`undercover/win-condition`（勝負判定）
- Code：`src/undercover.ts` 的 `checkUndercoverWinner`
- Docs：wiki 的誰是臥底規則頁與入口頁
