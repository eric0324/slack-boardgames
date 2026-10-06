// bot 的台詞庫：隨機組合出一句話。台詞跟 bot 的真實身分無關，也不會出現任何角色名稱。
// {t} 會換成被提到的玩家（例如 <@U123> 或 🤖Bot2）。
import type { Rng } from './engine.js';

const OPENERS = ['嗯……', '我先說一下，', '好，輪到我了。', '各位，', '老實說，', '欸，', '我簡單講，'];

const SUSPECTS = [
  '我覺得 {t} 剛剛講話有點閃躲',
  '{t} 給我的感覺怪怪的',
  '我比較懷疑 {t}',
  '{t} 的發言前後不太一致',
  '我想聽聽 {t} 怎麼解釋',
  '{t} 太安靜了，有點可疑',
  '我注意到 {t} 一直在帶風向',
  '今天我想投 {t}',
];

const CLOSERS = ['，先這樣。', '，大家參考一下。', '，我是好人，過。', '，以上。', '，就這樣吧。', '，請大家相信我。'];

const LAST_WORDS = [
  '我是好人，大家小心 {t}。',
  '沒想到我這麼早就走了，{t} 很可疑。',
  '我是好人啊！請大家幫我報仇，我懷疑 {t}。',
  '好人們加油，記得多注意 {t}。',
  '唉……{t}，我在天上看著你。',
];

const PK_DEFENSES = [
  '我真的是好人，{t} 才比較可疑！',
  '請大家相信我，投 {t} 吧。',
  '我沒什麼好辯解的，但 {t} 的發言更奇怪。',
  '冷靜想想，{t} 比較可疑吧？',
  '我是好人，拜託不要投我，{t} 才要注意。',
];

const pick = (items: string[], rng: Rng) => items[Math.floor(rng() * items.length)];

export function botLine(kind: 'speech' | 'lastWords' | 'pk', target: string, rng: Rng): string {
  const fill = (template: string) => template.replace('{t}', target);
  if (kind === 'lastWords') return fill(pick(LAST_WORDS, rng));
  if (kind === 'pk') return fill(pick(PK_DEFENSES, rng));
  return pick(OPENERS, rng) + fill(pick(SUSPECTS, rng)) + pick(CLOSERS, rng);
}
