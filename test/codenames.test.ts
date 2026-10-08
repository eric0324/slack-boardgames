import { describe, expect, it } from 'vitest';
import { type GameEvent } from '../src/engine.js';
import { applyCodenames, type CAction, type CState } from '../src/codenames.js';

const rng = () => 0.99999;

function run(actions: CAction[], start?: CState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyCodenames(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as CAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('codenames/setup: 機密代號的房間', () => {
  it('開房：公告標示機密代號', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'codenames', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '機密代號', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 4 人不能開始', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(3).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 4 人') });
  });

  it('房間已滿（12 人）時拒絕加入', () => {
    const { state, events } = run([{ type: 'join', user: 'x' }], lobbyWith(12).state);
    expect(state.players).toHaveLength(12);
    expect(ephemeralTo(events, 'x')).toMatchObject({ text: expect.stringContaining('房間已滿') });
  });

  it('不支援 bot', () => {
    const { state, events } = run([{ type: 'addBot', user: 'p1', count: 2 }], lobbyWith(2).state);
    expect(state.players).toHaveLength(2);
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: '機密代號不支援 bot。' });
  });

  it('加入、離開、房主離開取消、房主取消', () => {
    const lobby = lobbyWith(3).state;
    expect(run([{ type: 'leave', user: 'p3' }], lobby).state.players).toHaveLength(2);
    expect(run([{ type: 'leave', user: 'p1' }], lobby).state.phase).toBe('ended');
    expect(run([{ type: 'cancel', user: 'p1' }], lobby).state.phase).toBe('ended');
  });

  it('非房主不能開始；4 人以上房主可以開始，按鈕失效', () => {
    expect(ephemeralTo(run([{ type: 'start', user: 'p2' }], lobbyWith(4).state).events, 'p2')).toBeDefined();
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(4).state);
    expect(state.phase).not.toBe('lobby');
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
  });
});

// rng 固定時不洗牌：玩家輪流分到紅、藍隊（p1 紅、p2 藍…），各隊第一位是隊長；藍隊先攻
// 字卡是詞庫前 25 個，前 9 張藍隊、接著 8 張紅隊、7 張中立、最後 1 張刺客
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);
const boards = (events: GameEvent[]) => events.filter((e) => e.type === 'board') as Extract<GameEvent, { type: 'board' }>[];

describe('codenames/setup: 分隊與隊長', () => {
  it('5 人：兩隊人數差最多 1，各有 1 位隊長；公告兩隊和先攻', () => {
    const { state, events } = started(5);
    const red = state.players.filter((p) => p.team === 'red');
    const blue = state.players.filter((p) => p.team === 'blue');
    expect(Math.abs(red.length - blue.length)).toBeLessThanOrEqual(1);
    expect(red.filter((p) => p.spymaster)).toHaveLength(1);
    expect(blue.filter((p) => p.spymaster)).toHaveLength(1);
    const text = announces(events).join('\n');
    expect(text).toContain('紅隊：隊長 <@p1>');
    expect(text).toContain('藍隊：隊長 <@p2>');
    expect(text).toContain('藍隊先攻');
  });

  it('分隊、隊長、先攻都是隨機的', () => {
    const a = started(6, () => 0).state;
    const b = started(6).state;
    expect(a.startTeam).not.toBe(b.startTeam);
    expect(a.cards.map((x) => x.word)).not.toEqual(b.cards.map((x) => x.word));
  });
});

describe('codenames/setup: 牌桌', () => {
  it('25 張不重複的字卡：先攻 9、後攻 8、中立 7、刺客 1', () => {
    const { state } = started(4);
    expect(new Set(state.cards.map((x) => x.word)).size).toBe(25);
    const count = (color: string) => state.cards.filter((x) => x.color === color).length;
    expect([count('blue'), count('red'), count('neutral'), count('assassin')]).toEqual([9, 8, 7, 1]);
    expect(state.cards.every((x) => !x.revealed)).toBe(true);
  });

  it('頻道貼出 5×5 的牌桌，按鈕只有詞、不透露顏色', () => {
    const { state, events } = started(4);
    const board = boards(events).at(-1)!;
    expect(board.rows).toHaveLength(5);
    expect(board.rows.every((r) => r.length === 5)).toBe(true);
    const flat = board.rows.flat();
    expect(flat.map((b) => b.label)).toEqual(state.cards.map((x) => x.word));
    expect(flat.map((b) => b.value)).toEqual(state.cards.map((_, i) => String(i)));
    expect(flat.every((b) => b.style === undefined)).toBe(true);
  });
});

