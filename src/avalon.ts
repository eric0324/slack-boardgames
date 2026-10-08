// 阿瓦隆遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyAvalon(state, action, rng) → { state, events }。
import { randomBotName } from './botLines.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';

export const MIN_AVALON_PLAYERS = 5;
export const MAX_AVALON_PLAYERS = 10;
const TITLE = '阿瓦隆';
const SPEECH_MS = 40_000;
const MAX_REJECTS = 5;

// 人數 → 5 個任務的隊伍人數；7 人以上第 4 個任務要 2 張失敗票
const QUESTS: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export type APhase = 'lobby' | 'speech' | 'pick' | 'teamVote' | 'quest' | 'assassinate' | 'ended';

export type ARole = 'merlin' | 'percival' | 'loyal' | 'assassin' | 'morgana' | 'minion';

export interface APlayer {
  id: string;
  role?: ARole;
}

// 人數 → [好人, 壞人]
const TEAM_SIZES: Record<number, [number, number]> = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
const EVIL: ARole[] = ['assassin', 'morgana', 'minion'];
export const isEvil = (role?: ARole) => EVIL.includes(role!);

export interface AState {
  game: 'avalon';
  channel: string;
  host: string;
  phase: APhase;
  players: APlayer[];
  leader: number; // 隊長在 players 裡的位置
  quest: number; // 目前是第幾個任務（0 起算）
  results: ('success' | 'fail')[];
  rejects: number; // 這個任務連續被否決幾次
  speakers: string[];
  speaker?: string;
  timerSeq: number;
  timers: { phase?: number };
}

export type AAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'endSpeech'; user: string }
  | { type: 'skipSpeaker'; user: string }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<AAction, { type: 'new' }>;

interface Result {
  state: AState;
  events: GameEvent[];
}

interface Ctx {
  s: AState;
  events: GameEvent[];
  rng: Rng;
}

const lobbyEvent = (s: AState): GameEvent => ({
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

const list = (ids: string[]) => ids.map(mention).join('、');

const ROLE_INTRO: Record<ARole, string> = {
  merlin: '🧙 你是梅林（好人）。',
  percival: '🛡️ 你是派西維爾（好人）。',
  loyal: '⚔️ 你是忠臣（好人）。\n幫助好人完成 3 個任務。',
  assassin: '🗡️ 你是刺客（壞人）。',
  morgana: '🔮 你是莫甘娜（壞人）。',
  minion: '😈 你是爪牙（壞人）。',
};

// 發身分：依人數組出身分清單後洗牌，私訊每個人自己的身分和能看到的資訊
function deal(c: Ctx) {
  const s = c.s;
  const [good, evil] = TEAM_SIZES[s.players.length];
  const deck: ARole[] = [
    'merlin',
    'percival',
    ...Array<ARole>(good - 2).fill('loyal'),
    'assassin',
    'morgana',
    ...Array<ARole>(evil - 2).fill('minion'),
  ];
  const dealt = shuffle(deck, c.rng);
  s.players.forEach((p, i) => (p.role = dealt[i]));
  const evilIds = s.players.filter((p) => isEvil(p.role)).map((p) => p.id);
  const idsOf = (...rs: ARole[]) => s.players.filter((p) => rs.includes(p.role!)).map((p) => p.id);
  c.events.push({
    type: 'announce',
    text: `🏰 阿瓦隆開始！玩家：${list(s.players.map((p) => p.id))}\n好人 ${good} 位、壞人 ${evil} 位。身分已經用私訊傳給大家，請到和 bot 的私訊查看。`,
    gif: 'start',
  });
  for (const p of s.players) {
    const others = evilIds.filter((id) => id !== p.id);
    let extra = '';
    if (p.role === 'merlin') extra = `\n壞人是：${list(evilIds)}\n小心別讓壞人發現你是梅林，不然最後會被刺殺。`;
    else if (p.role === 'percival') extra = `\n${list(idsOf('merlin', 'morgana'))} 其中一位是梅林、另一位是莫甘娜。`;
    else if (isEvil(p.role)) extra = `\n你的同伴：${list(others)}`;
    if (p.role === 'assassin') extra += '\n好人完成 3 個任務時，你可以刺殺梅林翻盤。';
    if (p.role === 'morgana') extra += '\n派西維爾會把你和梅林搞混，好好利用。';
    c.events.push({ type: 'dm', to: p.id, text: ROLE_INTRO[p.role!] + extra });
  }
  c.events.push({ type: 'wolfChat', wolves: evilIds, text: `😈 這是壞人的私訊群組：${list(evilIds)}\n可以在這裡討論，好人看不到。` });
}

function startTimer(c: Ctx, ms: number) {
  c.s.timers.phase = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id: c.s.timerSeq, ms });
}

