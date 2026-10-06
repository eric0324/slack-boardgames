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
    expect(events).toContainEqual({ type: 'announce', text: expect.stringContaining('第 1 夜') });
    const [wolf] = prompts(events, 'wolfKill');
    expect(wolf.audience).toBe('wolves');
    expect(wolf.options).toHaveLength(8);
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
