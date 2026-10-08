// 間諜危機遊戲引擎：純邏輯，不碰任何 I/O。介面和誰是臥底一樣：applySpyfall(state, action, rng) → { state, events }。
import { randomBotName } from './botLines.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';
import { LOCATIONS } from './spyfallLocations.js';

export const MIN_SPYFALL_PLAYERS = 4;
export const MAX_SPYFALL_PLAYERS = 10;
const TITLE = '間諜危機';
const QA_MS = 8 * 60_000;
const REMIND_MS = 60_000;
const STEP_MS = 40_000;
const VOTE_MS = 60_000;

export type SPhase = 'lobby' | 'qa' | 'vote' | 'pkSpeech' | 'pkVote' | 'ended';

export interface SPlayer {
  id: string;
  alive: boolean;
  role?: 'spy' | 'civilian';
  job?: string; // 平民的角色
}

export interface SState {
  game: 'spyfall';
  channel: string;
  host: string;
  phase: SPhase;
  players: SPlayer[];
  location?: string;
  timerSeq: number;
  qa?: { step: 'choose' | 'answer'; asker: string; target?: string; lastAsker?: string };
  votes: Record<string, string>;
  candidates: string[];
  voters: string[];
  speakers: string[];
  speaker?: string;
  timers: { step?: number; remind?: number; total?: number };
}

export type SAction =
  | { type: 'new'; user: string; channel: string }
  | { type: 'join'; user: string }
  | { type: 'leave'; user: string }
  | { type: 'start'; user: string }
  | { type: 'cancel'; user: string }
  | { type: 'askTarget'; user: string; target: string }
  | { type: 'endAnswer'; user: string }
  | { type: 'skipSpeaker'; user: string }
  | { type: 'endDiscussion'; user: string }
  | { type: 'endSpeech'; user: string }
  | { type: 'dayVote'; user: string; target: string }
  | { type: 'addBot'; user: string; count: number }
  | { type: 'removeBot'; user: string; count: number }
  | { type: 'timeout'; id: number };

type GameAction = Exclude<SAction, { type: 'new' }>;

interface Result {
  state: SState;
  events: GameEvent[];
}

