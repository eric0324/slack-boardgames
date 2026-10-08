import { parseChat } from './chatParser.js';
import { botLine, counterClaim, followClaim, knightReveal, randomBotName, seerClaim, witchReveal } from './botLines.js';

// 狼人殺遊戲引擎：純邏輯，不碰任何 I/O。
// applyAction(state, action, rng) → { state, events }，由 adapter 把 events 轉成 Slack 訊息。

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;

export type Phase = 'lobby' | 'night' | 'lastWords' | 'shooting' | 'speech' | 'vote' | 'pkSpeech' | 'pkVote' | 'ended';
export type Role = 'werewolf' | 'wolfKing' | 'seer' | 'witch' | 'knight' | 'villager';

// 人數 → 各角色數量（順序也是不洗牌時的發牌順序）
export const ROLE_TABLE: Record<number, Partial<Record<Role, number>>> = {
  6: { werewolf: 2, seer: 1, witch: 1, villager: 2 },
  7: { werewolf: 2, seer: 1, witch: 1, villager: 3 },
  8: { werewolf: 3, seer: 1, witch: 1, villager: 3 },
  9: { werewolf: 3, seer: 1, witch: 1, knight: 1, villager: 3 },
  10: { werewolf: 2, wolfKing: 1, seer: 1, witch: 1, knight: 1, villager: 4 },
  11: { werewolf: 3, wolfKing: 1, seer: 1, witch: 1, knight: 1, villager: 4 },
  12: { werewolf: 3, wolfKing: 1, seer: 1, witch: 1, knight: 1, villager: 5 },
};

export const ROLE_NAME: Record<Role, string> = {
  werewolf: '狼人',
  wolfKing: '狼王',
  seer: '預言家',
  witch: '女巫',
  knight: '騎士',
  villager: '村民',
};

const ROLE_HELP: Record<Role, string> = {
  werewolf: '每晚和其他狼人一起選一位玩家擊殺。殺光所有村民或所有神職就獲勝。',
  wolfKing: '你是狼人陣營，每晚和其他狼人一起擊殺。死亡時（被毒死除外）可以開槍帶走一位玩家。',
  seer: '每晚可以查驗一位玩家是好人還是狼人。',
  witch: '有一瓶解藥和一瓶毒藥，各能用一次，一晚最多用一瓶。解藥只有第一夜可以救自己。',
  knight: '整局一次，白天輪流發言時可以翻牌向一位玩家決鬥：對方是狼人就出局並直接入夜，對方是好人則你出局。',
  villager: '沒有特殊能力，靠白天的推理和投票找出狼人。',
};

// bot 玩家的 id 是 `bot:<編號>:<名字>`，沒有 Slack 帳號，所以不能用 <@id>，改顯示成 🤖<名字>
export const isBot = (id: string) => id.startsWith('bot:');
export const mention = (id: string) => {
  if (!isBot(id)) return `<@${id}>`;
  const [, n, name] = id.split(':');
  return `🤖${name ?? `Bot${n}`}`;
};

export const RULES_URL = encodeURI('https://github.com/eric0324/slack-gamebuddy/wiki/狼人殺-遊戲規則');
export const ACTION_MS = 60_000;
const WOLF_REMIND_BEFORE_MS = 30_000;
export const SPEECH_MS = 40_000; // 輪流發言每人的時間
export const LAST_WORDS_MS = 30_000;

export interface Player {
  id: string;
  alive: boolean;
  role?: Role;
}

export interface NightState {
  wolfVotes: Record<string, string>;
  wolfTarget?: string | null; // undefined = 還沒決定，null = 沒有擊殺目標
  seerDone: boolean;
  witchDone: boolean;
  saved: boolean;
  poisoned: string | null;
}

type TimerName = 'wolves' | 'wolfRemind' | 'witch' | 'phase';

export interface GameState {
  channel: string;
  host: string;
  phase: Phase;
  players: Player[];
  day: number;
  timerSeq: number;
  timers: Partial<Record<TimerName, number>>;
  night?: NightState;
  potions: { antidote: boolean; poison: boolean };
  lastDeaths: string[]; // 上一次夜晚結算死亡的玩家
  winner?: 'good' | 'wolves'; // 分出勝負後才有；取消的遊戲沒有
  knightUsed: boolean; // 騎士是否已經決鬥過
  suspects: Record<string, string>; // bot → 當天發言時懷疑的玩家（投票時優先投他）
  checks: { night: number; target: string; wolf: boolean }[]; // 預言家的真實查驗結果
  witchLog: { night: number; saved?: string; poisoned?: string }[]; // 女巫的用藥紀錄
  claims: { by: string; night: number; target: string; wolf: boolean }[]; // bot 公開報過的查驗（可能是假的）
  fakeSeer?: string; // 悍跳預言家的狼人 bot
  fakeSeerDecided: boolean; // 第一天是否已經決定過要不要悍跳
  seerClaimers: string[]; // 在頻道自稱過預言家的真人
  godClaims: Record<string, 'witch' | 'knight'>; // 在頻道自稱神職的真人
  speakers: string[]; // 還沒輪到的發言者
  speaker?: string; // 目前的發言者（輪流發言或遺言）
  lastWords: string[]; // 還沒講遺言的死者
  afterLastWords?: { kind: 'dawn' } | { kind: 'exile'; id: string }; // 遺言講完後要接什麼
  votes: Record<string, string>; // 投票者 → 目標 id 或 'abstain'
  candidates: string[]; // 這輪可以被投的人
  voters: string[]; // 這輪可以投票的人
  shooter?: { id: string; next: 'speech' | 'night' }; // 正在等待開槍的狼王
}

