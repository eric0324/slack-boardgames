// 阿瓦隆遊戲引擎：純邏輯，不碰任何 I/O。介面和其他遊戲一樣：applyAvalon(state, action, rng) → { state, events }。
import { randomBotName } from './botLines.js';
import { isBot, mention, type GameEvent, type Rng } from './engine.js';

export const MIN_AVALON_PLAYERS = 5;
export const MAX_AVALON_PLAYERS = 10;
const TITLE = '阿瓦隆';
const SPEECH_MS = 40_000;
const PICK_MS = 90_000;
const VOTE_MS = 60_000;
const QUEST_MS = 60_000;
const ASSASSIN_MS = 60_000;
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

// bot 發言用的通用台詞
export const AVALON_BOT_LINES = [
  '我是好人，請相信我。',
  '我覺得上一隊怪怪的，大家多注意一下。',
  '這輪我想看隊長怎麼選人。',
  '投票結果很有參考價值，大家回頭看看。',
  '我沒有什麼特別的資訊，先聽大家說。',
  '如果任務失敗，隊伍裡一定有壞人。',
  '有人一直在反對，我覺得有點可疑。',
  '我願意出任務，選我就對了。',
  '先不要急著下結論。',
  '這局好人要團結一點。',
];

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
  team: string[];
  votes: Record<string, 'approve' | 'reject'>;
  cards: Record<string, 'success' | 'fail'>;
  speakers: string[];
  speaker?: string;
  winner?: 'good' | 'evil';
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
  | { type: 'pickMember'; user: string; target: string }
  | { type: 'confirmTeam'; user: string }
  | { type: 'teamVote'; user: string; vote: 'approve' | 'reject' }
  | { type: 'quest'; user: string; card: 'success' | 'fail' }
  | { type: 'assassinate'; user: string; target: string }
  | { type: 'timeout'; id: number }
  | { type: 'rematch'; user: string; channel: string };

