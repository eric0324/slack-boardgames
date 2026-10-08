// 一字千金遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyJustOne(state, action, rng) → { state, events }。
import { CODENAMES_WORDS } from './codenamesWords.js';
import { mention, type GameEvent, type Rng } from './engine.js';

export const MIN_JUSTONE_PLAYERS = 3;
export const MAX_JUSTONE_PLAYERS = 7;
const TITLE = '一字千金';
const DECK_SIZE = 13;

export type JPhase = 'lobby' | 'clue' | 'guess' | 'ended';

export interface JPlayer {
  id: string;
}

export interface JState {
  game: 'justone';
  channel: string;
  host: string;
  phase: JPhase;
  players: JPlayer[];
  deck: string[]; // 還沒翻的牌
  word?: string; // 這一輪的詞
  card: number; // 第幾張（1 起算）
  guesser: number; // 猜詞的人在 players 裡的位置
  score: number;
  timerSeq: number;
  timers: { phase?: number };
}

export type JAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<JAction, { type: 'new' }>;

interface Result {
  state: JState;
  events: GameEvent[];
}

interface Ctx {
  s: JState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: JState): GameEvent => ({
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

// 新的一輪：翻一張牌給猜詞以外的人
function startRound(c: Ctx) {
  const s = c.s;
  s.word = s.deck.shift();
  s.card++;
  s.phase = 'clue';
  c.events.push({ type: 'announce', text: `🃏 第 ${s.card} 張：${mention(s.players[s.guesser].id)} 猜詞` });
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
      if (s.players.length >= MAX_JUSTONE_PLAYERS) return reply(c, action.user, '房間已滿。');
      s.players.push({ id: action.user });
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
      return reply(c, action.user, '一字千金不支援 bot。');
    case 'start': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以開始遊戲。');
      if (s.phase !== 'lobby') return false;
      const n = s.players.length;
      if (n < MIN_JUSTONE_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_JUSTONE_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'clue' }));
      s.deck = shuffle(CODENAMES_WORDS, c.rng).slice(0, DECK_SIZE);
      s.guesser = Math.floor(c.rng() * n);
      c.events.push({ type: 'announce', text: `💡 一字千金開始！牌堆 ${DECK_SIZE} 張，大家一起合作，看能猜對幾張。`, gif: 'start' });
      startRound(c);
      return true;
    }
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      s.timers = {};
      c.events.push({ type: 'announce', text: '🛑 房主已取消遊戲。' });
      return true;
    }
    case 'timeout':
      return false;
  }
}

export function applyJustOne(state: JState | undefined, action: JAction, rng: Rng): Result {
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

function createLobby(prev: JState | undefined, host: string, channel: string): Result {
  const created: JState = {
    game: 'justone',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host }],
    deck: [],
    card: 0,
    guesser: 0,
    score: 0,
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
