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
