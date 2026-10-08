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

const play = (user: string, index: number, s: HState) => run([{ type: 'play', user, index }], s);
// 2 人局：p2 先，p2 手牌 紅3 紅3 紅4 紅4 紅5；p1 手牌 紅1 紅1 紅1 紅2 紅2；牌堆最上面是黃 1
describe('hanabi/turns: 出牌', () => {
  it('出牌成功：放上煙火，補一張牌到最後，換下一位', () => {
    const s = { ...started(2).state, turn: 0 };
    const { state, events } = play('p1', 0, s);
    expect(state.fireworks.red).toBe(1);
    expect(state.players[0].hand.map((x) => `${x.color}${x.n}`)).toEqual(['red1', 'red1', 'red2', 'red2', 'yellow1']);
    expect(announces(events).join('\n')).toContain('<@p1> 打出 🟥1，成功');
    expect(state.turn).toBe(1);
  });

  it('出牌失誤：失誤次數加 1，牌進棄牌堆', () => {
    const { state, events } = play('p2', 0, started(2).state);
    expect(state).toMatchObject({ fuses: 1, discard: [{ color: 'red', n: 3 }] });
    expect(state.fireworks.red).toBe(0);
    expect(announces(events).join('\n')).toContain('失誤');
  });

  it('完成某個顏色的 5：提示標記不滿 8 就加回 1 個', () => {
    const s = { ...started(2).state, fireworks: { red: 4, yellow: 0, green: 0, blue: 0, white: 0 }, hints: 5 };
    const { state } = play('p2', 4, s);
    expect(state.fireworks.red).toBe(5);
    expect(state.hints).toBe(6);
  });
});

const discard = (user: string, index: number, s: HState) => run([{ type: 'discard', user, index }], s);
describe('hanabi/turns: 棄牌', () => {
  it('棄牌：提示標記加 1，公告棄掉的牌，補一張', () => {
    const s = { ...started(2).state, hints: 5 };
    const { state, events } = discard('p2', 1, s);
    expect(state.hints).toBe(6);
    expect(state.discard).toEqual([{ color: 'red', n: 3 }]);
    expect(state.players[1].hand).toHaveLength(5);
    expect(announces(events).join('\n')).toContain('<@p2> 棄掉 🟥3');
    expect(state.turn).toBe(0);
  });

  it('提示標記 8 個時不能棄牌', () => {
    const { state, events } = discard('p2', 0, started(2).state);
    expect(state.turn).toBe(1);
    expect(ephemeralTo(events, 'p2')).toMatchObject({ text: expect.stringContaining('提示標記滿了') });
  });
});

const hint = (user: string, target: string, value: { color?: string; number?: number }, s: HState) =>
  run([{ type: 'hint', user, target, ...value } as HAction], s);
describe('hanabi/turns: 提示', () => {
  it('提示顏色：標記減 1，公告所有符合的位置，被提示的牌記住', () => {
    const { state, events } = hint('p2', 'p1', { color: 'red' }, started(2).state);
    expect(state.hints).toBe(7);
    expect(announces(events).join('\n')).toContain('<@p2> 提示 <@p1>：第 1、2、3、4、5 張是紅色');
    expect(state.players[0].hand.every((x) => x.knowColor)).toBe(true);
    expect(state.turn).toBe(0);
  });

  it('提示數字：之後看牌會顯示', () => {
    const { state, events } = hint('p2', 'p1', { number: 2 }, started(2).state);
    expect(announces(events).join('\n')).toContain('第 4、5 張是 2');
    const peeked = run([{ type: 'peek', user: 'p1' }], state);
    expect((ephemeralTo(peeked.events, 'p1') as { text: string }).text).toContain('第 4 張：？2');
  });

  it('至少要指出一張牌、要有提示標記、不能提示自己', () => {
    const s = started(2).state;
    for (const [user, target, value, s2, text] of [
      ['p2', 'p1', { number: 3 }, s, '至少'],
      ['p2', 'p1', { color: 'red' }, { ...s, hints: 0 }, '沒有提示標記'],
      ['p2', 'p2', { color: 'red' }, s, '不能提示自己'],
    ] as [string, string, { color?: string; number?: number }, HState, string][]) {
      const res = hint(user, target, value, s2);
      expect(res.state.turn).toBe(1);
      expect(ephemeralTo(res.events, user)).toMatchObject({ text: expect.stringContaining(text) });
    }
  });
});