export type Action =
  | { type: 'new'; user: string; channel: string }
  | { type: 'rematch'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'wolfVote'; user: string; target: string } // target 是玩家 id 或 'none'（不殺人）
  | { type: 'seerCheck'; user: string; target: string }
  | { type: 'witchAct'; user: string; choice: string } // 'save' | 'skip' | 'poison:<id>'
  | { type: 'endDiscussion'; user: string }
  | { type: 'endSpeech'; user: string }
  | { type: 'skipSpeaker'; user: string }
  | { type: 'dayVote'; user: string; target: string } // target 是玩家 id 或 'abstain'
  | { type: 'shoot'; user: string; target: string } // target 是玩家 id 或 'none'
  | { type: 'duel'; user: string; target: string }
  | { type: 'chat'; user: string; text: string } // 真人在頻道打的字
  | { type: 'timeout'; id: number };

export interface Option {
  value: string;
  label: string;
}

export type GameEvent =
  | { type: 'announce'; text: string; gif?: GifKey }
  | { type: 'board'; text: string; rows: { value: string; label: string; style?: 'primary' | 'danger' }[][] }
  | { type: 'ephemeral'; to: string; text: string }
  | { type: 'dm'; to: string; text: string }
  | { type: 'wolfChat'; wolves: string[]; text: string }
  | { type: 'lobby'; host: string; players: string[]; open: boolean; title?: string } // title 沒寫就是狼人殺
  | { type: 'prompt'; kind: string; audience: 'channel' | 'wolves' | 'user'; user?: string; text: string; options: Option[] }
  | { type: 'startTimer'; id: number; ms: number }
  | { type: 'gameRecord'; winner: 'good' | 'wolves'; players: { id: string; role: Role }[] };

export type Rng = () => number;

// 公告要搭配哪一種 GIF，實際網址由 adapter 的設定檔決定
export type GifKey =
  | 'start'
  | 'night'
  | 'dawnDeath'
  | 'dawnPeace'
  | 'exile'
  | 'wolfKingShot'
  | 'pk'
  | 'duelWin'
  | 'duelLose'
  | 'goodWin'
  | 'wolvesWin'
  | 'guessRight'
  | 'guessWrong'
  | 'teamApproved'
  | 'teamRejected'
  | 'questSuccess'
  | 'questFail'
  | 'assassination';

interface Result {
  state: GameState;
  events: GameEvent[];
}

// 處理 action 時的工作區：s 是複製出來的 state，可以直接修改
interface Ctx {
  s: GameState;
  events: GameEvent[];
  rng: Rng;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function dealRoles(n: number, rng: Rng): Role[] {
  return shuffle(
    Object.entries(ROLE_TABLE[n]).flatMap(([role, k]) => Array<Role>(k).fill(role as Role)),
    rng,
  );
}

const GODS: Role[] = ['seer', 'witch', 'knight'];
// 狼人陣營：狼王在擊殺、查驗、勝負判定時都算狼人
export const isWolf = (role?: Role) => role === 'werewolf' || role === 'wolfKing';

// 屠邊：狼人全滅 → 好人贏（同時成立也算好人）；村民全滅、神職全滅，或存活狼人 ≥ 存活好人 → 狼人贏
export function checkWinner(players: Player[]): 'good' | 'wolves' | null {
  const allDead = (match: (r: Role) => boolean) => players.filter((p) => match(p.role!)).every((p) => !p.alive);
  if (allDead(isWolf)) return 'good';
  if (allDead((r) => r === 'villager') || allDead((r) => GODS.includes(r))) return 'wolves';
  // 存活狼人追上好人：好人已經不可能靠投票贏
  const wolves = players.filter((p) => p.alive && isWolf(p.role)).length;
  if (wolves >= players.filter((p) => p.alive && !isWolf(p.role)).length) return 'wolves';
  return null;
}

const player = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const alive = (s: GameState) => s.players.filter((p) => p.alive);
const aliveWith = (s: GameState, role: Role) => alive(s).filter((p) => p.role === role);
const isAlive = (s: GameState, id: string) => alive(s).some((p) => p.id === id);
const wolfIds = (s: GameState) => s.players.filter((p) => isWolf(p.role)).map((p) => p.id);
const aliveWolves = (s: GameState) => alive(s).filter((p) => isWolf(p.role));
const options = (ids: string[]): Option[] => ids.map((id) => ({ value: id, label: id }));

const lobbyEvent = (s: GameState): GameEvent => ({
  type: 'lobby',
  host: s.host,
  players: s.players.map((p) => p.id),
  open: s.phase === 'lobby',
});

function startTimer(c: Ctx, name: TimerName, ms: number) {
  const id = ++c.s.timerSeq;
  c.s.timers[name] = id;
  c.events.push({ type: 'startTimer', id, ms });
}

// 回傳得票最多的人（平手時有多位，沒有票時是空陣列）
function mostVoted(votes: string[]): string[] {
  const tally = new Map<string, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const max = Math.max(0, ...tally.values());
  return [...tally].filter(([, k]) => k === max).map(([id]) => id);
}

function announceStart(c: Ctx) {
  const s = c.s;
  const setup = Object.entries(ROLE_TABLE[s.players.length])
    .map(([role, k]) => `${k} ${ROLE_NAME[role as Role]}`)
    .join('、');
  const wolves = wolfIds(s);
  c.events.push(
    {
      type: 'announce',
      text: `🎲 遊戲開始！玩家：${s.players.map((p) => mention(p.id)).join(' ')}\n角色配置：${setup}\n身分已經用私訊傳給每個人，請到和 bot 的私訊查看。\n📖 第一次玩？先看 <${RULES_URL}|遊戲規則>`,
      gif: 'start',
    },
    ...s.players.map((p): GameEvent => ({
      type: 'dm',
      to: p.id,
      text: `你的身分是「${ROLE_NAME[p.role!]}」。${ROLE_HELP[p.role!]}`,
    })),
    {
      type: 'wolfChat',
      wolves,
      text: `這裡是狼人的私密對話。狼人：${wolves.map((id) => mention(id) + (player(s, id).role === 'wolfKing' ? '（狼王）' : '')).join(' ')}`,
    },
  );
}

function enterNight(c: Ctx) {
  const s = c.s;
  s.phase = 'night';
  s.day += 1;
  s.timers = {};
  const seer = aliveWith(s, 'seer')[0];
  s.night = { wolfVotes: {}, seerDone: !seer, witchDone: false, saved: false, poisoned: null };
  const living = alive(s).map((p) => p.id);
  c.events.push(
    { type: 'announce', text: `🌙 第 ${s.day} 夜，天黑請閉眼。`, gif: 'night' },
    {
      type: 'prompt',
      kind: 'wolfKill',
      audience: 'wolves',
      text: '請選擇今晚要擊殺的玩家。',
      options: [...options(living), { value: 'none', label: '不殺人' }],
    },
  );
  if (seer) {
    c.events.push({
      type: 'prompt',
      kind: 'seerCheck',
      audience: 'user',
      user: seer.id,
      text: '請選擇今晚要查驗的玩家。',
      options: options(living.filter((id) => id !== seer.id)),
    });
  }
  startTimer(c, 'wolves', ACTION_MS);
  startTimer(c, 'wolfRemind', ACTION_MS - WOLF_REMIND_BEFORE_MS);
}

function decideWolves(c: Ctx) {
  const n = c.s.night!;
  const top = mostVoted(Object.values(n.wolfVotes));
  const choice = top.length ? top[Math.floor(c.rng() * top.length)] : null;
  n.wolfTarget = choice === 'none' ? null : choice;
  const text =
    choice === 'none' ? '今晚不殺人。' : n.wolfTarget ? `今晚的目標是 ${mention(n.wolfTarget)}。` : '今晚沒有擊殺目標。';
  c.events.push({ type: 'wolfChat', wolves: wolfIds(c.s), text });
  startTimer(c, 'witch', ACTION_MS);
  promptWitch(c);
}

// 女巫能不能對今晚的刀口用解藥：解藥還在、有刀口，而且不是第二夜以後自救
function canSave(s: GameState, witch: string) {
  const target = s.night!.wolfTarget;
  return s.potions.antidote && !!target && (target !== witch || s.day === 1);
}

function promptWitch(c: Ctx) {
  const s = c.s;
  const witch = aliveWith(s, 'witch')[0];
  if (!witch) {
    s.night!.witchDone = true;
    return;
  }
  const target = s.night!.wolfTarget;
  const lines: string[] = [];
  if (s.potions.antidote) lines.push(target ? `今晚被殺的是 ${mention(target)}。` : '今晚沒有人被殺。');
  lines.push('一晚最多使用一瓶藥。');
  const opts = witchOptions(s, witch.id);
  c.events.push({ type: 'prompt', kind: 'witch', audience: 'user', user: witch.id, text: lines.join('\n'), options: opts });
}

function witchOptions(s: GameState, witch: string): Option[] {
  const opts: Option[] = [];
  if (canSave(s, witch)) opts.push({ value: 'save', label: '使用解藥' });
  if (s.potions.poison) {
    for (const p of alive(s)) if (p.id !== witch) opts.push({ value: `poison:${p.id}`, label: `毒 ${p.id}` });
  }
  opts.push({ value: 'skip', label: '不使用' });
  return opts;
}

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];
const aliveBot = (s: GameState, role: Role) => aliveWith(s, role).find((p) => isBot(p.id));

