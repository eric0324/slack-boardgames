# Spec Delta

## MODIFIED Requirements

### Requirement: 指令和按鈕交給正確的遊戲
頻道內的子指令（例如 start、next、vote、cancel）和遊戲按鈕 SHALL 交給這個頻道目前那局遊戲處理；「目前那局」SHALL 只在開房或再來一局時改變，已經結束或取消的上一局遊戲留下的計時器之後才觸發時，SHALL NOT 改變按鈕要交給哪款遊戲。對誰是臥底使用狼人殺專屬的指令（或反過來）時，系統 SHALL 只讓輸入的人看到「這個指令不適用於目前的遊戲」。

#### Scenario: 用 /game werewolf 指令操作誰是臥底的房間
- **WHEN** 頻道正在玩誰是臥底，有人輸入 `/game werewolf start`
- **THEN** 系統不處理，只讓這位使用者看到「這個指令不適用於目前的遊戲」

#### Scenario: 換遊戲後上一局的計時器才觸發
- **WHEN** 頻道取消一局正在倒數的誰是臥底後開了吹牛骰的房間，接著誰是臥底留下的計時器觸發
- **THEN** 之後按吹牛骰房間的「加入」，仍然是加入吹牛骰的房間
