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

const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const lastTimer = (events: GameEvent[]) => (events.filter((e) => e.type === 'startTimer') as { id: number; ms: number }[]).at(-1)!;
const values = (p: { options: { value: string }[] }) => p.options.map((o) => o.value);
const act = (user: string, kind: string, s: KState) => run([{ type: 'act', user, kind } as KAction], s);
const target = (user: string, t: string, s: KState) => run([{ type: 'target', user, target: t }], s);
const coins = (s: KState, list: number[]): KState => ({ ...s, players: s.players.map((p, i) => ({ ...p, coins: list[i] })) });

// 3 人局：p3 先；p1 公爵公爵、p2 公爵刺客、p3 刺客刺客
describe('coup/turns: 行動', () => {
  it('輪到的人收到行動按鈕，金幣不夠的行動不能選；60 秒', () => {
    const { events } = started(3);
    const p = prompts(events, 'coupAction').at(-1)!;
    expect(p.text).toContain('<@p3>');
    expect(values(p)).toEqual(['income', 'foreignAid', 'tax', 'steal', 'exchange']);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('收入：拿 1 枚，輪到下一位', () => {
    const { state, events } = act('p3', 'income', started(3).state);
    expect(state.players[2].coins).toBe(3);
    expect(state.turn).toBe(0);
    expect(announces(events).join('\n')).toContain('<@p3> 收入');
  });

  it('只有輪到的人能行動', () => {
    const res = act('p1', 'income', started(3).state);
    expect(res.state.players[0].coins).toBe(2);
    expect(ephemeralTo(res.events, 'p1')).toBeDefined();
  });

  it('政變：選目標後付 7 枚，目標失去一個影響力', () => {
    const s = coins(started(3).state, [2, 2, 7]);
    const picking = act('p3', 'coup', s);
    expect(picking.state.phase).toBe('target');
    expect(values(prompts(picking.events, 'coupTarget').at(-1)!)).toEqual(['p1', 'p2']);
    const { state } = target('p3', 'p1', picking.state);
    expect(state.players[2].coins).toBe(0);
    expect(state).toMatchObject({ phase: 'lose', losing: ['p1'] });
  });

  it('10 枚以上只能政變', () => {
    const s = coins(started(3).state, [2, 2, 10]);
    const { events } = act('p3', 'income', { ...s, phase: 'action' });
    expect(ephemeralTo(events, 'p3')).toMatchObject({ text: expect.stringContaining('政變') });
    const next = act('p3', 'income', coins(started(3).state, [10, 2, 2]));
    expect(values(prompts(next.events, 'coupAction').at(-1)!)).toEqual(['coup']);
  });

  it('選行動超時：收入；10 枚以上時對隨機一人政變；選目標超時隨機', () => {
    const st = started(3);
    expect(run([{ type: 'timeout', id: lastTimer(st.events).id }], st.state).state.players[2].coins).toBe(3);
    const rich = coins(st.state, [2, 2, 10]);
    expect(run([{ type: 'timeout', id: lastTimer(st.events).id }], rich).state.phase).toBe('lose');
    const picking = act('p3', 'coup', coins(st.state, [2, 2, 7]));
    expect(run([{ type: 'timeout', id: lastTimer(picking.events).id }], picking.state).state.phase).toBe('lose');
  });
});

const reveal = (user: string, index: number, s: KState) => run([{ type: 'reveal', user, index }], s);
// p3 對 p1 政變
const couped = (s: KState = coins(started(3).state, [2, 2, 7])) => target('p3', 'p1', act('p3', 'coup', s).state);
const withCards = (s: KState, i: number, revealed: boolean[]): KState => ({
  ...s,
  players: s.players.map((p, k) => (k === i ? { ...p, cards: p.cards.map((x, j) => ({ ...x, revealed: revealed[j] })) } : p)),
});

describe('coup/turns: 失去影響力', () => {
  it('私訊選要翻開哪張牌；翻開後公告，輪到下一位', () => {
    const { state, events } = couped();
    const p = prompts(events, 'loseCard').at(-1)!;
    expect(p).toMatchObject({ audience: 'user', user: 'p1' });
    expect(values(p)).toEqual(['0', '1']);
    expect(lastTimer(events).ms).toBe(30_000);
    const after = reveal('p1', 1, state);
    expect(after.state.players[0].cards[1].revealed).toBe(true);
    expect(announces(after.events).join('\n')).toContain('<@p1> 翻開了「公爵」');
    expect(after.state).toMatchObject({ phase: 'action', turn: 0 });
  });

  it('只剩一張時自動翻開並出局；出局的人之後不會輪到', () => {
    const { state, events } = couped(withCards(coins(started(3).state, [2, 2, 7]), 0, [true, false]));
    expect(state.players[0].cards.every((x) => x.revealed)).toBe(true);
    expect(announces(events).join('\n')).toContain('<@p1> 出局');
    expect(state.turn).toBe(1);
  });

  it('只有要翻牌的人能選；30 秒超時隨機翻一張', () => {
    const { state, events } = couped();
    expect(reveal('p2', 0, state).state.phase).toBe('lose');
    const after = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(after.state.players[0].cards.filter((x) => x.revealed)).toHaveLength(1);
  });
});

describe('coup/turns: 勝負', () => {
  const won = () => couped(withCards(withCards(coins(started(3).state, [2, 2, 7]), 0, [true, false]), 1, [true, true]));

  it('只剩一人：公告獲勝者和每個人的牌，貼出再來一局', () => {
    const { state, events } = won();
    expect(state).toMatchObject({ phase: 'ended', winner: 'p3' });
    const text = announces(events).at(-1)!;
    expect(text).toContain('<@p3> 獲勝');
    expect(text).toContain('<@p2>：公爵、刺客');
    expect(prompts(events, 'rematch')).toHaveLength(1);
  });

  it('再來一局：上一局的真人玩家可以開新房間；取消的遊戲不能', () => {
    const ended = won().state;
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], ended).state).toMatchObject({ phase: 'lobby', host: 'p2' });
    expect(ephemeralTo(run([{ type: 'rematch', user: 'X', channel: 'C1' }], ended).events, 'X')).toBeDefined();
    const cancelled = run([{ type: 'cancel', user: 'p1' }], started(3).state).state;
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], cancelled).events).toEqual([]);
  });
});