// 預言家 bot 優先查還沒查過的存活玩家
export function chooseSeerTarget(s: GameState, seer: string, rng: Rng): string {
  const others = alive(s).map((p) => p.id).filter((id) => id !== seer);
  const unchecked = others.filter((id) => !s.checks.some((c) => c.target === id));
  return pick(unchecked.length ? unchecked : others, rng);
}

// 找出下一個輪到 bot 的行動；沒有就回傳 null
function nextBotAction(s: GameState, rng: Rng): GameAction | null {
  const n = s.night;
  if (s.phase === 'night' && n) {
    if (n.wolfTarget === undefined) {
      const wolf = aliveWolves(s).find((p) => isBot(p.id) && !n.wolfVotes[p.id]);
      const prey = alive(s).filter((p) => !isWolf(p.role)).map((p) => p.id);
      if (wolf) return { type: 'wolfVote', user: wolf.id, target: pick(prey, rng) };
    }
    const seer = aliveBot(s, 'seer');
    if (seer && !n.seerDone) return { type: 'seerCheck', user: seer.id, target: chooseSeerTarget(s, seer.id, rng) };
    const witch = aliveBot(s, 'witch');
    if (witch && n.wolfTarget !== undefined && !n.witchDone) {
      return { type: 'witchAct', user: witch.id, choice: pick(witchOptions(s, witch.id), rng).value };
    }
  }
  if (s.phase === 'vote' || s.phase === 'pkVote') {
    const voter = s.voters.find((v) => isBot(v) && isAlive(s, v) && !s.votes[v]);
    if (voter) {
      // 狼人 bot 不投隊友
      const wolf = isWolf(player(s, voter).role);
      const choices = s.candidates.filter((id) => id !== voter && !(wolf && isWolf(player(s, id).role)));
      const suspect = s.suspects[voter];
      const target = choices.includes(suspect) ? suspect : choices.length ? pick(choices, rng) : 'abstain';
      return { type: 'dayVote', user: voter, target };
    }
  }
  if (s.phase === 'shooting' && s.shooter && isBot(s.shooter.id)) {
    const targets = [...alive(s).map((p) => p.id), 'none'];
    return { type: 'shoot', user: s.shooter.id, target: pick(targets, rng) };
  }
  return null;
}

// 替所有輪到行動的 bot 立刻行動，直到沒有 bot 需要行動為止
function runBots(c: Ctx) {
  for (let i = 0; i < 1000; i++) {
    const action = nextBotAction(c.s, c.rng);
    if (!action || !handle(c, action)) return;
    maybeResolveNight(c);
  }
}

