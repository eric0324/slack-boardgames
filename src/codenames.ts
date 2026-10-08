// 機密代號遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyCodenames(state, action, rng) → { state, events }。
import { CODENAMES_WORDS } from './codenamesWords.js';
import { mention, type GameEvent, type Rng } from './engine.js';

export const MIN_CODENAMES_PLAYERS = 4;
export const MAX_CODENAMES_PLAYERS = 12;
const TITLE = '機密代號';

export type CPhase = 'lobby' | 'clue' | 'guess' | 'ended';

export type Team = 'red' | 'blue';
export type CardColor = Team | 'neutral' | 'assassin';

export interface CPlayer {
  id: string;
  team?: Team;
  spymaster?: boolean;
}

export interface Card {
  word: string;
  color: CardColor;
  revealed: boolean;
}

const TEAM_NAME: Record<Team, string> = { red: '紅隊', blue: '藍隊' };
const EMOJI: Record<CardColor, string> = { red: '🟥', blue: '🟦', neutral: '⬜', assassin: '💀' };
const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

export interface CState {
  game: 'codenames';
  channel: string;
  host: string;
  phase: CPhase;
  players: CPlayer[];
  cards: Card[];
  startTeam: Team;
  turn: Team;
  timerSeq: number;
  timers: { phase?: number };
}

export type CAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<CAction, { type: 'new' }>;

interface Result {
  state: CState;
  events: GameEvent[];
}

interface Ctx {
  s: CState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: CState): GameEvent => ({
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

const left = (s: CState, team: Team) => s.cards.filter((x) => x.color === team && !x.revealed).length;

// 牌桌：5×5 按鈕，翻開的牌加上顏色 emoji 和樣式；reveal 為 true 時全部翻開（遊戲結束）
function boardEvent(s: CState, reveal = false): GameEvent {
  const buttons = s.cards.map((x, i) => {
    const shown = x.revealed || reveal;
    const style = shown && x.color === 'red' ? 'danger' : shown && x.color === 'blue' ? 'primary' : undefined;
    return { value: String(i), label: shown ? `${EMOJI[x.color]}${x.word}` : x.word, ...(style ? { style } : {}) } as {
      value: string;
      label: string;
      style?: 'primary' | 'danger';
    };
  });
  return {
    type: 'board',
    text: `🟥 紅隊剩 ${left(s, 'red')} 張　🟦 藍隊剩 ${left(s, 'blue')} 張`,
    rows: Array.from({ length: 5 }, (_, r) => buttons.slice(r * 5, r * 5 + 5)),
  };
}

// 開局：隨機分隊、選隊長、決定先攻，擺牌桌並私訊隊長答案
function deal(c: Ctx) {
  const s = c.s;
  s.startTeam = c.rng() < 0.5 ? 'red' : 'blue';
  s.turn = s.startTeam;
  shuffle(s.players, c.rng).forEach((p, i) => {
    const player = s.players.find((x) => x.id === p.id)!;
    player.team = i % 2 === 0 ? 'red' : 'blue';
    player.spymaster = i < 2;
  });
  const words = shuffle(CODENAMES_WORDS, c.rng).slice(0, 25);
  const colors: CardColor[] = [
    ...Array<CardColor>(9).fill(s.startTeam),
    ...Array<CardColor>(8).fill(other(s.startTeam)),
    ...Array<CardColor>(7).fill('neutral'),
    'assassin',
  ];
  const dealt = shuffle(colors, c.rng);
  s.cards = words.map((word, i) => ({ word, color: dealt[i], revealed: false }));
  const roster = (t: Team) => {
    const team = s.players.filter((p) => p.team === t);
    const captain = team.find((p) => p.spymaster)!;
    const members = team.filter((p) => !p.spymaster).map((p) => mention(p.id));
    return `${EMOJI[t]} ${TEAM_NAME[t]}：隊長 ${mention(captain.id)}；隊員 ${members.join('、')}`;
  };
  c.events.push(
    {
      type: 'announce',
      text: `🕵️ 機密代號開始！\n${roster('red')}\n${roster('blue')}\n${TEAM_NAME[s.startTeam]}先攻（9 張），${TEAM_NAME[other(s.startTeam)]} 8 張。答案已經私訊給兩位隊長。`,
      gif: 'start',
    },
    boardEvent(s),
  );
  const answer = Array.from({ length: 5 }, (_, r) =>
    s.cards
      .slice(r * 5, r * 5 + 5)
      .map((x) => `${EMOJI[x.color]}${x.word}`)
      .join('　'),
  ).join('\n');
  for (const p of s.players.filter((x) => x.spymaster)) {
    c.events.push({
      type: 'dm',
      to: p.id,
      text: `🗝️ 你是${TEAM_NAME[p.team!]}隊長，這是答案（不要給隊員看）：\n${answer}\n輪到你們隊時，用 \`/game codenames clue <詞> <數字>\` 給提示。`,
    });
  }
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
      if (s.players.length >= MAX_CODENAMES_PLAYERS) return reply(c, action.user, '房間已滿。');
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
      return reply(c, action.user, '機密代號不支援 bot。');
    case 'start': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以開始遊戲。');
      if (s.phase !== 'lobby') return false;
      const n = s.players.length;
      if (n < MIN_CODENAMES_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_CODENAMES_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'clue' }));
      deal(c);
      s.phase = 'clue';
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

export function applyCodenames(state: CState | undefined, action: CAction, rng: Rng): Result {
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

function createLobby(prev: CState | undefined, host: string, channel: string): Result {
  const created: CState = {
    game: 'codenames',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host }],
    cards: [],
    startTeam: 'red',
    turn: 'red',
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
