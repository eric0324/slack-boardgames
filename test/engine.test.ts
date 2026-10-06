import { describe, expect, it } from 'vitest';
import { applyAction, checkWinner, dealRoles, isBot, mention, ROLE_TABLE, type Action, type GameEvent, type GameState, type Role } from '../src/engine.js';

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

  it('12 人局：4 狼、1 預言家、1 女巫、1 獵人、1 騎士、4 村民', () => {
    expect(count(dealRoles(12, Math.random))).toEqual({ werewolf: 4, seer: 1, witch: 1, hunter: 1, knight: 1, villager: 4 });
  });

  it('9 人以上才有騎士', () => {
    expect(count(dealRoles(8, Math.random)).knight).toBeUndefined();
    for (let n = 9; n <= 12; n++) expect(count(dealRoles(n, Math.random)).knight).toBe(1);
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

// rng 固定時，8 人局的發牌順序：p1~p3 狼人、p4 預言家、p5 女巫、p6 獵人、p7~p8 村民
const started = (n: number) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state);

describe('role-assignment: 私下通知身分', () => {
  it('每位玩家都收到私訊，裡面有自己的角色和能力說明', () => {
    const { state, events } = started(8);
    for (const p of state.players) {
      const dm = events.find((e) => e.type === 'dm' && e.to === p.id);
      expect(dm).toBeDefined();
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'dm', to: 'p1', text: expect.stringContaining('狼人') }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'dm', to: 'p4', text: expect.stringContaining('預言家') }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'dm', to: 'p7', text: expect.stringContaining('村民') }));
  });

  it('頻道公告只有玩家名單和角色數量，不寫誰是什麼角色', () => {
    const { events } = started(8);
    const texts = events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text).join('\n');
    expect(texts).toContain('<@p8>');
    expect(texts).toContain('3 狼人');
    expect(texts).not.toMatch(/<@p\d+>\s*[:：]?\s*(是)?\s*(狼人|預言家|女巫|獵人|村民)/);
  });
});

describe('role-assignment: 狼人互相認識', () => {
  it('所有狼人在同一個私密對話，裡面列出狼人名單', () => {
    const { events } = started(8);
    const chat = events.find((e) => e.type === 'wolfChat');
    expect(chat).toMatchObject({ wolves: ['p1', 'p2', 'p3'] });
    for (const w of ['p1', 'p2', 'p3']) expect((chat as { text: string }).text).toContain(`<@${w}>`);
  });
});

const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const timerIds = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'startTimer').map((e) => (e as { id: number }).id);
const wolfChatText = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'wolfChat').map((e) => (e as { text: string }).text).join('\n');

describe('night-phase: 夜晚流程與時限', () => {
  it('天黑公告，狼人和預言家收到行動提示，計時 60 秒', () => {
    const { events } = started(8);
    expect(events).toContainEqual({ type: 'announce', text: expect.stringContaining('第 1 夜'), gif: 'night' });
    const [wolf] = prompts(events, 'wolfKill');
    expect(wolf.audience).toBe('wolves');
    expect(wolf.options).toHaveLength(9);
    expect(wolf.options.at(-1)).toEqual({ value: 'none', label: '不殺人' });
    const [seer] = prompts(events, 'seerCheck');
    expect(seer).toMatchObject({ audience: 'user', user: 'p4' });
    expect(seer.options.map((o) => o.value)).not.toContain('p4');
    expect(events).toContainEqual(expect.objectContaining({ type: 'startTimer', ms: 60_000 }));
  });

  it('不是目前計時器的 timeout 會被忽略', () => {
    const { state } = started(8);
    const { state: after, events } = run([{ type: 'timeout', id: 999 }], state);
    expect(after).toBe(state);
    expect(events).toEqual([]);
  });
});

describe('night-phase: 狼人擊殺', () => {
  it('狼人意見一致，立刻決定目標並在狼人對話公布', () => {
    const { state, events } = run(
      [
        { type: 'wolfVote', user: 'p1', target: 'p7' },
        { type: 'wolfVote', user: 'p2', target: 'p7' },
        { type: 'wolfVote', user: 'p3', target: 'p7' },
      ],
      started(8).state,
    );
    expect(state.night!.wolfTarget).toBe('p7');
    expect(wolfChatText(events)).toContain('<@p7>');
  });

  it('還有狼人沒選時不會決定目標', () => {
    const { state } = run([{ type: 'wolfVote', user: 'p1', target: 'p7' }], started(8).state);
    expect(state.night!.wolfTarget).toBeUndefined();
  });

  it('狼人可以改選', () => {
    const { state } = run(
      [
        { type: 'wolfVote', user: 'p1', target: 'p7' },
        { type: 'wolfVote', user: 'p1', target: 'p8' },
        { type: 'wolfVote', user: 'p2', target: 'p8' },
        { type: 'wolfVote', user: 'p3', target: 'p8' },
      ],
      started(8).state,
    );
    expect(state.night!.wolfTarget).toBe('p8');
  });

  it('狼人意見平手時，從平手的人裡隨機選一位', () => {
    const s = run([{ type: 'wolfVote', user: 'p1', target: 'p5' }], started(6).state).state;
    const last: Action = { type: 'wolfVote', user: 'p2', target: 'p6' };
    const a = applyAction(s, last, () => 0).state.night!.wolfTarget;
    const b = applyAction(s, last, () => 0.99999).state.night!.wolfTarget;
    expect(new Set([a, b])).toEqual(new Set(['p5', 'p6']));
  });

  it('時限到了沒有狼人選擇，當晚沒有擊殺目標', () => {
    const { state, events } = started(8);
    const [id] = timerIds(events);
    const after = run([{ type: 'timeout', id }], state);
    expect(after.state.night!.wolfTarget).toBeNull();
    expect(wolfChatText(after.events)).toContain('沒有擊殺目標');
  });

  it('時限到了只有部分狼人選擇，用已經選的票決定', () => {
    const { state, events } = started(8);
    const [id] = timerIds(events);
    const after = run([{ type: 'wolfVote', user: 'p1', target: 'p8' }, { type: 'timeout', id }], state);
    expect(after.state.night!.wolfTarget).toBe('p8');
  });

  it('非狼人送出擊殺選擇會被忽略', () => {
    const { state } = started(8);
    const { state: after, events } = run([{ type: 'wolfVote', user: 'p7', target: 'p8' }], state);
    expect(after).toBe(state);
    expect(events).toEqual([]);
  });
});

describe('night-phase: 預言家查驗', () => {
  it('查到狼人', () => {
    const { events } = run([{ type: 'seerCheck', user: 'p4', target: 'p1' }], started(8).state);
    expect(events).toContainEqual({ type: 'dm', to: 'p4', text: '<@p1> 是狼人。' });
  });

  it('查到好人，不透露具體角色', () => {
    const { events } = run([{ type: 'seerCheck', user: 'p4', target: 'p5' }], started(8).state);
    expect(events).toContainEqual({ type: 'dm', to: 'p4', text: '<@p5> 是好人。' });
  });

  it('同一晚重複查驗會被忽略', () => {
    const { state } = run([{ type: 'seerCheck', user: 'p4', target: 'p5' }], started(8).state);
    expect(run([{ type: 'seerCheck', user: 'p4', target: 'p1' }], state).events).toEqual([]);
  });

  it('超時就放棄當晚的查驗', () => {
    const { state, events } = started(8);
    const [id] = timerIds(events);
    const after = run([{ type: 'timeout', id }], state).state;
    expect(run([{ type: 'seerCheck', user: 'p4', target: 'p1' }], after).events).toEqual([]);
  });

  it('不是預言家或查驗自己都會被忽略', () => {
    const { state } = started(8);
    expect(run([{ type: 'seerCheck', user: 'p7', target: 'p1' }], state).events).toEqual([]);
    expect(run([{ type: 'seerCheck', user: 'p4', target: 'p4' }], state).events).toEqual([]);
  });
});