function maybeResolveNight(c: Ctx) {
  const s = c.s;
  const n = s.night;
  if (s.phase !== 'night' || !n || n.wolfTarget === undefined || !n.seerDone || !n.witchDone) return;
  const deaths = new Set<string>();
  if (n.wolfTarget && !n.saved) deaths.add(n.wolfTarget);
  if (n.poisoned) deaths.add(n.poisoned);
  for (const p of s.players) if (deaths.has(p.id)) p.alive = false;
  s.lastDeaths = shuffle([...deaths], c.rng);
  s.timers = {};
  dawn(c);
}

function dawn(c: Ctx) {
  const deaths = c.s.lastDeaths;
  const text = deaths.length
    ? `☀️ 天亮了。昨晚死亡的是 ${deaths.map(mention).join('、')}。死亡的玩家請不要再發言。`
    : '☀️ 天亮了。昨晚是平安夜。';
  c.events.push({ type: 'announce', text, gif: deaths.length ? 'dawnDeath' : 'dawnPeace' });
  if (checkGameOver(c)) return;
  startLastWords(c, c.s.day === 1 ? deaths : [], { kind: 'dawn' });
}

// 遺言：第一夜死者和被放逐者才有
function startLastWords(c: Ctx, ids: string[], after: NonNullable<GameState['afterLastWords']>) {
  c.s.phase = 'lastWords';
  c.s.lastWords = [...ids];
  c.s.afterLastWords = after;
  nextLastWords(c);
}

function nextLastWords(c: Ctx) {
  const s = c.s;
  s.timers = {};
  for (let id = s.lastWords.shift(); id; id = s.lastWords.shift()) {
    s.speaker = id;
    if (isBot(id)) {
      c.events.push({ type: 'announce', text: `${mention(id)}：${botLastWords(s, id, c.rng)}` });
      continue;
    }
    c.events.push({
      type: 'prompt',
      kind: 'endSpeech',
      audience: 'channel',
      text: `🕯️ ${mention(id)} 的遺言（${LAST_WORDS_MS / 1000} 秒）`,
      options: [{ value: id, label: '結束發言' }],
    });
    startTimer(c, 'phase', LAST_WORDS_MS);
    return;
  }
  s.speaker = undefined;
  const after = s.afterLastWords!;
  s.afterLastWords = undefined;
  if (after.kind === 'exile') {
    if (canShoot(s, after.id, 'exile')) startShooter(c, after.id, 'night');
    else enterNight(c);
    return;
  }
  const n = s.night!;
  const shotByWolves = n.wolfTarget && !n.saved && n.poisoned !== n.wolfTarget ? n.wolfTarget : null;
  if (shotByWolves && canShoot(s, shotByWolves, 'wolf')) startShooter(c, shotByWolves, 'speech');
  else startSpeeches(c);
}

type DeathCause = 'wolf' | 'poison' | 'exile' | 'duel';

// 狼王除了被毒死以外，任何死法都可以開槍
function canShoot(s: GameState, id: string, cause: DeathCause): boolean {
  const role = player(s, id).role;
  if (role === 'wolfKing') return cause !== 'poison';
  return false;
}

function startShooter(c: Ctx, id: string, next: 'speech' | 'night') {
  const s = c.s;
  s.phase = 'shooting';
  s.timers = {};
  s.shooter = { id, next };
  c.events.push({
    type: 'prompt',
    kind: 'shoot',
    audience: 'user',
    user: id,
    text: '你死亡了，可以開槍帶走一位玩家。',
    options: [...options(alive(s).map((p) => p.id)), { value: 'none', label: '不開槍' }],
  });
  startTimer(c, 'phase', ACTION_MS);
}

function finishShooter(c: Ctx, target: string) {
  const s = c.s;
  const { id, next } = s.shooter!;
  s.shooter = undefined;
  if (target !== 'none') {
    player(s, target).alive = false;
    const role = player(s, id).role!;
    c.events.push({ type: 'announce', text: `🔫 ${ROLE_NAME[role]} ${mention(id)} 開槍帶走了 ${mention(target)}。`, gif: 'wolfKingShot' });
    if (checkGameOver(c)) return;
  }
  if (next === 'speech') startSpeeches(c);
  else enterNight(c);
}

// 隨機選起點，依加入順序（座位）輪流發言
function startSpeeches(c: Ctx) {
  const s = c.s;
  const living = alive(s).map((p) => p.id);
  const first = Math.floor(c.rng() * living.length);
  s.phase = 'speech';
  s.suspects = {};
  s.speakers = [...living.slice(first), ...living.slice(0, first)];
  c.events.push({ type: 'announce', text: `💬 開始輪流發言，順序：${s.speakers.map(mention).join(' → ')}` });
  promptKnight(c);
  nextSpeaker(c);
}

// 輪流發言時懷疑一位存活玩家並記下來；PK 時替自己辯護、提到另一位平票的人
// 真人在頻道打的字：比對出查驗、懷疑、神職自稱，讓 bot 參考。只讀不回應
const DAY_PHASES: Phase[] = ['lastWords', 'shooting', 'speech', 'vote', 'pkSpeech', 'pkVote'];

function readChat(s: GameState, user: string, text: string): boolean {
  if (!DAY_PHASES.includes(s.phase) || isBot(user)) return false;
  const speaker = s.players.find((p) => p.id === user);
  if (!speaker || (!speaker.alive && !(s.phase === 'lastWords' && s.speaker === user))) return false;
  const info = parseChat(
    text,
    s.players.map((p) => p.id),
  );
  const others = (ids: string[]) => ids.filter((id) => id !== user);
  let changed = false;
  if (info.seerClaim && !s.seerClaimers.includes(user)) {
    s.seerClaimers.push(user);
    changed = true;
  }
  if (s.seerClaimers.includes(user)) {
    const before = s.claims.length;
    recordClaims(s, user, [
      ...others(info.wolf).map((target) => ({ night: s.day, target, wolf: true })),
      ...others(info.good).map((target) => ({ night: s.day, target, wolf: false })),
    ]);
    changed ||= s.claims.length > before;
  } else {
    const suspected = others([...info.wolf, ...info.suspect]).at(-1);
    if (suspected) {
      s.suspects[user] = suspected;
      changed = true;
    }
  }
  if (info.godClaim) {
    s.godClaims[user] = info.godClaim;
    changed = true;
  }
  return changed;
}

