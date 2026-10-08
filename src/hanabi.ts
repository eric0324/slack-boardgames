// 花火遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyHanabi(state, action, rng) → { state, events }。
import { mention, type GameEvent, type Rng } from './engine.js';

export const MIN_HANABI_PLAYERS = 2;
export const MAX_HANABI_PLAYERS = 5;
const TITLE = '花火';
const TURN_MS = 120_000;
const MAX_HINTS = 8;
const MAX_FUSES = 3;

export type Color = 'red' | 'yellow' | 'green' | 'blue' | 'white';
const COLORS: Color[] = ['red', 'yellow', 'green', 'blue', 'white'];
export const COLOR_NAME: Record<Color, string> = { red: '紅', yellow: '黃', green: '綠', blue: '藍', white: '白' };
const COLOR_EMOJI: Record<Color, string> = { red: '🟥', yellow: '🟨', green: '🟩', blue: '🟦', white: '⬜' };
const NUMBERS = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5];

export interface HCard {
  color: Color;
  n: number;
  knowColor?: boolean; // 被提示過顏色
  knowNumber?: boolean; // 被提示過數字
}

export type HPhase = 'lobby' | 'turn' | 'ended';

export interface HPlayer {
  id: string;
  hand: HCard[];
}

export interface HState {
  game: 'hanabi';
  channel: string;
  host: string;
  phase: HPhase;
  players: HPlayer[];
  deck: HCard[];
  fireworks: Record<Color, number>;
  hints: number;
  fuses: number;
  discard: HCard[];
  turn: number;
  timerSeq: number;
  timers: { phase?: number };
}

export type HAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'peek'; user: string }
  | { type: 'play'; user: string; index: number }
  | { type: 'discard'; user: string; index: number }
  | { type: 'hint'; user: string; target: string; color?: Color; number?: number }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<HAction, { type: 'new' }>;

interface Result {
  state: HState;
  events: GameEvent[];
}

interface Ctx {
  s: HState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: HState): GameEvent => ({
  type: 'lobby',
  title: TITLE,
  host: s.host,
  players: s.players.map((p) => p.id),
  open: s.phase === 'lobby',
});

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startTimer(c: Ctx, ms: number) {
  c.s.timers.phase = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id: c.s.timerSeq, ms });
}

const show = (x: HCard) => `${COLOR_EMOJI[x.color]}${x.n}`;
const known = (x: HCard) => `${x.knowColor ? COLOR_NAME[x.color] : '？'}${x.knowNumber ? x.n : '？'}`;
const fireworksLine = (s: HState) => COLORS.map((col) => `${COLOR_EMOJI[col]}${s.fireworks[col]}`).join(' ');

// 洗牌發牌：2～3 人每人 5 張、4～5 人每人 4 張
function deal(c: Ctx) {
  const s = c.s;
  s.deck = shuffle(
    COLORS.flatMap((color) => NUMBERS.map((n) => ({ color, n }))),
    c.rng,
  );
  const size = s.players.length <= 3 ? 5 : 4;
  for (const p of s.players) p.hand = s.deck.splice(0, size);
  s.turn = Math.floor(c.rng() * s.players.length);
  c.events.push({
    type: 'announce',
    text: `🎆 花火開始！大家看得到別人的牌、看不到自己的，靠提示合力依序打出五種顏色的煙火（1 到 5）。\n按「👀 看牌」可以看別人的手牌和自己已知的提示。`,
    gif: 'start',
  });
  startTurn(c);
}

function startTurn(c: Ctx) {
  const s = c.s;
  s.phase = 'turn';
  const p = s.players[s.turn];
  const slots = p.hand.map((_, i) => i);
  c.events.push(
    {
      type: 'announce',
      text: `🎇 輪到 ${mention(p.id)}（${TURN_MS / 60_000} 分鐘）\n煙火：${fireworksLine(s)}｜提示 ${s.hints}｜失誤 ${s.fuses}／${MAX_FUSES}｜牌堆 ${s.deck.length}\n給提示：\`/game hanabi hint @某人 <紅|黃|綠|藍|白|1～5>\``,
    },
    {
      type: 'prompt',
      kind: 'hanabiTurn',
      audience: 'channel',
      text: `${mention(p.id)} 請出牌、棄牌或給提示；大家都可以按「看牌」`,
      options: [
        { value: 'peek', label: '👀 看牌' },
        ...slots.map((i) => ({ value: `play:${i}`, label: `出第 ${i + 1} 張` })),
        ...slots.map((i) => ({ value: `discard:${i}`, label: `棄第 ${i + 1} 張` })),
      ],
    },
  );
  startTimer(c, TURN_MS);
}

// 看牌：只讓按的人看到別人的手牌和自己已知的提示
function peek(c: Ctx, user: string) {
  const s = c.s;
  const me = s.players.find((p) => p.id === user);
  if (!me) return reply(c, user, '你不在這局遊戲裡。');
  const others = s.players.filter((p) => p.id !== user).map((p) => `${mention(p.id)}：${p.hand.map(show).join(' ')}`);
  const mine = me.hand.map((x, i) => `第 ${i + 1} 張：${known(x)}`).join('\n');
  return reply(c, user, `👀 別人的手牌：\n${others.join('\n')}\n\n你的手牌（已知的提示）：\n${mine}`);
}

const currentId = (s: HState) => s.players[s.turn].id;

// 從手牌拿出一張，牌堆還有就補一張到最後
function takeCard(s: HState, p: HPlayer, index: number) {
  const [card] = p.hand.splice(index, 1);
  if (s.deck.length) p.hand.push(s.deck.shift()!);
  return card;
}

