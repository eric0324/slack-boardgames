// 機密代號遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyCodenames(state, action, rng) → { state, events }。
import { CODENAMES_WORDS } from './codenamesWords.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';

export const MIN_CODENAMES_PLAYERS = 4;
export const MAX_CODENAMES_PLAYERS = 12;
const TITLE = '機密代號';
const CLUE_MS = 120_000;
const GUESS_MS = 180_000;

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
  clue?: { word: string; count: number };
  guessed: number; // 這回合已經翻了幾張
  winner?: Team;
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
  | { type: 'clue'; user: string; word: string; count: number }
  | { type: 'guess'; user: string; index: number }
  | { type: 'endGuess'; user: string }
  | { type: 'skipTurn'; user: string }
  | { type: 'timeout'; id: number }
  | { type: 'rematch'; user: string; channel: string };

type GameAction = Exclude<CAction, { type: 'new' } | { type: 'rematch' }>;

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

function startTimer(c: Ctx, ms: number) {
  c.s.timers.phase = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id: c.s.timerSeq, ms });
}

const captainOf = (s: CState, t: Team) => s.players.find((p) => p.team === t && p.spymaster)!.id;

// 回合開始：請目前隊伍的隊長給提示
function startTurn(c: Ctx) {
  const s = c.s;
  s.phase = 'clue';
  s.clue = undefined;
  s.guessed = 0;
  c.events.push({
    type: 'announce',
    text: `🔔 輪到 ${EMOJI[s.turn]} ${TEAM_NAME[s.turn]}：隊長 ${mention(captainOf(s, s.turn))} 請用 \`/game codenames clue <詞> <數字>\` 給提示（${CLUE_MS / 60_000} 分鐘）\n🟥 紅隊剩 ${left(s, 'red')} 張　🟦 藍隊剩 ${left(s, 'blue')} 張`,
  });
  startTimer(c, CLUE_MS);
}

function endTurn(c: Ctx) {
  c.s.turn = other(c.s.turn);
  startTurn(c);
}

function giveClue(c: Ctx, user: string, word: string, count: number): boolean {
  const s = c.s;
  if (s.phase !== 'clue' || user !== captainOf(s, s.turn)) return reply(c, user, '現在不是你給提示的時間。');
  if (!word || /\s/.test(word)) return reply(c, user, '提示只能是一個詞（不能有空白）。');
  if (s.cards.some((x) => !x.revealed && x.word === word)) return reply(c, user, '不能用牌桌上的詞當提示。');
  if (!Number.isInteger(count) || count < 1 || count > 9) return reply(c, user, '提示的數字要是 1～9。');
  s.phase = 'guess';
  s.clue = { word, count };
  c.events.push({
    type: 'announce',
    text: `🕵️ ${TEAM_NAME[s.turn]}隊長：「${word}」${count}\n${TEAM_NAME[s.turn]}隊員請在牌桌上按字卡猜，最多 ${count + 1} 張（${GUESS_MS / 60_000} 分鐘）`,
  });
  c.events.push({ type: 'prompt', kind: 'endGuess', audience: 'channel', text: '猜完了可以按「結束猜牌」', options: [{ value: 'end', label: '結束猜牌' }] });
  startTimer(c, GUESS_MS);
  return true;
}

const COLOR_NAME: Record<CardColor, string> = { red: '🟥 紅隊', blue: '🟦 藍隊', neutral: '⬜ 中立', assassin: '💀 刺客' };

