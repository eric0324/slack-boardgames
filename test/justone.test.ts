import { describe, expect, it } from 'vitest';
import { type GameEvent } from '../src/engine.js';
import { applyJustOne, type JAction, type JState } from '../src/justone.js';

const rng = () => 0.99999;

function run(actions: JAction[], start?: JState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyJustOne(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as JAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('justone/setup: 一字千金的房間', () => {
  it('開房：公告標示一字千金', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'justone', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '一字千金', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 3 人不能開始；7 人滿', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(2).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 3 人') });
    const full = run([{ type: 'join', user: 'x' }], lobbyWith(7).state);
    expect(full.state.players).toHaveLength(7);
    expect(ephemeralTo(full.events, 'x')).toMatchObject({ text: expect.stringContaining('房間已滿') });
  });

  it('不支援 bot', () => {
    expect(ephemeralTo(run([{ type: 'addBot', user: 'p1', count: 1 }], lobbyWith(2).state).events, 'p1')).toMatchObject({
      text: '一字千金不支援 bot。',
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

// rng 固定：牌堆是詞庫最前面的 13 個詞（不洗牌），第一位猜詞的是最後一位玩家
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);

describe('justone/setup: 牌堆', () => {
  it('13 張不重複的詞，隨機第一位猜詞的人', () => {
    const { state, events } = started(4);
    expect(state.deck.length + 1).toBe(13);
    expect(new Set([...state.deck, state.word]).size).toBe(13);
    expect(state.guesser).toBe(3);
    const text = announces(events).join('\n');
    expect(text).toContain('13 張');
    expect(text).toContain('第 1 張：<@p4> 猜詞');
  });

  it('牌堆和第一位都是隨機的', () => {
    const a = started(4, () => 0).state;
    const b = started(4).state;
    expect(a.guesser).not.toBe(b.guesser);
    expect(a.word).not.toBe(b.word);
  });
});

const lastTimer = (events: GameEvent[]) => (events.filter((e) => e.type === 'startTimer') as { id: number; ms: number }[]).at(-1)!;
const clue = (user: string, word: string, s: JState) => run([{ type: 'clue', user, word }], s);
const clues = (pairs: [string, string][], s: JState) => run(pairs.map(([user, word]) => ({ type: 'clue', user, word }) as JAction), s);

// 4 人局：p4 猜詞，p1～p3 給提示
describe('justone/rounds: 給提示', () => {
  it('私訊其他人這輪的詞，猜詞的人沒有；90 秒', () => {
    const { state, events } = started(4);
    for (const id of ['p1', 'p2', 'p3']) expect(dmTo(events, id)!.text).toContain(`「${state.word}」`);
    expect(dmTo(events, 'p4')).toBeUndefined();
    expect(lastTimer(events).ms).toBe(90_000);
  });

  it('給提示：只有自己看到已收到，頻道公告人數；可以覆蓋', () => {
    const s = started(4).state;
    const { state, events } = clue('p1', '牛頓', s);
    expect(state.clues).toEqual({ p1: '牛頓' });
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('已收到') });
    expect(announces(events).at(-1)).toContain('1／3');
    expect(announces(events).join('\n')).not.toContain('牛頓');
    expect(clue('p1', '紅色', state).state.clues).toEqual({ p1: '紅色' });
  });

  it('猜詞的人、不在遊戲裡的人不能給；提示不能有空白', () => {
    const s = started(4).state;
    expect(ephemeralTo(clue('p4', '水果', s).events, 'p4')).toMatchObject({ text: expect.stringContaining('不能給提示') });
    expect(clue('x', '水果', s).state.clues).toEqual({});
    expect(ephemeralTo(clue('p1', '水 果', s).events, 'p1')).toMatchObject({ text: expect.stringContaining('一個詞') });
  });

  it('所有人都給了，或 90 秒到了，就結束給提示', () => {
    expect(clues([['p1', 'a'], ['p2', 'b'], ['p3', 'c']], started(4).state).state.phase).toBe('guess');
    const st = started(4);
    expect(run([{ type: 'timeout', id: lastTimer(st.events).id }], clue('p1', 'a', st.state).state).state.phase).toBe('guess');
  });
});

describe('justone/rounds: 刪除重複的提示', () => {
  it('重複的提示全部刪掉，只公開留下的提示和給的人、被刪掉幾個', () => {
    const { events } = clues([['p1', '水果'], ['p2', '水果'], ['p3', '牛頓']], started(4).state);
    const text = announces(events).at(-1)!;
    expect(text).toContain('<@p3>「牛頓」');
    expect(text).not.toContain('水果');
    expect(text).toContain('2 個提示');
  });

  it('去掉前後空白、英文不分大小寫後相同就算重複；和答案相同的也刪掉', () => {
    const s = started(4).state;
    const { events } = clues([['p1', 'Apple'], ['p2', ' apple '], ['p3', s.word!]], s);
    const text = announces(events).at(-1)!;
    expect(text).toContain('3 個提示');
    expect(text).toContain('沒有留下任何提示');
  });

  it('公告後猜詞的人收到「跳過」按鈕', () => {
    const { events } = clues([['p1', 'a'], ['p2', 'b'], ['p3', 'c']], started(4).state);
    const p = events.find((e) => e.type === 'prompt' && e.kind === 'skipGuess') as Extract<GameEvent, { type: 'prompt' }>;
    expect(p.options).toEqual([{ value: 'p4', label: '跳過' }]);
  });
});
