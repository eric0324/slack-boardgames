# Spec Delta

## ADDED Requirements

### Requirement: 房間公告附上遊戲說明
每款遊戲的房間公告 SHALL 附上該遊戲在 wiki 上的「遊戲規則」頁面連結，讓還不會玩的人在加入前可以先看規則。房間公告更新（有人加入、離開）時連結 SHALL 保留。

#### Scenario: 開房時附上規則連結
- **WHEN** 使用者開一個吹牛骰的房間
- **THEN** 房間公告裡有連到 wiki「吹牛骰-遊戲規則」頁面的連結

#### Scenario: 狼人殺的房間
- **WHEN** 使用者輸入 `/werewolf new`
- **THEN** 房間公告裡有連到 wiki「狼人殺-遊戲規則」頁面的連結
