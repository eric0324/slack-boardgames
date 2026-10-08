import { describe, expect, it } from 'vitest';
import { type GameEvent } from '../src/engine.js';
import { applyLiarsDice, type LAction, type LState } from '../src/liarsdice.js';

const rng = () => 0.99999;

function run(actions: LAction[], start?: LState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyLiarsDice(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as LAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('liarsdice/setup: 吹牛骰的房間', () => {
  it('開房：公告標示吹牛骰', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'liarsdice', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '吹牛骰', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 2 人不能開始', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(1).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 2 人') });
  });

  it('房間已滿（8 人）時拒絕加入', () => {
    const { state, events } = run([{ type: 'join', user: 'x' }], lobbyWith(8).state);
    expect(state.players).toHaveLength(8);
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

  it('非房主不能開始；2 人以上房主可以開始，按鈕失效', () => {
    expect(ephemeralTo(run([{ type: 'start', user: 'p2' }], lobbyWith(2).state).events, 'p2')).toBeDefined();
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(2).state);
    expect(state.phase).not.toBe('lobby');
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
  });
});

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
// rng 固定為 0.99999：擲出來全是 6，第一位是最後一位玩家
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);

describe('liarsdice/setup: 骰子', () => {
  it('每人 5 顆骰子，私訊自己的點數', () => {
    const { state, events } = started(3);
    for (const p of state.players) {
      expect(p.dice).toHaveLength(5);
      expect(p.dice.every((d) => d >= 1 && d <= 6)).toBe(true);
      expect(dmTo(events, p.id)!.text).toContain(p.dice.map((d) => FACES[d - 1]).join(' '));
    }
  });

  it('頻道只公告每人剩幾顆和全場總數，不洩漏點數', () => {
    const text = announces(started(3).events).join('\n');
    expect(text).toContain('<@p1> 5 顆');
    expect(text).toContain('全場 15 顆');
    for (const f of FACES) expect(text).not.toContain(f);
  });

  it('擲骰是隨機的', () => {
    expect(started(2, () => 0).state.players[0].dice).not.toEqual(started(2).state.players[0].dice);
  });
});

const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const lastTimer = (events: GameEvent[]) => (events.filter((e) => e.type === 'startTimer') as { id: number; ms: number }[]).at(-1)!;
const bid = (user: string, quantity: number, face: number, s: LState) => run([{ type: 'bid', user, quantity, face }], s);

// 3 人局：第一位是 p3，接著 p1、p2
describe('liarsdice/rounds: 喊數', () => {
  it('輪到的人收到提示，60 秒；這輪還沒人喊時沒有「開！」', () => {
    const { state, events } = started(3);
    expect(state.turn).toBe(2);
    expect(announces(events).at(-1)).toContain('輪到 <@p3> 喊數');
    expect(prompts(events, 'challenge')).toEqual([]);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('喊數成立：公告、輪到下一位，下一位有「開！」按鈕', () => {
    const { state, events } = bid('p3', 3, 5, started(3).state);
    expect(state).toMatchObject({ turn: 0, bid: { quantity: 3, face: 5, by: 'p3' } });
    expect(announces(events)).toContainEqual(expect.stringContaining('<@p3> 喊：「3 個 5」'));
    const p = prompts(events, 'challenge').at(-1)!;
    expect(p.text).toContain('<@p1>');
    expect(p.options).toEqual([{ value: 'p1', label: '開！' }]);
  });

  it('要喊得更大：數量更多，或數量相同點數更大（1 最大）', () => {
    const s = bid('p3', 3, 5, started(3).state).state;
    for (const [q, f] of [[3, 4], [2, 6], [3, 5]]) {
      const res = bid('p1', q, f, s);
      expect(res.state.bid).toMatchObject({ by: 'p3' });
      expect(ephemeralTo(res.events, 'p1')).toMatchObject({ text: expect.stringContaining('更大') });
    }
    expect(bid('p1', 3, 6, s).state.bid).toMatchObject({ by: 'p1' });
    expect(bid('p1', 3, 1, s).state.bid).toMatchObject({ by: 'p1' });
    expect(bid('p1', 4, 2, s).state.bid).toMatchObject({ by: 'p1' });
    const ones = bid('p1', 3, 1, s).state;
    expect(ephemeralTo(bid('p2', 3, 6, ones).events, 'p2')).toBeDefined();
  });

  it('點數 1～6、數量至少 1；不是輪到的人不能喊', () => {
    const s = started(3).state;
    for (const [q, f] of [[1, 7], [1, 0], [0, 3]]) expect(ephemeralTo(bid('p3', q, f, s).events, 'p3')).toBeDefined();
    const res = bid('p1', 1, 3, s);
    expect(res.state.bid).toBeUndefined();
    expect(ephemeralTo(res.events, 'p1')).toMatchObject({ text: expect.stringContaining('還沒輪到你') });
  });

  it('這輪第一位超時：自動喊「1 個 2」', () => {
    const { state, events } = started(3);
    const after = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(after.state.bid).toEqual({ quantity: 1, face: 2, by: 'p3' });
  });
});
