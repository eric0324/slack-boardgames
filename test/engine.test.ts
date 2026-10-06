import { describe, expect, it } from 'vitest';
import { applyAction, type Action, type GameEvent, type GameState } from '../src/engine.js';

const rng = () => 0.99999; // Fisher-Yates 不交換，角色照配置表順序發

function run(actions: Action[], start?: GameState) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyAction(state, action, rng);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as Action),
  ]);

const ephemeralTo = (events: GameEvent[], user: string) =>
  events.find((e) => e.type === 'ephemeral' && e.to === user);

describe('game-lobby: 開房', () => {
  it('成功開房：房主自動加入，公告房間', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state.host).toBe('A');
    expect(state.players.map((p) => p.id)).toEqual(['A']);
    expect(events).toContainEqual({ type: 'lobby', host: 'A', players: ['A'], open: true });
  });

  it('頻道已經有房間時拒絕開房', () => {
    const { state } = lobbyWith(1);
    const { state: after, events } = run([{ type: 'new', user: 'B', channel: 'C1' }], state);
    expect(after).toBe(state);
    expect(ephemeralTo(events, 'B')).toBeDefined();
  });
});

describe('game-lobby: 加入與離開房間', () => {
  it('加入房間會更新名單', () => {
    const { state, events } = lobbyWith(2);
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(events).toContainEqual({ type: 'lobby', host: 'p1', players: ['p1', 'p2'], open: true });
  });

  it('重複加入：名單不變，提示本人', () => {
    const { state } = lobbyWith(2);
    const { state: after, events } = run([{ type: 'join', user: 'p2' }], state);
    expect(after.players).toHaveLength(2);
    expect(ephemeralTo(events, 'p2')).toBeDefined();
  });

  it('房間已滿（12 人）時拒絕加入', () => {
    const { state } = lobbyWith(12);
    const { state: after, events } = run([{ type: 'join', user: 'x' }], state);
    expect(after.players).toHaveLength(12);
    expect(ephemeralTo(events, 'x')).toBeDefined();
  });

  it('非房主離開會從名單移除', () => {
    const { state } = lobbyWith(3);
    const { state: after, events } = run([{ type: 'leave', user: 'p2' }], state);
    expect(after.players.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(events).toContainEqual({ type: 'lobby', host: 'p1', players: ['p1', 'p3'], open: true });
  });

  it('房主離開就取消房間', () => {
    const { state } = lobbyWith(3);
    const { state: after, events } = run([{ type: 'leave', user: 'p1' }], state);
    expect(after.phase).toBe('ended');
    expect(events.some((e) => e.type === 'announce' && e.text.includes('取消'))).toBe(true);
  });
});