interface Ctx {
  s: SState;
  events: GameEvent[];
  rng: Rng;
}

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const lobbyEvent = (s: SState): GameEvent => ({
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

// 發牌：隨機一位間諜、抽一個地點，平民依序拿角色（人比角色多時重複）
function deal(c: Ctx) {
  const s = c.s;
  const spyIndex = Math.floor(c.rng() * s.players.length);
  const location = pick(LOCATIONS, c.rng);
  const jobs = shuffle(location.roles, c.rng);
  s.location = location.name;
  let k = 0;
  s.players.forEach((p, i) => {
    if (i === spyIndex) {
      p.role = 'spy';
    } else {
      p.role = 'civilian';
      p.job = jobs[k++ % jobs.length];
    }
  });
  c.events.push({
    type: 'announce',
    text: `🎲 間諜危機開始！玩家：${s.players.map((p) => mention(p.id)).join(' ')}\n共 ${s.players.length} 人，其中 1 位是間諜。地點和角色已經用私訊傳給大家，請到和 bot 的私訊查看。`,
    gif: 'start',
  });
  const list = LOCATIONS.map((l) => l.name).join('、');
  for (const p of s.players) {
    const text =
      p.role === 'spy'
        ? `🕵️ 你是間諜，不知道地點。\n聽大家的問答猜出地點，提問期間隨時可以用 \`/game spyfall guess <地點>\` 猜一次。\n可能的地點：${list}`
        : `📍 地點：${s.location}\n你的角色：${p.job}\n回答問題時別講太白，免得間諜猜到地點。`;
    c.events.push({ type: 'dm', to: p.id, text });
  }
}

function startTimer(c: Ctx, ms: number): number {
  const id = ++c.s.timerSeq;
  c.events.push({ type: 'startTimer', id, ms });
  return id;
}

// 提問階段：隨機第一位提問者，總時長 8 分鐘（剩 1 分鐘時提醒）
function startQa(c: Ctx) {
  const s = c.s;
  s.phase = 'qa';
  c.events.push({ type: 'announce', text: `⏱️ 提問開始！總共 ${QA_MS / 60_000} 分鐘，大家接力互相提問。` });
  s.timers.remind = startTimer(c, QA_MS - REMIND_MS);
  askNext(c, pick(s.players, c.rng).id, undefined);
}

// 可以被問的人：除了自己和剛剛問自己的人
const targetsOf = (s: SState) => s.players.map((p) => p.id).filter((id) => id !== s.qa!.asker && id !== s.qa!.lastAsker);

function askNext(c: Ctx, asker: string, lastAsker: string | undefined) {
  const s = c.s;
  s.qa = { step: 'choose', asker, lastAsker };
  c.events.push({
    type: 'prompt',
    kind: 'askTarget',
    audience: 'channel',
    text: `❓ 輪到 ${mention(asker)} 提問，選擇要問誰（${STEP_MS / 1000} 秒）`,
    options: targetsOf(s).map((id) => ({ value: id, label: id })),
  });
  s.timers.step = startTimer(c, STEP_MS);
}

function ask(c: Ctx, target: string) {
  const s = c.s;
  const qa = s.qa!;
  s.qa = { ...qa, step: 'answer', target };
  c.events.push({
    type: 'prompt',
    kind: 'endAnswer',
    audience: 'channel',
    text: `🎤 ${mention(qa.asker)} 問 ${mention(target)}（${STEP_MS / 1000} 秒）`,
    options: [{ value: target, label: '回答完畢' }],
  });
  s.timers.step = startTimer(c, STEP_MS);
}

// 推進卡住的步驟：還沒選人就隨機選，正在回答就換被問的人提問
function advance(c: Ctx) {
  const qa = c.s.qa!;
  if (qa.step === 'choose') ask(c, pick(targetsOf(c.s), c.rng));
  else askNext(c, qa.target!, qa.asker);
}

function startVote(c: Ctx) {
  const s = c.s;
  s.qa = undefined;
  s.timers = {};
  const ids = s.players.map((p) => p.id);
  openVote(c, 'vote', ids, ids);
}

function openVote(c: Ctx, phase: 'vote' | 'pkVote', candidates: string[], voters: string[]) {
  const s = c.s;
  s.phase = phase;
  s.votes = {};
  s.candidates = candidates;
  s.voters = voters;
  c.events.push({
    type: 'prompt',
    kind: phase === 'vote' ? 'dayVote' : 'pkVote',
    audience: 'channel',
    text: phase === 'vote' ? '🗳️ 提問結束！請投票指控你覺得是間諜的人。' : '⚔️ PK 投票：請在平票的玩家中選一位（PK 中的玩家不能投票）。',
    options: [...candidates.map((id) => ({ value: id, label: id })), { value: 'abstain', label: '棄票' }],
  });
  s.timers.step = startTimer(c, VOTE_MS);
}

function endVote(c: Ctx) {
  const s = c.s;
  const lines = s.voters.map((v) => {
    const t = s.votes[v] ?? 'abstain';
    return `${mention(v)} → ${t === 'abstain' ? '棄票' : mention(t)}`;
  });
  c.events.push({ type: 'announce', text: `🗳️ 投票結果：\n${lines.join('\n')}` });
  const tally = new Map<string, number>();
  for (const t of Object.values(s.votes)) if (t !== 'abstain') tally.set(t, (tally.get(t) ?? 0) + 1);
  const max = Math.max(0, ...tally.values());
  const top = [...tally].filter(([, k]) => k === max).map(([id]) => id);
  if (top.length > 1 && s.phase === 'vote') {
    startPk(c, top);
    return;
  }
  if (top.length !== 1) {
    c.events.push({ type: 'announce', text: '🤷 沒有人被指控，沒有抓到間諜。' });
    endGame(c);
    return;
  }
  accuse(c, top[0]);
}

function startPk(c: Ctx, tied: string[]) {
  const s = c.s;
  s.phase = 'pkSpeech';
  s.candidates = tied;
  s.speakers = s.players.map((p) => p.id).filter((id) => tied.includes(id));
  c.events.push({ type: 'announce', text: `⚔️ 平票！${tied.map(mention).join('、')} 進入 PK，依序辯解。`, gif: 'pk' });
  nextSpeaker(c);
}

function nextSpeaker(c: Ctx) {
  const s = c.s;
  const id = s.speakers.shift();
  if (!id) {
    s.speaker = undefined;
    const voters = s.players.map((p) => p.id).filter((v) => !s.candidates.includes(v));
    openVote(c, 'pkVote', s.candidates, voters);
    return;
  }
  s.speaker = id;
  c.events.push({
    type: 'prompt',
    kind: 'endSpeech',
    audience: 'channel',
    text: `🎤 輪到 ${mention(id)} 辯解（${STEP_MS / 1000} 秒）`,
    options: [{ value: id, label: '結束發言' }],
  });
  s.timers.step = startTimer(c, STEP_MS);
}

function accuse(c: Ctx, id: string) {
  c.events.push({ type: 'announce', text: `👉 ${mention(id)} 被指控！` });
  endGame(c);
}

function endGame(c: Ctx) {
  c.s.phase = 'ended';
  c.s.timers = {};
}

function handle(c: Ctx, action: GameAction): boolean {
  const s = c.s;
  switch (action.type) {
    case 'join': {
      if (s.phase !== 'lobby') return reply(c, action.user, '遊戲已經開始了。');
      if (s.players.some((p) => p.id === action.user)) return reply(c, action.user, '你已經在房間裡了。');
      if (s.players.length >= MAX_SPYFALL_PLAYERS) return reply(c, action.user, '房間已滿。');
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
      const room = MAX_SPYFALL_PLAYERS - s.players.length;
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
      if (n < MIN_SPYFALL_PLAYERS) return reply(c, action.user, `目前 ${n} 人，至少需要 ${MIN_SPYFALL_PLAYERS} 人才能開始。`);
      c.events.push(lobbyEvent({ ...s, phase: 'qa' }));
      deal(c);
      startQa(c);
      return true;
    }
    case 'cancel': {
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以取消遊戲。');
      s.phase = 'ended';
      s.timers = {};
      c.events.push({ type: 'announce', text: '🛑 房主已取消遊戲。' });
      return true;
    }
    case 'askTarget': {
      if (s.phase !== 'qa' || s.qa!.step !== 'choose') return false;
      if (action.user !== s.qa!.asker) return reply(c, action.user, '現在不是你提問。');
      if (!targetsOf(s).includes(action.target)) return false;
      ask(c, action.target);
      return true;
    }
    case 'endAnswer': {
      if (s.phase !== 'qa' || s.qa!.step !== 'answer') return false;
      if (action.user !== s.qa!.target) return reply(c, action.user, '現在不是你回答。');
      advance(c);
      return true;
    }
    case 'skipSpeaker': {
      if (s.phase !== 'qa') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以跳過。');
      advance(c);
      return true;
    }
    case 'endDiscussion': {
      if (s.phase !== 'qa') return false;
      if (action.user !== s.host) return reply(c, action.user, '只有房主可以直接進入投票。');
      startVote(c);
      return true;
    }
    case 'endSpeech': {
      if (s.phase !== 'pkSpeech') return false;
      if (action.user !== s.speaker) return reply(c, action.user, '現在不是你的發言時間。');
      nextSpeaker(c);
      return true;
    }
    case 'dayVote': {
      if (s.phase !== 'vote' && s.phase !== 'pkVote') return false;
      if (!s.players.some((p) => p.id === action.user)) return false;
      if (!s.voters.includes(action.user)) return reply(c, action.user, 'PK 中的玩家不能投票。');
      if (action.target !== 'abstain' && !s.candidates.includes(action.target)) return false;
      s.votes[action.user] = action.target;
      const choice = action.target === 'abstain' ? '你選擇棄票。' : `你投給了 ${mention(action.target)}。`;
      c.events.push({ type: 'ephemeral', to: action.user, text: choice });
      if (s.voters.every((v) => s.votes[v])) endVote(c);
      return true;
    }
    case 'timeout': {
      if (action.id !== s.timers.step && action.id !== s.timers.remind && action.id !== s.timers.total) return false;
      if (s.phase === 'vote' || s.phase === 'pkVote') endVote(c);
      else if (s.phase === 'pkSpeech') nextSpeaker(c);
      else if (s.phase === 'qa' && action.id === s.timers.step) advance(c);
      else if (s.phase === 'qa' && action.id === s.timers.remind) {
        c.events.push({ type: 'announce', text: '⏰ 提問時間剩下 1 分鐘！' });
        s.timers.remind = undefined;
        s.timers.total = startTimer(c, REMIND_MS);
      } else if (s.phase === 'qa' && action.id === s.timers.total) startVote(c);
      else return false;
      return true;
    }
  }
}

export function applySpyfall(state: SState | undefined, action: SAction, rng: Rng): Result {
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

function createLobby(prev: SState | undefined, host: string, channel: string): Result {
  const created: SState = {
    game: 'spyfall',
    channel,
    host,
    phase: 'lobby',
    players: [{ id: host, alive: true }],
    timerSeq: prev?.timerSeq ?? 0,
    votes: {},
    candidates: [],
    voters: [],
    speakers: [],
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