const teamSize = (s: AState) => QUESTS[s.players.length][s.quest];
const progress = (s: AState) =>
  Array.from({ length: 5 }, (_, i) => (s.results[i] === 'success' ? '✅' : s.results[i] === 'fail' ? '❌' : '⬜')).join('');

// 開始一次組隊：公告任務資訊，從隊長的下一位開始輪流發言，隊長最後
function startRound(c: Ctx) {
  const s = c.s;
  const n = s.players.length;
  const leader = s.players[s.leader].id;
  const twoFails = n >= 7 && s.quest === 3 ? '（需要 2 張失敗票才算失敗）' : '';
  c.events.push({
    type: 'announce',
    text: `📜 任務 ${s.quest + 1}／5：隊伍 ${teamSize(s)} 人${twoFails}，隊長 ${mention(leader)}\n任務進度：${progress(s)}　連續否決：${s.rejects}／${MAX_REJECTS}`,
  });
  s.phase = 'speech';
  s.speakers = Array.from({ length: n }, (_, i) => s.players[(s.leader + 1 + i) % n].id);
  nextSpeaker(c);
}

function nextSpeaker(c: Ctx) {
  const s = c.s;
  const id = s.speakers.shift();
  s.speaker = id;
  if (!id) {
    s.phase = 'pick';
    return;
  }
  c.events.push({
    type: 'prompt',
    kind: 'endSpeech',
    audience: 'channel',
    text: `🎤 輪到 ${mention(id)} 發言（${SPEECH_MS / 1000} 秒）`,
    options: [{ value: id, label: '結束發言' }],
  });
  startTimer(c, SPEECH_MS);
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
      if (s.players.length >= MAX_AVALON_PLAYERS) return reply(c, action.user, '房間已滿。');
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
    case 'addBot': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以加入 bot。');
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      const room = MAX_AVALON_PLAYERS - s.players.length;
      const bots = s.players.filter((p) => isBot(p.id)).length;
      const taken = new Set(s.players.filter((p) => isBot(p.id)).map((p) => p.id.split(':')[2]));
      for (let i = 1; i <= Math.min(action.count, room); i++) {
        const name = randomBotName(c.rng, taken);
        taken.add(name);
        s.players.push({ id: `bot:${bots + i}:${name}` });
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
      if (n < MIN_AVALON_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_AVALON_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'speech' }));
      deal(c);
      s.leader = Math.floor(c.rng() * n);
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
      if (s.phase !== 'speech') return false;
      if (action.user !== s.speaker) return reply(c, action.user, '現在不是你的發言時間。');
      nextSpeaker(c);
      return true;
    }
    case 'skipSpeaker': {
      if (s.phase !== 'speech') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以跳過發言者。');
      nextSpeaker(c);
      return true;
    }
    case 'timeout': {
      if (action.id !== s.timers.phase) return false;
      if (s.phase === 'speech') nextSpeaker(c);
      else return false;
      return true;
    }
  }
}

export function applyAvalon(state: AState | undefined, action: AAction, rng: Rng): Result {
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

function createLobby(prev: AState | undefined, host: string, channel: string): Result {
  const created: AState = {
    game: 'avalon',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host }],
    leader: 0,
    quest: 0,
    results: [],
    rejects: 0,
    speakers: [],
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
