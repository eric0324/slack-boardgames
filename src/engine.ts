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

export const ROLE_NAME: Record<Role, string> = {
  werewolf: '狼人',
  seer: '預言家',
  witch: '女巫',
  hunter: '獵人',
  villager: '村民',
};

const ROLE_HELP: Record<Role, string> = {
  werewolf: '每晚和其他狼人一起選一位玩家擊殺。殺光所有村民或所有神職就獲勝。',
  seer: '每晚可以查驗一位玩家是好人還是狼人。',
  witch: '有一瓶解藥和一瓶毒藥，各能用一次，一晚最多用一瓶。解藥只有第一夜可以救自己。',
  hunter: '被狼人殺死或被放逐時，可以開槍帶走一位玩家；被毒死則不能開槍。',
  villager: '沒有特殊能力，靠白天的推理和投票找出狼人。',
};

export const mention = (id: string) => `<@${id}>`;

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
  | { type: 'dm'; to: string; text: string }
  | { type: 'wolfChat'; wolves: string[]; text: string }
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

function startEvents(s: GameState): GameEvent[] {
  const setup = Object.entries(ROLE_TABLE[s.players.length])
    .map(([role, k]) => `${k} ${ROLE_NAME[role as Role]}`)
    .join('、');
  const wolves = s.players.filter((p) => p.role === 'werewolf').map((p) => p.id);
  return [
    { type: 'announce', text: `遊戲開始！玩家：${s.players.map((p) => mention(p.id)).join(' ')}\n角色配置：${setup}` },
    ...s.players.map((p): GameEvent => ({
      type: 'dm',
      to: p.id,
      text: `你的身分是「${ROLE_NAME[p.role!]}」。${ROLE_HELP[p.role!]}`,
    })),
    { type: 'wolfChat', wolves, text: `這裡是狼人的私密對話。狼人：${wolves.map(mention).join(' ')}` },
  ];
}

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
      return { state: next, events: [lobbyEvent(next), ...startEvents(next)] };
    }
    case 'cancel': {
      if (action.user !== state.host) return reply(state, action.user, '只有房主可以取消遊戲。');
      const next: GameState = { ...state, phase: 'ended' };
      return { state: next, events: [{ type: 'announce', text: '房主已取消遊戲。' }] };
    }
  }
}
