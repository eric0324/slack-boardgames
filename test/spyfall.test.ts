import { describe, expect, it } from 'vitest';
import { mention, type GameEvent } from '../src/engine.js';
import { applySpyfall, type SAction, type SState } from '../src/spyfall.js';
import { LOCATIONS, QUESTIONS, SPY_ANSWERS } from '../src/spyfallLocations.js';

const rng = () => 0.99999;

function run(actions: SAction[], start?: SState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applySpyfall(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as SAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('spyfall/setup: 間諜危機的房間', () => {
  it('開房：公告標示間諜危機', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'spyfall', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '間諜危機', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 4 人不能開始', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(3).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 4 人') });
  });

  it('房間已滿（10 人）時拒絕加入', () => {
    const { state, events } = run([{ type: 'join', user: 'x' }], lobbyWith(10).state);
    expect(state.players).toHaveLength(10);
    expect(ephemeralTo(events, 'x')).toMatchObject({ text: expect.stringContaining('房間已滿') });
  });

  it('加入、離開、加減 bot、房主離開取消、房主取消', () => {
    const lobby = lobbyWith(3).state;
    expect(run([{ type: 'leave', user: 'p3' }], lobby).state.players).toHaveLength(2);
    const bots = run([{ type: 'addBot', user: 'p1', count: 3 }], lobby).state;
    expect(bots.players).toHaveLength(6);
    expect(run([{ type: 'removeBot', user: 'p1', count: 2 }], bots).state.players).toHaveLength(4);
    expect(run([{ type: 'leave', user: 'p1' }], lobby).state.phase).toBe('ended');
    expect(run([{ type: 'cancel', user: 'p1' }], lobby).state.phase).toBe('ended');
  });

  it('非房主不能開始；4 人以上房主可以開始，按鈕失效', () => {
    expect(ephemeralTo(run([{ type: 'start', user: 'p2' }], lobbyWith(4).state).events, 'p2')).toBeDefined();
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(4).state);
    expect(state.phase).not.toBe('lobby');
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
  });
});

// rng 固定時：間諜是最後一位玩家，地點是地點庫的最後一個
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);

describe('spyfall/setup: 發牌', () => {
  it('剛好 1 位間諜，其他人都是平民並有角色', () => {
    const { state } = started(6);
    expect(state.players.filter((p) => p.role === 'spy')).toHaveLength(1);
    const loc = LOCATIONS.find((l) => l.name === state.location)!;
    for (const p of state.players.filter((x) => x.role === 'civilian')) expect(loc.roles).toContain(p.job);
  });

  it('平民收到地點和角色', () => {
    const { state, events } = started(6);
    const civ = state.players.find((p) => p.role === 'civilian')!;
    expect(dmTo(events, civ.id)!.text).toContain(`地點：${state.location}`);
    expect(dmTo(events, civ.id)!.text).toContain(`你的角色：${civ.job}`);
  });

  it('間諜收到「你是間諜」和所有地點的清單，但不知道這局的地點', () => {
    const { state, events } = started(6);
    const spy = state.players.find((p) => p.role === 'spy')!;
    const text = dmTo(events, spy.id)!.text;
    expect(text).toContain('你是間諜，不知道地點');
    for (const l of LOCATIONS) expect(text).toContain(l.name);
    expect(text).not.toContain(`地點：${state.location}`);
  });

  it('平民比角色多時角色可以重複', () => {
    const { state } = started(10);
    expect(state.players.filter((p) => p.role === 'civilian').every((p) => p.job)).toBe(true);
  });

  it('頻道公告不洩漏地點和間諜，並提醒查看私訊', () => {
    const { state, events } = started(6);
    const text = announces(events).join('\n');
    expect(text).toContain('私訊');
    expect(text).toContain('1 位是間諜');
    expect(text).not.toContain(state.location!);
    const spy = state.players.find((p) => p.role === 'spy')!;
    expect(text).not.toMatch(new RegExp(`${mention(spy.id)}\\s*[:：]?\\s*(是)?\\s*間諜`));
  });

  it('間諜和地點是隨機的', () => {
    const a = started(6, () => 0).state;
    const b = started(6, () => 0.99999).state;
    expect(a.location).not.toBe(b.location);
    expect(a.players.findIndex((p) => p.role === 'spy')).not.toBe(b.players.findIndex((p) => p.role === 'spy'));
  });
});

const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const timers = (events: GameEvent[]) => events.filter((e) => e.type === 'startTimer') as { id: number; ms: number }[];
const timerOf = (events: GameEvent[], ms: number) => timers(events).filter((t) => t.ms === ms).at(-1)!;
const values = (p: { options: { value: string }[] }) => p.options.map((o) => o.value);

