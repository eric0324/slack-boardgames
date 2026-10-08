import { describe, expect, it } from 'vitest';
import { mention, type GameEvent } from '../src/engine.js';
import { applyUndercover, checkUndercoverWinner, UNDERCOVER_TABLE, type UAction, type UState } from '../src/undercover.js';
import { BLANK_LINES, WORD_PAIRS } from '../src/undercoverWords.js';

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

const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const lastTimer = (events: GameEvent[]) => events.filter((e) => e.type === 'startTimer').at(-1) as { id: number; ms: number };

// 4 人局（p1 臥底、p2~p4 平民），rng 固定時第一輪從最後一位 p4 開始：p4 → p1 → p2 → p3
describe('undercover/rounds: 輪流描述', () => {
  it('公告描述順序，輪到第一位描述 40 秒', () => {
    const { state, events } = startedU(4);
    expect(state).toMatchObject({ phase: 'speech', speaker: 'p4' });
    expect(announces(events)).toContainEqual(expect.stringContaining('<@p4> → <@p1> → <@p2> → <@p3>'));
    expect(prompts(events, 'endSpeech').at(-1)).toMatchObject({ text: expect.stringContaining('輪到 <@p4> 描述（40 秒）') });
    expect(lastTimer(events).ms).toBe(40_000);
  });

  it('時間到換下一位', () => {
    const { state, events } = startedU(4);
    expect(run([{ type: 'timeout', id: lastTimer(events).id }], state).state.speaker).toBe('p1');
  });

  it('發言者提前結束；不是發言者按結束發言會被拒絕', () => {
    const { state } = startedU(4);
    expect(run([{ type: 'endSpeech', user: 'p4' }], state).state.speaker).toBe('p1');
    const denied = run([{ type: 'endSpeech', user: 'p2' }], state);
    expect(denied.state.speaker).toBe('p4');
    expect(ephemeralTo(denied.events, 'p2')).toMatchObject({ text: expect.stringContaining('不是你的發言時間') });
  });

  it('房主可以跳過發言者，也可以直接進入投票', () => {
    const { state } = startedU(4);
    expect(run([{ type: 'skipSpeaker', user: 'p1' }], state).state.speaker).toBe('p1');
    expect(run([{ type: 'endDiscussion', user: 'p1' }], state).state.phase).toBe('vote');
  });

  it('全部描述完直接進入投票', () => {
    const { state } = startedU(4);
    const done = run(['p4', 'p1', 'p2', 'p3'].map((user) => ({ type: 'endSpeech', user }) as UAction), state);
    expect(done.state.phase).toBe('vote');
  });
});

const voting4 = () => run([{ type: 'endDiscussion', user: 'p1' }], startedU(4).state);
const votes = (pairs: [string, string][]) => pairs.map(([user, target]) => ({ type: 'dayVote', user, target }) as UAction);

