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

export const ACTION_MS = 60_000;

export interface Player {
  id: string;
  alive: boolean;
  role?: Role;
}

export interface NightState {
  wolfVotes: Record<string, string>;
  wolfTarget?: string | null; // undefined = 還沒決定，null = 沒有擊殺目標
  seerDone: boolean;
}

type TimerName = 'wolves' | 'witch';

export interface GameState {
  channel: string;
  host: string;
  phase: Phase;
  players: Player[];
  day: number;
  timerSeq: number;
  timers: Partial<Record<TimerName, number>>;
  night?: NightState;
}

export type Action =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'wolfVote'; user: string; target: string }
  | { type: 'seerCheck'; user: string; target: string }
  | { type: 'timeout'; id: number };

export interface Option {
  value: string;
  label: string;
}

export type GameEvent =
  | { type: 'announce'; text: string }
  | { type: 'ephemeral'; to: string; text: string }
  | { type: 'dm'; to: string; text: string }
  | { type: 'wolfChat'; wolves: string[]; text: string }
  | { type: 'lobby'; host: string; players: string[]; open: boolean }
  | { type: 'prompt'; kind: string; audience: 'channel' | 'wolves' | 'user'; user?: string; text: string; options: Option[] }
  | { type: 'startTimer'; id: number; ms: number };

export type Rng = () => number;

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

export function dealRoles(n: number, rng: Rng): Role[] {
  const roles = Object.entries(ROLE_TABLE[n]).flatMap(([role, k]) => Array<Role>(k).fill(role as Role));
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

const alive = (s: GameState) => s.players.filter((p) => p.alive);
const aliveWith = (s: GameState, role: Role) => alive(s).filter((p) => p.role === role);
const isAlive = (s: GameState, id: string) => alive(s).some((p) => p.id === id);
const wolfIds = (s: GameState) => s.players.filter((p) => p.role === 'werewolf').map((p) => p.id);
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

// 從票數最高的人裡隨機選一位；沒有票就回傳 null
function topVoted(votes: string[], rng: Rng): string | null {
  const tally = new Map<string, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const max = Math.max(0, ...tally.values());
  const top = [...tally].filter(([, k]) => k === max).map(([id]) => id);
  return top.length ? top[Math.floor(rng() * top.length)] : null;
}

function announceStart(c: Ctx) {
  const s = c.s;
  const setup = Object.entries(ROLE_TABLE[s.players.length])
    .map(([role, k]) => `${k} ${ROLE_NAME[role as Role]}`)
    .join('、');
  const wolves = wolfIds(s);
  c.events.push(
    { type: 'announce', text: `遊戲開始！玩家：${s.players.map((p) => mention(p.id)).join(' ')}\n角色配置：${setup}` },
    ...s.players.map((p): GameEvent => ({
      type: 'dm',
      to: p.id,
      text: `你的身分是「${ROLE_NAME[p.role!]}」。${ROLE_HELP[p.role!]}`,
    })),
    { type: 'wolfChat', wolves, text: `這裡是狼人的私密對話。狼人：${wolves.map(mention).join(' ')}` },
  );
}

function enterNight(c: Ctx) {
  const s = c.s;
  s.phase = 'night';
  s.day += 1;
  s.timers = {};
  const seer = aliveWith(s, 'seer')[0];
  s.night = { wolfVotes: {}, seerDone: !seer };
  const living = alive(s).map((p) => p.id);
  c.events.push(
    { type: 'announce', text: `第 ${s.day} 夜，天黑請閉眼。` },
    { type: 'prompt', kind: 'wolfKill', audience: 'wolves', text: '請選擇今晚要擊殺的玩家。', options: options(living) },
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
}

function decideWolves(c: Ctx) {
  const n = c.s.night!;
  n.wolfTarget = topVoted(Object.values(n.wolfVotes), c.rng);
  const text = n.wolfTarget ? `今晚的目標是 ${mention(n.wolfTarget)}。` : '今晚沒有擊殺目標。';
  c.events.push({ type: 'wolfChat', wolves: wolfIds(c.s), text });
  startTimer(c, 'witch', ACTION_MS);
}

const reply = (c: Ctx, to: string, text: string) => {
  c.events.push({ type: 'ephemeral', to, text });
  return false;
};

// 回傳 true 代表 state 有變動
function handle(c: Ctx, action: Exclude<Action, { type: 'new' }>): boolean {
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
        c.events.push(lobbyEvent(s), { type: 'announce', text: '房主離開，遊戲已取消。' });
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
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      c.events.push({ type: 'announce', text: '房主已取消遊戲。' });
      return true;
    }
    case 'wolfVote': {
      const n = s.night;
      if (s.phase !== 'night' || !n || n.wolfTarget !== undefined) return false;
      if (!aliveWith(s, 'werewolf').some((p) => p.id === action.user) || !isAlive(s, action.target)) return false;
      n.wolfVotes[action.user] = action.target;
      if (aliveWith(s, 'werewolf').every((w) => n.wolfVotes[w.id])) decideWolves(c);
      return true;
    }
    case 'seerCheck': {
      const n = s.night;
      if (s.phase !== 'night' || !n || n.seerDone) return false;
      if (!aliveWith(s, 'seer').some((p) => p.id === action.user)) return false;
      if (action.target === action.user || !isAlive(s, action.target)) return false;
      n.seerDone = true;
      const target = s.players.find((p) => p.id === action.target)!;
      const side = target.role === 'werewolf' ? '狼人' : '好人';
      c.events.push({ type: 'dm', to: action.user, text: `${mention(target.id)} 是${side}。` });
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
      return false;
    }
  }
}

export function applyAction(state: GameState | undefined, action: Action, rng: Rng): Result {
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    }
    const created: GameState = {
      channel: action.channel,
      host: action.user,
      phase: 'lobby',
      players: [{ id: action.user, alive: true }],
      day: 0,
      timerSeq: 0,
      timers: {},
    };
    return { state: created, events: [lobbyEvent(created)] };
  }
  if (!state || state.phase === 'ended') return { state: state!, events: [] };
  const c: Ctx = { s: structuredClone(state), events: [], rng };
  const changed = handle(c, action);
  return { state: changed ? c.s : state, events: c.events };
}
