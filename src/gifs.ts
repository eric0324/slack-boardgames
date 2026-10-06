// 各時刻公告搭配的 GIF。每次公告從清單隨機選一張；清單是空的就只送文字。
// 想換圖：到 giphy.com 打開 GIF，網址最後一段就是 id，填成 media.giphy.com/media/<id>/200.gif（200 是小尺寸版本）。
import type { GifKey } from './engine.js';

const giphy = (...ids: string[]) => ids.map((id) => `https://media.giphy.com/media/${id}/200.gif`);

export const GIFS: Record<GifKey, string[]> = {
  // 洗牌、發牌、來玩遊戲吧
  start: giphy(
    '2hjPmNNYtVGFy',
    '3LdP5sgb3PGFO',
    'B4qNMPzBc84Za',
    '25LbA5gcDNM5N7sHHy',
    'tYIjjhyWy8heGDRhFw',
    '6YKW50RucAE7q5i8xV',
    '1STYRz8waCf63JiIt0',
    'KCNLqGdndJ6h2',
    '3ov9jUCYetT3GVwcy4',
  ),
  // 月亮、狼嚎、晚安
  night: giphy(
    'g1Y5zKWbODUl2',
    '2bd2SyCotaHA9QjXt8',
    'XmWGYlQ6tJHBS',
    'NZl457NWzcp4fkkKJi',
    'eRvQi7d8EcvonzBQvQ',
    'R54F6kReFBZZO1fSJX',
    'DQzOKqLSkkZssCkFdQ',
    'RxJpkbjksbkas',
    '0mPp8Lz8kfBqxGFFW0',
  ),
  // 抬棺舞、RIP、I'm dead
  dawnDeath: giphy(
    'JoV2BiMWVZ96taSewG',
    'qf9UuB7vNpHc25agxb',
    'LjkdbDxmz4yI0AGUpd',
    'YqE3jbSQQR6x9g19Kj',
    'R5unorzb9UtmrAPpl7',
    '95ThFF7MokcdeoVqt8',
    'ze4Y13PeotDfqoQWza',
  ),
  // 鬆一口氣、早安
  dawnPeace: giphy(
    'JMV7IKoqzxlrW',
    'KR9OgQyWAwIIE',
    'MsjdQQCxq0OHtM0uuP',
    '3nID5xQQFb5nSia6Iz',
    'ULc3bADIPeKF757wVj',
    'kYNVwkyB3jkauFJrZA',
    'Cm9wKmKMUlRPvdoHgU',
    'ZX6RWer1T8rsgVTG1s',
  ),
  // 被踢出去、掰掰
  exile: giphy(
    'xCyjMEYF9H2ZcLqf7t',
    'WFN3ppTdHYpnPqIlP3',
    'WTlH9XMLIAD4I',
    'm9eG1qVjvN56H0MXt8',
    'PF4NopbRuZj8I',
    'COAg7vjpWW8Ja',
    'ZBVhKIDgts1eHYdT7u',
  ),
  // 反派邪笑
  wolfKingShot: giphy(
    'wlBS2Aif8eBvW',
    '3orif7aLUehOfdmlXy',
    '13FD3rp8IqYUXm',
    'onZIkheksIuje',
    'PPi5c8l8WDY7if1L8z',
    'yhK9WRjy14w6MuEK9G',
    'iF6kSCNVO3ro82qIFD',
  ),
  // 對峙、瞪眼
  pk: giphy(
    '6o7uRtooCyfVC',
    'tQsVMkwwoPrDW',
    'zG6f8nsNTdHRm',
    'YetssBvnfv1sU6NcmF',
    '3oriO9zfxLJ2Xl9SmI',
    'lQVWAAJuwn64UtJ37X',
  ),
  // 決鬥成功：揮劍、抓到你了
  duelWin: giphy(
    'JmprBlTQFeGgUyb7Mh',
    'PRAon7HFHCOzu',
    'jIO61Nk4FkGf3BYX0G',
    '3oz8xs8WYZr0dJV3kQ',
    'YTQtFyserQgId2sPIX',
    'fBpfmQPXnywQwlRbSp',
    '48evvoYjwnSAfHZqpf',
  ),
  // 決鬥失敗：糗、my bad
  duelLose: giphy(
    'EXHHMS9caoxAA',
    '4A1am1JlzkJj2',
    'l41lR9cLxFqcJI4co',
    '80TEu4wOBdPLG',
    'BsQAVgY6ksvIY',
    '10VJ2YDMoNEBl6',
    'dgBbmiMscKvHX6XoZD',
  ),
  // 慶祝
  goodWin: giphy(
    '03IoP34ByFpdRvT0wb',
    'bnro9kWnyfpkpbafCw',
    'rh6PW0gnVU37Xvxvgq',
    'F0vSIq2uyGj29bxEec',
    'ZyrsfSkAbJ0SRyT8Ek',
    'rhaIsgMSRHaUg',
    '55VwaRpeMC7DM6YdWS',
  ),
  // 邪惡的笑
  wolvesWin: giphy(
    'hqXsVAHXaMaOY',
    'Yq1pe2v7nNlwA',
    'hWjVvBsVub7Anr67qy',
    'CsA9ldJhWDHCo',
    'xl5QdxfNonh3q',
    'FLKUJnRt6cGBG102B0',
    'lY1F6BJjbRO3m',
  ),
};
