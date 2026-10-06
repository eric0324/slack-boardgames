// 狼人殺遊戲引擎：純邏輯，不碰任何 I/O。
// applyAction(state, action, rng) → { state, events }，由 adapter 把 events 轉成 Slack 訊息。

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;

export type Phase = 'lobby' | 'night' | 'ended';
export type Role = 'werewolf' | 'seer' | 'witch' | 'hunter' | 'villager';

// 人數 → 各角色數量（順序也是不洗牌時的發牌順序）
export const ROLE_TABLE: Record<number, Partial<Record<Role, number>>> = {
  6: { werewolf: 2, seer: 1, witch: 1, villager: 2 },
  7: { werewolf: 2, seer: 1, witch: 1, hunter: 1, villager: 2 },
  8: { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 2 },
  9: { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 3 },
  10: { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 4 },
  11: { werewolf: 4, seer: 1, witch: 1, hunter: 1, villager: 4 },
  12: { werewolf: 4, seer: 1, witch: 1, hunter: 1, villager: 5 },
};

export interface Player {
  id: string;
  alive: boolean;
  role?: Role;
}

export interface GameState {
  channel: string;
  host: string;
  phase: Phase;
  players: Player[];
}

export type Action =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string };

export type GameEvent =
  | { type: 'announce'; text: string }
  | { type: 'ephemeral'; to: string; text: string }
  | { type: 'lobby'; host: string; players: string[]; open: boolean };

export type Rng = () => number;

interface Result {
  state: GameState;
  events: GameEvent[];
}

export function dealRoles(n: number, rng: Rng): Role[] {
  const roles = Object.entries(ROLE_TABLE[n]).flatMap(([role, k]) => Array<Role>(k).fill(role as Role));
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

const reply = (state: GameState, to: string, text: string): Result => ({
  state,
  events: [{ type: 'ephemeral', to, text }],
});

const lobbyEvent = (s: GameState): GameEvent => ({
  type: 'lobby',
  host: s.host,
  players: s.players.map((p) => p.id),
  open: s.phase === 'lobby',
});

export function applyAction(state: GameState | undefined, action: Action, rng: Rng): Result {
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') return reply(state, action.user, '這個頻道已經有遊戲了。');
    const created: GameState = {
      channel: action.channel,
      host: action.user,
      phase: 'lobby',
      players: [{ id: action.user, alive: true }],
    };
    return { state: created, events: [lobbyEvent(created)] };
  }
  if (!state || state.phase === 'ended') return { state: state!, events: [] };

  switch (action.type) {
    case 'join': {
      if (state.phase !== 'lobby') return reply(state, action.user, '遊戲已經開始了。');
      if (state.players.some((p) => p.id === action.user)) return reply(state, action.user, '你已經在房間裡了。');
      if (state.players.length >= MAX_PLAYERS) return reply(state, action.user, '房間已滿。');
      const next = { ...state, players: [...state.players, { id: action.user, alive: true }] };
      return { state: next, events: [lobbyEvent(next)] };
    }
    case 'leave': {
      if (!state.players.some((p) => p.id === action.user)) return { state, events: [] };
      if (state.phase !== 'lobby') return reply(state, action.user, '遊戲已經開始了，不能離開。');
      if (action.user === state.host) {
        const next: GameState = { ...state, phase: 'ended' };
        return { state: next, events: [lobbyEvent(next), { type: 'announce', text: '房主離開，遊戲已取消。' }] };
      }
      const next = { ...state, players: state.players.filter((p) => p.id !== action.user) };
      return { state: next, events: [lobbyEvent(next)] };
    }
    case 'start': {
      if (action.user !== state.host) return reply(state, action.user, '只有房主可以開始遊戲。');
      if (state.phase !== 'lobby') return { state, events: [] };
      const n = state.players.length;
      if (n < MIN_PLAYERS) return reply(state, action.user, `目前 ${n} 人，至少需要 ${MIN_PLAYERS} 人才能開始。`);
      const roles = dealRoles(n, rng);
      const players = state.players.map((p, i) => ({ ...p, role: roles[i] }));
      const next: GameState = { ...state, phase: 'night', players };
      return { state: next, events: [lobbyEvent(next)] };
    }
    case 'cancel': {
      if (action.user !== state.host) return reply(state, action.user, '只有房主可以取消遊戲。');
      const next: GameState = { ...state, phase: 'ended' };
      return { state: next, events: [{ type: 'announce', text: '房主已取消遊戲。' }] };
    }
  }
}
