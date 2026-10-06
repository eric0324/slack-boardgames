// bot 的台詞庫：隨機組合出一句話。台詞跟 bot 的真實身分無關，也不會出現任何角色名稱。
// {t} 會換成被提到的玩家（例如 <@U123> 或 🤖Bot2）。句子裡不用「他／她」，一律用名字或省略主詞。
import type { Rng } from './engine.js';

// 輪流發言：開場語 + 懷疑句 +（一半機率）理由 + 結尾語
const OPENERS = [
  '嗯……',
  '我先說一下，',
  '好，輪到我了。',
  '各位，',
  '老實說，',
  '欸，',
  '我簡單講，',
  '咳咳，',
  '聽我說，',
  '不囉嗦，',
  '我想了一整晚，',
  '說真的，',
  '我的直覺告訴我，',
  '先講結論，',
  '大家冷靜一下，',
  '欸欸欸，',
];

const SUSPECTS = [
  '我覺得 {t} 剛剛講話有點閃躲',
  '{t} 給我的感覺怪怪的',
  '我比較懷疑 {t}',
  '{t} 的發言前後不太一致',
  '我想聽聽 {t} 怎麼解釋',
  '{t} 太安靜了，有點可疑',
  '我注意到 {t} 一直在帶風向',
  '今天我想投 {t}',
  '{t} 剛剛眼神飄來飄去',
  '我總覺得 {t} 在演',
  '{t} 講話太順了，像是準備好的',
  '{t} 一直跟風，沒有自己的想法',
  '我對 {t} 的印象分數很低',
  '{t} 剛剛是不是偷笑了一下',
  '我投 {t} 一票，不解釋',
  '{t} 你昨晚到底在幹嘛',
  '我想請 {t} 再講清楚一次',
  '{t} 的立場一直在變',
  '我懷疑 {t} 不是表面上那樣',
  '{t} 給人一種心虛的感覺',
  '說不出為什麼，但 {t} 很可疑',
  '{t} 太積極了，反而怪',
];

const REASONS = [
  '，因為剛剛一直在幫別人說話',
  '，理由聽起來很牽強',
  '，從第一天就怪怪的',
  '，而且都不敢跟我對到眼',
  '，講話的節奏跟昨天不一樣',
  '，一直在轉移話題',
  '，剛剛差點說溜嘴',
  '，票投得很奇怪',
  '，安靜得不像平常',
  '，感覺在保某個人',
  '，這是我的第六感',
  '，剛剛停頓了很久',
  '，回答問題都避重就輕',
  '，明顯在帶節奏',
  '，好像知道些什麼',
  '，發言跟上一輪矛盾',
];

const CLOSERS = [
  '，先這樣。',
  '，大家參考一下。',
  '，我是好人，過。',
  '，以上。',
  '，就這樣吧。',
  '，請大家相信我。',
  '，我說完了。',
  '，信我一次。',
  '，大家自己判斷。',
  '，下一位。',
  '，我的發言結束。',
  '，今天就看大家了。',
];

// 遺言：開頭感嘆 + 提到一位玩家
const LAST_INTROS = [
  '沒想到我這麼早就走了……',
  '唉，',
  '各位，我先走一步了。',
  '我是好人啊！',
  '人生好難……',
  '好吧，',
  '我不甘心！',
  '記住我說的話：',
  '最後一句話，',
  '拜託大家聽好，',
];

const LAST_BODIES = [
  '大家小心 {t}。',
  '{t} 很可疑。',
  '請大家幫我報仇，我懷疑 {t}。',
  '記得多注意 {t}。',
  '{t}，我在天上看著你。',
  '下一個要投的就是 {t}。',
  '{t} 一定有問題。',
  '不要被 {t} 騙了。',
  '我覺得 {t} 才是關鍵。',
  '{t}，你最好給大家一個交代。',
  '相信我，{t} 不單純。',
  '我的票留給 {t}。',
];

// PK：替自己辯護 + 把矛頭指向另一位平票的玩家
const PK_DEFENSES = [
  '我真的是好人！',
  '請大家相信我，',
  '我沒什麼好辯解的，但',
  '冷靜想想，',
  '我是好人，拜託不要投我，',
  '大家被帶風向了，',
  '我發誓我是清白的，',
  '投我只會讓壞人開心，',
  '我的發言一直都很一致，',
  '我知道我看起來可疑，但是',
];

