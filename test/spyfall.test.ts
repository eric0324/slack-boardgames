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