const challenge = (user: string, s: KState) => run([{ type: 'challenge', user }], s);
const passWindow = (r: { state: KState; events: GameEvent[] }) => run([{ type: 'timeout', id: lastTimer(r.events).id }], r.state);

// 3 人局：p1 公爵公爵、p2 公爵刺客、p3 刺客刺客；p3 先，接著 p1、p2
describe('coup/turns: 質疑', () => {
  it('宣稱角色的行動：公告宣稱，貼出 20 秒的質疑按鈕；沒人質疑就執行', () => {
    const r = act('p3', 'tax', started(3).state);
    expect(r.state.phase).toBe('challenge');
    expect(announces(r.events).join('\n')).toContain('<@p3> 宣稱「公爵」');
    expect(prompts(r.events, 'challenge').at(-1)!.options).toEqual([{ value: 'challenge', label: '質疑' }]);
    expect(lastTimer(r.events).ms).toBe(20_000);
    const after = passWindow(r);
    expect(after.state.players[2].coins).toBe(5);
    expect(after.state).toMatchObject({ phase: 'action', turn: 0 });
  });

  it('質疑成功：說謊的人失去一個影響力，行動失敗', () => {
    const r = challenge('p1', act('p3', 'tax', started(3).state).state);
    expect(announces(r.events).join('\n')).toContain('質疑成功');
    expect(r.state).toMatchObject({ phase: 'lose', losing: ['p3'] });
    const after = reveal('p3', 0, r.state);
    expect(after.state.players[2].coins).toBe(2);
    expect(after.state).toMatchObject({ phase: 'action', turn: 0 });
  });

  it('質疑失敗：翻給大家看、換一張新牌，質疑的人失去一個影響力，行動照常', () => {
    const s = { ...started(3).state, turn: 1 };
    const r = challenge('p1', act('p2', 'tax', s).state);
    expect(announces(r.events).join('\n')).toContain('<@p2> 真的有「公爵」');
    expect(r.state.deck).not.toEqual(s.deck);
    expect(r.state.losing).toEqual(['p1']);
    const after = reveal('p1', 0, r.state);
    expect(after.state.players[1].coins).toBe(5);
  });

  it('刺殺：選目標時付 3 枚；質疑失敗的目標先失去一張，沒阻擋就再被刺殺', () => {
    const s = coins(started(3).state, [2, 2, 3]);
    const r = target('p3', 'p1', act('p3', 'assassinate', s).state);
    expect(r.state.players[2].coins).toBe(0);
    expect(r.state.phase).toBe('challenge');
    const lost = challenge('p1', r.state);
    const blocking = reveal('p1', 0, lost.state);
    expect(blocking.state.phase).toBe('block');
    const after = passWindow(blocking);
    expect(after.state.players[0].cards.every((x) => x.revealed)).toBe(true);
    expect(announces(after.events).join('\n')).toContain('<@p1> 出局');
  });

  it('勒索：從目標拿 2 枚（不足就拿光）', () => {
    const s = coins(started(3).state, [1, 2, 2]);
    expect(passWindow(passWindow(target('p3', 'p2', act('p3', 'steal', s).state))).state.players.map((p) => p.coins)).toEqual([1, 0, 4]);
    expect(passWindow(passWindow(target('p3', 'p1', act('p3', 'steal', s).state))).state.players.map((p) => p.coins)).toEqual([0, 2, 3]);
  });

  it('宣稱的人自己、出局的人不能質疑', () => {
    const r = act('p3', 'tax', started(3).state);
    expect(challenge('p3', r.state).state.phase).toBe('challenge');
    const dead = withCards(r.state, 0, [true, true]);
    expect(challenge('p1', dead).state.phase).toBe('challenge');
  });
});

