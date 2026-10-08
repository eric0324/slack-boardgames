// 政變遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyCoup(state, action, rng) → { state, events }。
import { randomBotName } from './botLines.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';

export const MIN_COUP_PLAYERS = 3;
export const MAX_COUP_PLAYERS = 6;
const TITLE = '政變';
const ACTION_MS = 60_000;
const TARGET_MS = 30_000;

export type KPhase = 'lobby' | 'action' | 'target' | 'lose' | 'ended';
export type ActKind = 'income' | 'foreignAid' | 'coup' | 'tax' | 'assassinate' | 'steal' | 'exchange';

export type Role = 'duke' | 'assassin' | 'captain' | 'ambassador' | 'contessa';
const ROLES: Role[] = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
export const ROLE_NAME: Record<Role, string> = { duke: '公爵', assassin: '刺客', captain: '隊長', ambassador: '大使', contessa: '女伯爵' };
const ROLE_HELP = [
  '公爵：稅收（拿 3 枚），可以阻擋外援',
  '刺客：付 3 枚刺殺一人',
  '隊長：勒索（從一人拿 2 枚），可以阻擋勒索',
  '大使：交換（抽 2 張再選要留的牌），可以阻擋勒索',
  '女伯爵：可以阻擋刺殺',
].join('\n');

export interface Card {
  role: Role;
  revealed: boolean;
}

export interface KPlayer {
  id: string;
  cards: Card[];
  coins: number;
}

export interface KState {
  game: 'coup';
  channel: string;
  host: string;
  phase: KPhase;
  players: KPlayer[];
  deck: Role[];
  turn: number;
  pending?: { actor: string; kind: ActKind; target?: string };
  losing: string[]; // 等著選要翻開哪張牌的玩家
  timerSeq: number;
  timers: { phase?: number };
}

export type KAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'act'; user: string; kind: ActKind }
  | { type: 'target'; user: string; target: string }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<KAction, { type: 'new' }>;

interface Result {
  state: KState;
  events: GameEvent[];
}

interface Ctx {
  s: KState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: KState): GameEvent => ({
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

const cardList = (p: KPlayer) => p.cards.filter((x) => !x.revealed).map((x) => ROLE_NAME[x.role]).join('、');

// 發牌：15 張洗牌，每人 2 張暗牌和 2 枚金幣
function deal(c: Ctx) {
  const s = c.s;
  s.deck = shuffle(ROLES.flatMap((r) => [r, r, r]), c.rng);
  for (const p of s.players) {
    p.cards = [s.deck.shift()!, s.deck.shift()!].map((role) => ({ role, revealed: false }));
    p.coins = 2;
  }
  s.turn = Math.floor(c.rng() * s.players.length);
  const order = s.players.map((_, i) => s.players[(s.turn + i) % s.players.length].id);
  c.events.push({
    type: 'announce',
    text: `👑 政變開始！順序：${order.map(mention).join(' → ')}\n每人 2 枚金幣，手牌已經私訊給大家。可以宣稱任何角色，但小心被質疑！`,
    gif: 'start',
  });
  for (const p of s.players) c.events.push({ type: 'dm', to: p.id, text: `🃏 你的手牌：${cardList(p)}\n\n${ROLE_HELP}` });
}

function startTimer(c: Ctx, ms: number) {
  c.s.timers.phase = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id: c.s.timerSeq, ms });
}

const ACT_LABEL: Record<ActKind, string> = {
  income: '💰 收入 +1',
  foreignAid: '🤲 外援 +2',
  coup: '💥 政變（付 7）',
  tax: '👑 稅收 +3（公爵）',
  assassinate: '🗡️ 刺殺（付 3，刺客）',
  steal: '🏴‍☠️ 勒索 2 枚（隊長）',
  exchange: '🔄 交換（大使）',
};
const TARGETED: ActKind[] = ['coup', 'assassinate', 'steal'];

const alive = (p: KPlayer) => p.cards.some((x) => !x.revealed);
const current = (s: KState) => s.players[s.turn];
const playerOf = (s: KState, id: string) => s.players.find((p) => p.id === id)!;

function available(p: KPlayer): ActKind[] {
  if (p.coins >= 10) return ['coup'];
  return (['income', 'foreignAid', 'coup', 'tax', 'assassinate', 'steal', 'exchange'] as ActKind[]).filter(
    (k) => (k !== 'coup' || p.coins >= 7) && (k !== 'assassinate' || p.coins >= 3),
  );
}

