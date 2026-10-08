// 一字千金遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyJustOne(state, action, rng) → { state, events }。
import { CODENAMES_WORDS } from './codenamesWords.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';

export const MIN_JUSTONE_PLAYERS = 3;
export const MAX_JUSTONE_PLAYERS = 7;
const TITLE = '一字千金';
const DECK_SIZE = 13;
const CLUE_MS = 90_000;
const GUESS_MS = 90_000;

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
  clues: Record<string, string>;
  removed: string[]; // 這輪被刪掉的提示（回合結束時公開）
  finished?: boolean; // 牌堆用完正常結束（取消的遊戲沒有）
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
  | { type: 'clue'; user: string; word: string }
  | { type: 'guess'; user: string; word: string }
  | { type: 'skipGuess'; user: string }
  | { type: 'skipStep'; user: string }
  | { type: 'timeout'; id: number }
  | { type: 'rematch'; user: string; channel: string };

type GameAction = Exclude<JAction, { type: 'new' } | { type: 'rematch' }>;

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
  s.clues = {};
  const guesser = s.players[s.guesser].id;
  c.events.push({
    type: 'announce',
    text: `🃏 第 ${s.card} 張：${mention(guesser)} 猜詞\n其他人請看私訊的詞，用 \`/game justone clue <詞>\` 給一個提示（${CLUE_MS / 1000} 秒），重複的提示會被刪掉！`,
  });
  for (const p of s.players.filter((x) => x.id !== guesser)) {
    c.events.push({ type: 'dm', to: p.id, text: `🃏 第 ${s.card} 張的詞是「${s.word}」，${mention(guesser)} 要猜。用 \`/game justone clue <詞>\` 給一個提示。` });
  }
  startTimer(c, CLUE_MS);
}

function startTimer(c: Ctx, ms: number) {
  c.s.timers.phase = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id: c.s.timerSeq, ms });
}

const cluers = (s: JState) => s.players.filter((_, i) => i !== s.guesser).map((p) => p.id);

function giveClue(c: Ctx, user: string, word: string): boolean {
  const s = c.s;
  if (!s.players.some((p) => p.id === user)) return false;
  if (s.phase !== 'clue' || !cluers(s).includes(user)) return reply(c, user, '你現在不能給提示。');
  const w = word.trim();
  if (!w || /\s/.test(w)) return reply(c, user, '提示只能是一個詞（不能有空白）。');
  s.clues[user] = w;
  reply(c, user, `已收到你的提示「${w}」，在時間內可以重新輸入覆蓋。`);
  const done = Object.keys(s.clues).length;
  c.events.push({ type: 'announce', text: `✍️ 已收到 ${done}／${cluers(s).length} 個提示` });
  if (done === cluers(s).length) endClues(c);
  return true;
}

const normalize = (text: string) => text.trim().toLowerCase();

// 給提示結束：刪掉重複的和跟答案相同的提示，公開留下的提示
function endClues(c: Ctx) {
  const s = c.s;
  s.phase = 'guess';
  const entries = cluers(s)
    .filter((id) => s.clues[id] !== undefined)
    .map((id) => [id, s.clues[id]] as const);
  const count = new Map<string, number>();
  for (const [, w] of entries) count.set(normalize(w), (count.get(normalize(w)) ?? 0) + 1);
  const ok = (w: string) => count.get(normalize(w)) === 1 && normalize(w) !== normalize(s.word!);
  const kept = entries.filter(([, w]) => ok(w));
  s.removed = entries.filter(([, w]) => !ok(w)).map(([id, w]) => `${mention(id)}「${w}」`);
  const guesser = s.players[s.guesser].id;
  const shown = kept.length ? kept.map(([id, w]) => `${mention(id)}「${w}」`).join('、') : '沒有留下任何提示 😱';
  const removed = s.removed.length ? `\n（${s.removed.length} 個提示因為重複或和答案相同被刪掉）` : '';
  c.events.push(
    {
      type: 'announce',
      text: `💡 提示：${shown}${removed}\n${mention(guesser)} 請用 \`/game justone guess <詞>\` 猜一次，或按「跳過」（${GUESS_MS / 1000} 秒）`,
    },
    { type: 'prompt', kind: 'skipGuess', audience: 'channel', text: '沒把握的話可以跳過，只會丟掉這張牌', options: [{ value: guesser, label: '跳過' }] },
  );
  startTimer(c, GUESS_MS);
}