const block = (user: string, role: string, s: KState) => run([{ type: 'block', user, role } as KAction], s);

describe('coup/turns: 阻擋', () => {
  it('外援：任何人可以宣稱公爵阻擋，20 秒；沒人阻擋就拿 2 枚', () => {
    const r = act('p3', 'foreignAid', started(3).state);
    expect(r.state.phase).toBe('block');
    expect(prompts(r.events, 'block').at(-1)!.options).toEqual([{ value: 'duke', label: '用公爵阻擋' }]);
    expect(lastTimer(r.events).ms).toBe(20_000);
    expect(passWindow(r).state.players[2].coins).toBe(4);
  });

  it('阻擋後開質疑視窗；沒人質疑就擋下來', () => {
    const r = block('p1', 'duke', act('p3', 'foreignAid', started(3).state).state);
    expect(r.state).toMatchObject({ phase: 'challenge', claim: { by: 'p1', role: 'duke', forBlock: true } });
    const after = passWindow(r);
    expect(after.state.players[2].coins).toBe(2);
    expect(announces(after.events).join('\n')).toContain('被擋下來');
    expect(after.state).toMatchObject({ phase: 'action', turn: 0 });
  });

  it('阻擋的人說謊被抓：阻擋的人失去影響力，行動照常', () => {
    const s = { ...started(3).state, turn: 0 };
    const r = challenge('p1', block('p3', 'duke', act('p1', 'foreignAid', s).state).state);
    expect(r.state.losing).toEqual(['p3']);
    expect(reveal('p3', 0, r.state).state.players[0].coins).toBe(4);
  });

  it('刺殺只有目標能用女伯爵阻擋；擋下來時 3 枚不退', () => {
    const s = coins(started(3).state, [2, 2, 3]);
    const blocking = passWindow(target('p3', 'p1', act('p3', 'assassinate', s).state));
    expect(blocking.state.phase).toBe('block');
    expect(prompts(blocking.events, 'block').at(-1)!.options).toEqual([{ value: 'contessa', label: '用女伯爵阻擋' }]);
    expect(block('p2', 'contessa', blocking.state).state.phase).toBe('block');
    const after = passWindow(block('p1', 'contessa', blocking.state));
    expect(after.state.players[2].coins).toBe(0);
    expect(after.state.players[0].cards.some((x) => x.revealed)).toBe(false);
  });

  it('勒索可以用隊長或大使阻擋', () => {
    const blocking = passWindow(target('p3', 'p2', act('p3', 'steal', started(3).state).state));
    expect(prompts(blocking.events, 'block').at(-1)!.options.map((o) => o.value)).toEqual(['captain', 'ambassador']);
    expect(block('p2', 'contessa', blocking.state).state.phase).toBe('block');
    expect(block('p2', 'ambassador', blocking.state).state.phase).toBe('challenge');
  });
});

