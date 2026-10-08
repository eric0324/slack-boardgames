import { describe, expect, it } from 'vitest';
import { mention, type GameEvent } from '../src/engine.js';
import { applyAvalon, AVALON_BOT_LINES, isEvil, type AAction, type AState } from '../src/avalon.js';

const rng = () => 0.99999;

function run(actions: AAction[], start?: AState, r: () => number = rng) {
  let state = start;
  let events: GameEvent[] = [];
  for (const action of actions) {
    const result = applyAvalon(state, action, r);
    state = result.state;
    events = result.events;
  }
  return { state: state!, events };
}

const lobbyWith = (n: number) =>
  run([
    { type: 'new', user: 'p1', channel: 'C1' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ type: 'join', user: `p${i + 2}` }) as AAction),
  ]);
const ephemeralTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'ephemeral' && e.to === user);
const announces = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'announce').map((e) => (e as { text: string }).text);
const dmTo = (events: GameEvent[], user: string) => events.find((e) => e.type === 'dm' && e.to === user) as { text: string } | undefined;

describe('avalon/setup: 阿瓦隆的房間', () => {
  it('開房：公告標示阿瓦隆', () => {
    const { state, events } = run([{ type: 'new', user: 'A', channel: 'C1' }]);
    expect(state).toMatchObject({ game: 'avalon', host: 'A', phase: 'lobby' });
    expect(events).toContainEqual({ type: 'lobby', title: '阿瓦隆', host: 'A', players: ['A'], open: true });
  });

  it('人數不足 5 人不能開始', () => {
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(4).state);
    expect(state.phase).toBe('lobby');
    expect(ephemeralTo(events, 'p1')).toMatchObject({ text: expect.stringContaining('至少需要 5 人') });
  });

  it('房間已滿（10 人）時拒絕加入', () => {
    const { state, events } = run([{ type: 'join', user: 'x' }], lobbyWith(10).state);
    expect(state.players).toHaveLength(10);
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

  it('非房主不能開始；5 人以上房主可以開始，按鈕失效', () => {
    expect(ephemeralTo(run([{ type: 'start', user: 'p2' }], lobbyWith(5).state).events, 'p2')).toBeDefined();
    const { state, events } = run([{ type: 'start', user: 'p1' }], lobbyWith(5).state);
    expect(state.phase).not.toBe('lobby');
    expect(events).toContainEqual(expect.objectContaining({ type: 'lobby', open: false }));
  });
});

// rng 固定時不洗牌：身分依「好人（梅林、派西維爾、忠臣…）→ 壞人（刺客、莫甘娜、爪牙…）」照玩家順序發
const started = (n: number, r: () => number = rng) => run([{ type: 'start', user: 'p1' }], lobbyWith(n).state, r);
const roles = (s: AState) => s.players.map((p) => p.role);

describe('avalon/setup: 身分配置', () => {
  it.each([
    [5, 3, 2],
    [6, 4, 2],
    [7, 4, 3],
    [8, 5, 3],
    [9, 6, 3],
    [10, 6, 4],
  ])('%i 人：%i 好人、%i 壞人，梅林、派西維爾、刺客、莫甘娜各 1 位', (n, good, evil) => {
    const r = roles(started(n).state);
    const evilRoles = ['assassin', 'morgana', 'minion'];
    expect(r.filter((x) => !evilRoles.includes(x!))).toHaveLength(good);
    expect(r.filter((x) => evilRoles.includes(x!))).toHaveLength(evil);
    for (const one of ['merlin', 'percival', 'assassin', 'morgana']) expect(r.filter((x) => x === one)).toHaveLength(1);
  });

  it('身分是隨機的', () => {
    expect(roles(started(7, () => 0).state)).not.toEqual(roles(started(7).state));
  });
});

// 5 人局：p1 梅林、p2 派西維爾、p3 忠臣、p4 刺客、p5 莫甘娜
describe('avalon/setup: 身分私訊', () => {
  it('梅林知道所有壞人', () => {
    const text = dmTo(started(5).events, 'p1')!.text;
    expect(text).toContain('你是梅林');
    expect(text).toContain('<@p4>');
    expect(text).toContain('<@p5>');
    expect(text).not.toContain('<@p2>');
  });

  it('派西維爾知道梅林和莫甘娜是哪兩位，但不知道誰是誰', () => {
    const text = dmTo(started(5).events, 'p2')!.text;
    expect(text).toContain('你是派西維爾');
    expect(text).toContain('<@p1>、<@p5> 其中一位是梅林、另一位是莫甘娜');
  });

  it('壞人知道其他壞人，忠臣沒有額外資訊', () => {
    const { events } = started(7);
    expect(dmTo(events, 'p5')!.text).toContain('你是刺客');
    expect(dmTo(events, 'p5')!.text).toContain('<@p6>、<@p7>');
    expect(dmTo(events, 'p6')!.text).toContain('你是莫甘娜');
    expect(dmTo(events, 'p7')!.text).toContain('你是爪牙');
    expect(dmTo(events, 'p7')!.text).toContain('<@p5>、<@p6>');
    expect(dmTo(events, 'p3')!.text).toContain('你是忠臣');
    expect(dmTo(events, 'p3')!.text).not.toContain('<@');
  });

  it('壞人被拉進私訊群組', () => {
    expect(started(5).events).toContainEqual(expect.objectContaining({ type: 'wolfChat', wolves: ['p4', 'p5'] }));
  });

  it('頻道公告只有人數和查看私訊的提醒，不洩漏身分', () => {
    const text = announces(started(5).events).join('\n');
    expect(text).toContain('好人 3 位、壞人 2 位');
    expect(text).toContain('私訊');
    for (const name of ['梅林', '派西維爾', '忠臣', '刺客', '莫甘娜', '爪牙']) expect(text).not.toMatch(new RegExp(`<@p\\d>\\S*${name}`));
  });
});

const prompts = (events: GameEvent[], kind: string) =>
  events.filter((e) => e.type === 'prompt' && e.kind === kind) as Extract<GameEvent, { type: 'prompt' }>[];
const timers = (events: GameEvent[]) => events.filter((e) => e.type === 'startTimer') as { id: number; ms: number }[];
const lastTimer = (events: GameEvent[]) => timers(events).at(-1)!;
const values = (p: { options: { value: string }[] }) => p.options.map((o) => o.value);
// 依序讓目前的發言者都按結束發言
const finishSpeech = (s: AState) => {
  let res = { state: s, events: [] as GameEvent[] };
  for (let i = 0; i < 20 && res.state.phase === 'speech'; i++) res = run([{ type: 'endSpeech', user: res.state.speaker! }], res.state);
  return res;
};

// rng 固定時第一位隊長是最後一位玩家
describe('avalon/rounds: 隊長與輪流發言', () => {
  it('開始後公告任務、隊伍人數、隊長、進度和否決次數，從隊長的下一位開始發言', () => {
    const { state, events } = started(5);
    const text = announces(events).join('\n');
    expect(text).toContain('任務 1');
    expect(text).toContain('隊伍 2 人');
    expect(text).toContain('隊長 <@p5>');
    expect(text).toContain('連續否決：0／5');
    expect(state).toMatchObject({ phase: 'speech', speaker: 'p1' });
    const p = prompts(events, 'endSpeech').at(-1)!;
    expect(p.text).toContain('輪到 <@p1> 發言（40 秒）');
    expect(values(p)).toEqual(['p1']);
    expect(lastTimer(events).ms).toBe(40_000);
  });

  it('隊長最後一個發言', () => {
    const { state } = started(5, () => 0);
    expect(state.speaker).toBe('p2');
    expect(state.speakers).toEqual(['p3', 'p4', 'p5', 'p1']);
  });

  it('只有目前的發言者能結束發言；時間到或房主 next 換下一位', () => {
    const { state, events } = started(5);
    const denied = run([{ type: 'endSpeech', user: 'p2' }], state);
    expect(denied.state.speaker).toBe('p1');
    expect(ephemeralTo(denied.events, 'p2')).toBeDefined();
    expect(run([{ type: 'timeout', id: lastTimer(events).id }], state).state.speaker).toBe('p2');
    expect(run([{ type: 'skipSpeaker', user: 'p1' }], state).state.speaker).toBe('p2');
    expect(ephemeralTo(run([{ type: 'skipSpeaker', user: 'p2' }], state).events, 'p2')).toBeDefined();
  });

  it('所有人發言完進入隊長選人', () => {
    expect(finishSpeech(started(5).state).state.phase).toBe('pick');
  });
});

// 5 人局：隊長 p5，任務 1 需要 2 人
const picking = () => finishSpeech(started(5).state);
const pick = (targets: string[], s: AState, user = 'p5') =>
  run(targets.map((target) => ({ type: 'pickMember', user, target }) as AAction), s);

describe('avalon/rounds: 隊長選人', () => {
  it('隊長收到選隊員按鈕（所有玩家）和確認按鈕，90 秒', () => {
    const { events } = picking();
    const p = prompts(events, 'pickMember').at(-1)!;
    expect(p.text).toContain('<@p5> 請選 2 位隊員');
    expect(values(p)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(prompts(events, 'confirmTeam')).toHaveLength(1);
    expect(lastTimer(events).ms).toBe(90_000);
  });

  it('按一下加入、再按一下移除，只讓隊長看到目前的隊伍', () => {
    const one = pick(['p1'], picking().state);
    expect(one.state.team).toEqual(['p1']);
    expect(ephemeralTo(one.events, 'p5')).toMatchObject({ text: expect.stringContaining('<@p1>') });
    expect(announces(one.events)).toEqual([]);
    expect(pick(['p1', 'p2', 'p1'], picking().state).state.team).toEqual(['p2']);
  });

  it('人數剛好才能確認；確認後公告隊伍並進入組隊投票', () => {
    const one = pick(['p1'], picking().state).state;
    const denied = run([{ type: 'confirmTeam', user: 'p5' }], one);
    expect(denied.state.phase).toBe('pick');
    expect(ephemeralTo(denied.events, 'p5')).toMatchObject({ text: expect.stringContaining('還差 1 人') });
    const full = pick(['p2'], one).state;
    expect(ephemeralTo(pick(['p3'], full).events, 'p5')).toMatchObject({ text: expect.stringContaining('已經滿了') });
    const { state, events } = run([{ type: 'confirmTeam', user: 'p5' }], full);
    expect(state.phase).toBe('teamVote');
    expect(announces(events).join('\n')).toContain('隊伍：<@p1>、<@p2>');
  });

  it('只有隊長能選人和確認', () => {
    const { state } = picking();
    const denied = pick(['p1'], state, 'p2');
    expect(denied.state.team).toEqual([]);
    expect(ephemeralTo(denied.events, 'p2')).toBeDefined();
    expect(ephemeralTo(run([{ type: 'confirmTeam', user: 'p2' }], state).events, 'p2')).toBeDefined();
  });

  it('隊長 90 秒沒確認：隨機補滿隊伍並送出', () => {
    const { state } = picking();
    const one = pick(['p1'], state).state;
    const after = run([{ type: 'timeout', id: one.timers.phase! }], one);
    expect(after.state.phase).toBe('teamVote');
    expect(after.state.team).toHaveLength(2);
    expect(after.state.team).toContain('p1');
  });
});

// 5 人局：隊長 p5 提出 p1、p2
const teamVoting = () => run([{ type: 'confirmTeam', user: 'p5' }], pick(['p1', 'p2'], picking().state).state);
const teamVotes = (pairs: [string, 'approve' | 'reject'][], s: AState) =>
  run(pairs.map(([user, vote]) => ({ type: 'teamVote', user, vote }) as AAction), s);

describe('avalon/rounds: 組隊投票', () => {
  it('所有人收到贊成／反對按鈕，60 秒', () => {
    const { events } = teamVoting();
    expect(values(prompts(events, 'teamVote').at(-1)!)).toEqual(['approve', 'reject']);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('可以改票，全部投完立刻結束並公開每個人的投票；過半通過進入出任務，否決次數歸零', () => {
    const s = teamVotes([['p1', 'reject'], ['p1', 'approve'], ['p2', 'approve'], ['p3', 'reject'], ['p4', 'reject']], teamVoting().state).state;
    expect(s.phase).toBe('teamVote');
    const { state, events } = teamVotes([['p5', 'approve']], { ...s, rejects: 2 });
    const text = announces(events).join('\n');
    expect(text).toContain('<@p1> → 👍 贊成');
    expect(text).toContain('<@p3> → 👎 反對');
    expect(text).toContain('隊伍通過');
    expect(state).toMatchObject({ phase: 'quest', rejects: 0 });
  });

  it('不在遊戲裡的人不能投', () => {
    expect(teamVotes([['x', 'approve']], teamVoting().state).state.votes).toEqual({});
  });

  it('沒過半（含平手）就否決：否決次數加 1，換下一位隊長重新組隊', () => {
    const { state, events } = teamVotes([['p1', 'approve'], ['p2', 'approve'], ['p3', 'reject'], ['p4', 'reject'], ['p5', 'reject']], teamVoting().state);
    expect(announces(events).join('\n')).toContain('隊伍被否決');
    expect(state).toMatchObject({ phase: 'speech', rejects: 1, quest: 0 });
    expect(announces(events).join('\n')).toContain('隊長 <@p1>');
    const six = finishSpeech(started(6).state).state;
    const sixVote = run([{ type: 'confirmTeam', user: 'p6' }], pick(['p1', 'p2'], six, 'p6').state).state;
    const tie = teamVotes([['p1', 'approve'], ['p2', 'approve'], ['p3', 'approve'], ['p4', 'reject'], ['p5', 'reject'], ['p6', 'reject']], sixVote);
    expect(tie.state.rejects).toBe(1);
  });

  it('時間到沒投的算贊成', () => {
    const v = teamVoting();
    const s = teamVotes([['p1', 'reject'], ['p2', 'reject']], v.state).state;
    const { state, events } = run([{ type: 'timeout', id: lastTimer(v.events).id }], s);
    expect(announces(events).join('\n')).toContain('<@p3> → 👍 贊成');
    expect(state.phase).toBe('quest');
  });
});

const approveAll = (s: AState) => teamVotes(s.players.map((p) => [p.id, 'approve'] as [string, 'approve']), s);
// 5 人局：p1（梅林）和 p4（刺客）出任務
const questing = () => approveAll(run([{ type: 'confirmTeam', user: 'p5' }], pick(['p1', 'p4'], picking().state).state).state);
const cards = (pairs: [string, 'success' | 'fail'][], s: AState) =>
  run(pairs.map(([user, card]) => ({ type: 'quest', user, card }) as AAction), s);

describe('avalon/rounds: 出任務', () => {
  it('私訊隊員出任務按鈕：好人只有成功，壞人有成功和失敗，60 秒', () => {
    const { events } = questing();
    const qs = prompts(events, 'quest');
    expect(qs.map((q) => q.user)).toEqual(['p1', 'p4']);
    expect(qs.every((q) => q.audience === 'user')).toBe(true);
    expect(values(qs[0])).toEqual(['success']);
    expect(values(qs[1])).toEqual(['success', 'fail']);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('全部出完立刻結束，只公開失敗票數；接著換下一位隊長進行下一個任務', () => {
    const s = cards([['p4', 'fail']], questing().state).state;
    expect(s.phase).toBe('quest');
    const { state, events } = cards([['p1', 'success']], s);
    const result = announces(events).find((t) => t.includes('任務 1'))!;
    expect(result).toContain('任務 1 失敗（1 張失敗票）');
    expect(result).not.toContain('<@p4>');
    expect(state).toMatchObject({ results: ['fail'], quest: 1, phase: 'speech' });
    expect(announces(events).join('\n')).toContain('隊長 <@p1>');
  });

  it('不是隊員、已經出過、好人出失敗都不算', () => {
    const s = questing().state;
    expect(ephemeralTo(cards([['p3', 'success']], s).events, 'p3')).toBeDefined();
    const once = cards([['p4', 'success']], s).state;
    expect(ephemeralTo(cards([['p4', 'fail']], once).events, 'p4')).toBeDefined();
    expect(cards([['p1', 'fail']], s).state.cards).toEqual({});
  });

  it('時間到沒出的算成功', () => {
    const q = questing();
    const { state } = run([{ type: 'timeout', id: lastTimer(q.events).id }], q.state);
    expect(state.results).toEqual(['success']);
  });

  it('7 人以上第 4 個任務要 2 張失敗票才失敗', () => {
    // 7 人局：p5 刺客、p6 莫甘娜，隊長 p7，第 4 個任務 4 人
    const s = finishSpeech(run([{ type: 'start', user: 'p1' }], lobbyWith(7).state).state).state;
    expect(s.leader).toBe(6);
    const atFour = { ...s, quest: 3, results: ['success', 'fail', 'success'] as ('success' | 'fail')[] };
    const q = approveAll(run([{ type: 'confirmTeam', user: 'p7' }], pick(['p1', 'p2', 'p5', 'p6'], atFour, 'p7').state).state).state;
    const one = cards([['p1', 'success'], ['p2', 'success'], ['p5', 'fail'], ['p6', 'success']], q);
    expect(announces(one.events).join('\n')).toContain('任務 4 成功（1 張失敗票）');
    const two = cards([['p1', 'success'], ['p2', 'success'], ['p5', 'fail'], ['p6', 'fail']], q);
    expect(announces(two.events).join('\n')).toContain('任務 4 失敗（2 張失敗票）');
  });
});

// 5 人局玩一個任務：成功的隊伍只放好人，失敗的隊伍放刺客 p4 並出失敗
const SIZES5 = [2, 3, 2, 3, 3];
function playQuest(s: AState, fail: boolean) {
  const st = finishSpeech(s).state;
  const leader = st.players[st.leader].id;
  const size = SIZES5[st.quest];
  const team = (fail ? ['p4', 'p1', 'p2', 'p3'] : ['p1', 'p2', 'p3']).slice(0, size);
  const q = approveAll(run([{ type: 'confirmTeam', user: leader }], pick(team, st, leader).state).state).state;
  return cards(team.map((id) => [id, fail && id === 'p4' ? 'fail' : 'success'] as [string, 'success' | 'fail']), q);
}
const playQuests = (pattern: boolean[]) => {
  let res = started(5);
  for (const fail of pattern) res = playQuest(res.state, fail);
  return res;
};
const rejectAll = (s: AState) => {
  const st = finishSpeech(s).state;
  const leader = st.players[st.leader].id;
  const full = pick(['p1', 'p2', 'p3'].slice(0, SIZES5[st.quest]), st, leader).state;
  const v = run([{ type: 'confirmTeam', user: leader }], full).state;
  return teamVotes(v.players.map((p) => [p.id, 'reject'] as [string, 'reject']), v);
};

describe('avalon/win-condition: 勝負判定', () => {
  it('3 個任務失敗：壞人獲勝', () => {
    const { state } = playQuests([true, false, true, true]);
    expect(state).toMatchObject({ phase: 'ended', winner: 'evil' });
  });

  it('同一個任務連續 5 次被否決：壞人獲勝', () => {
    let res = started(5);
    for (let i = 0; i < 4; i++) res = rejectAll(res.state);
    expect(res.state).toMatchObject({ phase: 'speech', rejects: 4 });
    res = rejectAll(res.state);
    expect(res.state).toMatchObject({ phase: 'ended', winner: 'evil' });
  });

  it('3 個任務成功：進入刺殺階段，公開所有壞人', () => {
    const { state, events } = playQuests([false, true, false, false]);
    expect(state.phase).toBe('assassinate');
    expect(announces(events).join('\n')).toContain('刺殺');
    expect(announces(events).join('\n')).toContain('<@p4>、<@p5>');
  });
});

// 5 人局：p1 梅林、p4 刺客
const assassinating = () => playQuests([false, false, false]);
const stab = (user: string, target: string, s: AState) => run([{ type: 'assassinate', user, target }], s);

describe('avalon/win-condition: 刺殺梅林', () => {
  it('刺客在壞人群組收到所有好人的按鈕，60 秒', () => {
    const { events } = assassinating();
    const p = prompts(events, 'assassinate').at(-1)!;
    expect(p.audience).toBe('wolves');
    expect(p.text).toContain('<@p4>');
    expect(values(p)).toEqual(['p1', 'p2', 'p3']);
    expect(lastTimer(events).ms).toBe(60_000);
  });

  it('刺中梅林：壞人獲勝；刺錯人：好人獲勝', () => {
    const s = assassinating().state;
    const hit = stab('p4', 'p1', s);
    expect(hit.state.winner).toBe('evil');
    expect(announces(hit.events).join('\n')).toContain('刺中梅林');
    const miss = stab('p4', 'p3', s);
    expect(miss.state.winner).toBe('good');
    expect(announces(miss.events).join('\n')).toContain('不是梅林');
  });

  it('只有刺客的選擇算數，不能刺壞人', () => {
    const s = assassinating().state;
    const denied = stab('p5', 'p1', s);
    expect(denied.state.phase).toBe('assassinate');
    expect(ephemeralTo(denied.events, 'p5')).toBeDefined();
    expect(stab('p4', 'p5', s).state.phase).toBe('assassinate');
  });

  it('60 秒沒選：隨機刺殺一位好人', () => {
    const { state, events } = assassinating();
    const after = run([{ type: 'timeout', id: lastTimer(events).id }], state);
    expect(after.state.phase).toBe('ended');
  });
});

describe('avalon/win-condition: 結束公開與再來一局', () => {
  it('公告獲勝陣營、每個人的身分和任務結果，貼出再來一局', () => {
    const { events } = stab('p4', 'p3', assassinating().state);
    const text = announces(events).at(-1)!;
    expect(text).toContain('好人獲勝');
    expect(text).toContain('<@p1>：梅林');
    expect(text).toContain('<@p5>：莫甘娜');
    expect(text).toContain('✅✅✅');
    expect(prompts(events, 'rematch')).toHaveLength(1);
  });

  it('再來一局：上一局的真人玩家可以開新房間，其他人不行；取消的遊戲不能', () => {
    const ended = stab('p4', 'p3', assassinating().state).state;
    const again = run([{ type: 'rematch', user: 'p3', channel: 'C1' }], ended);
    expect(again.state).toMatchObject({ phase: 'lobby', host: 'p3', players: [{ id: 'p3' }] });
    expect(again.state.timerSeq).toBe(ended.timerSeq);
    expect(ephemeralTo(run([{ type: 'rematch', user: 'X', channel: 'C1' }], ended).events, 'X')).toBeDefined();
    const cancelled = run([{ type: 'cancel', user: 'p1' }], started(5).state).state;
    expect(run([{ type: 'rematch', user: 'p2', channel: 'C1' }], cancelled).events).toEqual([]);
  });
});

const withBots = (r: () => number) => run([{ type: 'addBot', user: 'p1', count: 4 }, { type: 'start', user: 'p1' }], lobbyWith(1).state, r);
const isBotId = (id: string) => id.startsWith('bot:');
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe('avalon/bots: bot 的行動', () => {
  it('bot 發言：說一句通用台詞後立刻換下一位', () => {
    // rng 0：隊長是 p1，發言順序 bot1～bot4、最後 p1
    const { state, events } = withBots(() => 0);
    expect(state.speaker).toBe('p1');
    const lines = announces(events).filter((t) => t.startsWith('🤖'));
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(AVALON_BOT_LINES.some((x) => l.endsWith(x))).toBe(true);
  });

  it('bot 當隊長：隨機選滿隊伍並送出，壞人 bot 一定選自己；在隊伍裡的 bot 投贊成', () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = seeded(seed);
      let res = withBots(r);
      for (let i = 0; i < 10 && res.state.phase === 'speech'; i++) res = applyAvalon(res.state, { type: 'endSpeech', user: 'p1' }, r);
      const s = res.state;
      const leader = s.players[s.leader];
      if (!isBotId(leader.id) || s.phase !== 'teamVote') continue;
      expect(s.team).toHaveLength(2);
      if (isEvil(leader.role)) expect(s.team).toContain(leader.id);
      for (const id of s.team.filter(isBotId)) expect(s.votes[id]).toBe('approve');
      for (const p of s.players.filter((x) => isBotId(x.id))) expect(s.votes[p.id]).toBeDefined();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('出任務：好人 bot 出成功，壞人 bot 出失敗', () => {
    const { state } = withBots(() => 0);
    const bots = state.players.filter((p) => isBotId(p.id));
    const evilBot = bots.find((p) => isEvil(p.role))!;
    const goodBot = bots.find((p) => !isEvil(p.role))!;
    const picking1 = run([{ type: 'endSpeech', user: 'p1' }], state, () => 0).state;
    const team = pick([evilBot.id, goodBot.id], picking1, 'p1').state;
    const voting1 = run([{ type: 'confirmTeam', user: 'p1' }], team, () => 0).state;
    const { events } = run([{ type: 'teamVote', user: 'p1', vote: 'approve' }], voting1, () => 0);
    expect(announces(events).join('\n')).toContain('任務 1 失敗（1 張失敗票）');
  });

  it('1 位真人加 bot、真人什麼都不做，遊戲一定會結束', () => {
    for (const bots of [4, 6, 9]) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = seeded(seed);
        let s = run([{ type: 'addBot', user: 'p1', count: bots }, { type: 'start', user: 'p1' }], lobbyWith(1).state, r).state;
        for (let step = 0; step < 500 && s.phase !== 'ended'; step++) s = applyAvalon(s, { type: 'timeout', id: s.timers.phase! }, r).state;
        expect(s.phase, `${bots} bots, seed ${seed}`).toBe('ended');
      }
    }
  });
});

const gifOf = (events: GameEvent[], text: string) =>
  (events.find((e) => e.type === 'announce' && e.text.includes(text)) as { gif?: string } | undefined)?.gif;
const gifs = (events: GameEvent[]) => events.filter((e) => e.type === 'announce' && e.gif).map((e) => (e as { gif: string }).gif);

describe('announcement-gifs: 阿瓦隆', () => {
  it('隊伍通過和被否決用不同的 GIF', () => {
    const s = teamVoting().state;
    expect(gifOf(approveAll(s).events, '隊伍通過')).toBe('teamApproved');
    const rejected = teamVotes(s.players.map((p) => [p.id, 'reject'] as [string, 'reject']), s).events;
    expect(gifOf(rejected, '隊伍被否決')).toBe('teamRejected');
  });

  it('任務成功和失敗用不同的 GIF', () => {
    expect(gifOf(playQuests([false]).events, '任務 1 成功')).toBe('questSuccess');
    expect(gifOf(playQuests([true]).events, '任務 1 失敗')).toBe('questFail');
  });

  it('第 3 個任務成功進入刺殺：只附「進入刺殺」的 GIF', () => {
    const { events } = assassinating();
    expect(gifs(events)).toEqual(['assassination']);
    expect(gifOf(events, '好人完成了 3 個任務')).toBe('assassination');
  });

  it('造成結束的時刻：GIF 附在結束公告上，取代勝利 GIF', () => {
    const s = assassinating().state;
    expect(gifs(stab('p4', 'p1', s).events)).toEqual(['duelWin']);
    expect(gifOf(stab('p4', 'p1', s).events, '遊戲結束')).toBe('duelWin');
    expect(gifs(stab('p4', 'p3', s).events)).toEqual(['duelLose']);
    expect(gifs(playQuests([true, true, true]).events)).toEqual(['questFail']);
    let res = started(5);
    for (let i = 0; i < 5; i++) res = rejectAll(res.state);
    expect(gifs(res.events)).toEqual(['teamRejected']);
    expect(gifOf(res.events, '遊戲結束')).toBe('teamRejected');
  });
});
