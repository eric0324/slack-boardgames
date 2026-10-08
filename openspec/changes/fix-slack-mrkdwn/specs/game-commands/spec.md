# Spec Delta

## ADDED Requirements

### Requirement: 訊息格式正確顯示
bot 在 Slack 送出的所有文字（頻道公告、只讓自己看到的訊息、私訊、按鈕訊息和大廳的文字）中，`*粗體*` 和 `` `程式碼` `` 的標記 SHALL 能被 Slack 正確顯示成格式，而不是直接顯示 `*` 或 `` ` `` 符號。標記外側緊貼著中文或全形標點等字時，系統 SHALL 在標記外側補一個空格；標記外側已經是空白、行首行尾或半形標點時 SHALL NOT 改動。

#### Scenario: 粗體緊貼全形括號
- **WHEN** 要送出「📍 *間諜危機*（`spyfall`）4～10 人」
- **THEN** 實際送出「📍 *間諜危機* （ `spyfall` ）4～10 人」，Slack 顯示粗體和程式碼格式

#### Scenario: 程式碼緊貼中文
- **WHEN** 要送出「請用 `/game justone clue <詞>` 給提示」
- **THEN** 標記外側原本就是空白，內容不變

#### Scenario: 程式碼前面是中文字
- **WHEN** 要送出「輸入`/game`開房」
- **THEN** 實際送出「輸入 `/game` 開房」