// 4 人局（p4 是間諜），rng 固定時第一位提問者是 p4
describe('spyfall/rounds: 接力提問', () => {
  it('提問開始：公告 8 分鐘，第一位提問者收到選人按鈕', () => {
    const { state, events } = started(4);
    expect(state).toMatchObject({ phase: 'qa', qa: { step: 'choose', asker: 'p4' } });
    expect(announces(events)).toContainEqual(expect.stringContaining('8 分鐘'));
    const p = prompts(events, 'askTarget').at(-1)!;
    expect(p).toMatchObject({ audience: 'channel', text: expect.stringContaining('輪到 <@p4> 提問') });
    expect(values(p)).toEqual(['p1', 'p2', 'p3']);
    expect(timerOf(events, 40_000)).toBeDefined();
    expect(timerOf(events, 7 * 60_000)).toBeDefined();
  });

  it('選人後公告誰問誰；回答完畢後換被問的人提問，不能反問剛剛問自己的人', () => {
    const asked = run([{ type: 'askTarget', user: 'p4', target: 'p2' }], started(4).state);
    expect(asked.state.qa).toMatchObject({ step: 'answer', asker: 'p4', target: 'p2' });
    const ans = prompts(asked.events, 'endAnswer').at(-1)!;
    expect(ans.text).toContain('🎤 <@p4> 問 <@p2>（40 秒）');
    expect(values(ans)).toEqual(['p2']);
    const next = run([{ type: 'endAnswer', user: 'p2' }], asked.state);
    expect(next.state.qa).toMatchObject({ step: 'choose', asker: 'p2' });
    expect(values(prompts(next.events, 'askTarget').at(-1)!)).toEqual(['p1', 'p3']);
  });

  it('只有提問者能選人，只有被問的人能按回答完畢', () => {
    const { state } = started(4);
    expect(ephemeralTo(run([{ type: 'askTarget', user: 'p1', target: 'p2' }], state).events, 'p1')).toBeDefined();
    const asked = run([{ type: 'askTarget', user: 'p4', target: 'p2' }], state).state;
    const denied = run([{ type: 'endAnswer', user: 'p3' }], asked);
    expect(denied.state.qa!.step).toBe('answer');
    expect(ephemeralTo(denied.events, 'p3')).toBeDefined();
  });

  it('提問者 40 秒沒選人：系統隨機選一位', () => {
    const { state, events } = started(4);
    const after = run([{ type: 'timeout', id: timerOf(events, 40_000).id }], state);
    expect(after.state.qa!.step).toBe('answer');
    expect(['p1', 'p2', 'p3']).toContain(after.state.qa!.target);
  });

  it('被問的人 40 秒到了就換人提問', () => {
    const asked = run([{ type: 'askTarget', user: 'p4', target: 'p2' }], started(4).state);
    const after = run([{ type: 'timeout', id: timerOf(asked.events, 40_000).id }], asked.state);
    expect(after.state.qa).toMatchObject({ step: 'choose', asker: 'p2' });
  });

  it('房主可以跳過卡住的步驟，也可以直接進入投票', () => {
    const { state } = started(4);
    expect(run([{ type: 'skipSpeaker', user: 'p1' }], state).state.qa!.step).toBe('answer');
    expect(run([{ type: 'endDiscussion', user: 'p1' }], state).state.phase).toBe('vote');
  });

  it('提問時間剩 1 分鐘時提醒，8 分鐘到了進入投票', () => {
    const { state, events } = started(4);
    const remind = run([{ type: 'timeout', id: timerOf(events, 7 * 60_000).id }], state);
    expect(announces(remind.events)).toContainEqual(expect.stringContaining('剩下 1 分鐘'));
    expect(remind.state.phase).toBe('qa');
    const end = run([{ type: 'timeout', id: timerOf(remind.events, 60_000).id }], remind.state);
    expect(end.state.phase).toBe('vote');
  });
});

const voting = () => run([{ type: 'endDiscussion', user: 'p1' }], started(4).state);
const votes = (pairs: [string, string][], s: SState) =>
  run(pairs.map(([user, target]) => ({ type: 'dayVote', user, target }) as SAction), s);

