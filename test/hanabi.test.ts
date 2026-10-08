import { describe, expect, it } from 'vitest';
import { type GameEvent } from '../src/engine.js';
import { applyHanabi, type HAction, type HState } from '../src/hanabi.js';

const rng = () => 0.99999;

function run(actions: HAction[], start?: HState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyHanabi(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as HAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('hanabi/setup: 花火的房間', () => {
  it('開房：公告標示花火', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'hanabi', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '花火', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 2 人不能開始；5 人滿', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(1).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 2 人') });
    const full = run([{ type: 'join', user: 'x' }], lobbyWith(5).state);
    expect(full.state.players).toHaveLength(5);
    expect(ephemeralTo(full.events, 'x')).toMatchObject({ text: expect.stringContaining('房間已滿') });
  });

  it('不支援 bot', () => {
    expect(ephemeralTo(run([{ type: 'addBot', user: 'p1', count: 1 }], lobbyWith(2).state).events, 'p1')).toMatchObject({
      text: '花火不支援 bot。',
    });
  });

  it('加入、離開、房主離開取消、房主取消；非房主不能開始', () => {
    const lobby = lobbyWith(3).state;
    expect(run([{ type: 'leave', user: 'p3' }], lobby).state.players).toHaveLength(2);
    expect(run([{ type: 'leave', user: 'p1' }], lobby).state.phase).toBe('ended');
    expect(run([{ type: 'cancel', user: 'p1' }], lobby).state.phase).toBe('ended');
    expect(ephemeralTo(run([{ type: 'start', user: 'p2' }], lobby).events, 'p2')).toBeDefined();
  });
});

// rng 固定時不洗牌：牌堆依紅、黃、綠、藍、白排列，每色 1 1 1 2 2 3 3 4 4 5，依序發給 p1、p2…；第一位是最後一位玩家
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);
const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const values = (p: { options: { value: string }[] }) => p.options.map((o) => o.value);

describe('hanabi/setup: 牌堆與發牌', () => {
  it('50 張牌：每色 1×3、2×2、3×2、4×2、5×1', () => {
    const { state } = started(2);
    const all = [...state.deck, ...state.players.flatMap((p) => p.hand)];
    expect(all).toHaveLength(50);
    for (const color of ['red', 'yellow', 'green', 'blue', 'white']) {
      const nums = all.filter((x) => x.color === color).map((x) => x.n).sort();
      expect(nums).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    }
  });

  it('2～3 人每人 5 張、4～5 人每人 4 張；提示 8、失誤 0', () => {
    expect(started(2).state.players[0].hand).toHaveLength(5);
    expect(started(3).state.deck).toHaveLength(35);
    const four = started(4).state;
    expect(four.players[0].hand).toHaveLength(4);
    expect(four.deck).toHaveLength(34);
    expect(four).toMatchObject({ hints: 8, fuses: 0 });
  });

  it('第一位是隨機的', () => {
    expect(started(3).state.turn).toBe(2);
    expect(started(3, () => 0).state.turn).toBe(0);
  });
});

describe('hanabi/setup: 看牌', () => {
  it('回合公告煙火進度、提示、失誤、牌堆，附上看牌和出牌、棄牌按鈕', () => {
    const { events } = started(2);
    const text = announces(events).at(-1)!;
    expect(text).toContain('輪到 <@p2>');
    expect(text).toContain('提示 8');
    expect(text).toContain('失誤 0／3');
    expect(text).toContain('牌堆 40');
    const p = prompts(events, 'hanabiTurn').at(-1)!;
    expect(values(p)).toEqual(['peek', 'play:0', 'play:1', 'play:2', 'play:3', 'play:4', 'discard:0', 'discard:1', 'discard:2', 'discard:3', 'discard:4']);
  });

  it('看牌：只有自己看到別人的手牌和自己已知的提示，看不到自己的牌', () => {
    const { state, events } = run([{ type: 'peek', user: 'p1' }], started(2).state);
    const eph = ephemeralTo(events, 'p1') as { text: string };
    expect(eph.text).toContain('<@p2>：🟥3 🟥3 🟥4 🟥4 🟥5');
    expect(eph.text).toContain('第 1 張：？？');
    expect(eph.text).not.toContain('🟥1');
    expect(events.filter((e) => e.type === 'announce')).toEqual([]);
    expect(state.players[0].hand).toHaveLength(5);
  });
});
