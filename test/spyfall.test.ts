import { describe, expect, it } from 'vitest';
import { mention, type GameEvent } from '../src/engine.js';
import { applySpyfall, type SAction, type SState } from '../src/spyfall.js';
import { LOCATIONS } from '../src/spyfallLocations.js';

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