// 猜詞結果：猜對得分；跳過丟掉這張；猜錯再多丟一張（牌堆空了就丟一張得分的牌）
function finishGuess(c: Ctx, result: 'right' | 'skip' | 'wrong') {
  const s = c.s;
  const lines = [
    result === 'right' ? `🎉 猜對了！答案是「${s.word}」` : result === 'skip' ? `⏭️ 跳過，答案是「${s.word}」` : `❌ 猜錯了，答案是「${s.word}」`,
  ];
  if (result === 'right') s.score++;
  if (result === 'wrong') {
    if (s.deck.length) {
      s.deck.shift();
      lines.push('另外從牌堆多丟掉一張牌。');
    } else if (s.score > 0) {
      s.score--;
      lines.push('牌堆沒牌了，改成丟掉一張得分的牌。');
    }
  }
  if (s.removed.length) lines.push(`被刪掉的提示：${s.removed.join('、')}`);
  lines.push(`目前得分 ${s.score}，牌堆剩 ${s.deck.length} 張`);
  c.events.push({ type: 'announce', text: lines.join('\n') });
  s.guesser = (s.guesser + 1) % s.players.length;
  if (s.deck.length) startRound(c);
  else endGame(c);
}

// 官方評價
function rating(score: number) {
  if (score >= 13) return '完美！';
  if (score === 12) return '驚人！大家的默契太好了';
  if (score === 11) return '太厲害了！';
  if (score >= 9) return '很棒！';
  if (score >= 7) return '不錯，繼續加油';
  if (score >= 4) return '還可以，再多練習';
  return '再試一次吧';
}

function endGame(c: Ctx) {
  const s = c.s;
  s.phase = 'ended';
  s.timers = {};
  s.finished = true;
  c.events.push(
    { type: 'announce', text: `🏁 遊戲結束！大家一起猜對 ${s.score} 張，得分 ${s.score} 分：${rating(s.score)}`, gif: 'goodWin' },
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
    case 'clue':
      return giveClue(c, action.user, action.word);
    case 'guess': {
      if (s.phase !== 'guess' || action.user !== s.players[s.guesser].id) return reply(c, action.user, '現在不是你猜詞。');
      finishGuess(c, normalize(action.word) === normalize(s.word!) ? 'right' : 'wrong');
      return true;
    }
    case 'skipGuess': {
      if (s.phase !== 'guess' || action.user !== s.players[s.guesser].id) return reply(c, action.user, '只有猜詞的人可以跳過。');
      finishGuess(c, 'skip');
      return true;
    }
    case 'skipStep': {
      if (s.phase !== 'clue' && s.phase !== 'guess') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以跳過。');
      if (s.phase === 'clue') endClues(c);
      else finishGuess(c, 'skip');
      return true;
    }
    case 'timeout': {
      if (action.id !== s.timers.phase) return false;
      if (s.phase === 'clue') endClues(c);
      else if (s.phase === 'guess') finishGuess(c, 'skip');
      else return false;
      return true;
    }
  }
}

export function applyJustOne(state: JState | undefined, action: JAction, rng: Rng): Result {
  if (action.type === 'new') {
    if (state && state.phase !== 'ended') {
      return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    }
    return createLobby(state, action.user, action.channel);
  }
  if (action.type === 'rematch') {
    if (!state) return { state: state!, events: [] };
    if (state.phase !== 'ended') return { state, events: [{ type: 'ephemeral', to: action.user, text: '這個頻道已經有遊戲了。' }] };
    if (!state.finished) return { state, events: [] };
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
    clues: {},
    removed: [],
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