// bot 的遺言：預言家（或悍跳的狼人）報查驗，其他人依身分懷疑一位存活玩家
function botLastWords(s: GameState, id: string, rng: Rng): string {
  const role = player(s, id).role!;
  if (role === 'seer' && s.checks.length) {
    recordClaims(s, id, s.checks);
    return seerClaim(checkLines(s.checks)) + '大家加油。';
  }
  if (s.fakeSeer === id) return seerClaim(checkLines(s.claims.filter((k) => k.by === id))) + '大家相信我。';
  const pool = alive(s).map((p) => p.id);
  const target = isWolf(role) ? wolfSuspect(s, id, pool, rng).target : goodSuspect(s, id, pool, rng).target;
  return botLine('lastWords', mention(target), rng);
}

// bot 依身分發言：預言家報查驗、狼人假裝好人（可能悍跳）、神職被懷疑時亮身分、好人跟著查殺
function botSpeak(c: Ctx, id: string) {
  const s = c.s;
  const pk = s.phase === 'pkSpeech';
  const role = player(s, id).role!;
  const pool = (pk ? s.candidates : alive(s).map((p) => p.id)).filter((p) => p !== id);
  const say = (text: string, target: string) => {
    if (!pk) s.suspects[id] = target;
    c.events.push({ type: 'announce', text: `${mention(id)}：${text}` });
  };

  if (role === 'seer' && s.checks.length) {
    recordClaims(s, id, s.checks);
    const found = s.checks.filter((k) => k.wolf && pool.includes(k.target)).at(-1)?.target;
    const target = found ?? goodSuspect(s, id, pool, c.rng).target;
    const tail = found ? `今天大家跟我投 ${mention(found)}。` : `目前還沒查到狼，我先看 ${mention(target)}。`;
    say(seerClaim(checkLines(s.checks)) + tail, target);
    return;
  }

  if (isWolf(role)) {
    if (!pk && s.day === 1 && !s.fakeSeerDecided) {
      s.fakeSeerDecided = true;
      if (c.rng() < 0.5) s.fakeSeer = id;
    }
    if (s.fakeSeer === id) {
      const fake = fakeCheck(s, id, c.rng);
      const target = fake && pool.includes(fake) ? fake : wolfSuspect(s, id, pool, c.rng).target;
      say(seerClaim(checkLines(s.claims.filter((k) => k.by === id))) + `今天大家跟我投 ${mention(target)}。`, target);
      return;
    }
    const { target, counter } = wolfSuspect(s, id, pool, c.rng);
    say(counter ? counterClaim(mention(target), c.rng) : botLine(pk ? 'pk' : 'speech', mention(target), c.rng), target);
    return;
  }

  const { target, followed } = goodSuspect(s, id, pool, c.rng);
  const accused = pk || Object.values(s.suspects).includes(id);
  const reveal = accused ? godReveal(s, id, role) : '';
  say(reveal + (followed ? followClaim(mention(target), c.rng) : botLine(pk ? 'pk' : 'speech', mention(target), c.rng)), target);
}

const checkLines = (list: { night: number; target: string; wolf: boolean }[]) =>
  list.map((k) => ({ night: k.night, target: mention(k.target), wolf: k.wolf }));

// 把 bot 報出的查驗記下來，其他 bot 會參考
function recordClaims(s: GameState, by: string, list: { night: number; target: string; wolf: boolean }[]) {
  for (const k of list) {
    if (!s.claims.some((x) => x.by === by && x.night === k.night && x.target === k.target)) s.claims.push({ by, ...k });
  }
}

// 悍跳的狼人每天報一個假查殺：優先咬其他自稱預言家的人，否則隨機選一位非狼人
function fakeCheck(s: GameState, wolf: string, rng: Rng): string | undefined {
  const existing = s.claims.find((k) => k.by === wolf && k.night === s.day);
  if (existing) return existing.target;
  const used = new Set(s.claims.filter((k) => k.by === wolf).map((k) => k.target));
  const goods = alive(s).filter((p) => !isWolf(p.role) && !used.has(p.id)).map((p) => p.id);
  if (!goods.length) return undefined;
  const rivals = goods.filter((id) => s.claims.some((k) => k.by === id) || s.seerClaimers.includes(id));
  const target = pick(rivals.length ? rivals : goods, rng);
  s.claims.push({ by: wolf, night: s.day, target, wolf: true });
  return target;
}

// 好人 bot：優先懷疑被 bot 報過是狼人的人；被報過是好人的盡量不懷疑
function goodSuspect(s: GameState, id: string, pool: string[], rng: Rng) {
  const others = pool.filter((p) => p !== id);
  const wolves = [...new Set(s.claims.filter((k) => k.wolf).map((k) => k.target))].filter((t) => others.includes(t));
  if (wolves.length) return { target: pick(wolves, rng), followed: true };
  const good = new Set([...s.claims.filter((k) => !k.wolf).map((k) => k.target), ...Object.keys(s.godClaims)]);
  const rest = others.filter((p) => !good.has(p));
  return { target: pick(rest.length ? rest : others, rng), followed: false };
}

// 狼人 bot：絕不懷疑隊友，優先咬報過狼隊友是狼人的人
function wolfSuspect(s: GameState, id: string, pool: string[], rng: Rng) {
  const goods = pool.filter((p) => p !== id && !isWolf(player(s, p).role));
  const accusers = s.claims.filter((k) => k.wolf && isWolf(player(s, k.target).role)).map((k) => k.by);
  const targets = [...new Set(accusers)].filter((b) => goods.includes(b));
  if (targets.length) return { target: pick(targets, rng), counter: true };
  return { target: pick(goods.length ? goods : pool.filter((p) => p !== id), rng), counter: false };
}

