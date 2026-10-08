import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine.js';
import { applyUndercover, type UAction, type UState } from '../src/undercover.js';

const rng = () => 0.99999;

function run(actions: UAction[], start?: UState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyUndercover(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as UAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const ids = (s: UState) => s.players.map((p) => p.id);

describe('undercover/setup: 誰是臥底的房間', () => {
  it('開房：房主自動加入，公告標示誰是臥底', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'undercover', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '誰是臥底', host: 'A', players: ['A'], open: true });
  });

  it('加入、離開、重複加入', () => {
    const { state } = lobbyWith(3);
    expect(ids(state)).toEqual(['p1', 'p2', 'p3']);
    const dup = run([{ type: 'join', user: 'p2' }], state);
    expect(ephemeralTo(dup.events, 'p2')).toBeDefined();
    expect(ids(run([{ type: 'leave', user: 'p3' }], state).state)).toEqual(['p1', 'p2']);
  });

  it('房主開始前離開就取消房間', () => {
    const { state, events } = run([{ type: 'leave', user: 'p1' }], lobbyWith(3).state);
    expect(state.phase).toBe('ended');
    expect(events.some((e) => e.type === 'announce' && e.text.includes('取消'))).toBe(true);
  });

  it('房間已滿（12 人）時拒絕加入', () => {
    const { state, events } = run([{ type: 'join', user: 'x' }], lobbyWith(12).state);
    expect(state.players).toHaveLength(12);
    expect(ephemeralTo(events, 'x')).toMatchObject({ text: expect.stringContaining('房間已滿') });
  });

  it('人數不足 4 人不能開始，只讓房主看到提示', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(3).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 4 人') });
  });

  it('非房主不能開始', () => {
    const { state, events } = run([{ type: 'start', user: 'p2' }], lobbyWith(4).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p2')).toBeDefined();
  });

  it('4 人以上房主可以開始，按鈕失效', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(4).state);
    expect(state.phase).not.toBe('lobby');
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
  });

  it('房主可以加入和移除 bot，bot 顯示成 🤖<名字>', () => {
    const { state } = run([{ type: 'addBot', user: 'p1', count: 3 }], lobbyWith(1).state);
    expect(state.players.filter((p) => p.id.startsWith('bot:'))).toHaveLength(3);
    const removed = run([{ type: 'removeBot', user: 'p1', count: 2 }], state).state;
    expect(removed.players).toHaveLength(2);
  });

  it('房主可以取消遊戲，之後的操作都沒有作用', () => {
    const { state, events } = run([{ type: 'cancel', user: 'p1' }], lobbyWith(4).state);
    expect(state.phase).toBe('ended');
    expect(events.some((e) => e.type === 'announce' && e.text.includes('取消'))).toBe(true);
    expect(run([{ type: 'join', user: 'x' }], state).events).toEqual([]);
  });
});
