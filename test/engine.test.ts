import { describe, expect, it } from 'vitest';
import { applyAction, dealRoles, ROLE_TABLE, type Action, type GameEvent, type GameState, type Role } from '../src/engine.js';

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

describe('game-lobby: 開始遊戲', () => {
  it('6～12 人時房主可以開始，按鈕失效', () => {
    for (const n of [6, 12]) {
      const { state } = lobbyWith(n);
      const { state: after, events } = run([{ type: 'start', user: 'p1' }], state);
      expect(after.phase).not.toBe('lobby');
      expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
    }
  });

  it('人數不足時拒絕，告訴房主人數', () => {
    const { state } = lobbyWith(5);
    const { state: after, events } = run([{ type: 'start', user: 'p1' }], state);
    expect(after.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('5') });
  });

  it('非房主不能開始', () => {
    const { state } = lobbyWith(6);
    const { state: after, events } = run([{ type: 'start', user: 'p2' }], state);
    expect(after.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p2')).toBeDefined();
  });

  it('遊戲開始後不能加入', () => {
    const { state } = run([{ type: 'start', user: 'p1' }], lobbyWith(6).state);
    const { state: after, events } = run([{ type: 'join', user: 'x' }], state);
    expect(after.players).toHaveLength(6);
    expect(ephemeralTo(events, 'x')).toMatchObject({ text: expect.stringContaining('已經開始') });
  });

  it('遊戲開始後不能離開', () => {
    const { state } = run([{ type: 'start', user: 'p1' }], lobbyWith(6).state);
    const { state: after, events } = run([{ type: 'leave', user: 'p2' }], state);
    expect(after.players).toHaveLength(6);
    expect(ephemeralTo(events, 'p2')).toMatchObject({ text: expect.stringContaining('已經開始') });
  });
});

describe('game-lobby: 取消遊戲', () => {
  it('房主取消後遊戲結束，之後的操作都沒有作用', () => {
    const { state } = run([{ type: 'start', user: 'p1' }], lobbyWith(6).state);
    const { state: after, events } = run([{ type: 'cancel', user: 'p1' }], state);
    expect(after.phase).toBe('ended');
    expect(events.some((e) => e.type === 'announce' && e.text.includes('取消'))).toBe(true);
    expect(run([{ type: 'join', user: 'x' }], after).events).toEqual([]);
  });

  it('非房主不能取消', () => {
    const { state } = lobbyWith(6);
    const { state: after, events } = run([{ type: 'cancel', user: 'p2' }], state);
    expect(after.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p2')).toBeDefined();
  });
});

const count = (roles: Role[]) =>
  roles.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});

describe('role-assignment: 依人數配置角色', () => {
  it('6 人局：2 狼、1 預言家、1 女巫、2 村民，沒有獵人', () => {
    expect(count(dealRoles(6, Math.random))).toEqual({ werewolf: 2, seer: 1, witch: 1, villager: 2 });
  });

  it('12 人局：4 狼、1 預言家、1 女巫、1 獵人、5 村民', () => {
    expect(count(dealRoles(12, Math.random))).toEqual({ werewolf: 4, seer: 1, witch: 1, hunter: 1, villager: 5 });
  });

  it('6～12 人的角色總數都等於玩家數', () => {
    for (let n = 6; n <= 12; n++) {
      const total = Object.values(ROLE_TABLE[n]).reduce((a, b) => a + b, 0);
      expect(total).toBe(n);
      expect(dealRoles(n, Math.random)).toHaveLength(n);
    }
  });
});

describe('role-assignment: 隨機發牌', () => {
  it('開始遊戲後每位玩家剛好一個角色，數量和配置表一致', () => {
    const { state } = run([{ type: 'start', user: 'p1' }], lobbyWith(8).state);
    const roles = state.players.map((p) => p.role!);
    expect(roles.every(Boolean)).toBe(true);
    expect(count(roles)).toEqual({ werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 2 });
  });

  it('發牌結果由 rng 決定', () => {
    const a = dealRoles(10, () => 0);
    const b = dealRoles(10, () => 0.99999);
    expect(a).not.toEqual(b);
  });
});