// 女巫、騎士被懷疑或進 PK 時亮身分
function godReveal(s: GameState, id: string, role: Role): string {
  if (role === 'witch') {
    return witchReveal(s.witchLog.map((l) => ({ night: l.night, saved: l.saved && mention(l.saved), poisoned: l.poisoned && mention(l.poisoned) })));
  }
  if (role === 'knight') return knightReveal(s.knightUsed);
  return '';
}

// 騎士還活著、還沒決鬥過時，私訊決鬥按鈕
function promptKnight(c: Ctx) {
  const s = c.s;
  const knight = aliveWith(s, 'knight')[0];
  if (!knight || s.knightUsed) return;
  c.events.push({
    type: 'prompt',
    kind: 'duel',
    audience: 'user',
    user: knight.id,
    text: '🗡️ 你可以在輪流發言時翻牌決鬥（整局一次）。選擇決鬥對象：',
    options: options(alive(s).filter((p) => p.id !== knight.id).map((p) => p.id)),
  });
}

function duel(c: Ctx, knight: string, target: string) {
  const s = c.s;
  s.knightUsed = true;
  c.events.push({ type: 'announce', text: `🗡️ 騎士 ${mention(knight)} 翻牌，向 ${mention(target)} 發起決鬥！` });
  if (isWolf(player(s, target).role)) {
    player(s, target).alive = false;
    c.events.push({ type: 'announce', text: `${mention(target)} 是狼人，出局！直接進入黑夜。`, gif: 'duelWin' });
    if (checkGameOver(c)) return;
    if (canShoot(s, target, 'duel')) startShooter(c, target, 'night');
    else enterNight(c);
    return;
  }
  player(s, knight).alive = false;
  c.events.push({ type: 'announce', text: `${mention(target)} 是好人，騎士 ${mention(knight)} 出局。`, gif: 'duelLose' });
  if (checkGameOver(c)) return;
  s.speakers = s.speakers.filter((id) => id !== knight);
  if (s.phase === 'speech' && s.speaker === knight) nextSpeaker(c);
}

// 換下一位發言者；bot 說一句台詞就換人，沒有人了就進入下一個階段
function nextSpeaker(c: Ctx) {
  const s = c.s;
  s.timers = {};
  for (let id = s.speakers.shift(); id; id = s.speakers.shift()) {
    s.speaker = id;
    if (isBot(id)) {
      botSpeak(c, id);
      continue;
    }
    c.events.push({
      type: 'prompt',
      kind: 'endSpeech',
      audience: 'channel',
      text: `🎤 輪到 ${mention(id)} 發言（${SPEECH_MS / 1000} 秒）`,
      options: [{ value: id, label: '結束發言' }],
    });
    startTimer(c, 'phase', SPEECH_MS);
    return;
  }
  s.speaker = undefined;
  if (s.phase === 'pkSpeech') {
    const voters = alive(s).filter((p) => !s.candidates.includes(p.id)).map((p) => p.id);
    openVote(c, 'pkVote', s.candidates, voters);
    return;
  }
  startVote(c);
}

function startVote(c: Ctx) {
  const ids = alive(c.s).map((p) => p.id);
  openVote(c, 'vote', ids, ids);
}

function openVote(c: Ctx, phase: 'vote' | 'pkVote', candidates: string[], voters: string[]) {
  const s = c.s;
  s.phase = phase;
  s.timers = {};
  s.votes = {};
  s.candidates = candidates;
  s.voters = voters;
  c.events.push({
    type: 'prompt',
    kind: phase === 'vote' ? 'dayVote' : 'pkVote',
    audience: 'channel',
    text: phase === 'vote' ? '🗳️ 請投票選出要放逐的玩家。' : '⚔️ PK 投票：請在平票的玩家中選出要放逐的人（PK 中的玩家不能投票）。',
    options: [...options(candidates), { value: 'abstain', label: '棄票' }],
  });
  startTimer(c, 'phase', ACTION_MS);
  if (voters.length === 0) endVote(c);
}

function startPk(c: Ctx, tied: string[]) {
  const s = c.s;
  s.phase = 'pkSpeech';
  s.candidates = tied;
  s.speakers = s.players.map((p) => p.id).filter((id) => tied.includes(id));
  c.events.push({ type: 'announce', text: `⚔️ 平票！${tied.map(mention).join('、')} 進入 PK，依序再發言一次。`, gif: 'pk' });
  nextSpeaker(c);
}

function endVote(c: Ctx) {
  const s = c.s;
  const lines = s.voters.map((v) => {
    const t = s.votes[v] ?? 'abstain';
    return `${mention(v)} → ${t === 'abstain' ? '棄票' : mention(t)}`;
  });
  c.events.push({ type: 'announce', text: `🗳️ 投票結果：\n${lines.join('\n')}` });
  const top = mostVoted(Object.values(s.votes).filter((t) => t !== 'abstain'));
  if (top.length > 1 && s.phase === 'vote') {
    startPk(c, top);
    return;
  }
  if (top.length !== 1) {
    c.events.push({ type: 'announce', text: '🗳️ 今天沒有人被放逐。' });
    enterNight(c);
    return;
  }
  exile(c, top[0]);
}

function exile(c: Ctx, id: string) {
  player(c.s, id).alive = false;
  c.events.push({ type: 'announce', text: `🚪 ${mention(id)} 被放逐了。`, gif: 'exile' });
  if (checkGameOver(c)) return;
  startLastWords(c, [id], { kind: 'exile', id });
}