describe('undercover/rounds: 投票與 PK', () => {
  it('投票訊息列出存活玩家和棄票，計時 60 秒', () => {
    const { events } = voting4();
    const [p] = prompts(events, 'dayVote');
    expect(p.options.map((o) => o.value)).toEqual(['p1', 'p2', 'p3', 'p4', 'abstain']);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('單一最高票被放逐，公開每個人的投票', () => {
    const { state, events } = run(votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p4', 'p1']]), voting4().state);
    expect(announces(events).join('\n')).toContain('<@p1> → <@p4>');
    expect(state.players.find((p) => p.id === 'p4')!.alive).toBe(false);
  });

  it('時限內可以改票；投票期間只有本人看到自己投給誰', () => {
    const first = run(votes([['p1', 'p4']]), voting4().state);
    expect(first.events).toEqual([{ type: 'ephemeral', to: 'p1', text: expect.stringContaining('<@p4>') }]);
    expect(run(votes([['p1', 'p3']]), first.state).state.votes.p1).toBe('p3');
  });

  it('時間到沒投票的人算棄票；全部棄票就沒有人出局，開始下一輪', () => {
    const { state, events } = voting4();
    const after = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(announces(after.events)).toContainEqual(expect.stringContaining('沒有人出局'));
    expect(after.state).toMatchObject({ phase: 'speech', round: 2 });
    expect(after.state.players.every((p) => p.alive)).toBe(true);
  });

  it('平票進入 PK：平手的人依加入順序再描述，接著只能投平手的人，平手的人不能投', () => {
    const tied = run(votes([['p1', 'p3'], ['p2', 'p4'], ['p3', 'p4'], ['p4', 'p3']]), voting4().state);
    expect(tied.state).toMatchObject({ phase: 'pkSpeech', speaker: 'p3' });
    expect(announces(tied.events)).toContainEqual(expect.stringContaining('PK'));
    const pk = run(
      [
        { type: 'endSpeech', user: 'p3' },
        { type: 'endSpeech', user: 'p4' },
      ],
      tied.state,
    );
    expect(pk.state.phase).toBe('pkVote');
    expect(prompts(pk.events, 'pkVote')[0].options.map((o) => o.value)).toEqual(['p3', 'p4', 'abstain']);
    const denied = run(votes([['p3', 'p4']]), pk.state);
    expect(ephemeralTo(denied.events, 'p3')).toMatchObject({ text: expect.stringContaining('PK') });
  });

  it('PK 仍然平手：這一輪沒有人出局，開始下一輪', () => {
    const tied = run(votes([['p1', 'p3'], ['p2', 'p4'], ['p3', 'p4'], ['p4', 'p3']]), voting4().state);
    const pk = run([{ type: 'endSpeech', user: 'p3' }, { type: 'endSpeech', user: 'p4' }], tied.state).state;
    const { state, events } = run(votes([['p1', 'p3'], ['p2', 'p4']]), pk);
    expect(announces(events)).toContainEqual(expect.stringContaining('沒有人出局'));
    expect(state).toMatchObject({ phase: 'speech', round: 2 });
  });
});

// 6 人局：p1 臥底、p2 白板、p3~p6 平民。所有人都投 target，target 自己投給別人
const voting6 = () => run([{ type: 'endDiscussion', user: 'p1' }], startedU(6).state);
const exile6 = (target: string, from = voting6().state) => {
  const others = from.players.filter((p) => p.alive).map((p) => p.id);
  return run(votes(others.map((u) => [u, u === target ? others.find((o) => o !== target)! : target])), from);
};

describe('undercover/rounds: 出局公開身分', () => {
  it('放逐平民：公開身分是平民，不公開詞', () => {
    const { state, events } = exile6('p3');
    const text = announces(events).join('\n');
    expect(text).toContain('<@p3> 出局，身分是平民');
    expect(text).not.toContain(state.words!.civilian);
    expect(state.phase).toBe('speech');
  });

  it('放逐臥底：公開身分是臥底', () => {
    expect(announces(exile6('p1').events)).toContainEqual(expect.stringContaining('<@p1> 出局，身分是臥底'));
  });

  it('出局的玩家不能描述也不能投票', () => {
    const { state } = exile6('p3');
    expect(state.speakers.concat(state.speaker ?? [])).not.toContain('p3');
  });
});

describe('undercover/rounds: 白板猜詞', () => {
  it('放逐白板：公開身分是白板，給 60 秒猜詞', () => {
    const { state, events } = exile6('p2');
    expect(announces(events)).toContainEqual(expect.stringContaining('<@p2> 出局，身分是白板'));
    expect(announces(events).join('\n')).toContain('/game undercover guess');
    expect(state).toMatchObject({ phase: 'guess', guesser: 'p2' });
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('白板猜中（忽略前後空白和大小寫）：臥底陣營獲勝', () => {
    const { state } = exile6('p2');
    const guess = `  ${state.words!.civilian.toUpperCase()} `;
    const after = run([{ type: 'guess', user: 'p2', word: guess }], state);
    expect(announces(after.events)).toContainEqual(expect.stringContaining('猜中'));
    expect(after.state).toMatchObject({ phase: 'ended', winner: 'undercover' });
  });

  it('白板猜錯：照一般規則繼續遊戲，而且不能再猜', () => {
    const { state } = exile6('p2');
    const after = run([{ type: 'guess', user: 'p2', word: state.words!.undercover }], state);
    expect(announces(after.events)).toContainEqual(expect.stringContaining('沒猜中'));
    expect(after.state.phase).toBe('speech');
    const again = run([{ type: 'guess', user: 'p2', word: state.words!.civilian }], after.state);
    expect(ephemeralTo(again.events, 'p2')).toMatchObject({ text: '現在不能猜詞。' });
  });

  it('白板 60 秒內沒有猜：視為沒猜中', () => {
    const { state, events } = exile6('p2');
    const after = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(after.state.phase).toBe('speech');
  });

  it('不是被放逐的白板不能猜', () => {
    const { state } = exile6('p2');
    const denied = run([{ type: 'guess', user: 'p3', word: state.words!.civilian }], state);
    expect(denied.state.phase).toBe('guess');
    expect(ephemeralTo(denied.events, 'p3')).toMatchObject({ text: '現在不能猜詞。' });
  });
});

const nextVote = (s: UState) => run([{ type: 'endDiscussion', user: 'p1' }], s).state;

describe('undercover/win-condition: 勝負判定', () => {
  it('臥底全部出局（沒有白板的局）：平民獲勝', () => {
    const { state } = run(votes([['p2', 'p1'], ['p3', 'p1'], ['p4', 'p1'], ['p1', 'p2']]), voting4().state);
    expect(state).toMatchObject({ phase: 'ended', winner: 'civilian' });
  });

  it('臥底和白板都出局：平民獲勝（先放逐白板、白板猜錯，再放逐臥底）', () => {
    const guessing = exile6('p2').state;
    const afterBlank = run([{ type: 'guess', user: 'p2', word: guessing.words!.undercover }], guessing).state;
    expect(afterBlank.phase).toBe('speech');
    expect(exile6('p1', nextVote(afterBlank)).state).toMatchObject({ phase: 'ended', winner: 'civilian' });
  });

  it('臥底出局但白板還活著：平民獲勝，遊戲立刻結束', () => {
    const { state, events } = exile6('p1');
    expect(state).toMatchObject({ phase: 'ended', winner: 'civilian' });
    expect(state.players.find((p) => p.id === 'p2')!.alive).toBe(true);
    expect(announces(events).join('\n')).toContain('平民獲勝');
  });

  it('兩位臥底只出局一位：遊戲繼續；兩位都出局：平民獲勝', () => {
    const P = (role: 'civilian' | 'undercover' | 'blank', alive = true) => ({ id: role, alive, role });
    const civilians = Array.from({ length: 6 }, () => P('civilian'));
    expect(checkUndercoverWinner([P('undercover', false), P('undercover'), P('blank'), ...civilians])).toBeNull();
    expect(checkUndercoverWinner([P('undercover', false), P('undercover', false), P('blank'), ...civilians])).toBe('civilian');
  });

  it('臥底陣營追上平民：臥底陣營獲勝', () => {
    // 6 人局放逐兩位平民後：1 臥底、1 白板、2 平民
    const round2 = exile6('p3').state;
    const { state } = exile6('p4', nextVote(round2));
    expect(state).toMatchObject({ phase: 'ended', winner: 'undercover' });
  });

  it('還沒分出勝負：開始下一輪', () => {
    const { state } = run(votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p4', 'p1']]), voting4().state);
    expect(state).toMatchObject({ phase: 'speech', round: 2 });
  });
});

describe('undercover/win-condition: 結束公開與再來一局', () => {
  const ended = () => run(votes([['p2', 'p1'], ['p3', 'p1'], ['p4', 'p1'], ['p1', 'p2']]), voting4().state);

  it('公告獲勝陣營、兩個詞，以及每個人的身分、詞和存活狀態', () => {
    const { state, events } = ended();
    const text = announces(events).find((t) => t.includes('遊戲結束'))!;
    expect(text).toContain('平民獲勝');
    expect(text).toContain(`平民詞：${state.words!.civilian}／臥底詞：${state.words!.undercover}`);
    expect(text).toMatch(new RegExp(`<@p1>.*臥底.*${state.words!.undercover}.*出局`));
    expect(text).toMatch(new RegExp(`<@p2>.*平民.*${state.words!.civilian}.*存活`));
    expect(prompts(events, 'rematch')).toHaveLength(1);
  });

  it('上一局的玩家按再來一局：開一個新的誰是臥底房間', () => {
    const { state, events } = run([{ type: 'rematch', user: 'p3', channel: 'C1' }], ended().state);
    expect(state).toMatchObject({ game: 'undercover', phase: 'lobby', host: 'p3' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', title: '誰是臥底', host: 'p3' }));
  });

  it('不是上一局的玩家不能按；取消的遊戲沒有再來一局', () => {
    const outsider = run([{ type: 'rematch', user: 'X', channel: 'C1' }], ended().state);
    expect(ephemeralTo(outsider.events, 'X')).toBeDefined();
    const cancelled = run([{ type: 'cancel', user: 'p1' }], startedU(4).state).state;
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], cancelled).events).toEqual([]);
  });
});

// 1 真人 + 5 bot：p1 臥底、bot1 白板、bot2~bot5 平民；第一輪從 bot5 開始 → bot5 描述完輪到 p1
const withBotsU = () => run([{ type: 'addBot', user: 'p1', count: 5 }, { type: 'start', user: 'p1' }], lobbyWith(1).state);
const botN = (s: UState, n: number) => s.players.find((p) => p.id.startsWith(`bot:${n}:`))!.id;
const botSays = (events: GameEvent[], id: string) => announces(events).filter((t) => t.startsWith(`${mention(id)}：`));
const seededU = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe('undercover/bots: bot 描述', () => {
  it('平民 bot 用自己詞的描述句，裡面沒有出現兩個詞，接著立刻換下一位', () => {
    const { state, events } = withBotsU();
    const bot5 = botN(state, 5);
    const [line] = botSays(events, bot5);
    const hints = WORD_PAIRS.flatMap(({ a, b }) => [a, b]).find((w) => w.word === state.words!.civilian)!.hints;
    expect(hints.some((h) => line.endsWith(h))).toBe(true);
    expect(line).not.toContain(state.words!.civilian);
    expect(line).not.toContain(state.words!.undercover);
    expect(state.speaker).toBe('p1');
  });

  it('白板 bot 說通用的模糊台詞', () => {
    const { state } = withBotsU();
    const { events } = run([{ type: 'endSpeech', user: 'p1' }], state);
    const [line] = botSays(events, botN(state, 1));
    expect(BLANK_LINES.some((l) => line.endsWith(l))).toBe(true);
  });

  it('同一局同一位 bot 的描述盡量不重複', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = seededU(seed);
      let s = applyUndercover(undefined, { type: 'new', user: 'p1', channel: 'C1' }, r).state;
      s = applyUndercover(s, { type: 'addBot', user: 'p1', count: 11 }, r).state;
      let res = applyUndercover(s, { type: 'start', user: 'p1' }, r);
      const said: Record<string, string[]> = {};
      for (let step = 0; step < 300; step++) {
        for (const t of announces(res.events)) {
          const m = /^(🤖\S+)：(.*)$/.exec(t);
          if (m && !t.includes('猜')) (said[m[1]] ??= []).push(m[2]);
        }
        if (res.state.phase === 'ended') break;
        res = applyUndercover(res.state, { type: 'timeout', id: res.state.timers.phase! }, r);
      }
      for (const lines of Object.values(said)) {
        const first3 = lines.slice(0, 3);
        expect(new Set(first3).size, `seed ${seed}`).toBe(first3.length);
      }
    }
  });
});

describe('undercover/bots: bot 投票與猜詞', () => {
  it('進入投票時，每個存活的 bot 立刻投給一位不是自己的候選人', () => {
    const vote = run([{ type: 'endDiscussion', user: 'p1' }], withBotsU().state).state;
    for (const p of vote.players.filter((x) => x.id.startsWith('bot:'))) {
      expect(vote.votes[p.id]).toBeDefined();
      expect(vote.votes[p.id]).not.toBe(p.id);
      expect(vote.votes[p.id]).not.toBe('abstain');
    }
  });

  it('白板 bot 被放逐時立刻猜詞（從平民詞、臥底詞、另一個隨機的詞中選）', () => {
    const vote = run([{ type: 'endDiscussion', user: 'p1' }], withBotsU().state).state;
    const blank = botN(vote, 1);
    // 讓白板 bot 被放逐：真人也投給白板 bot，再把 bot 的票都改成投白板 bot
    const patched: UState = { ...vote, votes: Object.fromEntries(Object.keys(vote.votes).map((v) => [v, v === blank ? 'p1' : blank])) };
    const { state, events } = run(votes([['p1', blank]]), patched);
    const guess = announces(events).find((t) => t.startsWith(`🎯 ${mention(blank)}`) || t.startsWith(`${mention(blank)} 猜`))!;
    expect(guess).toBeDefined();
    expect(state.phase).not.toBe('guess');
  });

  it('1 位真人加 bot、真人什麼都不做，遊戲一定會結束', () => {
    for (const bots of [3, 5, 11]) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = seededU(seed);
        let s = applyUndercover(undefined, { type: 'new', user: 'p1', channel: 'C1' }, r).state;
        s = applyUndercover(s, { type: 'addBot', user: 'p1', count: bots }, r).state;
        s = applyUndercover(s, { type: 'start', user: 'p1' }, r).state;
        for (let step = 0; step < 500 && s.phase !== 'ended'; step++) {
          s = applyUndercover(s, { type: 'timeout', id: s.timers.phase! }, r).state;
        }
        expect(s.phase, `${bots} bots, seed ${seed}`).toBe('ended');
      }
    }
  });
});

const gifOf = (events: GameEvent[], text: string) =>
  (events.find((e) => e.type === 'announce' && e.text.includes(text)) as { gif?: string } | undefined)?.gif;
const gifs = (events: GameEvent[]) => events.filter((e) => e.type === 'announce' && e.gif).map((e) => (e as { gif: string }).gif);

describe('announcement-gifs: 誰是臥底', () => {
  it('放逐平民或白板：附「放逐」的 GIF', () => {
    expect(gifOf(exile6('p3').events, '出局')).toBe('exile');
    expect(gifOf(exile6('p2').events, '出局')).toBe('exile');
  });

  it('放逐到最後一位臥底：結束公告附「抓到了」的 GIF，只有一張', () => {
    const { events } = run(votes([['p2', 'p1'], ['p3', 'p1'], ['p4', 'p1'], ['p1', 'p2']]), voting4().state);
    expect(gifs(events)).toEqual(['duelWin']);
    expect(gifOf(events, '遊戲結束')).toBe('duelWin');
  });

  it('放逐平民後臥底陣營追上：結束公告附「放逐」的 GIF，只有一張', () => {
    const { events } = exile6('p4', nextVote(exile6('p3').state));
    expect(gifs(events)).toEqual(['exile']);
    expect(gifOf(events, '遊戲結束')).toBe('exile');
  });

  it('白板猜中：結束公告附「猜對了」；猜錯而遊戲繼續：附「猜錯了」', () => {
    const { state } = exile6('p2');
    const right = run([{ type: 'guess', user: 'p2', word: state.words!.civilian }], state).events;
    expect(gifs(right)).toEqual(['guessRight']);
    expect(gifOf(right, '遊戲結束')).toBe('guessRight');
    const wrong = run([{ type: 'guess', user: 'p2', word: state.words!.undercover }], state).events;
    expect(gifOf(wrong, '沒猜中')).toBe('guessWrong');
  });
});