// 翻牌：自己隊的牌可以繼續猜（最多提示數字＋1 張），其他顏色回合結束
function guessCard(c: Ctx, user: string, index: number): boolean {
  const s = c.s;
  const card = s.cards[index];
  if (!card || card.revealed) return false;
  const p = s.players.find((x) => x.id === user);
  if (!p) return reply(c, user, '你不在這局遊戲裡。');
  if (s.phase !== 'guess') return reply(c, user, '現在不是猜牌的時間。');
  if (p.spymaster) return reply(c, user, '隊長不能翻牌。');
  if (p.team !== s.turn) return reply(c, user, '現在不是你們隊猜牌。');
  card.revealed = true;
  s.guessed++;
  c.events.push({ type: 'announce', text: `${mention(user)} 翻開「${card.word}」：${COLOR_NAME[card.color]}` });
  if (card.color === 'assassin') {
    c.events.push({ type: 'announce', text: `💀 ${TEAM_NAME[s.turn]}翻到刺客了！` });
    endGame(c, other(s.turn));
    return true;
  }
  const done = (['red', 'blue'] as Team[]).find((t) => left(s, t) === 0);
  if (done) {
    endGame(c, done);
    return true;
  }
  c.events.push(boardEvent(s));
  if (card.color !== s.turn) endTurn(c);
  else if (s.guessed >= s.clue!.count + 1) {
    c.events.push({ type: 'announce', text: `✋ 已經猜滿 ${s.guessed} 張，換對方。` });
    endTurn(c);
  }
  return true;
}

// 結束：牌桌全部翻開，公告獲勝隊伍和兩隊成員
function endGame(c: Ctx, winner: Team) {
  const s = c.s;
  s.phase = 'ended';
  s.timers = {};
  s.winner = winner;
  const members = (t: Team) =>
    `${EMOJI[t]} ${TEAM_NAME[t]}：${s.players
      .filter((p) => p.team === t)
      .map((p) => `${mention(p.id)}${p.spymaster ? '（隊長）' : ''}`)
      .join('、')}`;
  c.events.push(
    boardEvent(s, true),
    { type: 'announce', text: `🎉 遊戲結束，${TEAM_NAME[winner]}獲勝！\n${members('red')}\n${members('blue')}`, gif: 'goodWin' },
    { type: 'prompt', kind: 'rematch', audience: 'channel', text: '要再來一局嗎？', options: [{ value: 'rematch', label: '再來一局' }] },
  );
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
    case 'clue':
      return giveClue(c, action.user, action.word, action.count);
    case 'guess':
      return guessCard(c, action.user, action.index);
    case 'endGuess': {
      if (s.phase !== 'guess') return false;
      const p = s.players.find((x) => x.id === action.user);
      if (!p || p.spymaster || p.team !== s.turn) return reply(c, action.user, '只有目前猜牌隊伍的隊員可以結束猜牌。');
      if (s.guessed === 0) return reply(c, action.user, '至少要猜一張才能結束猜牌。');
      c.events.push({ type: 'announce', text: `🛑 ${TEAM_NAME[s.turn]}結束猜牌，換對方。` });
      endTurn(c);
      return true;
    }
    case 'skipTurn': {
      if (s.phase !== 'clue' && s.phase !== 'guess') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以跳過回合。');
      c.events.push({ type: 'announce', text: `⏭️ 房主跳過了${TEAM_NAME[s.turn]}的回合。` });
      endTurn(c);
      return true;
    }
    case 'timeout': {
      if (action.id !== s.timers.phase) return false;
      const who = s.phase === 'clue' ? `${TEAM_NAME[s.turn]}隊長沒有給提示` : `${TEAM_NAME[s.turn]}猜牌時間到了`;
      c.events.push({ type: 'announce', text: `⌛ ${who}，換對方。` });
      endTurn(c);
      return true;
    }
  }
}

export function applyCodenames(state: CState | undefined, action: CAction, rng: Rng): Result {
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    }
    return createLobby(state, action.user, action.channel);
  }
  if (action.type === 'rematch') {
    if (!state) return { state: state!, events: [] };
    if (state.phase !== 'ended') return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    if (!state.winner) return { state, events: [] };
    if (isBot(action.user) || !state.players.some((p) => p.id === action.user)) {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '只有上一局的玩家可以開新的一局。' }] };
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
    guessed: 0,
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