// 有人死亡後呼叫；勝負已定就結束遊戲並公開身分，回傳 true
function checkGameOver(c: Ctx): boolean {
  const winner = checkWinner(c.s.players);
  if (!winner) return false;
  c.s.phase = 'ended';
  c.s.timers = {};
  const roster = c.s.players
    .map((p) => `${mention(p.id)}：${ROLE_NAME[p.role!]}（${p.alive ? '存活' : '死亡'}）`)
    .join('\n');
  const title = winner === 'good' ? '🎉 遊戲結束，好人陣營獲勝！' : '🐺 遊戲結束，狼人陣營獲勝！';
  c.s.winner = winner;
  // 只記錄全真人的遊戲（戰績查詢用）
  if (!c.s.players.some((p) => isBot(p.id))) {
    c.events.push({ type: 'gameRecord', winner, players: c.s.players.map((p) => ({ id: p.id, role: p.role! })) });
  }
  c.events.push(
    { type: 'announce', text: `${title}\n${roster}`, gif: winner === 'good' ? 'goodWin' : 'wolvesWin' },
    {
      type: 'prompt',
      kind: 'rematch',
      audience: 'channel',
      text: '要再來一局嗎？',
      options: [{ value: 'rematch', label: '再來一局' }],
    },
  );
  return true;
}

const isSpeaking = (s: GameState) => s.phase === 'speech' || s.phase === 'pkSpeech' || s.phase === 'lastWords';
const advanceSpeaker = (c: Ctx) => (c.s.phase === 'lastWords' ? nextLastWords(c) : nextSpeaker(c));

const reply = (c: Ctx, to: string, text: string) => {
  c.events.push({ type: 'ephemeral', to, text });
  return false;
};

type GameAction = Exclude<Action, { type: 'new' } | { type: 'rematch' }>;

// 只有這局的玩家才能做的操作（遊戲按鈕）
const PLAYER_ACTIONS: GameAction['type'][] = ['wolfVote', 'seerCheck', 'witchAct', 'shoot', 'endSpeech', 'dayVote', 'duel'];

