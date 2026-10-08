// 誰是臥底遊戲引擎：純邏輯，不碰任何 I/O。介面和狼人殺一樣：applyUndercover(state, action, rng) → { state, events }。
// events 沿用狼人殺的 GameEvent，adapter 的 send() 可以共用。
import { randomBotName } from './botLines.js';
import { isBot, MAX_PLAYERS, type GameEvent, type Rng } from './engine.js';

export const MIN_UNDERCOVER_PLAYERS = 4;
const TITLE = '誰是臥底';

export type UPhase = 'lobby' | 'speech' | 'ended';
export type URole = 'civilian' | 'undercover' | 'blank';

export interface UPlayer {
  id: string;
  alive: boolean;
  role?: URole;
  word?: string;
}

export interface UState {
  game: 'undercover';
  channel: string;
  host: string;
  phase: UPhase;
  players: UPlayer[];
  timerSeq: number;
  timers: { phase?: number };
}

export type UAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'timeout'; id: number };

interface Result {
  state: UState;
  events: GameEvent[];
}

interface Ctx {
  s: UState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: UState): GameEvent => ({
  type: 'lobby',
  title: TITLE,
  host: s.host,
  players: s.players.map((p) => p.id),
  open: s.phase === 'lobby',
});

const reply = (c: Ctx, to: string, text: string) => {
  c.events.push({ type: 'ephemeral', to, text });
  return false;
};

function handle(c: Ctx, action: Exclude<UAction, { type: 'new' }>): boolean {
  const s = c.s;
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
    case 'start': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以開始遊戲。');
      if (s.phase !== 'lobby') return false;
      const n = s.players.length;
      if (n < MIN_UNDERCOVER_PLAYERS) {
        return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_UNDERCOVER_PLAYERS} 人才能開始。`);
      }
      s.phase = 'speech';
      c.events.push(lobbyEvent(s));
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

export function applyUndercover(state: UState | undefined, action: UAction, rng: Rng): Result {
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    }
    const created: UState = {
      game: 'undercover',
      channel: action.channel,
      host: action.user,
      phase: 'lobby',
      players: [{ id: action.user, alive: true }],
      timerSeq: state?.timerSeq ?? 0,
      timers: {},
    };
    return { state: created, events: [lobbyEvent(created)] };
  }
  if (!state || state.phase === 'ended') return { state: state!, events: [] };
  const c: Ctx = { s: structuredClone(state), events: [], rng };
  const changed = handle(c, action);
  return { state: changed ? c.s : state, events: c.events };
}