describe('codenames/setup: 隊長的答案', () => {
  it('兩位隊長收到每張字卡的顏色，隊員沒有', () => {
    const { state, events } = started(4);
    for (const id of ['p1', 'p2']) {
      const text = dmTo(events, id)!.text;
      expect(text).toContain(`🟦${state.cards[0].word}`);
      expect(text).toContain(`🟥${state.cards[9].word}`);
      expect(text).toContain(`⬜${state.cards[17].word}`);
      expect(text).toContain(`💀${state.cards[24].word}`);
    }
    expect(dmTo(events, 'p3')).toBeUndefined();
    expect(dmTo(events, 'p4')).toBeUndefined();
  });
});

const timers = (events: GameEvent[]) => events.filter((e) => e.type === 'startTimer') as { id: number; ms: number }[];
const lastTimer = (events: GameEvent[]) => timers(events).at(-1)!;
const clue = (user: string, word: string, count: number, s: CState) => run([{ type: 'clue', user, word, count }], s);

// 4 人局：紅隊 p1（隊長）、p3；藍隊 p2（隊長）、p4；藍隊先攻
describe('codenames/turns: 隊長給提示', () => {
  it('回合開始：公告輪到哪隊和剩餘張數，請隊長給提示，2 分鐘', () => {
    const { state, events } = started(4);
    expect(state).toMatchObject({ phase: 'clue', turn: 'blue' });
    const text = announces(events).at(-1)!;
    expect(text).toContain('輪到 🟦 藍隊');
    expect(text).toContain('<@p2>');
    expect(text).toContain('紅隊剩 8 張');
    expect(text).toContain('藍隊剩 9 張');
    expect(lastTimer(events).ms).toBe(120_000);
  });

  it('隊長給提示：公告提示，進入猜牌，3 分鐘', () => {
    const { state, events } = clue('p2', '水果', 2, started(4).state);
    expect(state).toMatchObject({ phase: 'guess', clue: { word: '水果', count: 2 }, guessed: 0 });
    expect(announces(events)).toContainEqual(expect.stringContaining('🕵️ 藍隊隊長：「水果」2'));
    expect(lastTimer(events).ms).toBe(180_000);
  });

  it('不能用牌桌上還沒翻開的詞、數字要 1～9、詞不能有空白', () => {
    const s = started(4).state;
    for (const [word, count, hint] of [
      [s.cards[3].word, 1, '牌桌上的詞'],
      ['水果', 0, '1～9'],
      ['水果', 10, '1～9'],
      ['水 果', 1, '一個詞'],
    ] as [string, number, string][]) {
      const res = clue('p2', word, count, s);
      expect(res.state.phase).toBe('clue');
      expect(ephemeralTo(res.events, 'p2')).toMatchObject({ text: expect.stringContaining(hint) });
    }
  });

  it('不是目前隊伍的隊長不能給提示', () => {
    const s = started(4).state;
    for (const user of ['p1', 'p4']) {
      const res = clue(user, '水果', 1, s);
      expect(res.state.phase).toBe('clue');
      expect(ephemeralTo(res.events, user)).toBeDefined();
    }
  });

  it('隊長 2 分鐘沒給提示：換對方隊伍', () => {
    const { state, events } = started(4);
    const after = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(after.state).toMatchObject({ phase: 'clue', turn: 'red' });
    expect(announces(after.events).join('\n')).toContain('輪到 🟥 紅隊');
  });
});
