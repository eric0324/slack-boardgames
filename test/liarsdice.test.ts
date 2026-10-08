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

const challenge = (user: string, s: LState) => run([{ type: 'challenge', user }], s);
const withDice = (s: LState, dice: number[][], extra: Partial<LState> = {}): LState => ({
  ...s,
  players: s.players.map((p, i) => ({ ...p, dice: dice[i] })),
  ...extra,
});

describe('liarsdice/rounds: 開', () => {
  it('喊的人吹牛：公開所有骰子，喊的人少一顆，下一輪由他先喊', () => {
    // 全場 15 顆都是 6
    const s = bid('p3', 16, 6, started(3).state).state;
    const { state, events } = challenge('p1', s);
    const text = announces(events).join('\n');
    expect(text).toContain('<@p3>：⚅ ⚅ ⚅ ⚅ ⚅');
    expect(text).toContain('實際有 15 顆');
    expect(text).toContain('<@p3> 輸了');
    expect(state.players[2].dice).toHaveLength(4);
    expect(state).toMatchObject({ round: 2, turn: 2 });
    expect(state.bid).toBeUndefined();
  });

  it('喊的數量成立：開的人輸', () => {
    const s = bid('p3', 15, 6, started(3).state).state;
    expect(challenge('p1', s).state.players[0].dice).toHaveLength(4);
  });

  it('1 點萬用；這輪喊過 1 點就不再萬用', () => {
    const base = started(3).state;
    const dice = [[1, 1, 2, 3, 4], [5, 5, 5, 5, 5], [6, 6, 6, 6, 6]];
    const wild = withDice(base, dice, { bid: { quantity: 7, face: 5, by: 'p3' }, turn: 0 });
    expect(announces(challenge('p1', wild).events).join('\n')).toContain('<@p1> 輸了');
    const noWild = { ...wild, onesCalled: true };
    expect(announces(challenge('p1', noWild).events).join('\n')).toContain('<@p3> 輸了');
  });

  it('只有輪到的人能開，而且要有人喊過', () => {
    const s = bid('p3', 3, 5, started(3).state).state;
    expect(ephemeralTo(challenge('p2', s).events, 'p2')).toBeDefined();
    expect(ephemeralTo(challenge('p3', started(3).state).events, 'p3')).toBeDefined();
  });

  it('已經有人喊過時超時：自動開', () => {
    const r = bid('p3', 16, 6, started(3).state);
    const after = run([{ type: 'timeout', id: lastTimer(r.events).id }], r.state);
    expect(after.state.players[2].dice).toHaveLength(4);
  });
});

describe('liarsdice/rounds: 勝負', () => {
  const lastOne = () => {
    const base = started(2).state;
    return challenge('p1', withDice(base, [[6, 6], [6]], { bid: { quantity: 5, face: 6, by: 'p2' }, turn: 0 }));
  };

  it('骰子沒了就出局；只剩一人時獲勝，貼出再來一局', () => {
    const { state, events } = lastOne();
    expect(state).toMatchObject({ phase: 'ended', winner: 'p1' });
    const text = announces(events).join('\n');
    expect(text).toContain('<@p2> 出局');
    expect(text).toContain('<@p1> 獲勝');
    expect(prompts(events, 'rematch')).toHaveLength(1);
  });

  it('出局的人之後不會輪到', () => {
    const base = started(3).state;
    const { state } = challenge('p2', withDice(base, [[6], [6, 6], [6, 6]], { bid: { quantity: 9, face: 6, by: 'p1' }, turn: 1 }));
    expect(state.players[0].dice).toHaveLength(0);
    expect(state.turn).toBe(1);
  });

  it('再來一局：上一局的真人玩家可以開新房間；取消的遊戲不能', () => {
    const ended = lastOne().state;
    const again = run([{ type: 'rematch', user: 'p2', channel: 'C1' }], ended);
    expect(again.state).toMatchObject({ phase: 'lobby', host: 'p2', players: [{ id: 'p2' }] });
    expect(ephemeralTo(run([{ type: 'rematch', user: 'X', channel: 'C1' }], ended).events, 'X')).toBeDefined();
    const cancelled = run([{ type: 'cancel', user: 'p1' }], started(2).state).state;
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], cancelled).events).toEqual([]);
  });
});

// 1 真人 + 1 bot，rng 固定：骰子全是 6，bot 先喊
const withBot = () => run([{ type: 'addBot', user: 'p1', count: 1 }, { type: 'start', user: 'p1' }], lobbyWith(1).state);
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe('liarsdice/bots: bot 喊數與開', () => {
  it('輪到 bot 時立刻從自己最多的點數喊數', () => {
    const { state, events } = withBot();
    const bot = state.players[1].id;
    expect(state.bid).toMatchObject({ face: 6, by: bot });
    expect(state.turn).toBe(0);
    expect(announces(events).join('\n')).toContain('喊：「');
  });

  it('喊數遠超過期望值時 bot 立刻開', () => {
    const { state, events } = bid('p1', 9, 5, withBot().state);
    const bot = state.players[1].id;
    expect(announces(events).join('\n')).toContain(`開「9 個 5」`);
    expect(announces(events).join('\n')).toContain('<@p1> 輸了');
    expect(bot).toBeDefined();
  });

  it('1 位真人加 bot、真人什麼都不做，遊戲一定會結束', () => {
    for (const bots of [1, 3, 7]) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = seeded(seed);
        let s = run([{ type: 'addBot', user: 'p1', count: bots }, { type: 'start', user: 'p1' }], lobbyWith(1).state, r).state;
        for (let step = 0; step < 500 && s.phase !== 'ended'; step++) s = applyLiarsDice(s, { type: 'timeout', id: s.timers.phase! }, r).state;
        expect(s.phase, `${bots} bots, seed ${seed}`).toBe('ended');
      }
    }
  });
});
