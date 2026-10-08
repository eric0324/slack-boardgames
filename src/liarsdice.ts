// 吹牛骰遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyLiarsDice(state, action, rng) → { state, events }。
import { randomBotName } from './botLines.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';

export const MIN_DICE_PLAYERS = 2;
export const MAX_DICE_PLAYERS = 8;
const TITLE = '吹牛骰';
const START_DICE = 5;
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const TURN_MS = 60_000;

export type LPhase = 'lobby' | 'bid' | 'ended';

export interface LPlayer {
  id: string;
  dice: number[];
}

export interface LState {
  game: 'liarsdice';
  channel: string;
  host: string;
  phase: LPhase;
  players: LPlayer[];
  round: number;
  turn: number; // 輪到 players 裡的第幾位
  bid?: { quantity: number; face: number; by: string };
  onesCalled: boolean; // 這輪有人喊過 1 點，1 點就不再萬用
  timerSeq: number;
  timers: { phase?: number };
}

export type LAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'bid'; user: string; quantity: number; face: number }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<LAction, { type: 'new' }>;

interface Result {
  state: LState;
  events: GameEvent[];
}

interface Ctx {
  s: LState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: LState): GameEvent => ({
  type: 'lobby',
  title: TITLE,
  host: s.host,
  players: s.players.map((p) => p.id),
  open: s.phase === 'lobby',
});

const totalDice = (s: LState) => s.players.reduce((n, p) => n + p.dice.length, 0);

// 新的一輪：還有骰子的人重新擲骰並私訊點數，頻道只公告每人剩幾顆
function startRound(c: Ctx, starter: number) {
  const s = c.s;
  s.round++;
  s.turn = starter;
  for (const p of s.players) p.dice = p.dice.map(() => Math.floor(c.rng() * 6) + 1);
  const alive = s.players.filter((p) => p.dice.length);
  c.events.push({
    type: 'announce',
    text: `🎲 第 ${s.round} 輪：${alive.map((p) => `${mention(p.id)} ${p.dice.length} 顆`).join('、')}（全場 ${totalDice(s)} 顆）`,
  });
  for (const p of alive) {
    c.events.push({ type: 'dm', to: p.id, text: `🎲 第 ${s.round} 輪，你的骰子：${p.dice.map((d) => FACES[d - 1]).join(' ')}` });
  }
  s.bid = undefined;
  s.onesCalled = false;
  promptTurn(c);
}

function startTimer(c: Ctx, ms: number) {
  c.s.timers.phase = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id: c.s.timerSeq, ms });
}

const current = (s: LState) => s.players[s.turn].id;

function promptTurn(c: Ctx) {
  const s = c.s;
  const id = current(s);
  c.events.push({
    type: 'announce',
    text: `👉 輪到 ${mention(id)} 喊數：\`/game liarsdice bid <數量> <點數>\`（${TURN_MS / 1000} 秒）`,
  });
  if (s.bid) {
    c.events.push({
      type: 'prompt',
      kind: 'challenge',
      audience: 'channel',
      text: `${mention(id)} 覺得「${s.bid.quantity} 個 ${s.bid.face}」是吹牛的話可以開`,
      options: [{ value: id, label: '開！' }],
    });
  }
  startTimer(c, TURN_MS);
}

// 下一位還有骰子的玩家
function nextAlive(s: LState, from: number) {
  for (let i = 1; i <= s.players.length; i++) {
    const k = (from + i) % s.players.length;
    if (s.players[k].dice.length) return k;
  }
  return from;
}

// 點數大小：2 < 3 < 4 < 5 < 6 < 1
const rank = (face: number) => (face === 1 ? 7 : face);

function placeBid(c: Ctx, user: string, quantity: number, face: number): boolean {
  const s = c.s;
  if (s.phase !== 'bid' || user !== current(s)) return reply(c, user, '還沒輪到你喊數。');
  if (!Number.isInteger(face) || face < 1 || face > 6) return reply(c, user, '點數要是 1～6。');
  if (!Number.isInteger(quantity) || quantity < 1) return reply(c, user, '數量至少要 1。');
  const prev = s.bid;
  if (prev && !(quantity > prev.quantity || (quantity === prev.quantity && rank(face) > rank(prev.face)))) {
    return reply(c, user, `要喊得比「${prev.quantity} 個 ${prev.face}」更大：數量更多，或數量相同、點數更大（1 最大）。`);
  }
  s.bid = { quantity, face, by: user };
  if (face === 1) s.onesCalled = true;
  c.events.push({ type: 'announce', text: `📢 ${mention(user)} 喊：「${quantity} 個 ${face}」` });
  s.turn = nextAlive(s, s.turn);
  promptTurn(c);
  return true;
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
      if (s.players.length >= MAX_DICE_PLAYERS) return reply(c, action.user, '房間已滿。');
      s.players.push({ id: action.user, dice: [] });
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
    case 'addBot': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以加入 bot。');
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      const room = MAX_DICE_PLAYERS - s.players.length;
      const bots = s.players.filter((p) => isBot(p.id)).length;
      const taken = new Set(s.players.filter((p) => isBot(p.id)).map((p) => p.id.split(':')[2]));
      for (let i = 1; i <= Math.min(action.count, room); i++) {
        const name = randomBotName(c.rng, taken);
        taken.add(name);
        s.players.push({ id: `bot:${bots + i}:${name}`, dice: [] });
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
    case 'start': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以開始遊戲。');
      if (s.phase !== 'lobby') return false;
      const n = s.players.length;
      if (n < MIN_DICE_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_DICE_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'bid' }));
      s.phase = 'bid';
      for (const p of s.players) p.dice = Array(START_DICE).fill(0);
      startRound(c, Math.floor(c.rng() * n));
      return true;
    }
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      s.timers = {};
      c.events.push({ type: 'announce', text: '🛑 房主已取消遊戲。' });
      return true;
    }
    case 'bid':
      return placeBid(c, action.user, action.quantity, action.face);
    case 'timeout': {
      if (action.id !== s.timers.phase || s.phase !== 'bid') return false;
      if (!s.bid) return placeBid(c, current(s), 1, 2);
      return false;
    }
  }
}

export function applyLiarsDice(state: LState | undefined, action: LAction, rng: Rng): Result {
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

function createLobby(prev: LState | undefined, host: string, channel: string): Result {
  const created: LState = {
    game: 'liarsdice',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host, dice: [] }],
    round: 0,
    turn: 0,
    onesCalled: false,
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