const keep = (user: string, indexes: number[], s: KState) =>
  run(indexes.map((index) => ({ type: 'keep', user, index }) as KAction), s);

describe('coup/turns: 交換', () => {
  // p3（刺客刺客）宣稱大使交換，沒人質疑；牌堆最上面是隊長、隊長
  const exchanging = () => passWindow(act('p3', 'exchange', started(3).state));

  it('私訊手上的牌加上牌堆抽的 2 張，選要留下的張數', () => {
    const { state, events } = exchanging();
    expect(state.phase).toBe('exchange');
    const p = prompts(events, 'keepCard').at(-1)!;
    expect(p).toMatchObject({ audience: 'user', user: 'p3' });
    expect(p.options.map((o) => o.label)).toEqual(['刺客', '刺客', '隊長', '隊長']);
    expect(lastTimer(events).ms).toBe(30_000);
  });

  it('選完後換成新的手牌，其他放回牌堆，輪到下一位', () => {
    const s = exchanging().state;
    const deckSize = s.deck.length;
    const { state, events } = keep('p3', [2, 3], s);
    expect(state.players[2].cards.map((x) => x.role)).toEqual(['captain', 'captain']);
    expect(state.deck).toHaveLength(deckSize + 2);
    expect(state.deck.filter((r) => r === 'assassin')).toHaveLength(2);
    expect(state).toMatchObject({ phase: 'action', turn: 0 });
    expect(events.some((e) => e.type === 'dm' && e.to === 'p3' && e.text.includes('隊長、隊長'))).toBe(true);
  });

  it('只剩一張牌時只留一張；只有交換的人能選；30 秒超時留原本的牌', () => {
    const one = passWindow(act('p3', 'exchange', withCards(started(3).state, 2, [true, false])));
    expect(prompts(one.events, 'keepCard').at(-1)!.options).toHaveLength(3);
    expect(keep('p3', [1], one.state).state.phase).toBe('action');
    const s = exchanging();
    expect(keep('p1', [2], s.state).state.phase).toBe('exchange');
    const after = run([{ type: 'timeout', id: lastTimer(s.events).id }], s.state);
    expect(after.state.players[2].cards.map((x) => x.role)).toEqual(['assassin', 'assassin']);
  });
});

// 1 真人 + 2 bot：p1 公爵公爵、bot1 公爵刺客、bot2 刺客刺客；bot2 先（金幣不夠刺殺，收入），接著 p1
const withBots = () => run([{ type: 'addBot', user: 'p1', count: 2 }, { type: 'start', user: 'p1' }], lobbyWith(1).state);
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe('coup/bots: bot 的行動與反應', () => {
  it('bot 立刻行動：沒有能用的角色就收入，輪到真人', () => {
    const { state } = withBots();
    expect(state.players[2].coins).toBe(3);
    expect(state).toMatchObject({ phase: 'action', turn: 0 });
  });

  it('bot 手上有公爵就收稅', () => {
    const { state } = act('p1', 'income', withBots().state);
    expect(state.claim).toMatchObject({ by: state.players[1].id, role: 'duke' });
  });

  it('bot 手上有能阻擋的角色就阻擋', () => {
    const { state } = act('p1', 'foreignAid', withBots().state);
    expect(state.phase).toBe('challenge');
    expect(state.claim).toMatchObject({ by: state.players[1].id, role: 'duke', forBlock: true });
  });

  it('bot 失去影響力時立刻隨機翻一張', () => {
    const s = coins(withBots().state, [7, 2, 3]);
    const { state } = target('p1', s.players[1].id, act('p1', 'coup', s).state);
    expect(state.players[1].cards.filter((x) => x.revealed)).toHaveLength(1);
    expect(state.phase).not.toBe('lose');
  });

  it('1 位真人加 bot、真人什麼都不做，遊戲一定會結束', () => {
    for (const bots of [2, 3, 5]) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = seeded(seed);
        let s = run([{ type: 'addBot', user: 'p1', count: bots }, { type: 'start', user: 'p1' }], lobbyWith(1).state, r).state;
        for (let step = 0; step < 1000 && s.phase !== 'ended'; step++) s = applyCoup(s, { type: 'timeout', id: s.timers.phase! }, r).state;
        expect(s.phase, `${bots} bots, seed ${seed}`).toBe('ended');
      }
    }
  });
});
