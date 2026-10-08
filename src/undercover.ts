// 誰是臥底遊戲引擎：純邏輯，不碰任何 I/O。介面和狼人殺一樣：applyUndercover(state, action, rng) → { state, events }。
// events 沿用狼人殺的 GameEvent，adapter 的 send() 可以共用。
import { randomBotName } from './botLines.js';
import { isBot, MAX_PLAYERS, mention, type GameEvent, type Rng } from './engine.js';
import { WORD_PAIRS } from './undercoverWords.js';

export const MIN_UNDERCOVER_PLAYERS = 4;
export const SPEECH_MS = 40_000;
export const VOTE_MS = 60_000;
export const GUESS_MS = 60_000;
const TITLE = '誰是臥底';

export type UPhase = 'lobby' | 'speech' | 'vote' | 'pkSpeech' | 'pkVote' | 'guess' | 'ended';
export type URole = 'civilian' | 'undercover' | 'blank';

export const ROLE_NAME_U: Record<URole, string> = { civilian: '平民', undercover: '臥底', blank: '白板' };

// 人數 → 各身分數量
export const UNDERCOVER_TABLE: Record<number, Record<URole, number>> = {
  4: { civilian: 3, undercover: 1, blank: 0 },
  5: { civilian: 4, undercover: 1, blank: 0 },
  6: { civilian: 4, undercover: 1, blank: 1 },
  7: { civilian: 5, undercover: 1, blank: 1 },
  8: { civilian: 6, undercover: 1, blank: 1 },
  9: { civilian: 6, undercover: 2, blank: 1 },
  10: { civilian: 7, undercover: 2, blank: 1 },
  11: { civilian: 8, undercover: 2, blank: 1 },
  12: { civilian: 9, undercover: 2, blank: 1 },
};

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
  words?: { civilian: string; undercover: string };
  round: number;
  speakers: string[]; // 還沒輪到的描述者
  speaker?: string;
  votes: Record<string, string>;
  candidates: string[];
  voters: string[];
}

export type UAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'endSpeech'; user: string }
  | { type: 'skipSpeaker'; user: string }
  | { type: 'endDiscussion'; user: string }
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

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 發牌：不洗牌時的順序是臥底、白板、平民
function deal(c: Ctx) {
  const s = c.s;
  const table = UNDERCOVER_TABLE[s.players.length];
  const roles = shuffle(
    (['undercover', 'blank', 'civilian'] as URole[]).flatMap((r) => Array<URole>(table[r]).fill(r)),
    c.rng,
  );
  const pair = WORD_PAIRS[Math.floor(c.rng() * WORD_PAIRS.length)];
  const [civilian, undercover] = c.rng() < 0.5 ? [pair.a.word, pair.b.word] : [pair.b.word, pair.a.word];
  s.words = { civilian, undercover };
  s.players.forEach((p, i) => {
    p.role = roles[i];
    p.word = p.role === 'civilian' ? civilian : p.role === 'undercover' ? undercover : undefined;
  });
  const setup = (['civilian', 'undercover', 'blank'] as URole[])
    .filter((r) => table[r])
    .map((r) => `${table[r]} ${ROLE_NAME_U[r]}`)
    .join('、');
  c.events.push({
    type: 'announce',
    text: `🎲 誰是臥底開始！玩家：${s.players.map((p) => mention(p.id)).join(' ')}\n身分配置：${setup}\n每個人的詞已經用私訊傳給大家，請到和 bot 的私訊查看。`,
    gif: 'start',
  });
  for (const p of s.players) {
    const text = p.word
      ? `你的詞是：${p.word}\n輪到你時，用一句話描述它，不要說得太明白。`
      : '你是白板，沒有拿到詞。\n仔細聽別人的描述，假裝自己也有詞；被投出去時還有一次猜詞的機會。';
    c.events.push({ type: 'dm', to: p.id, text });
  }
}

const alive = (s: UState) => s.players.filter((p) => p.alive);

function startTimer(c: Ctx, ms: number) {
  const id = ++c.s.timerSeq;
  c.s.timers = { phase: id };
  c.events.push({ type: 'startTimer', id, ms });
}

// 每一輪：隨機起點，依加入順序輪流描述
function startRound(c: Ctx) {
  const s = c.s;
  s.round += 1;
  const living = alive(s).map((p) => p.id);
  const first = Math.floor(c.rng() * living.length);
  s.phase = 'speech';
  s.speakers = [...living.slice(first), ...living.slice(0, first)];
  c.events.push({ type: 'announce', text: `💬 第 ${s.round} 輪描述，順序：${s.speakers.map(mention).join(' → ')}` });
  nextSpeaker(c);
}

function nextSpeaker(c: Ctx) {
  const s = c.s;
  s.timers = {};
  for (let id = s.speakers.shift(); id; id = s.speakers.shift()) {
    s.speaker = id;
    if (isBot(id)) {
      botDescribe(c, id);
      continue;
    }
    c.events.push({
      type: 'prompt',
      kind: 'endSpeech',
      audience: 'channel',
      text: `🎤 輪到 ${mention(id)} 描述（${SPEECH_MS / 1000} 秒）`,
      options: [{ value: id, label: '結束發言' }],
    });
    startTimer(c, SPEECH_MS);
    return;
  }
  s.speaker = undefined;
  startVote(c);
}

// 先放一句通用台詞，task 5.1 會改成依詞庫描述
function botDescribe(c: Ctx, id: string) {
  c.events.push({ type: 'announce', text: `${mention(id)}：……` });
}

function startVote(c: Ctx) {
  const s = c.s;
  const ids = alive(s).map((p) => p.id);
  s.phase = 'vote';
  s.votes = {};
  s.candidates = ids;
  s.voters = ids;
  c.events.push({
    type: 'prompt',
    kind: 'dayVote',
    audience: 'channel',
    text: '🗳️ 請投票選出臥底。',
    options: [...ids.map((id) => ({ value: id, label: id })), { value: 'abstain', label: '棄票' }],
  });
  startTimer(c, VOTE_MS);
}

const isSpeaking = (s: UState) => s.phase === 'speech' || s.phase === 'pkSpeech';

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
      c.events.push(lobbyEvent({ ...s, phase: 'speech' }));
      deal(c);
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
    case 'endSpeech': {
      if (!isSpeaking(s)) return false;
      if (action.user !== s.speaker) return reply(c, action.user, '現在不是你的發言時間。');
      nextSpeaker(c);
      return true;
    }
    case 'skipSpeaker': {
      if (!isSpeaking(s)) return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以跳過發言者。');
      nextSpeaker(c);
      return true;
    }
    case 'endDiscussion': {
      if (s.phase !== 'speech') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以直接進入投票。');
      startVote(c);
      return true;
    }
    case 'timeout': {
      if (action.id !== s.timers.phase) return false;
      if (isSpeaking(s)) nextSpeaker(c);
      else return false;
      return true;
    }
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
      round: 0,
      speakers: [],
      votes: {},
      candidates: [],
      voters: [],
    };
    return { state: created, events: [lobbyEvent(created)] };
  }
  if (!state || state.phase === 'ended') return { state: state!, events: [] };
  const c: Ctx = { s: structuredClone(state), events: [], rng };
  const changed = handle(c, action);
  return { state: changed ? c.s : state, events: c.events };
}
