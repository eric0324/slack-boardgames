import { describe, expect, it } from 'vitest';
import { type GameEvent } from '../src/engine.js';
import { applyCoup, type KAction, type KState } from '../src/coup.js';

const rng = () => 0.99999;

function run(actions: KAction[], start?: KState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyCoup(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as KAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('coup/setup: 政變的房間', () => {
  it('開房：公告標示政變', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'coup', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '政變', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 3 人不能開始', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(2).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 3 人') });
  });

  it('房間已滿（6 人）時拒絕加入', () => {
    const { state, events } = run([{ type: 'join', user: 'x' }], lobbyWith(6).state);
    expect(state.players).toHaveLength(6);
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

  it('非房主不能開始；3 人以上房主可以開始，按鈕失效', () => {
    expect(ephemeralTo(run([{ type: 'start', user: 'p2' }], lobbyWith(3).state).events, 'p2')).toBeDefined();
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(3).state);
    expect(state.phase).not.toBe('lobby');
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
  });
});

// rng 固定時不洗牌：牌堆依公爵、刺客、隊長、大使、女伯爵各 3 張排列，依序發給 p1、p2…；第一位是最後一位玩家
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);
const ROLE_NAMES = ['公爵', '刺客', '隊長', '大使', '女伯爵'];

describe('coup/setup: 發牌與金幣', () => {
  it('每人 2 張暗牌、2 枚金幣，牌堆剩 15 - 2n 張', () => {
    const { state } = started(4);
    for (const p of state.players) {
      expect(p.cards).toHaveLength(2);
      expect(p.cards.every((x) => !x.revealed)).toBe(true);
      expect(p.coins).toBe(2);
    }
    expect(state.deck).toHaveLength(7);
    const all = [...state.deck, ...state.players.flatMap((p) => p.cards.map((x) => x.role))];
    for (const role of ['duke', 'assassin', 'captain', 'ambassador', 'contessa']) expect(all.filter((r) => r === role)).toHaveLength(3);
  });

  it('私訊自己的手牌和角色說明', () => {
    const { state, events } = started(3);
    const text = dmTo(events, 'p2')!.text;
    expect(text).toContain('你的手牌');
    expect(text).toContain('公爵：稅收');
    expect(state.players[1].cards.map((x) => x.role)).toEqual(['duke', 'assassin']);
    expect(text).toContain('公爵、刺客');
  });

  it('頻道公告順序和金幣，不洩漏手牌；第一位是隨機的', () => {
    const { state, events } = started(3);
    const text = announces(events)[0];
    expect(text).toContain('每人 2 枚金幣');
    for (const name of ROLE_NAMES) expect(text).not.toContain(name);
    expect(state.turn).toBe(2);
    expect(started(3, () => 0).state.turn).toBe(0);
  });
});