// 回傳 true 代表 state 有變動
function handle(c: Ctx, action: GameAction): boolean {
  const s = c.s;
  if (PLAYER_ACTIONS.includes(action.type) && 'user' in action && !s.players.some((p) => p.id === action.user)) {
    return reply(c, action.user, '你不在這局遊戲中。');
  }
  switch (action.type) {
    case 'join': {
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      if (s.players.some((p) => p.id === action.user)) return reply(c, action.user, '你已經在房間裡了。');
      if (s.players.length >= MAX_PLAYERS) return reply(c, action.user, '房間已滿。');
      s.players.push({ id: action.user, alive: true });
      c.events.push(lobbyEvent(s));
      return true;
    }
    case 'leave': {
      if (!s.players.some((p) => p.id === action.user)) return false;
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了，不能離開。');
      if (action.user === s.host) {
        s.phase = 'ended';
        c.events.push(lobbyEvent(s), { type: 'announce', text: '🛑 房主離開，遊戲已取消。' });
        return true;
      }
      s.players = s.players.filter((p) => p.id !== action.user);
      c.events.push(lobbyEvent(s));
      return true;
    }
    case 'start': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以開始遊戲。');
      if (s.phase !== 'lobby') return false;
      const n = s.players.length;
      if (n < MIN_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_PLAYERS} 人才能開始。`);
      const roles = dealRoles(n, c.rng);
      s.players.forEach((p, i) => (p.role = roles[i]));
      s.phase = 'night';
      c.events.push(lobbyEvent(s));
      announceStart(c);
      enterNight(c);
      return true;
    }
    case 'addBot': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以加入 bot。');
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      const room = MAX_PLAYERS - s.players.length;
      const bots = s.players.filter((p) => isBot(p.id)).length;
      const taken = new Set(s.players.filter((p) => isBot(p.id)).map((p) => p.id.split(':')[2]));
      for (let i = 1; i <= Math.min(action.count, room); i++) {
        const name = randomBotName(c.rng, taken);
        taken.add(name);
        s.players.push({ id: `bot:${bots + i}:${name}`, alive: true });
      }
      if (room > 0) c.events.push(lobbyEvent(s));
      if (action.count > room) reply(c, action.user, '房間已滿。');
      return room > 0;
    }
    case 'removeBot': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以移除 bot。');
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      const bots = s.players.filter((p) => isBot(p.id));
      if (!bots.length) return reply(c, action.user, '房間裡沒有 bot。');
      const removed = new Set(bots.slice(-action.count).map((p) => p.id));
      s.players = s.players.filter((p) => !removed.has(p.id));
      c.events.push(lobbyEvent(s));
      return true;
    }
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      c.events.push({ type: 'announce', text: '🛑 房主已取消遊戲。' });
      return true;
    }
    case 'wolfVote': {
      const n = s.night;
      if (s.phase !== 'night' || !n || n.wolfTarget !== undefined) return false;
      if (!aliveWolves(s).some((p) => p.id === action.user)) return false;
      if (action.target !== 'none' && !isAlive(s, action.target)) return false;
      n.wolfVotes[action.user] = action.target;
      const picked =
        action.target === 'none'
          ? `${mention(action.user)} 選擇不殺人。`
          : `${mention(action.user)} 選擇擊殺 ${mention(action.target)}。`;
      c.events.push({ type: 'wolfChat', wolves: wolfIds(s), text: picked });
      if (aliveWolves(s).every((w) => n.wolfVotes[w.id])) decideWolves(c);
      return true;
    }
    case 'seerCheck': {
      const n = s.night;
      if (s.phase !== 'night' || !n || n.seerDone) return false;
      if (!aliveWith(s, 'seer').some((p) => p.id === action.user)) return false;
      if (action.target === action.user || !isAlive(s, action.target)) return false;
      n.seerDone = true;
      const target = player(s, action.target);
      s.checks.push({ night: s.day, target: target.id, wolf: isWolf(target.role) });
      const side = isWolf(target.role) ? '狼人' : '好人';
      c.events.push({ type: 'dm', to: action.user, text: `${mention(target.id)} 是${side}。` });
      return true;
    }
    case 'witchAct': {
      const n = s.night;
      if (s.phase !== 'night' || !n || n.wolfTarget === undefined || n.witchDone) return false;
      if (!aliveWith(s, 'witch').some((p) => p.id === action.user)) return false;
      if (action.choice === 'save') {
        if (!canSave(s, action.user)) return false;
        n.saved = true;
        s.potions.antidote = false;
        s.witchLog.push({ night: s.day, saved: n.wolfTarget! });
        c.events.push({ type: 'dm', to: action.user, text: `你對 ${mention(n.wolfTarget!)} 使用了解藥。` });
      } else if (action.choice.startsWith('poison:')) {
        const target = action.choice.slice('poison:'.length);
        if (!s.potions.poison || target === action.user || !isAlive(s, target)) return false;
        n.poisoned = target;
        s.potions.poison = false;
        s.witchLog.push({ night: s.day, poisoned: target });
        c.events.push({ type: 'dm', to: action.user, text: `你對 ${mention(target)} 使用了毒藥。` });
      } else if (action.choice === 'skip') {
        c.events.push({ type: 'dm', to: action.user, text: '你今晚不使用藥。' });
      } else {
        return false;
      }
      n.witchDone = true;
      return true;
    }
    case 'endDiscussion': {
      if (s.phase !== 'speech') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以提前結束討論。');
      startVote(c);
      return true;
    }
    case 'chat':
      return readChat(s, action.user, action.text);
    case 'duel': {
      if (!aliveWith(s, 'knight').some((p) => p.id === action.user) || s.knightUsed) return false;
      if (s.phase !== 'speech') return reply(c, action.user, '現在不能決鬥。');
      if (action.target === action.user || !isAlive(s, action.target)) return false;
      duel(c, action.user, action.target);
      return true;
    }
    case 'endSpeech': {
      if (!isSpeaking(s)) return false;
      if (action.user !== s.speaker) return reply(c, action.user, '現在不是你的發言時間。');
      advanceSpeaker(c);
      return true;
    }
    case 'skipSpeaker': {
      if (!isSpeaking(s)) return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以跳過發言者。');
      advanceSpeaker(c);
      return true;
    }
    case 'dayVote': {
      if (s.phase !== 'vote' && s.phase !== 'pkVote') return false;
      const voter = s.players.find((p) => p.id === action.user);
      if (!voter) return false;
      if (!voter.alive) return reply(c, action.user, '你已經死亡，無法投票。');
      if (!s.voters.includes(action.user)) return reply(c, action.user, 'PK 中的玩家不能投票。');
      if (action.target !== 'abstain' && !s.candidates.includes(action.target)) return false;
      s.votes[action.user] = action.target;
      const choice = action.target === 'abstain' ? '你選擇棄票。' : `你投給了 ${mention(action.target)}。`;
      c.events.push({ type: 'ephemeral', to: action.user, text: choice });
      if (s.voters.every((v) => s.votes[v])) endVote(c);
      return true;
    }
    case 'shoot': {
      if (s.phase !== 'shooting' || action.user !== s.shooter?.id) return false;
      if (action.target !== 'none' && !isAlive(s, action.target)) return false;
      if (action.target === 'none') c.events.push({ type: 'dm', to: action.user, text: '你選擇不開槍。' });
      finishShooter(c, action.target);
      return true;
    }
    case 'timeout': {
      const n = s.night;
      if (action.id === s.timers.wolves && n) {
        delete s.timers.wolves;
        n.seerDone = true;
        if (n.wolfTarget === undefined) decideWolves(c);
        return true;
      }
      if (action.id === s.timers.wolfRemind && n) {
        delete s.timers.wolfRemind;
        const waiting = aliveWolves(s).filter((w) => !n.wolfVotes[w.id]);
        if (n.wolfTarget === undefined && waiting.length) {
          const text = `⏰ 剩下 ${WOLF_REMIND_BEFORE_MS / 1000} 秒，還沒選的：${waiting.map((w) => mention(w.id)).join('、')}`;
          c.events.push({ type: 'wolfChat', wolves: wolfIds(s), text });
        }
        return true;
      }
      if (action.id === s.timers.witch && n) {
        delete s.timers.witch;
        n.witchDone = true;
        return true;
      }
      if (action.id === s.timers.phase && isSpeaking(s)) {
        advanceSpeaker(c);
        return true;
      }
      if (action.id === s.timers.phase && (s.phase === 'vote' || s.phase === 'pkVote')) {
        endVote(c);
        return true;
      }
      if (action.id === s.timers.phase && s.phase === 'shooting') {
        finishShooter(c, 'none');
        return true;
      }
      return false;
    }
  }
}

export function applyAction(state: GameState | undefined, action: Action, rng: Rng): Result {
  const busy = (user: string) => ({ state: state!, events: [{ type: 'ephemeral', to: user, text: '這個頻道已經有遊戲了。' } as GameEvent] });
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') return busy(action.user);
    return createLobby(state, action.user, action.channel);
  }
  if (action.type === 'rematch') {
    if (!state) return { state: state!, events: [] };
    if (state.phase !== 'ended') return busy(action.user);
    if (!state.winner) return { state, events: [] };
    if (isBot(action.user) || !state.players.some((p) => p.id === action.user)) {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '只有上一局的玩家可以開新的一局。' }] };
    }
    return createLobby(state, action.user, action.channel);
  }
  if (!state || state.phase === 'ended') return { state: state!, events: [] };
  const c: Ctx = { s: structuredClone(state), events: [], rng };
  const changed = handle(c, action);
  if (changed) {
    maybeResolveNight(c);
    runBots(c);
  }
  return { state: changed ? c.s : state, events: c.events };
}

function createLobby(prev: GameState | undefined, host: string, channel: string): Result {
  const created: GameState = {
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host, alive: true }],
    day: 0,
    timerSeq: prev?.timerSeq ?? 0, // 接續上一局的編號，舊計時器的 timeout 才不會被誤認
    timers: {},
    potions: { antidote: true, poison: true },
    lastDeaths: [],
    speakers: [],
    lastWords: [],
    knightUsed: false,
    suspects: {},
    checks: [],
    witchLog: [],
    claims: [],
    fakeSeerDecided: false,
    seerClaimers: [],
    godClaims: {},
    votes: {},
    candidates: [],
    voters: [],
  };
  return { state: created, events: [lobbyEvent(created)] };
}