// 8 人局：狼人 p1~p3 一起刀 target，接著輪到女巫 p5
const wolvesKill = (target: string, s: GameState = started(8).state) =>
  run(['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target }) as Action), s);
const witchPrompt = (events: GameEvent[]) => prompts(events, 'witch')[0];
const values = (p: { options: { value: string }[] }) => p.options.map((o) => o.value);

describe('night-phase: 女巫用藥', () => {
  it('狼人決定後，女巫收到刀口和用藥選項', () => {
    const p = witchPrompt(wolvesKill('p7').events);
    expect(p).toMatchObject({ audience: 'user', user: 'p5', text: expect.stringContaining('<@p7>') });
    expect(values(p)).toEqual(expect.arrayContaining(['save', 'poison:p1', 'skip']));
    expect(values(p)).not.toContain('poison:p5');
  });

  it('沒有擊殺目標時告訴女巫今晚沒有人被殺，也沒有解藥選項', () => {
    const { state, events } = started(8);
    const after = run([{ type: 'timeout', id: timerIds(events)[0] }], state);
    const p = witchPrompt(after.events);
    expect(p.text).toContain('沒有人被殺');
    expect(values(p)).not.toContain('save');
  });

  it('用解藥救人：解藥變成已使用', () => {
    const { state } = run([{ type: 'witchAct', user: 'p5', choice: 'save' }], wolvesKill('p7').state);
    expect(state.night!.saved).toBe(true);
    expect(state.potions.antidote).toBe(false);
  });

  it('用毒藥：毒藥變成已使用', () => {
    const { state } = run([{ type: 'witchAct', user: 'p5', choice: 'poison:p1' }], wolvesKill('p7').state);
    expect(state.night!.poisoned).toBe('p1');
    expect(state.potions.poison).toBe(false);
  });

  it('同一晚用了解藥就不能再下毒', () => {
    const { state } = run([{ type: 'witchAct', user: 'p5', choice: 'save' }], wolvesKill('p7').state);
    const after = run([{ type: 'witchAct', user: 'p5', choice: 'poison:p1' }], state);
    expect(after.state.night!.poisoned).toBeFalsy();
    expect(after.state.potions.poison).toBe(true);
  });

  it('第一夜可以自救', () => {
    const { state } = run([{ type: 'witchAct', user: 'p5', choice: 'save' }], wolvesKill('p5').state);
    expect(state.night!.saved).toBe(true);
  });

  it('第二夜以後不能自救：告訴她刀口是自己，但沒有解藥選項', () => {
    const night2 = { ...started(8).state, day: 2 };
    const { state, events } = wolvesKill('p5', night2);
    const p = witchPrompt(events);
    expect(p.text).toContain('<@p5>');
    expect(values(p)).not.toContain('save');
    expect(run([{ type: 'witchAct', user: 'p5', choice: 'save' }], state).state.night!.saved).toBeFalsy();
  });

  it('解藥用過之後看不到刀口', () => {
    const used = { ...started(8).state, potions: { antidote: false, poison: true } };
    const p = witchPrompt(wolvesKill('p7', used).events);
    expect(p.text).not.toContain('<@p7>');
    expect(values(p)).not.toContain('save');
  });

  it('超時就當作不使用', () => {
    const { state, events } = wolvesKill('p7');
    const witchTimer = timerIds(events).at(-1)!;
    const after = run([{ type: 'timeout', id: witchTimer }], state).state;
    expect(after.night!.witchDone).toBe(true);
    expect(after.potions).toEqual({ antidote: true, poison: true });
  });
});

// 8 人局一整晚：狼人刀 kill，預言家查 p1，女巫做 witch
const fullNight = (kill: string, witch: string) =>
  run(
    [
      ...['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: kill }) as Action),
      { type: 'seerCheck', user: 'p4', target: 'p1' },
      { type: 'witchAct', user: 'p5', choice: witch },
    ],
    started(8).state,
  );
const isDead = (s: GameState, id: string) => !s.players.find((p) => p.id === id)!.alive;
// 房主把遺言都跳過
const skipLastWords = (r: { state: GameState; events: GameEvent[] }) => {
  while (r.state.phase === 'lastWords') r = run([{ type: 'skipSpeaker', user: 'p1' }], r.state);
  return r;
};
// 第一夜結束，而且第一夜死者的遺言都講完了
const dawned = (kill: string, witch: string) => skipLastWords(fullNight(kill, witch));

describe('night-phase: 夜晚結算', () => {
  it('所有人行動完就進入結算', () => {
    const { state } = fullNight('p7', 'skip');
    expect(state.phase).not.toBe('night');
    expect(state.lastDeaths).toEqual(['p7']);
  });

  it('預言家還沒查驗時不會結算，等到預言家超時', () => {
    const { state, events } = started(8);
    const wolfTimer = timerIds(events)[0];
    const s = run(
      [
        ...['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: 'p7' }) as Action),
        { type: 'witchAct', user: 'p5', choice: 'skip' },
      ],
      state,
    ).state;
    expect(s.phase).toBe('night');
    expect(run([{ type: 'timeout', id: wolfTimer }], s).state.phase).not.toBe('night');
  });

  it('被刀又被救：沒有人死亡', () => {
    const { state } = fullNight('p7', 'save');
    expect(state.lastDeaths).toEqual([]);
    expect(isDead(state, 'p7')).toBe(false);
  });

  it('有人被刀、另一人被毒：兩人都死亡', () => {
    const { state } = fullNight('p7', 'poison:p8');
    expect([...state.lastDeaths].sort()).toEqual(['p7', 'p8']);
    expect(isDead(state, 'p7') && isDead(state, 'p8')).toBe(true);
  });

  it('沒有擊殺也沒有下毒：沒有人死亡', () => {
    const { state, events } = started(8);
    const after = run(
      [
        { type: 'timeout', id: timerIds(events)[0] },
        { type: 'witchAct', user: 'p5', choice: 'skip' },
      ],
      state,
    ).state;
    expect(after.lastDeaths).toEqual([]);
  });
});

// 用角色字串快速建立玩家，大寫開頭代表還活著，例如 'W' 活著的狼人、'w' 死掉的狼人
const ROLE_CODE: Record<string, Role> = { w: 'werewolf', v: 'villager', s: 'seer', i: 'witch', h: 'hunter', k: 'knight' };
const table = (codes: string) =>
  [...codes].map((ch, i) => ({ id: `p${i + 1}`, role: ROLE_CODE[ch.toLowerCase()], alive: ch !== ch.toLowerCase() }));

describe('win-condition: 屠邊勝負規則', () => {
  it('狼人全滅：好人獲勝', () => {
    expect(checkWinner(table('wwSIHVV'))).toBe('good');
  });

  it('村民全滅：狼人獲勝，即使神職還活著', () => {
    expect(checkWinner(table('WwSIHvv'))).toBe('wolves');
  });

  it('神職全滅：狼人獲勝，即使村民還活著', () => {
    expect(checkWinner(table('WwsihVV'))).toBe('wolves');
  });

  it('騎士算神職：騎士還活著時，其他神職死光也不算狼人獲勝', () => {
    expect(checkWinner(table('WwsihKVV'))).toBeNull();
    expect(checkWinner(table('WwsihkVV'))).toBe('wolves');
  });

  it('6 人局沒有獵人：預言家和女巫都死了，狼人獲勝', () => {
    expect(checkWinner(table('WwsiVV'))).toBe('wolves');
  });

  it('兩邊同時成立：好人獲勝', () => {
    expect(checkWinner(table('wwSIHvv'))).toBe('good');
  });

  it('雙方都還有人：勝負未定', () => {
    expect(checkWinner(table('WwSihVv'))).toBeNull();
  });
});

// 6 人局（p1、p2 狼人，p3 預言家，p4 女巫，p5、p6 村民）。預言家已死，狼人今晚刀女巫 → 神職全滅，狼人獲勝
function wolvesWinTonight() {
  const s = started(6).state;
  const seerDead: GameState = {
    ...s,
    players: s.players.map((p) => (p.id === 'p3' ? { ...p, alive: false } : p)),
    night: { ...s.night!, seerDone: true },
  };
  return run(
    [
      { type: 'wolfVote', user: 'p1', target: 'p4' },
      { type: 'wolfVote', user: 'p2', target: 'p4' },
      { type: 'witchAct', user: 'p4', choice: 'skip' },
    ],
    seerDead,
  );
}

describe('win-condition: 遊戲結束公開身分', () => {
  it('公告獲勝陣營，列出所有玩家的角色和存活狀態', () => {
    const { state, events } = wolvesWinTonight();
    expect(state.phase).toBe('ended');
    const text = events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text).join('\n');
    expect(text).toContain('狼人陣營獲勝');
    expect(text).toMatch(/<@p1>.*狼人.*存活/);
    expect(text).toMatch(/<@p3>.*預言家.*死亡/);
    expect(text).toMatch(/<@p6>.*村民.*存活/);
  });

  it('結束後所有操作都沒有作用', () => {
    const { state } = wolvesWinTonight();
    expect(run([{ type: 'wolfVote', user: 'p1', target: 'p5' }], state).events).toEqual([]);
    expect(run([{ type: 'cancel', user: 'p1' }], state).events).toEqual([]);
  });

  it('結束後可以重新開房', () => {
    const { state } = wolvesWinTonight();
    const after = run([{ type: 'new', user: 'p9', channel: 'C1' }], state).state;
    expect(after).toMatchObject({ phase: 'lobby', host: 'p9' });
  });
});

const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);

describe('day-phase: 天亮公布死訊', () => {
  it('公布昨晚死亡的玩家，不透露死因和角色', () => {
    const { events } = fullNight('p7', 'poison:p8');
    const dawn = announces(events).find((t) => t.includes('天亮'))!;
    expect(dawn).toContain('<@p7>');
    expect(dawn).toContain('<@p8>');
    expect(dawn).not.toMatch(/狼人|村民|毒|刀|殺/);
    expect(dawn).toContain('不要再發言');
  });

  it('多位死者的順序隨機', () => {
    const night = run(
      [
        ...['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: 'p7' }) as Action),
        { type: 'seerCheck', user: 'p4', target: 'p1' },
      ],
      started(8).state,
    ).state;
    const last: Action = { type: 'witchAct', user: 'p5', choice: 'poison:p8' };
    const order = (r: number) => announces(applyAction(night, last, () => r).events).find((t) => t.includes('天亮'));
    expect(order(0)).not.toBe(order(0.99999));
  });

  it('平安夜', () => {
    const { events } = fullNight('p7', 'save');
    expect(announces(events)).toContainEqual(expect.stringContaining('平安夜'));
  });
});

describe('win-condition: 判定時機', () => {
  it('天亮就分出勝負：先公布死訊再結束，不進入討論', () => {
    const { state, events } = wolvesWinTonight();
    const texts = announces(events);
    expect(texts.findIndex((t) => t.includes('天亮'))).toBeLessThan(texts.findIndex((t) => t.includes('遊戲結束')));
    expect(state.phase).toBe('ended');
    expect(texts.some((t) => t.includes('討論'))).toBe(false);
  });
});

const lastTimer = (events: GameEvent[]) => events.filter((e) => e.type === 'startTimer').at(-1) as { id: number; ms: number };

const speechPrompt = (events: GameEvent[]) => prompts(events, 'endSpeech').at(-1);
const lastPerWitch = (rng: () => number) => {
  const night = run(
    [
      ...['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: 'p7' }) as Action),
      { type: 'seerCheck', user: 'p4', target: 'p1' },
    ],
    started(8).state,
  ).state;
  const r = applyAction(night, { type: 'witchAct', user: 'p5', choice: 'skip' }, rng);
  return applyAction(r.state, { type: 'skipSpeaker', user: 'p1' }, rng);
};

// fullNight('p7', 'skip') 之後：存活 p1~p6、p8，rng 固定時從最後一位 p8 開始
describe('day-phase: 輪流發言', () => {
  it('公告發言順序（跳過死亡的 p7），輪到第一位發言 40 秒', () => {
    const { state, events } = dawned('p7', 'skip');
    expect(state).toMatchObject({ phase: 'speech', speaker: 'p8' });
    expect(announces(events)).toContainEqual(expect.stringContaining('<@p8> → <@p1> → <@p2> → <@p3> → <@p4> → <@p5> → <@p6>'));
    const p = speechPrompt(events)!;
    expect(p).toMatchObject({ audience: 'channel', text: expect.stringContaining('輪到 <@p8> 發言（40 秒）') });
    expect(values(p)).toEqual(['p8']);
    expect(lastTimer(events).ms).toBe(40_000);
  });

  it('起點是隨機的', () => {
    expect(lastPerWitch(() => 0).state.speaker).toBe('p1');
    expect(lastPerWitch(() => 0.99999).state.speaker).toBe('p8');
  });

  it('時間到換下一位', () => {
    const { state, events } = dawned('p7', 'skip');
    const next = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(next.state.speaker).toBe('p1');
    expect(speechPrompt(next.events)!.text).toContain('輪到 <@p1> 發言');
  });

  it('發言者提前結束', () => {
    const { state } = dawned('p7', 'skip');
    expect(run([{ type: 'endSpeech', user: 'p8' }], state).state.speaker).toBe('p1');
  });

  it('不是發言者按結束發言：不換人，提示本人', () => {
    const { state } = dawned('p7', 'skip');
    const after = run([{ type: 'endSpeech', user: 'p2' }], state);
    expect(after.state.speaker).toBe('p8');
    expect(ephemeralTo(after.events, 'p2')).toMatchObject({ text: expect.stringContaining('不是你的發言時間') });
  });

  it('房主可以跳過發言者，非房主不行', () => {
    const { state } = dawned('p7', 'skip');
    expect(run([{ type: 'skipSpeaker', user: 'p1' }], state).state.speaker).toBe('p1');
    const denied = run([{ type: 'skipSpeaker', user: 'p2' }], state);
    expect(denied.state.speaker).toBe('p8');
    expect(ephemeralTo(denied.events, 'p2')).toBeDefined();
  });

  it('輪到 bot 時公告「過」，立刻換下一位', () => {
    const { state } = withBots();
    const day = run([{ type: 'wolfVote', user: 'p1', target: state.night!.wolfVotes['bot:1'] }], state);
    expect(announces(day.events)).toContainEqual(expect.stringMatching(/^🤖Bot\d：過。$/));
    expect(day.state.speaker).toBe('p1');
  });

  it('全部講完進入 2 分鐘自由討論，時間到進入投票', () => {
    const { state } = dawned('p7', 'skip');
    const done = run(['p8', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((user) => ({ type: 'endSpeech', user }) as Action), state);
    expect(done.state.phase).toBe('discussion');
    expect(announces(done.events)).toContainEqual(expect.stringContaining('開始自由討論，時間 2 分鐘'));
    expect(lastTimer(done.events).ms).toBe(2 * 60_000);
    expect(run([{ type: 'timeout', id: lastTimer(done.events).id }], done.state).state.phase).toBe('vote');
  });

  it('房主可以在輪流發言或自由討論時直接進入投票，非房主不行', () => {
    const { state } = dawned('p7', 'skip');
    expect(run([{ type: 'endDiscussion', user: 'p1' }], state).state.phase).toBe('vote');
    const free = run(['p8', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((user) => ({ type: 'endSpeech', user }) as Action), state).state;
    expect(run([{ type: 'endDiscussion', user: 'p1' }], free).state.phase).toBe('vote');
    const denied = run([{ type: 'endDiscussion', user: 'p2' }], state);
    expect(denied.state.phase).toBe('speech');
    expect(ephemeralTo(denied.events, 'p2')).toBeDefined();
  });
});

// 第一夜 p7 死亡，存活 p1~p6、p8（狼人 p1~p3）。房主結束討論，進入投票
const voting = () => run([{ type: 'endDiscussion', user: 'p1' }], dawned('p7', 'skip').state);
const votes = (pairs: [string, string][]) => pairs.map(([user, target]) => ({ type: 'dayVote', user, target }) as Action);

describe('day-phase: 放逐投票', () => {
  it('投票訊息列出所有存活玩家和棄票，計時 60 秒', () => {
    const { events } = voting();
    const [p] = prompts(events, 'dayVote');
    expect(p.audience).toBe('channel');
    expect(values(p)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8', 'abstain']);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('投票期間只有本人看到自己投給誰', () => {
    const { events } = run(votes([['p1', 'p4']]), voting().state);
    expect(events).toEqual([{ type: 'ephemeral', to: 'p1', text: expect.stringContaining('<@p4>') }]);
  });

  it('單一最高票被放逐，公開每個人的投票，不公開角色', () => {
    const { state, events } = run(
      votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p5', 'p1'], ['p6', 'p1'], ['p4', 'abstain'], ['p8', 'abstain']]),
      voting().state,
    );
    const text = announces(events).join('\n');
    expect(text).toContain('<@p1> → <@p4>');
    expect(text).toContain('<@p8> → 棄票');
    expect(text).toContain('<@p4> 被放逐');
    expect(text).not.toContain('預言家');
    expect(isDead(state, 'p4')).toBe(true);
  });

  it('時限內可以改票', () => {
    const { state } = run(votes([['p1', 'p4'], ['p1', 'p5']]), voting().state);
    expect(state.votes.p1).toBe('p5');
  });

  it('時間到沒投票的人算棄票', () => {
    const { state, events } = voting();
    const after = run([...votes([['p1', 'p4']]), { type: 'timeout', id: lastTimer(events).id }], state);
    expect(announces(after.events).join('\n')).toContain('<@p2> → 棄票');
    expect(isDead(after.state, 'p4')).toBe(true);
  });

  it('全部棄票：沒有人被放逐，進入下一個夜晚', () => {
    const living = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8'];
    const { state, events } = run(votes(living.map((u) => [u, 'abstain'])), voting().state);
    expect(announces(events)).toContainEqual(expect.stringContaining('沒有人被放逐'));
    expect(state).toMatchObject({ phase: 'night', day: 2 });
  });
});

describe('day-phase: 死亡玩家的限制', () => {
  it('死亡玩家不能投票', () => {
    const { state } = voting();
    const after = run(votes([['p7', 'p1']]), state);
    expect(after.state.votes.p7).toBeUndefined();
    expect(ephemeralTo(after.events, 'p7')).toMatchObject({ text: expect.stringContaining('已經死亡') });
  });
});

describe('night-phase: 預言家已經死亡', () => {
  it('第二夜不發查驗提示', () => {
    const night1 = run(
      [
        { type: 'seerCheck', user: 'p4', target: 'p1' },
        ...['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: 'p4' }) as Action),
        { type: 'witchAct', user: 'p5', choice: 'skip' },
        { type: 'skipSpeaker', user: 'p1' },
        { type: 'endDiscussion', user: 'p1' },
      ],
      started(8).state,
    ).state;
    const living = ['p1', 'p2', 'p3', 'p5', 'p6', 'p7', 'p8'];
    const { state, events } = run(votes(living.map((u) => [u, 'abstain'])), night1);
    expect(state.day).toBe(2);
    expect(prompts(events, 'seerCheck')).toEqual([]);
    expect(prompts(events, 'wolfKill')).toHaveLength(1);
  });
});

// p1 和 p4 各 3 票平手，進入 PK；PK 投票者是 p2、p3、p5、p6、p8
const tied = () =>
  run(
    votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p4', 'p1'], ['p5', 'p1'], ['p6', 'p1'], ['p8', 'abstain']]),
    voting().state,
  );
const pkVoting = () =>
  run(
    [
      { type: 'endSpeech', user: 'p1' },
      { type: 'endSpeech', user: 'p4' },
    ],
    tied().state,
  );

describe('day-phase: 平票 PK', () => {
  it('平票時平手的玩家依加入順序輪流發言，講完直接進入 PK 投票', () => {
    const { state, events } = tied();
    expect(state).toMatchObject({ phase: 'pkSpeech', speaker: 'p1' });
    const pk = announces(events).find((t) => t.includes('PK'))!;
    expect(pk).toContain('<@p1>');
    expect(pk).toContain('<@p4>');
    expect(speechPrompt(events)!.text).toContain('輪到 <@p1> 發言（40 秒）');
    expect(lastTimer(events).ms).toBe(40_000);

    const p4 = run([{ type: 'endSpeech', user: 'p1' }], state);
    expect(speechPrompt(p4.events)!.text).toContain('輪到 <@p4> 發言');
    const vote = run([{ type: 'endSpeech', user: 'p4' }], p4.state);
    expect(vote.state.phase).toBe('pkVote');
    expect(announces(vote.events).some((t) => t.includes('自由討論'))).toBe(false);
  });

  it('PK 投票只能投平票的玩家或棄票', () => {
    const [p] = prompts(pkVoting().events, 'pkVote');
    expect(new Set(values(p))).toEqual(new Set(['p1', 'p4', 'abstain']));
  });

  it('PK 後分出勝負', () => {
    const { state } = run(votes([['p2', 'p4'], ['p3', 'p4'], ['p5', 'p4'], ['p6', 'p1'], ['p8', 'p1']]), pkVoting().state);
    expect(isDead(state, 'p4')).toBe(true);
    expect(isDead(state, 'p1')).toBe(false);
  });

  it('PK 後仍然平票：沒有人被放逐，進入下一個夜晚', () => {
    const { state, events } = run(
      votes([['p2', 'p4'], ['p3', 'p4'], ['p5', 'p1'], ['p6', 'p1'], ['p8', 'abstain']]),
      pkVoting().state,
    );
    expect(announces(events)).toContainEqual(expect.stringContaining('沒有人被放逐'));
    expect(state).toMatchObject({ phase: 'night', day: 2 });
  });

  it('PK 中的玩家不能投票', () => {
    const after = run(votes([['p1', 'p4']]), pkVoting().state);
    expect(after.state.votes.p1).toBeUndefined();
    expect(ephemeralTo(after.events, 'p1')).toMatchObject({ text: expect.stringContaining('PK') });
  });
});

const kill = (s: GameState, ...ids: string[]): GameState => ({
  ...s,
  players: s.players.map((p) => (ids.includes(p.id) ? { ...p, alive: false } : p)),
});

describe('day-phase: 獵人開槍', () => {
  it('夜晚被刀的獵人，天亮後、討論前可以開槍', () => {
    const night = dawned('p6', 'skip');
    expect(night.state.phase).toBe('hunter');
    const [p] = prompts(night.events, 'hunterShoot');
    expect(p).toMatchObject({ audience: 'user', user: 'p6' });
    expect(values(p)).toContain('none');
    expect(announces(night.events).some((t) => t.includes('輪流發言'))).toBe(false);

    const shot = run([{ type: 'hunterShoot', user: 'p6', target: 'p8' }], night.state);
    expect(announces(shot.events)).toContainEqual(expect.stringContaining('獵人 <@p6> 開槍帶走了 <@p8>'));
    expect(isDead(shot.state, 'p8')).toBe(true);
    expect(shot.state.phase).toBe('speech');
  });

  it('被放逐的獵人開槍後，判斷勝負再進入夜晚', () => {
    const exiled = run(
      votes([['p1', 'p6'], ['p2', 'p6'], ['p3', 'p6'], ['p4', 'abstain'], ['p5', 'abstain'], ['p6', 'abstain'], ['p8', 'abstain']]),
      voting().state,
    );
    const afterWords = run([{ type: 'endSpeech', user: 'p6' }], exiled.state);
    expect(afterWords.state.phase).toBe('hunter');
    const shot = run([{ type: 'hunterShoot', user: 'p6', target: 'p1' }], afterWords.state);
    expect(isDead(shot.state, 'p1')).toBe(true);
    expect(shot.state).toMatchObject({ phase: 'night', day: 2 });
  });

  it('被毒死的獵人不能開槍', () => {
    const { state, events } = dawned('p7', 'poison:p6');
    expect(prompts(events, 'hunterShoot')).toEqual([]);
    expect(announces(events).some((t) => t.includes('獵人'))).toBe(false);
    expect(state.phase).toBe('speech');
  });

  it('選擇不開槍或超時：沒有人死亡，不公開獵人身分', () => {
    const night = dawned('p6', 'skip');
    for (const next of [
      run([{ type: 'hunterShoot', user: 'p6', target: 'none' }], night.state),
      run([{ type: 'timeout', id: lastTimer(night.events).id }], night.state),
    ]) {
      expect(next.state.players.filter((p) => !p.alive).map((p) => p.id)).toEqual(['p6']);
      expect(announces(next.events).some((t) => t.includes('獵人'))).toBe(false);
      expect(next.state.phase).toBe('speech');
    }
  });

  it('不是獵人送出開槍會被忽略', () => {
    const { state } = dawned('p6', 'skip');
    expect(run([{ type: 'hunterShoot', user: 'p7', target: 'p1' }], state).events).toEqual([]);
  });
});

describe('win-condition: 判定時機（獵人）', () => {
  it('獵人被放逐時勝負已定，不會得到開槍機會', () => {
    const { state, events } = voting();
    const godsDown = kill(state, 'p4', 'p5'); // 預言家、女巫已死，放逐獵人後神職全滅
    const after = run([...votes([['p1', 'p6'], ['p2', 'p6'], ['p3', 'p6']]), { type: 'timeout', id: lastTimer(events).id }], godsDown);
    expect(after.state.phase).toBe('ended');
    expect(prompts(after.events, 'hunterShoot')).toEqual([]);
  });

  it('獵人開槍帶走最後一名狼人：好人獲勝', () => {
    const oneWolf = kill(started(8).state, 'p2', 'p3');
    const night = run(
      [
        { type: 'wolfVote', user: 'p1', target: 'p6' },
        { type: 'seerCheck', user: 'p4', target: 'p1' },
        { type: 'witchAct', user: 'p5', choice: 'skip' },
      ],
      oneWolf,
    );
    const shot = run([{ type: 'endSpeech', user: 'p6' }, { type: 'hunterShoot', user: 'p6', target: 'p1' }], night.state);
    expect(shot.state.phase).toBe('ended');
    expect(announces(shot.events)).toContainEqual(expect.stringContaining('好人陣營獲勝'));
  });
});

describe('整局流程', () => {
  it('6 人局：第一夜女巫救人，白天放逐一狼，第二夜女巫毒死最後一狼，好人獲勝', () => {
    // p1、p2 狼人，p3 預言家，p4 女巫，p5、p6 村民
    const { state: s1, events: e1 } = run([
      { type: 'new', user: 'p1', channel: 'C1' },
      ...['p2', 'p3', 'p4', 'p5', 'p6'].map((user) => ({ type: 'join', user }) as Action),
      { type: 'start', user: 'p1' },
      { type: 'seerCheck', user: 'p3', target: 'p1' },
      { type: 'wolfVote', user: 'p1', target: 'p5' },
      { type: 'wolfVote', user: 'p2', target: 'p5' },
      { type: 'witchAct', user: 'p4', choice: 'save' },
    ]);
    expect(announces(e1)).toContainEqual(expect.stringContaining('平安夜'));
    expect(s1.phase).toBe('speech');

    const { state: s2 } = run(
      [
        { type: 'endDiscussion', user: 'p1' },
        ...votes([['p3', 'p1'], ['p4', 'p1'], ['p5', 'p1'], ['p6', 'p1'], ['p1', 'p3'], ['p2', 'p3']]),
      ],
      s1,
    );
    expect(isDead(s2, 'p1')).toBe(true);
    expect(s2.phase).toBe('lastWords');
    const s2b = run([{ type: 'endSpeech', user: 'p1' }], s2).state;
    expect(s2b).toMatchObject({ phase: 'night', day: 2 });

    const { state: s3, events: e3 } = run(
      [
        { type: 'seerCheck', user: 'p3', target: 'p2' },
        { type: 'wolfVote', user: 'p2', target: 'p3' },
        { type: 'witchAct', user: 'p4', choice: 'poison:p2' },
      ],
      s2b,
    );
    expect(s3.phase).toBe('ended');
    expect(announces(e3)).toContainEqual(expect.stringContaining('好人陣營獲勝'));
  });
});

describe('game-lobby: 取消後計時器失效', () => {
  it('取消後重新開房，舊遊戲的計時器不會影響新遊戲', () => {
    const old = started(8);
    const oldTimer = timerIds(old.events)[0];
    const cancelled = run([{ type: 'cancel', user: 'p1' }], old.state).state;
    const fresh = run(
      [
        { type: 'new', user: 'p1', channel: 'C1' },
        ...Array.from({ length: 7 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as Action),
        { type: 'start', user: 'p1' },
      ],
      cancelled,
    );
    expect(timerIds(fresh.events)).not.toContain(oldTimer);
    expect(run([{ type: 'timeout', id: oldTimer }], fresh.state).events).toEqual([]);
  });
});

describe('按鈕確認訊息', () => {
  it('狼人選擇或改選時，狼人對話公布誰選擇擊殺誰', () => {
    const first = run([{ type: 'wolfVote', user: 'p1', target: 'p7' }], started(8).state);
    expect(first.events).toContainEqual({ type: 'wolfChat', wolves: ['p1', 'p2', 'p3'], text: '<@p1> 選擇擊殺 <@p7>。' });
    const changed = run([{ type: 'wolfVote', user: 'p1', target: 'p8' }], first.state);
    expect(wolfChatText(changed.events)).toContain('<@p1> 選擇擊殺 <@p8>。');
  });

  it('女巫行動後收到私訊確認', () => {
    const night = wolvesKill('p7').state;
    const dmTo = (choice: string) =>
      run([{ type: 'witchAct', user: 'p5', choice }], night).events.find((e) => e.type === 'dm' && e.to === 'p5');
    expect(dmTo('save')).toMatchObject({ text: '你對 <@p7> 使用了解藥。' });
    expect(dmTo('poison:p1')).toMatchObject({ text: '你對 <@p1> 使用了毒藥。' });
    expect(dmTo('skip')).toMatchObject({ text: '你今晚不使用藥。' });
  });

  it('獵人選擇不開槍後收到私訊確認，頻道沒有訊息', () => {
    const { events } = run([{ type: 'hunterShoot', user: 'p6', target: 'none' }], dawned('p6', 'skip').state);
    expect(events).toContainEqual({ type: 'dm', to: 'p6', text: '你選擇不開槍。' });
    expect(announces(events).some((t) => t.includes('開槍'))).toBe(false);
  });
});

const ids = (s: GameState) => s.players.map((p) => p.id);

describe('bot-players: 加入與移除 bot', () => {
  it('加入多個 bot，房間公告跟著更新', () => {
    const { state, events } = run([{ type: 'addBot', user: 'p1', count: 5 }], lobbyWith(1).state);
    expect(ids(state)).toEqual(['p1', 'bot:1', 'bot:2', 'bot:3', 'bot:4', 'bot:5']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', players: ids(state) }));
  });

  it('加入 bot 超過上限：只加到 12 人，提示房主房間已滿', () => {
    const { state, events } = run([{ type: 'addBot', user: 'p1', count: 5 }], lobbyWith(10).state);
    expect(state.players).toHaveLength(12);
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('房間已滿') });
  });

  it('移除 bot：從最後加入的開始移除', () => {
    const three = run([{ type: 'addBot', user: 'p1', count: 3 }], lobbyWith(1).state).state;
    const { state } = run([{ type: 'removeBot', user: 'p1', count: 2 }], three);
    expect(ids(state)).toEqual(['p1', 'bot:1']);
  });

  it('移除後再加入，編號接續', () => {
    const s = run(
      [
        { type: 'addBot', user: 'p1', count: 3 },
        { type: 'removeBot', user: 'p1', count: 2 },
        { type: 'addBot', user: 'p1', count: 1 },
      ],
      lobbyWith(1).state,
    ).state;
    expect(ids(s)).toEqual(['p1', 'bot:1', 'bot:2']);
  });

  it('沒有 bot 可以移除', () => {
    const { state, events } = run([{ type: 'removeBot', user: 'p1', count: 1 }], lobbyWith(2).state);
    expect(state.players).toHaveLength(2);
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('沒有 bot') });
  });

  it('非房主或遊戲已經開始時拒絕', () => {
    const lobby = lobbyWith(2).state;
    const a = run([{ type: 'addBot', user: 'p2', count: 1 }], lobby);
    expect(a.state.players).toHaveLength(2);
    expect(ephemeralTo(a.events, 'p2')).toBeDefined();

    const game = started(6).state;
    for (const type of ['addBot', 'removeBot'] as const) {
      const b = run([{ type, user: 'p1', count: 1 }], game);
      expect(b.state.players).toHaveLength(6);
      expect(ephemeralTo(b.events, 'p1')).toBeDefined();
    }
  });
});

describe('bot-players: bot 的顯示方式', () => {
  it('bot 顯示成 🤖Bot<編號>，真人還是 <@id>', () => {
    expect(mention('bot:1')).toBe('🤖Bot1');
    expect(mention('U123')).toBe('<@U123>');
    expect(isBot('bot:3')).toBe(true);
    expect(isBot('U123')).toBe(false);
  });
});

// p1 真人 + 5 個 bot。rng 固定時：p1、bot:1 狼人，bot:2 預言家，bot:3 女巫，bot:4、bot:5 村民
const withBots = () =>
  run([{ type: 'addBot', user: 'p1', count: 5 }, { type: 'start', user: 'p1' }], lobbyWith(1).state);
const roleOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.role;

describe('bot-players: bot 自動行動', () => {
  it('bot 狼人立刻選好存活的非狼人，bot 預言家立刻查驗', () => {
    const { state, events } = withBots();
    const target = state.night!.wolfVotes['bot:1'];
    expect(target).toBeDefined();
    expect(roleOf(state, target)).not.toBe('werewolf');
    expect(state.night!.seerDone).toBe(true);
    expect(wolfChatText(events)).toContain('🤖Bot1 選擇擊殺');
  });

  it('真人行動完後，其他都是 bot，夜晚立刻結算', () => {
    const { state } = withBots();
    const after = run([{ type: 'wolfVote', user: 'p1', target: state.night!.wolfVotes['bot:1'] }], state).state;
    expect(after.phase).not.toBe('night');
    expect(after.night!.witchDone).toBe(true);
  });

  it('進入投票時每個存活的 bot 立刻投給不是自己的候選人', () => {
    const { state } = withBots();
    const day = run(
      [
        { type: 'wolfVote', user: 'p1', target: state.night!.wolfVotes['bot:1'] },
        { type: 'endDiscussion', user: 'p1' },
      ],
      state,
    ).state;
    expect(day.phase).toBe('vote');
    const bots = day.players.filter((p) => p.alive && isBot(p.id));
    for (const b of bots) {
      expect(day.votes[b.id]).toBeDefined();
      expect(day.votes[b.id]).not.toBe(b.id);
      expect(day.votes[b.id]).not.toBe('abstain');
    }
  });
});

describe('bot-players: 整局測試', () => {
  // 簡單的 LCG，讓每個種子的結果都固定
  const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  it('1 位真人 + 5 個 bot，真人什麼都不做，遊戲一定會跑到結束', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = seeded(seed);
      let s = applyAction(undefined, { type: 'new', user: 'p1', channel: 'C1' }, r).state;
      s = applyAction(s, { type: 'addBot', user: 'p1', count: 5 }, r).state;
      s = applyAction(s, { type: 'start', user: 'p1' }, r).state;
      for (let step = 0; step < 200 && s.phase !== 'ended'; step++) {
        const id = Object.values(s.timers)[0];
        s = applyAction(s, { type: 'timeout', id: id! }, r).state;
      }
      expect(s.phase, `seed ${seed}`).toBe('ended');
    }
  });
});

type Announce = Extract<GameEvent, { type: 'announce' }>;
const announceWith = (events: GameEvent[], match: string) =>
  events.find((e): e is Announce => e.type === 'announce' && e.text.includes(match))!;

describe('announcement-gifs: 重要時刻的 GIF 和 emoji', () => {
  it('遊戲開始：🎲、start GIF，提醒查看私訊', () => {
    const a = announceWith(started(8).events, '遊戲開始');
    expect(a.text.startsWith('🎲')).toBe(true);
    expect(a.text).toContain('私訊');
    expect(a.gif).toBe('start');
  });

  it('天黑：🌙、night GIF', () => {
    const a = announceWith(started(8).events, '天黑');
    expect(a).toMatchObject({ text: expect.stringMatching(/^🌙/), gif: 'night' });
  });

  it('天亮有人死亡和平安夜用不同的 GIF', () => {
    expect(announceWith(fullNight('p7', 'skip').events, '天亮')).toMatchObject({ text: expect.stringMatching(/^☀️/), gif: 'dawnDeath' });
    expect(announceWith(fullNight('p7', 'save').events, '天亮')).toMatchObject({ text: expect.stringMatching(/^☀️/), gif: 'dawnPeace' });
  });

  it('討論 💬、投票 🗳️、平票 PK ⚔️', () => {
    expect(announceWith(dawned('p7', 'skip').events, '輪流發言').text.startsWith('💬')).toBe(true);
    expect(announceWith(tied().events, '投票結果').text.startsWith('🗳️')).toBe(true);
    expect(announceWith(tied().events, 'PK').text.startsWith('⚔️')).toBe(true);
  });

  it('放逐：🚪、exile GIF', () => {
    const { events } = run(
      votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p5', 'p1'], ['p6', 'p1'], ['p4', 'abstain'], ['p8', 'abstain']]),
      voting().state,
    );
    expect(announceWith(events, '被放逐')).toMatchObject({ text: expect.stringMatching(/^🚪/), gif: 'exile' });
  });

  it('獵人開槍：🔫、hunterShot GIF', () => {
    const { events } = run([{ type: 'hunterShoot', user: 'p6', target: 'p8' }], dawned('p6', 'skip').state);
    expect(announceWith(events, '開槍')).toMatchObject({ text: expect.stringMatching(/^🔫/), gif: 'hunterShot' });
  });

  it('勝負：好人 🎉 goodWin、狼人 🐺 wolvesWin', () => {
    expect(announceWith(wolvesWinTonight().events, '遊戲結束')).toMatchObject({ text: expect.stringMatching(/^🐺/), gif: 'wolvesWin' });
    const oneWolf = kill(started(8).state, 'p2', 'p3');
    const night = run(
      [
        { type: 'wolfVote', user: 'p1', target: 'p6' },
        { type: 'seerCheck', user: 'p4', target: 'p1' },
        { type: 'witchAct', user: 'p5', choice: 'skip' },
        { type: 'endSpeech', user: 'p6' },
        { type: 'hunterShoot', user: 'p6', target: 'p1' },
      ],
      oneWolf,
    );
    expect(announceWith(night.events, '遊戲結束')).toMatchObject({ text: expect.stringMatching(/^🎉/), gif: 'goodWin' });
  });

  it('取消遊戲：🛑', () => {
    const { events } = run([{ type: 'cancel', user: 'p1' }], started(6).state);
    expect(announceWith(events, '取消').text.startsWith('🛑')).toBe(true);
  });
});

describe('day-phase: 遺言', () => {
  const lastWordsPrompt = (events: GameEvent[]) => prompts(events, 'endSpeech').at(-1)!;

  it('第一夜死者講遺言 30 秒，結束後才開始輪流發言', () => {
    const { state, events } = fullNight('p7', 'skip');
    expect(state).toMatchObject({ phase: 'lastWords', speaker: 'p7' });
    expect(lastWordsPrompt(events).text).toContain('🕯️ <@p7> 的遺言（30 秒）');
    expect(values(lastWordsPrompt(events))).toEqual(['p7']);
    expect(lastTimer(events).ms).toBe(30_000);
    expect(run([{ type: 'endSpeech', user: 'p7' }], state).state.phase).toBe('speech');
  });

  it('第一夜兩人死亡：依死訊公布的順序講', () => {
    const { state } = fullNight('p7', 'poison:p4');
    const [first, second] = state.lastDeaths;
    expect(state.speaker).toBe(first);
    const next = run([{ type: 'endSpeech', user: first }], state);
    expect(next.state.speaker).toBe(second);
    expect(lastWordsPrompt(next.events).text).toContain(`🕯️ <@${second}> 的遺言`);
  });

  it('時間到遺言結束', () => {
    const { state, events } = fullNight('p7', 'skip');
    expect(run([{ type: 'timeout', id: lastTimer(events).id }], state).state.phase).toBe('speech');
  });

  it('第二夜以後的死者沒有遺言', () => {
    const living = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const night2 = run(
      [{ type: 'endDiscussion', user: 'p1' }, ...votes(living.map((u) => [u, 'abstain']))],
      fullNight('p7', 'save').state,
    ).state;
    expect(night2.day).toBe(2);
    const { state } = run(
      [
        ...['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: 'p8' }) as Action),
        { type: 'seerCheck', user: 'p4', target: 'p1' },
        { type: 'witchAct', user: 'p5', choice: 'skip' },
      ],
      night2,
    );
    expect(isDead(state, 'p8')).toBe(true);
    expect(state.phase).toBe('speech');
  });

  it('被放逐者講遺言，結束後才進入夜晚', () => {
    const exiled = run(
      votes([['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4'], ['p5', 'p1'], ['p6', 'p1'], ['p4', 'abstain'], ['p8', 'abstain']]),
      voting().state,
    );
    expect(exiled.state).toMatchObject({ phase: 'lastWords', speaker: 'p4' });
    expect(lastWordsPrompt(exiled.events).text).toContain('🕯️ <@p4> 的遺言（30 秒）');
    expect(run([{ type: 'endSpeech', user: 'p4' }], exiled.state).state).toMatchObject({ phase: 'night', day: 2 });
  });

  it('獵人先講遺言再開槍', () => {
    const exiled = run(
      votes([['p1', 'p6'], ['p2', 'p6'], ['p3', 'p6'], ['p4', 'abstain'], ['p5', 'abstain'], ['p6', 'abstain'], ['p8', 'abstain']]),
      voting().state,
    );
    expect(exiled.state.phase).toBe('lastWords');
    expect(prompts(exiled.events, 'hunterShoot')).toEqual([]);
    const words = run([{ type: 'endSpeech', user: 'p6' }], exiled.state);
    expect(prompts(words.events, 'hunterShoot')).toHaveLength(1);
  });

  it('被獵人帶走的人沒有遺言', () => {
    const shot = run([{ type: 'hunterShoot', user: 'p6', target: 'p8' }], dawned('p6', 'skip').state);
    expect(shot.state.phase).toBe('speech');
  });

  it('勝負已定就沒有遺言', () => {
    const { state, events } = voting();
    const godsDown = kill(state, 'p4', 'p5');
    const after = run([...votes([['p1', 'p6'], ['p2', 'p6'], ['p3', 'p6']]), { type: 'timeout', id: lastTimer(events).id }], godsDown);
    expect(after.state.phase).toBe('ended');
    expect(prompts(after.events, 'endSpeech')).toEqual([]);
  });

  it('不是死者按結束發言：遺言不會結束', () => {
    const { state } = fullNight('p7', 'skip');
    const after = run([{ type: 'endSpeech', user: 'p8' }], state);
    expect(after.state.speaker).toBe('p7');
    expect(ephemeralTo(after.events, 'p8')).toMatchObject({ text: expect.stringContaining('不是你的發言時間') });
  });

  it('bot 沒有遺言', () => {
    const { state } = withBots();
    const day = run([{ type: 'wolfVote', user: 'p1', target: state.night!.wolfVotes['bot:1'] }], state);
    expect(announces(day.events)).toContainEqual(expect.stringMatching(/^🤖Bot\d：（沒有遺言）$/));
  });
});

describe('night-phase: 狼人選擇不殺人', () => {
  it('狼人都選不殺人：沒有擊殺目標，公布今晚不殺人，女巫收到沒有人被殺', () => {
    const { state, events } = run(
      ['p1', 'p2', 'p3'].map((user) => ({ type: 'wolfVote', user, target: 'none' }) as Action),
      started(8).state,
    );
    expect(state.night!.wolfTarget).toBeNull();
    expect(wolfChatText(events)).toContain('<@p3> 選擇不殺人。');
    expect(wolfChatText(events)).toContain('今晚不殺人');
    expect(witchPrompt(events).text).toContain('今晚沒有人被殺');
  });

  it('不殺人得票最多：沒有擊殺目標', () => {
    const { state } = run(
      [
        { type: 'wolfVote', user: 'p1', target: 'none' },
        { type: 'wolfVote', user: 'p2', target: 'none' },
        { type: 'wolfVote', user: 'p3', target: 'p7' },
      ],
      started(8).state,
    );
    expect(state.night!.wolfTarget).toBeNull();
  });

  it('不殺人和玩家同票時隨機', () => {
    const s = run([{ type: 'wolfVote', user: 'p1', target: 'none' }], started(6).state).state;
    const last: Action = { type: 'wolfVote', user: 'p2', target: 'p6' };
    const a = applyAction(s, last, () => 0).state.night!.wolfTarget;
    const b = applyAction(s, last, () => 0.99999).state.night!.wolfTarget;
    expect(new Set([a, b])).toEqual(new Set([null, 'p6']));
  });
});

describe('night-phase: 狼人倒數提醒', () => {
  const remindTimer = (events: GameEvent[]) =>
    events.find((e) => e.type === 'startTimer' && e.ms === 30_000) as { id: number } | undefined;

  it('剩 30 秒時提醒還沒選的狼人', () => {
    const { state, events } = started(8);
    const timer = remindTimer(events)!;
    expect(timer).toBeDefined();
    const voted = run([{ type: 'wolfVote', user: 'p1', target: 'p7' }], state).state;
    const after = run([{ type: 'timeout', id: timer.id }], voted);
    expect(wolfChatText(after.events)).toBe('⏰ 剩下 30 秒，還沒選的：<@p2>、<@p3>');
  });

  it('狼人都選好了就不提醒', () => {
    const { events } = started(8);
    const timer = remindTimer(events)!;
    const decided = wolvesKill('p7').state;
    expect(run([{ type: 'timeout', id: timer.id }], decided).events).toEqual([]);
  });

  it('60 秒的狼人計時器仍然是第一個計時器', () => {
    const { events } = started(8);
    expect(events.find((e) => e.type === 'startTimer')).toMatchObject({ ms: 60_000 });
  });
});

describe('announcement-gifs: 開始公告附上規則連結', () => {
  it('開始公告有可以點的「遊戲規則」連結', () => {
    const url = encodeURI('https://github.com/eric0324/slack-werewolve/wiki/遊戲規則');
    expect(announceWith(started(8).events, '遊戲開始').text).toContain(`<${url}|遊戲規則>`);
  });
});

describe('game-lobby: 不在遊戲中的人不能參與', () => {
  it('不在遊戲中的人投票：不計入，只有本人看到提示', () => {
    const { state } = voting();
    const after = run([{ type: 'dayVote', user: 'X', target: 'p1' }], state);
    expect(after.state.votes.X).toBeUndefined();
    expect(after.events).toEqual([{ type: 'ephemeral', to: 'X', text: '你不在這局遊戲中。' }]);
  });

  it('不在遊戲中的人按結束發言：發言者不變', () => {
    const { state } = dawned('p7', 'skip');
    const after = run([{ type: 'endSpeech', user: 'X' }], state);
    expect(after.state.speaker).toBe(state.speaker);
    expect(after.events).toEqual([{ type: 'ephemeral', to: 'X', text: '你不在這局遊戲中。' }]);
  });

  it('夜晚的按鈕也一樣', () => {
    const night = started(8).state;
    for (const action of [
      { type: 'wolfVote', user: 'X', target: 'p7' },
      { type: 'seerCheck', user: 'X', target: 'p1' },
      { type: 'witchAct', user: 'X', choice: 'skip' },
      { type: 'hunterShoot', user: 'X', target: 'none' },
    ] as Action[]) {
      expect(run([action], night).events).toEqual([{ type: 'ephemeral', to: 'X', text: '你不在這局遊戲中。' }]);
    }
  });
});

describe('win-condition: 再來一局', () => {
  it('分出勝負後貼出「再來一局」按鈕', () => {
    const [p] = prompts(wolvesWinTonight().events, 'rematch');
    expect(p).toMatchObject({ audience: 'channel', text: expect.stringContaining('再來一局') });
    expect(p.options).toEqual([{ value: 'rematch', label: '再來一局' }]);
  });

  it('上一局的玩家（死亡也可以）開新的一局：空房間，按的人當房主', () => {
    const { state, events } = run([{ type: 'rematch', user: 'p3', channel: 'C1' }], wolvesWinTonight().state);
    expect(state).toMatchObject({ phase: 'lobby', host: 'p3' });
    expect(ids(state)).toEqual(['p3']);
    expect(events).toContainEqual({ type: 'lobby', host: 'p3', players: ['p3'], open: true });
  });

  it('不是上一局的玩家不能開', () => {
    const ended = wolvesWinTonight().state;
    const { state, events } = run([{ type: 'rematch', user: 'X', channel: 'C1' }], ended);
    expect(state).toBe(ended);
    expect(ephemeralTo(events, 'X')).toMatchObject({ text: '只有上一局的玩家可以開新的一局。' });
  });

  it('已經開了新房間就不會再開', () => {
    const lobby = run([{ type: 'rematch', user: 'p3', channel: 'C1' }], wolvesWinTonight().state).state;
    const { state, events } = run([{ type: 'rematch', user: 'p5', channel: 'C1' }], lobby);
    expect(state.host).toBe('p3');
    expect(ephemeralTo(events, 'p5')).toMatchObject({ text: '這個頻道已經有遊戲了。' });
  });

  it('取消的遊戲沒有再來一局', () => {
    const { state, events } = run([{ type: 'cancel', user: 'p1' }], started(6).state);
    expect(prompts(events, 'rematch')).toEqual([]);
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], state).events).toEqual([]);
  });
});
