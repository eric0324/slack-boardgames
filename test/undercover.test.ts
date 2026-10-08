import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine.js';
import { applyUndercover, UNDERCOVER_TABLE, type UAction, type UState } from '../src/undercover.js';
import { WORD_PAIRS } from '../src/undercoverWords.js';

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

// rng 固定時不洗牌：先發臥底、再發白板、其他是平民。例如 6 人局：p1 臥底、p2 白板、p3~p6 平民
const startedU = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);
const count = (s: UState) =>
  s.players.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.role!]: (acc[p.role!] ?? 0) + 1 }), {});

describe('undercover/setup: 身分配置', () => {
  it('4 人局：3 平民、1 臥底，沒有白板', () => {
    expect(count(startedU(4).state)).toEqual({ civilian: 3, undercover: 1 });
  });

  it('9 人局：6 平民、2 臥底、1 白板', () => {
    expect(count(startedU(9).state)).toEqual({ civilian: 6, undercover: 2, blank: 1 });
  });

  it('4～12 人的身分總數都等於人數', () => {
    for (let n = 4; n <= 12; n++) {
      const total = Object.values(UNDERCOVER_TABLE[n]).reduce((a, b) => a + b, 0);
      expect(total, `${n} 人`).toBe(n);
    }
  });

  it('頻道公告只寫各身分的數量，不寫誰是什麼身分，並提醒查看私訊', () => {
    const text = startedU(6)
      .events.filter((e) => e.type === 'announce')
      .map((e) => (e as { text: string }).text)
      .join('\n');
    expect(text).toContain('4 平民、1 臥底、1 白板');
    expect(text).toContain('私訊');
    expect(text).not.toMatch(/<@p\d+>\s*[:：]?\s*(是)?\s*(平民|臥底|白板)/);
  });
});

describe('undercover/setup: 私訊發詞', () => {
  it('平民和臥底只收到自己的詞，不知道自己的身分', () => {
    const { state, events } = startedU(6);
    const { civilian, undercover } = state.words!;
    expect(civilian).not.toBe(undercover);
    const dm = (id: string) => events.find((e) => e.type === 'dm' && e.to === id) as { text: string };
    expect(dm('p1').text).toContain(`你的詞是：${undercover}`);
    expect(dm('p3').text).toContain(`你的詞是：${civilian}`);
    for (const id of ['p1', 'p3']) expect(dm(id).text).not.toMatch(/平民|臥底|白板/);
  });

  it('白板收到「你是白板，沒有拿到詞」', () => {
    const { events } = startedU(6);
    expect(events.find((e) => e.type === 'dm' && e.to === 'p2')).toMatchObject({
      text: expect.stringContaining('你是白板，沒有拿到詞'),
    });
  });

  it('兩個詞來自詞庫的同一組，哪一個是平民詞是隨機的', () => {
    const pick = (r: () => number) => startedU(4, r).state.words!;
    const [x, y] = [pick(() => 0), pick(() => 0.99999)];
    for (const w of [x, y]) {
      expect(WORD_PAIRS.some(({ a, b }) => (a.word === w.civilian && b.word === w.undercover) || (b.word === w.civilian && a.word === w.undercover))).toBe(true);
    }
  });
});