// 輪到下一位：公告金幣和翻開的牌，給行動按鈕
function startTurn(c: Ctx) {
  const s = c.s;
  s.phase = 'action';
  s.pending = undefined;
  const p = current(s);
  const status = s.players
    .map((x) => {
      const shown = x.cards.filter((k) => k.revealed).map((k) => ROLE_NAME[k.role]);
      return `${mention(x.id)} 💰${x.coins}${shown.length ? `（翻開：${shown.join('、')}）` : ''}${alive(x) ? '' : ' 💀'}`;
    })
    .join('\n');
  c.events.push(
    { type: 'announce', text: `👉 輪到 ${mention(p.id)}\n${status}` },
    {
      type: 'prompt',
      kind: 'coupAction',
      audience: 'channel',
      text: `${mention(p.id)} 請選擇行動（${ACTION_MS / 1000} 秒）`,
      options: available(p).map((k) => ({ value: k, label: ACT_LABEL[k] })),
    },
  );
  startTimer(c, ACTION_MS);
}

function nextTurn(c: Ctx) {
  const s = c.s;
  for (let i = 1; i <= s.players.length; i++) {
    const k = (s.turn + i) % s.players.length;
    if (alive(s.players[k])) {
      s.turn = k;
      break;
    }
  }
  startTurn(c);
}

function declare(c: Ctx, user: string, kind: ActKind): boolean {
  const s = c.s;
  const p = current(s);
  if (s.phase !== 'action' || user !== p.id) return reply(c, user, '還沒輪到你行動。');
  if (!available(p).includes(kind)) return reply(c, user, p.coins >= 10 ? '有 10 枚以上金幣時只能政變。' : '金幣不夠，不能選這個行動。');
  if (kind === 'income') {
    p.coins += 1;
    c.events.push({ type: 'announce', text: `💰 ${mention(p.id)} 收入，拿 1 枚金幣。` });
    nextTurn(c);
    return true;
  }
  if (TARGETED.includes(kind)) {
    s.phase = 'target';
    s.pending = { actor: p.id, kind };
    c.events.push({
      type: 'prompt',
      kind: 'coupTarget',
      audience: 'channel',
      text: `${mention(p.id)} 選擇${ACT_LABEL[kind]}的目標（${TARGET_MS / 1000} 秒）`,
      options: s.players.filter((x) => x.id !== p.id && alive(x)).map((x) => ({ value: x.id, label: x.id })),
    });
    startTimer(c, TARGET_MS);
    return true;
  }
  return false;
}

function chooseTarget(c: Ctx, user: string, targetId: string): boolean {
  const s = c.s;
  if (s.phase !== 'target' || user !== s.pending!.actor) return reply(c, user, '現在不是你選目標。');
  const t = s.players.find((x) => x.id === targetId);
  if (!t || t.id === user || !alive(t)) return false;
  s.pending!.target = t.id;
  const actor = playerOf(s, user);
  if (s.pending!.kind === 'coup') {
    actor.coins -= 7;
    c.events.push({ type: 'announce', text: `💥 ${mention(user)} 付 7 枚金幣，對 ${mention(t.id)} 發動政變！` });
    loseInfluence(c, [t.id]);
  }
  return true;
}

// 失去影響力：依序讓玩家選要翻開哪張牌
function loseInfluence(c: Ctx, ids: string[]) {
  const s = c.s;
  s.phase = 'lose';
  s.losing = ids;
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
      if (s.players.length >= MAX_COUP_PLAYERS) return reply(c, action.user, '房間已滿。');
      s.players.push({ id: action.user, cards: [], coins: 0 });
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
      const room = MAX_COUP_PLAYERS - s.players.length;
      const bots = s.players.filter((p) => isBot(p.id)).length;
      const taken = new Set(s.players.filter((p) => isBot(p.id)).map((p) => p.id.split(':')[2]));
      for (let i = 1; i <= Math.min(action.count, room); i++) {
        const name = randomBotName(c.rng, taken);
        taken.add(name);
        s.players.push({ id: `bot:${bots + i}:${name}`, cards: [], coins: 0 });
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
      if (n < MIN_COUP_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_COUP_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'action' }));
      deal(c);
      startTurn(c);
      return true;
    }
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      s.timers = {};
      c.events.push({ type: 'announce', text: '🛑 房主已取消遊戲。' });
      return true;
    }
    case 'act':
      return declare(c, action.user, action.kind);
    case 'target':
      return chooseTarget(c, action.user, action.target);
    case 'timeout': {
      if (action.id !== s.timers.phase) return false;
      const others = () => s.players.filter((x) => x.id !== current(s).id && alive(x));
      if (s.phase === 'action') {
        if (current(s).coins < 10) return declare(c, current(s).id, 'income');
        declare(c, current(s).id, 'coup');
        return chooseTarget(c, current(s).id, others()[Math.floor(c.rng() * others().length)].id);
      }
      if (s.phase === 'target') return chooseTarget(c, s.pending!.actor, others()[Math.floor(c.rng() * others().length)].id);
      return false;
    }
  }
}

export function applyCoup(state: KState | undefined, action: KAction, rng: Rng): Result {
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

function createLobby(prev: KState | undefined, host: string, channel: string): Result {
  const created: KState = {
    game: 'coup',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host, cards: [], coins: 0 }],
    deck: [],
    turn: 0,
    losing: [],
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