const PK_ACCUSATIONS = [
  '{t} 才比較可疑！',
  '要投就投 {t}。',
  '{t} 的發言更奇怪。',
  '{t} 從頭到尾都在閃躲。',
  '大家看看 {t} 剛剛的反應。',
  '{t} 才是大家要擔心的。',
  '比起我，{t} 更值得懷疑。',
  '{t} 一直在帶風向。',
  '請把票投給 {t}。',
  '{t} 剛剛根本在演。',
];

const pick = (items: string[], rng: Rng) => items[Math.floor(rng() * items.length)];

export function botLine(kind: 'speech' | 'lastWords' | 'pk', target: string, rng: Rng): string {
  const fill = (template: string) => template.replace('{t}', target);
  if (kind === 'lastWords') return pick(LAST_INTROS, rng) + fill(pick(LAST_BODIES, rng));
  if (kind === 'pk') return pick(PK_DEFENSES, rng) + fill(pick(PK_ACCUSATIONS, rng));
  const reason = rng() < 0.5 ? pick(REASONS, rng) : '';
  return pick(OPENERS, rng) + fill(pick(SUSPECTS, rng)) + reason + pick(CLOSERS, rng);
}

// bot 的名字：簡單好讀的英文名字，從還沒用過的名字中隨機抽
const BOT_NAMES = [
  'Sam', 'Stephen', 'Carmen', 'Alice', 'Ben', 'Chloe', 'David', 'Emma', 'Frank', 'Grace',
  'Henry', 'Ivy', 'Jack', 'Kate', 'Leo', 'Mia', 'Nick', 'Olivia', 'Paul', 'Quinn',
  'Rose', 'Tom', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yuki', 'Zoe', 'Amy', 'Bob',
  'Cindy', 'Dan', 'Ella', 'Fred', 'Gina', 'Hank', 'Iris', 'Joe', 'Lily', 'Max',
];

export function randomBotName(rng: Rng, taken: Set<string>): string {
  const available = BOT_NAMES.filter((name) => !taken.has(name));
  return pick(available.length ? available : BOT_NAMES, rng);
}

// ---- 身分台詞（bot 依身分發言時用；這裡會出現角色名稱） ----
// target 等參數都是已經轉好的顯示文字（例如 <@U123> 或 🤖Sam）

export interface CheckLine {
  night: number;
  target: string;
  wolf: boolean;
}

// 「我是預言家，第 1 晚查了 X，是狼人；第 2 晚查了 Y，是好人。」真的預言家和悍跳的狼人用同一個格式
export function seerClaim(checks: CheckLine[]): string {
  const parts = checks.map((c) => `第 ${c.night} 晚查了 ${c.target}，是${c.wolf ? '狼人' : '好人'}`);
  return `我是預言家，${parts.join('；')}。`;
}

const FOLLOW_CLAIMS = [
  '{t} 被報查殺了，我跟著投 {t}。',
  '既然 {t} 被查殺，今天就出 {t}。',
  '我相信查驗，票投 {t}。',
  '{t} 被點名是狼人，大家一起投 {t}。',
];

const COUNTER_CLAIMS = [
  '{t} 的查驗是亂報的，我覺得 {t} 才可疑。',
  '{t} 一直在亂點人，太刻意了，我投 {t}。',
  '不要被 {t} 帶走，{t} 的發言很有問題。',
];

export const followClaim = (target: string, rng: Rng) => pick(FOLLOW_CLAIMS, rng).replaceAll('{t}', target);
export const counterClaim = (target: string, rng: Rng) => pick(COUNTER_CLAIMS, rng).replaceAll('{t}', target);

export function witchReveal(log: { night: number; saved?: string; poisoned?: string }[]): string {
  const parts = log.map((l) => (l.saved ? `第 ${l.night} 晚救了 ${l.saved}` : `第 ${l.night} 晚毒了 ${l.poisoned}`));
  return parts.length ? `我是女巫，${parts.join('、')}，別投我！` : '我是女巫，藥都還在，別投我！';
}

export const knightReveal = (used: boolean) =>
  used ? '我是騎士，已經決鬥過了，我是好人！' : '我是騎士，留著我還有用，別投我！';
