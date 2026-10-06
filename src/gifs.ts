// 各時刻公告搭配的 GIF。每次公告從清單隨機選一張；清單是空的就只送文字。
// 想換圖：到 giphy.com 打開 GIF，網址最後一段就是 id，填成 media.giphy.com/media/<id>/200.gif（200 是小尺寸版本）。
import type { GifKey } from './engine.js';

const giphy = (...ids: string[]) => ids.map((id) => `https://media.giphy.com/media/${id}/200.gif`);

export const GIFS: Record<GifKey, string[]> = {
  start: giphy('2hjPmNNYtVGFy', '3LdP5sgb3PGFO', 'B4qNMPzBc84Za'), // 洗牌、發牌
  night: giphy('g1Y5zKWbODUl2', '2bd2SyCotaHA9QjXt8', 'XmWGYlQ6tJHBS'), // 月亮、狼嚎
  dawnDeath: giphy('JoV2BiMWVZ96taSewG', 'qf9UuB7vNpHc25agxb', 'LjkdbDxmz4yI0AGUpd'), // 抬棺舞、RIP
  dawnPeace: giphy('JMV7IKoqzxlrW', 'KR9OgQyWAwIIE', 'MsjdQQCxq0OHtM0uuP'), // 鬆一口氣、早安
  exile: giphy('xCyjMEYF9H2ZcLqf7t', 'WFN3ppTdHYpnPqIlP3', 'WTlH9XMLIAD4I'), // 被踢出去
  hunterShot: giphy('Lmrt39eBJPNDSmwK62', 'YFHTSoWEywAiCAYSnx'), // 開槍、決鬥
  goodWin: giphy('03IoP34ByFpdRvT0wb', 'bnro9kWnyfpkpbafCw'), // 慶祝
  wolvesWin: giphy('hqXsVAHXaMaOY', 'Yq1pe2v7nNlwA', 'hWjVvBsVub7Anr67qy'), // 邪惡的笑
};