type GameAction = Exclude<AAction, { type: 'new' } | { type: 'rematch' }>;

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

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

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
  let id = s.speakers.shift();
  while (id && isBot(id)) {
    c.events.push({ type: 'announce', text: `${mention(id)}：${pick(AVALON_BOT_LINES, c.rng)}` });
    id = s.speakers.shift();
  }
  s.speaker = id;
  if (!id) {
    startPick(c);
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

const leaderOf = (s: AState) => s.players[s.leader].id;

function startPick(c: Ctx) {
  const s = c.s;
  s.phase = 'pick';
  s.team = [];
  c.events.push(
    {
      type: 'prompt',
      kind: 'pickMember',
      audience: 'channel',
      text: `👑 ${mention(leaderOf(s))} 請選 ${teamSize(s)} 位隊員（${PICK_MS / 1000} 秒）：按一下加入、再按一下移除`,
      options: s.players.map((p) => ({ value: p.id, label: p.id })),
    },
    { type: 'prompt', kind: 'confirmTeam', audience: 'channel', text: '選好後按「確認隊伍」', options: [{ value: 'confirm', label: '確認隊伍' }] },
  );
  startTimer(c, PICK_MS);
}

function submitTeam(c: Ctx) {
  const s = c.s;
  s.team = s.players.map((p) => p.id).filter((id) => s.team.includes(id));
  c.events.push({ type: 'announce', text: `🛡️ ${mention(leaderOf(s))} 提出的隊伍：${list(s.team)}` });
  s.phase = 'teamVote';
  s.votes = {};
  c.events.push({
    type: 'prompt',
    kind: 'teamVote',
    audience: 'channel',
    text: `🗳️ 同意這支隊伍出任務嗎？所有人都要投（${VOTE_MS / 1000} 秒，沒投的算贊成）`,
    options: [
      { value: 'approve', label: '👍 贊成' },
      { value: 'reject', label: '👎 反對' },
    ],
  });
  startTimer(c, VOTE_MS);
}

// 組隊投票結束：公開每個人的票，過半通過就出任務，否則換下一位隊長
function endTeamVote(c: Ctx) {
  const s = c.s;
  const votes = s.players.map((p) => [p.id, s.votes[p.id] ?? 'approve'] as const);
  const lines = votes.map(([id, v]) => `${mention(id)} → ${v === 'approve' ? '👍 贊成' : '👎 反對'}`);
  const approvals = votes.filter(([, v]) => v === 'approve').length;
  c.events.push({ type: 'announce', text: `🗳️ 投票結果：\n${lines.join('\n')}` });
  if (approvals * 2 > s.players.length) {
    s.rejects = 0;
    c.events.push({ type: 'announce', text: `✅ 隊伍通過（${approvals} 票贊成），${list(s.team)} 出任務！請到私訊選擇任務結果。` });
    startQuest(c);
    return;
  }
  s.rejects++;
  c.events.push({ type: 'announce', text: `❌ 隊伍被否決（${approvals} 票贊成），連續否決 ${s.rejects}／${MAX_REJECTS}。` });
  if (s.rejects >= MAX_REJECTS) {
    c.events.push({ type: 'announce', text: `😈 連續 ${MAX_REJECTS} 次組隊都沒通過，王國陷入混亂！` });
    endGame(c, 'evil');
    return;
  }
  nextLeader(c);
}

// 出任務：私訊每位隊員，好人只能出成功
function startQuest(c: Ctx) {
  const s = c.s;
  s.phase = 'quest';
  s.cards = {};
  for (const id of s.team) {
    const evil = isEvil(s.players.find((p) => p.id === id)!.role);
    c.events.push({
      type: 'prompt',
      kind: 'quest',
      audience: 'user',
      user: id,
      text: `⚔️ 任務 ${s.quest + 1}：請選擇任務結果（${QUEST_MS / 1000} 秒，沒選的算成功）`,
      options: [{ value: 'success', label: '✅ 成功' }, ...(evil ? [{ value: 'fail', label: '❌ 失敗' }] : [])],
    });
  }
  startTimer(c, QUEST_MS);
}

// 任務結束：只公開失敗票數；7 人以上第 4 個任務要 2 張失敗票才失敗
function endQuest(c: Ctx) {
  const s = c.s;
  const fails = s.team.filter((id) => s.cards[id] === 'fail').length;
  const needed = s.players.length >= 7 && s.quest === 3 ? 2 : 1;
  const result = fails >= needed ? 'fail' : 'success';
  s.results.push(result);
  c.events.push({
    type: 'announce',
    text: `${result === 'success' ? '🎉' : '💥'} 任務 ${s.quest + 1} ${result === 'success' ? '成功' : '失敗'}（${fails} 張失敗票）`,
  });
  s.quest++;
  const count = (r: string) => s.results.filter((x) => x === r).length;
  if (count('fail') >= 3) endGame(c, 'evil');
  else if (count('success') >= 3) startAssassination(c);
  else nextLeader(c);
}

// 好人完成 3 個任務：公開壞人，刺客可以刺殺梅林
function startAssassination(c: Ctx) {
  const s = c.s;
  s.phase = 'assassinate';
  s.timers = {};
  const evilIds = s.players.filter((p) => isEvil(p.role)).map((p) => p.id);
  c.events.push({
    type: 'announce',
    text: `🗡️ 好人完成了 3 個任務！但壞人還有最後機會：壞人是 ${list(evilIds)}，刺客正在和同伴討論要刺殺誰，刺中梅林壞人就逆轉獲勝。`,
  });
  c.events.push({
    type: 'prompt',
    kind: 'assassinate',
    audience: 'wolves',
    text: `🗡️ ${mention(roleHolder(s, 'assassin'))} 請選擇要刺殺的人（${ASSASSIN_MS / 1000} 秒），大家可以先在這裡討論誰是梅林`,
    options: goodIds(s).map((id) => ({ value: id, label: id })),
  });
  startTimer(c, ASSASSIN_MS);
}

const roleHolder = (s: AState, role: ARole) => s.players.find((p) => p.role === role)!.id;
const goodIds = (s: AState) => s.players.filter((p) => !isEvil(p.role)).map((p) => p.id);

function assassinate(c: Ctx, target: string) {
  const s = c.s;
  const assassin = mention(roleHolder(s, 'assassin'));
  if (target === roleHolder(s, 'merlin')) {
    c.events.push({ type: 'announce', text: `🎯 刺客 ${assassin} 刺殺了 ${mention(target)}——刺中梅林了！` });
    endGame(c, 'evil');
  } else {
    c.events.push({ type: 'announce', text: `😮 刺客 ${assassin} 刺殺了 ${mention(target)}，但 ${mention(target)} 不是梅林！` });
    endGame(c, 'good');
  }
}

const ROLE_NAME: Record<ARole, string> = {
  merlin: '梅林',
  percival: '派西維爾',
  loyal: '忠臣',
  assassin: '刺客',
  morgana: '莫甘娜',
  minion: '爪牙',
};

// 結束：公開獲勝陣營、每個人的身分和任務結果
function endGame(c: Ctx, winner: 'good' | 'evil') {
  const s = c.s;
  s.phase = 'ended';
  s.timers = {};
  s.winner = winner;
  const title = winner === 'good' ? '🎉 遊戲結束，好人獲勝！' : '😈 遊戲結束，壞人獲勝！';
  const roster = s.players.map((p) => `${mention(p.id)}：${ROLE_NAME[p.role!]}`).join('\n');
  c.events.push(
    { type: 'announce', text: `${title}\n任務結果：${progress(s)}\n${roster}`, gif: winner === 'good' ? 'goodWin' : 'wolvesWin' },
    { type: 'prompt', kind: 'rematch', audience: 'channel', text: '要再來一局嗎？', options: [{ value: 'rematch', label: '再來一局' }] },
  );
}

function nextLeader(c: Ctx) {
  c.s.leader = (c.s.leader + 1) % c.s.players.length;
  startRound(c);
}

// 找出下一個輪到 bot 的行動
function nextBotAction(s: AState, rng: Rng): GameAction | null {
  const roleOf = (id: string) => s.players.find((p) => p.id === id)!.role;
  if (s.phase === 'pick') {
    const leader = leaderOf(s);
    if (!isBot(leader)) return null;
    if (s.team.length >= teamSize(s)) return { type: 'confirmTeam', user: leader };
    if (isEvil(roleOf(leader)) && !s.team.includes(leader)) return { type: 'pickMember', user: leader, target: leader };
    const rest = s.players.map((p) => p.id).filter((id) => !s.team.includes(id));
    return { type: 'pickMember', user: leader, target: pick(rest, rng) };
  }
  if (s.phase === 'teamVote') {
    const voter = s.players.find((p) => isBot(p.id) && !s.votes[p.id]);
    if (voter) return { type: 'teamVote', user: voter.id, vote: s.team.includes(voter.id) || rng() < 0.5 ? 'approve' : 'reject' };
  }
  if (s.phase === 'quest') {
    const member = s.team.find((id) => isBot(id) && !s.cards[id]);
    if (member) return { type: 'quest', user: member, card: isEvil(roleOf(member)) ? 'fail' : 'success' };
  }
  if (s.phase === 'assassinate') {
    const assassin = roleHolder(s, 'assassin');
    if (isBot(assassin)) return { type: 'assassinate', user: assassin, target: pick(goodIds(s), rng) };
  }
  return null;
}

function runBots(c: Ctx) {
  for (let i = 0; i < 1000; i++) {
    const action = nextBotAction(c.s, c.rng);
    if (!action || !handle(c, action)) return;
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
    case 'pickMember': {
      if (s.phase !== 'pick') return false;
      if (action.user !== leaderOf(s)) return reply(c, action.user, '只有隊長可以選隊員。');
      if (!s.players.some((p) => p.id === action.target)) return false;
      if (s.team.includes(action.target)) s.team = s.team.filter((id) => id !== action.target);
      else if (s.team.length >= teamSize(s)) return reply(c, action.user, `隊伍已經滿了（${teamSize(s)} 人），要換人請先移除。`);
      else s.team.push(action.target);
      reply(c, action.user, `目前隊伍（${s.team.length}／${teamSize(s)}）：${s.team.length ? list(s.team) : '還沒有人'}`);
      return true;
    }
    case 'confirmTeam': {
      if (s.phase !== 'pick') return false;
      if (action.user !== leaderOf(s)) return reply(c, action.user, '只有隊長可以確認隊伍。');
      const missing = teamSize(s) - s.team.length;
      if (missing > 0) return reply(c, action.user, `隊伍還差 ${missing} 人。`);
      submitTeam(c);
      return true;
    }
    case 'teamVote': {
      if (s.phase !== 'teamVote' || !s.players.some((p) => p.id === action.user)) return false;
      s.votes[action.user] = action.vote;
      reply(c, action.user, action.vote === 'approve' ? '你投了贊成。' : '你投了反對。');
      if (s.players.every((p) => s.votes[p.id])) endTeamVote(c);
      return true;
    }
    case 'quest': {
      if (s.phase !== 'quest') return false;
      if (!s.team.includes(action.user)) return reply(c, action.user, '你不在這次任務的隊伍裡。');
      if (s.cards[action.user]) return reply(c, action.user, '你已經出過任務了。');
      if (action.card === 'fail' && !isEvil(s.players.find((p) => p.id === action.user)!.role)) return false;
      s.cards[action.user] = action.card;
      reply(c, action.user, action.card === 'success' ? '你出了 ✅ 成功。' : '你出了 ❌ 失敗。');
      if (s.team.every((id) => s.cards[id])) endQuest(c);
      return true;
    }
    case 'assassinate': {
      if (s.phase !== 'assassinate') return false;
      if (action.user !== roleHolder(s, 'assassin')) return reply(c, action.user, '只有刺客可以決定要刺殺誰。');
      if (!goodIds(s).includes(action.target)) return false;
      assassinate(c, action.target);
      return true;
    }
    case 'timeout': {
      if (action.id !== s.timers.phase) return false;
      if (s.phase === 'assassinate') {
        assassinate(c, goodIds(s)[Math.floor(c.rng() * goodIds(s).length)]);
        return true;
      }
      if (s.phase === 'quest') {
        endQuest(c);
        return true;
      }
      if (s.phase === 'teamVote') {
        endTeamVote(c);
        return true;
      }
      if (s.phase === 'speech') nextSpeaker(c);
      else if (s.phase === 'pick') {
        const rest = shuffle(s.players.map((p) => p.id).filter((id) => !s.team.includes(id)), c.rng);
        s.team.push(...rest.slice(0, teamSize(s) - s.team.length));
        submitTeam(c);
      }
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
  if (changed) runBots(c);
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
    team: [],
    votes: {},
    cards: {},
    speakers: [],
    timerSeq: prev?.timerSeq ?? 0,
    timers: {},
  };
  return { state: created, events: [lobbyEvent(created)] };
}