function playCard(c: Ctx, user: string, index: number): boolean {
  const s = c.s;
  if (s.phase !== 'turn' || user !== currentId(s)) return reply(c, user, '還沒輪到你。');
  const p = s.players[s.turn];
  if (!p.hand[index]) return false;
  const card = takeCard(s, p, index);
  if (s.fireworks[card.color] + 1 === card.n) {
    s.fireworks[card.color] = card.n;
    const bonus = card.n === 5 && s.hints < MAX_HINTS;
    if (bonus) s.hints++;
    c.events.push({ type: 'announce', text: `🎆 ${mention(user)} 打出 ${show(card)}，成功！${bonus ? '完成這個顏色，提示標記加回 1 個。' : ''}` });
  } else {
    s.fuses++;
    s.discard.push(card);
    c.events.push({ type: 'announce', text: `💥 ${mention(user)} 打出 ${show(card)}，失誤！（${s.fuses}／${MAX_FUSES}）` });
  }
  endTurn(c);
  return true;
}

function discardCard(c: Ctx, user: string, index: number): boolean {
  const s = c.s;
  if (s.phase !== 'turn' || user !== currentId(s)) return reply(c, user, '還沒輪到你。');
  if (s.hints >= MAX_HINTS) return reply(c, user, '提示標記滿了（8 個），不能棄牌。');
  const p = s.players[s.turn];
  if (!p.hand[index]) return false;
  const card = takeCard(s, p, index);
  s.discard.push(card);
  s.hints++;
  c.events.push({ type: 'announce', text: `🗑️ ${mention(user)} 棄掉 ${show(card)}，提示標記加 1。` });
  endTurn(c);
  return true;
}

// 提示：花 1 個標記，告訴對方他手上所有某個顏色或某個數字的牌
function giveHint(c: Ctx, user: string, targetId: string, color?: Color, number?: number): boolean {
  const s = c.s;
  if (s.phase !== 'turn' || user !== currentId(s)) return reply(c, user, '還沒輪到你。');
  if (s.hints <= 0) return reply(c, user, '沒有提示標記了，只能出牌或棄牌。');
  if (targetId === user) return reply(c, user, '不能提示自己。');
  const t = s.players.find((p) => p.id === targetId);
  if (!t) return reply(c, user, '這個人不在這局遊戲裡。');
  const match = (x: HCard) => (color ? x.color === color : x.n === number);
  const slots = t.hand.map((x, i) => [x, i] as const).filter(([x]) => match(x));
  if (!slots.length) return reply(c, user, '提示要至少指出一張牌。');
  for (const [x] of slots) {
    if (color) x.knowColor = true;
    else x.knowNumber = true;
  }
  s.hints--;
  const what = color ? `${COLOR_NAME[color]}色` : ` ${number}`;
  c.events.push({
    type: 'announce',
    text: `💬 ${mention(user)} 提示 ${mention(t.id)}：第 ${slots.map(([, i]) => i + 1).join('、')} 張是${what}`,
  });
  endTurn(c);
  return true;
}

function endTurn(c: Ctx) {
  const s = c.s;
  s.turn = (s.turn + 1) % s.players.length;
  startTurn(c);
}

const reply = (c: Ctx, to: string, text: string) => {
  c.events.push({ type: 'ephemeral', to, text });
  return false;
};

function handle(c: Ctx, action: GameAction): boolean {
  const s = c.s;
  switch (action.type) {
    case 'join': {
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      if (s.players.some((p) => p.id === action.user)) return reply(c, action.user, '你已經在房間裡了。');
      if (s.players.length >= MAX_HANABI_PLAYERS) return reply(c, action.user, '房間已滿。');
      s.players.push({ id: action.user, hand: [] });
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
    case 'addBot':
    case 'removeBot':
      return reply(c, action.user, '花火不支援 bot。');
    case 'start': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以開始遊戲。');
      if (s.phase !== 'lobby') return false;
      const n = s.players.length;
      if (n < MIN_HANABI_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_HANABI_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'turn' }));
      deal(c);
      return true;
    }
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      s.timers = {};
      c.events.push({ type: 'announce', text: '🛑 房主已取消遊戲。' });
      return true;
    }
    case 'peek':
      if (s.phase === 'lobby') return false;
      return peek(c, action.user);
    case 'play':
      return playCard(c, action.user, action.index);
    case 'discard':
      return discardCard(c, action.user, action.index);
    case 'hint':
      return giveHint(c, action.user, action.target, action.color, action.number);
    case 'timeout': {
      if (action.id !== s.timers.phase || s.phase !== 'turn') return false;
      const me = currentId(s);
      c.events.push({ type: 'announce', text: `⌛ ${mention(me)} 時間到了，系統代為行動。` });
      if (s.hints < MAX_HINTS) return discardCard(c, me, 0);
      const next = s.players[(s.turn + 1) % s.players.length];
      const card = next.hand[Math.floor(c.rng() * next.hand.length)];
      return c.rng() < 0.5 ? giveHint(c, me, next.id, card.color) : giveHint(c, me, next.id, undefined, card.n);
    }
  }
}

export function applyHanabi(state: HState | undefined, action: HAction, rng: Rng): Result {
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    }
    return createLobby(state, action.user, action.channel);
  }
  if (!state || state.phase === 'ended') return { state: state!, events: [] };
  const c: Ctx = { s: structuredClone(state), events: [], rng };
  const changed = handle(c, action);
  return { state: changed ? c.s : state, events: c.events };
}

function createLobby(prev: HState | undefined, host: string, channel: string): Result {
  const created: HState = {
    game: 'hanabi',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host, hand: [] }],
    deck: [],
    fireworks: { red: 0, yellow: 0, green: 0, blue: 0, white: 0 },
    hints: MAX_HINTS,
    fuses: 0,
    discard: [],
    turn: 0,
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