describe('spyfall/rounds: 投票與 PK', () => {
  it('進入投票：貼出所有玩家和棄票按鈕，60 秒', () => {
    const { state, events } = voting();
    expect(state.phase).toBe('vote');
    const p = prompts(events, 'dayVote').at(-1)!;
    expect(values(p)).toEqual(['p1', 'p2', 'p3', 'p4', 'abstain']);
    expect(timerOf(events, 60_000)).toBeDefined();
  });

  it('可以改票，全部投完立刻結束並公開每個人投給誰，得票最多的被指控', () => {
    const s = votes([['p1', 'p2'], ['p1', 'p3'], ['p2', 'p3'], ['p3', 'p1']], voting().state).state;
    expect(s.phase).toBe('vote');
    const { events } = votes([['p4', 'abstain']], s);
    const text = announces(events).join('\n');
    expect(text).toContain('<@p1> → <@p3>');
    expect(text).toContain('<@p4> → 棄票');
    expect(text).toContain('<@p3> 被指控');
  });

  it('不在遊戲裡的人不能投票', () => {
    const { state, events } = votes([['x', 'p1']], voting().state);
    expect(state.votes).toEqual({});
    expect(ephemeralTo(events, 'x')).toBeUndefined();
  });

  it('時間到沒投的算棄票', () => {
    const v = voting();
    const s = votes([['p1', 'p2']], v.state).state;
    const { events } = run([{ type: 'timeout', id: timerOf(v.events, 60_000).id }], s);
    expect(announces(events).join('\n')).toContain('<@p3> → 棄票');
    expect(announces(events).join('\n')).toContain('<@p2> 被指控');
  });

  it('平票進入 PK：依序辯解 40 秒，接著只能投平手的人，平手的人不能投', () => {
    const tie = votes([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p2'], ['p4', 'p3']], voting().state);
    expect(tie.state.phase).toBe('pkSpeech');
    const speech = prompts(tie.events, 'endSpeech').at(-1)!;
    expect(speech.text).toContain('<@p2>');
    expect(timerOf(tie.events, 40_000)).toBeDefined();
    const s1 = run([{ type: 'endSpeech', user: 'p2' }], tie.state);
    expect(prompts(s1.events, 'endSpeech').at(-1)!.text).toContain('<@p3>');
    const pk = run([{ type: 'endSpeech', user: 'p3' }], s1.state);
    expect(pk.state.phase).toBe('pkVote');
    expect(values(prompts(pk.events, 'pkVote').at(-1)!)).toEqual(['p2', 'p3', 'abstain']);
    expect(ephemeralTo(votes([['p2', 'p3']], pk.state).events, 'p2')).toMatchObject({ text: expect.stringContaining('PK') });
  });

  it('PK 仍然平手或全部棄票：沒有抓到間諜', () => {
    const tie = votes([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p2'], ['p4', 'p3']], voting().state).state;
    const pk = run([{ type: 'endSpeech', user: 'p2' }, { type: 'endSpeech', user: 'p3' }], tie).state;
    const { events } = votes([['p1', 'p2'], ['p4', 'p3']], pk);
    expect(announces(events).join('\n')).toContain('沒有抓到間諜');
    const none = votes([['p1', 'abstain'], ['p2', 'abstain'], ['p3', 'abstain'], ['p4', 'abstain']], voting().state);
    expect(announces(none.events).join('\n')).toContain('沒有抓到間諜');
  });
});

// 4 人局：p4 是間諜，地點是飯店
describe('spyfall/rounds: 間諜猜地點', () => {
  const guess = (user: string, location: string, s: SState) => run([{ type: 'guess', user, location }], s);

  it('間諜在提問中猜中（忽略前後空白）：間諜獲勝，遊戲結束', () => {
    const { state, events } = guess('p4', ' 飯店 ', started(4).state);
    expect(state.phase).toBe('ended');
    expect(announces(events).join('\n')).toContain('猜中');
  });

  it('比對忽略大小寫', () => {
    const s = { ...started(4).state, location: 'KTV包廂' };
    expect(announces(guess('p4', 'ktv包廂', s).events).join('\n')).toContain('猜中');
  });

  it('間諜在提問中猜錯：遊戲結束', () => {
    const { state, events } = guess('p4', '夜市', started(4).state);
    expect(state.phase).toBe('ended');
    expect(announces(events).join('\n')).toContain('猜錯');
  });

  it('平民、或不在可以猜的時間，不能猜地點', () => {
    const civ = guess('p1', '飯店', started(4).state);
    expect(civ.state.phase).toBe('qa');
    expect(ephemeralTo(civ.events, 'p1')).toMatchObject({ text: '現在不能猜地點' });
    const inVote = guess('p4', '飯店', voting().state);
    expect(inVote.state.phase).toBe('vote');
    expect(ephemeralTo(inVote.events, 'p4')).toMatchObject({ text: '現在不能猜地點' });
  });

  const accused = () => votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p4', 'p1']], voting().state);

  it('間諜被指控：公告抓到間諜，有 60 秒最後一次猜地點', () => {
    const { state, events } = accused();
    expect(state.phase).toBe('lastGuess');
    expect(announces(events).join('\n')).toContain('抓到間諜');
    expect(timerOf(events, 60_000)).toBeDefined();
    expect(announces(guess('p4', '飯店', state).events).join('\n')).toContain('猜中');
  });

  it('被指控的間諜 60 秒內沒猜：遊戲結束', () => {
    const { state, events } = accused();
    const after = run([{ type: 'timeout', id: timerOf(events, 60_000).id }], state);
    expect(after.state.phase).toBe('ended');
    expect(announces(after.events).join('\n')).toContain('沒有猜地點');
  });
});

describe('spyfall/win-condition: 勝負與結束公開', () => {
  const accuse = (target: string) =>
    votes(['p1', 'p2', 'p3', 'p4'].map((v) => [v, v === target ? 'abstain' : target] as [string, string]), voting().state);
  const lastAnnounce = (events: GameEvent[]) => announces(events).at(-1)!;

  it('指控錯人：公告是平民，間諜獲勝', () => {
    const { state, events } = accuse('p2');
    expect(state).toMatchObject({ phase: 'ended', winner: 'spy' });
    expect(announces(events).join('\n')).toContain('<@p2> 是平民');
    expect(lastAnnounce(events)).toContain('間諜獲勝');
  });

  it('沒有人被指控：間諜獲勝', () => {
    const none = votes(['p1', 'p2', 'p3', 'p4'].map((v) => [v, 'abstain'] as [string, string]), voting().state);
    expect(none.state.winner).toBe('spy');
  });

  it('抓到間諜且間諜猜錯或沒猜：平民獲勝；猜中：間諜獲勝', () => {
    const caught = accuse('p4').state;
    expect(run([{ type: 'guess', user: 'p4', location: '夜市' }], caught).state.winner).toBe('civilian');
    expect(run([{ type: 'guess', user: 'p4', location: '飯店' }], caught).state.winner).toBe('spy');
  });

  it('提問中主動猜：猜中間諜獲勝，猜錯平民獲勝', () => {
    expect(run([{ type: 'guess', user: 'p4', location: '飯店' }], started(4).state).state.winner).toBe('spy');
    expect(run([{ type: 'guess', user: 'p4', location: '夜市' }], started(4).state).state.winner).toBe('civilian');
  });

  it('結束時公開獲勝方、地點、間諜和每位平民的角色，並貼出再來一局', () => {
    const { state, events } = run([{ type: 'guess', user: 'p4', location: '夜市' }], started(4).state);
    const text = lastAnnounce(events);
    expect(text).toContain('平民獲勝');
    expect(text).toContain('地點：飯店');
    expect(text).toContain('間諜：<@p4>');
    for (const p of state.players.filter((x) => x.role === 'civilian')) expect(text).toContain(`<@${p.id}>：${p.job}`);
    expect(prompts(events, 'rematch')).toHaveLength(1);
  });

  it('再來一局：上一局的真人玩家可以開新房間，當房主；其他人不行；取消的遊戲不能', () => {
    const ended = run([{ type: 'guess', user: 'p4', location: '夜市' }], started(4).state).state;
    const again = run([{ type: 'rematch', user: 'p3', channel: 'C1' }], ended);
    expect(again.state).toMatchObject({ phase: 'lobby', host: 'p3', players: [{ id: 'p3' }] });
    expect(again.state.timerSeq).toBe(ended.timerSeq);
    expect(ephemeralTo(run([{ type: 'rematch', user: 'X', channel: 'C1' }], ended).events, 'X')).toBeDefined();
    const cancelled = run([{ type: 'cancel', user: 'p1' }], started(4).state).state;
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], cancelled).events).toEqual([]);
  });
});

// rng 固定為 0：p1（真人）是間諜、地點是公司尾牙、p1 先提問
const zero = () => 0;
const withBots = (bots = 3) => run([{ type: 'addBot', user: 'p1', count: bots }, { type: 'start', user: 'p1' }], lobbyWith(1).state, zero);
const botN = (s: SState, n: number) => s.players.find((p) => p.id.startsWith(`bot:${n}:`))!.id;
const botSays = (events: GameEvent[], id: string) =>
  announces(events).filter((t) => t.startsWith(`${mention(id)}：`)).map((t) => t.slice(`${mention(id)}：`.length));
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const hintsOf = (name: string) => LOCATIONS.find((l) => l.name === name)!.hints;

describe('spyfall/bots: bot 提問與回答', () => {
  it('平民 bot 被問時立刻用地點描述句回答，接著立刻替 bot 隨機問一位，問到真人就等真人回答', () => {
    const { state } = withBots();
    const bot1 = botN(state, 1);
    const { state: s, events } = run([{ type: 'askTarget', user: 'p1', target: bot1 }], state, zero);
    const lines = botSays(events, bot1);
    expect(lines.some((l) => hintsOf('公司尾牙').includes(l))).toBe(true);
    expect(lines.some((l) => QUESTIONS.includes(l))).toBe(true);
    for (const l of lines) expect(l).not.toContain('公司尾牙');
    expect(s.qa).toMatchObject({ step: 'answer', target: 'p1' });
    expect(prompts(events, 'endAnswer').at(-1)!.options).toEqual([{ value: 'p1', label: '回答完畢' }]);
  });

  it('間諜 bot 被問時用通用的模糊回答', () => {
    const { state } = withBots();
    const bot1 = botN(state, 1);
    const patched: SState = {
      ...state,
      players: state.players.map((p) => (p.id === bot1 ? { ...p, role: 'spy' } : p.id === 'p1' ? { ...p, role: 'civilian', job: '老闆' } : p)),
    };
    const lines = botSays(run([{ type: 'askTarget', user: 'p1', target: bot1 }], patched, zero).events, bot1);
    expect(lines.some((l) => SPY_ANSWERS.includes(l))).toBe(true);
  });

  it('同一位 bot 的回答盡量不重複', () => {
    const { state } = withBots();
    const bot1 = botN(state, 1);
    const first = run([{ type: 'askTarget', user: 'p1', target: bot1 }], state, zero);
    const again = run([{ type: 'askTarget', user: 'p1', target: bot1 }], { ...first.state, qa: { step: 'choose', asker: 'p1' } }, zero);
    expect(botSays(first.events, bot1)[0]).not.toBe(botSays(again.events, bot1)[0]);
  });
});

describe('spyfall/bots: bot 投票與猜地點', () => {
  it('進入投票時，每個 bot 立刻投給一位不是自己的玩家', () => {
    const vote = run([{ type: 'endDiscussion', user: 'p1' }], withBots().state, zero).state;
    for (const p of vote.players.filter((x) => x.id.startsWith('bot:'))) {
      expect(vote.votes[p.id]).toBeDefined();
      expect(vote.votes[p.id]).not.toBe(p.id);
      expect(vote.votes[p.id]).not.toBe('abstain');
    }
  });

  it('間諜 bot 被指控時立刻猜一個地點，遊戲結束', () => {
    const { state } = withBots();
    const bot1 = botN(state, 1);
    const patched: SState = {
      ...state,
      players: state.players.map((p) => (p.id === bot1 ? { ...p, role: 'spy' } : p.id === 'p1' ? { ...p, role: 'civilian', job: '老闆' } : p)),
    };
    const vote = run([{ type: 'endDiscussion', user: 'p1' }], patched, zero).state;
    const rigged: SState = { ...vote, votes: Object.fromEntries(Object.keys(vote.votes).map((v) => [v, v === bot1 ? 'p1' : bot1])) };
    const { state: end, events } = votes([['p1', bot1]], rigged);
    expect(announces(events).some((t) => t.includes(`${mention(bot1)} 猜「`))).toBe(true);
    expect(end.phase).toBe('ended');
  });

  it('1 位真人加 bot、真人什麼都不做，遊戲一定會結束，而且 bot 不會在提問中主動猜', () => {
    for (const bots of [3, 5, 9]) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = seeded(seed);
        let res = run([{ type: 'addBot', user: 'p1', count: bots }, { type: 'start', user: 'p1' }], lobbyWith(1).state, r);
        for (let step = 0; step < 500 && res.state.phase !== 'ended'; step++) {
          const t = res.state.timers;
          const id = step % 10 === 9 ? (t.total ?? t.remind ?? t.step) : (t.step ?? t.total ?? t.remind);
          const before = res.state.phase;
          res = applySpyfall(res.state, { type: 'timeout', id: id! }, r);
          if (before === 'qa') expect(announces(res.events).some((x) => x.includes('猜「'))).toBe(false);
        }
        expect(res.state.phase, `${bots} bots, seed ${seed}`).toBe('ended');
      }
    }
  });
});
