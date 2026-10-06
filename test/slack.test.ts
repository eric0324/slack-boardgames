import { describe, expect, it } from 'vitest';
import { buttonAction, GameHost, parseCommand, type SlackClient } from '../src/slack.js';

type Call = { method: string; args: Record<string, any> };

function fakeClient() {
  const calls: Call[] = [];
  let ts = 0;
  const record = (method: string, result: (args: any) => unknown) => async (args: any) => {
    calls.push({ method, args });
    return result(args);
  };
  const client: SlackClient = {
    chat: {
      postMessage: record('chat.postMessage', (a) => ({ ok: true, channel: a.channel, ts: String(++ts) })),
      update: record('chat.update', () => ({ ok: true })),
      postEphemeral: record('chat.postEphemeral', () => ({ ok: true })),
    },
    conversations: {
      open: record('conversations.open', (a) => ({ ok: true, channel: { id: `D:${a.users}` } })),
    },
  };
  return { client, calls };
}

function setup() {
  const { client, calls } = fakeClient();
  const timers: { ms: number; fn: () => void }[] = [];
  const host = new GameHost(client, {
    rng: () => 0.99999,
    setTimer: (fn, ms) => void timers.push({ fn, ms }),
  });
  return { host, calls, timers };
}

const buttonsOf = (call: Call) =>
  (call.args.blocks ?? []).flatMap((b: any) => (b.type === 'actions' ? b.elements : []));

describe('parseCommand', () => {
  it('把子指令轉成 engine action', () => {
    expect(parseCommand('new', 'U1', 'C1')).toEqual({ type: 'new', user: 'U1', channel: 'C1' });
    expect(parseCommand('start', 'U1', 'C1')).toEqual({ type: 'start', user: 'U1' });
    expect(parseCommand(' cancel ', 'U1', 'C1')).toEqual({ type: 'cancel', user: 'U1' });
    expect(parseCommand('vote', 'U1', 'C1')).toEqual({ type: 'endDiscussion', user: 'U1' });
  });

  it('不認識的子指令回傳 null', () => {
    expect(parseCommand('', 'U1', 'C1')).toBeNull();
    expect(parseCommand('dance', 'U1', 'C1')).toBeNull();
  });
});

describe('Slack：指令與房間', () => {
  it('/werewolf new 在頻道貼出有「加入」「離開」按鈕的房間公告', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    const post = calls.find((c) => c.method === 'chat.postMessage')!;
    expect(post.args.channel).toBe('C1');
    expect(post.args.text).toContain('<@U1>');
    const ids = buttonsOf(post).map((b: any) => b.action_id);
    expect(ids).toEqual(['ww:join:0', 'ww:leave:1']);
  });

  it('按「加入」會更新同一則房間公告', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    const update = calls.find((c) => c.method === 'chat.update')!;
    expect(update.args).toMatchObject({ channel: 'C1', ts: '1' });
    expect(update.args.text).toContain('<@U2>');
  });

  it('錯誤訊息只讓本人看到', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    await host.command('C1', 'U1', 'alice', 'start');
    expect(calls.at(-1)).toMatchObject({
      method: 'chat.postEphemeral',
      args: { channel: 'C1', user: 'U1', text: expect.stringContaining('至少需要 6 人') },
    });
  });

  it('不認識的指令回覆使用說明', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'dance');
    expect(calls.at(-1)).toMatchObject({
      method: 'chat.postEphemeral',
      args: { user: 'U1', text: expect.stringContaining('/werewolf new') },
    });
  });

  it('不同頻道的遊戲互不影響', async () => {
    const { host } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    await host.command('C2', 'U9', 'zed', 'new');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    expect(host.games.get('C1')!.players.map((p) => p.id)).toEqual(['U1', 'U2']);
    expect(host.games.get('C2')!.players.map((p) => p.id)).toEqual(['U9']);
  });
});

// 6 人局：U1、U2 狼人，U3 預言家，U4 女巫，U5、U6 村民
const NAMES: Record<string, string> = { U1: 'alice', U2: 'bob', U3: 'carol', U4: 'dave', U5: 'erin', U6: 'frank' };
async function startedHost() {
  const ctx = setup();
  await ctx.host.command('C1', 'U1', 'alice', 'new');
  for (const u of ['U2', 'U3', 'U4', 'U5', 'U6']) await ctx.host.button('ww:join:0', 'C1|join', u, NAMES[u]);
  await ctx.host.command('C1', 'U1', 'alice', 'start');
  return ctx;
}
const postsTo = (calls: Call[], channel: string) =>
  calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === channel);

describe('Slack：event 轉換', () => {
  it('dm：開啟私訊再發送身分', async () => {
    const { calls } = await startedHost();
    expect(calls).toContainEqual({ method: 'conversations.open', args: { users: 'U3' } });
    expect(postsTo(calls, 'D:U3').map((c) => c.args.text)).toContainEqual(expect.stringContaining('預言家'));
  });

  it('wolfChat：開啟狼人的多人私訊，擊殺提示也送到同一個對話', async () => {
    const { calls } = await startedHost();
    const opens = calls.filter((c) => c.method === 'conversations.open' && c.args.users === 'U1,U2');
    expect(opens).toHaveLength(1);
    const wolfPosts = postsTo(calls, 'D:U1,U2');
    expect(wolfPosts[0].args.text).toContain('<@U1>');
    expect(buttonsOf(wolfPosts.at(-1)!).map((b: any) => b.value)).toContain('C1|U5');
  });

  it('prompt（user）：按鈕用玩家名字當文字，value 帶著遊戲頻道', async () => {
    const { calls } = await startedHost();
    const seerPrompt = postsTo(calls, 'D:U3').find((c) => buttonsOf(c).length)!;
    const btns = buttonsOf(seerPrompt);
    expect(btns[0]).toMatchObject({ action_id: 'ww:seerCheck:0', value: 'C1|U1', text: { text: 'alice' } });
  });

  it('prompt（channel）：投票按鈕貼在遊戲頻道', async () => {
    const { host, calls } = await startedHost();
    for (const a of [
      { type: 'wolfVote', user: 'U1', target: 'U5' },
      { type: 'wolfVote', user: 'U2', target: 'U5' },
      { type: 'seerCheck', user: 'U3', target: 'U1' },
      { type: 'witchAct', user: 'U4', choice: 'skip' },
      { type: 'endDiscussion', user: 'U1' },
    ] as const) {
      await host.dispatch('C1', a);
    }
    const vote = postsTo(calls, 'C1').at(-1)!;
    const btns = buttonsOf(vote);
    expect(btns.map((b: any) => b.text.text)).toEqual(['alice', 'bob', 'carol', 'dave', 'frank', '棄票']);
    expect(btns[0].action_id).toBe('ww:dayVote:0');
  });

  it('女巫的毒藥選項也顯示玩家名字', async () => {
    const { host, calls } = await startedHost();
    await host.dispatch('C1', { type: 'wolfVote', user: 'U1', target: 'U5' });
    await host.dispatch('C1', { type: 'wolfVote', user: 'U2', target: 'U5' });
    const witchPrompt = postsTo(calls, 'D:U4').at(-1)!;
    expect(buttonsOf(witchPrompt).map((b: any) => b.text.text)).toContain('毒 alice');
  });
});

describe('Slack：遊戲按鈕與計時', () => {
  it('把各種按鈕轉成 engine action', () => {
    expect(buttonAction('join', 'join', 'U1')).toEqual({ type: 'join', user: 'U1' });
    expect(buttonAction('leave', 'leave', 'U1')).toEqual({ type: 'leave', user: 'U1' });
    expect(buttonAction('wolfKill', 'U5', 'U1')).toEqual({ type: 'wolfVote', user: 'U1', target: 'U5' });
    expect(buttonAction('seerCheck', 'U1', 'U3')).toEqual({ type: 'seerCheck', user: 'U3', target: 'U1' });
    expect(buttonAction('witch', 'poison:U1', 'U4')).toEqual({ type: 'witchAct', user: 'U4', choice: 'poison:U1' });
    expect(buttonAction('dayVote', 'abstain', 'U2')).toEqual({ type: 'dayVote', user: 'U2', target: 'abstain' });
    expect(buttonAction('pkVote', 'U1', 'U2')).toEqual({ type: 'dayVote', user: 'U2', target: 'U1' });
    expect(buttonAction('hunterShoot', 'none', 'U6')).toEqual({ type: 'hunterShoot', user: 'U6', target: 'none' });
    expect(buttonAction('unknown', 'x', 'U1')).toBeNull();
  });

  it('在私訊裡按的按鈕會送到 value 指定的遊戲', async () => {
    const { host } = await startedHost();
    await host.button('ww:wolfKill:4', 'C1|U5', 'U1', 'alice');
    expect(host.games.get('C1')!.night!.wolfVotes).toEqual({ U1: 'U5' });
  });

  it('startTimer 會設定計時，時間到送出 timeout', async () => {
    const { host, timers, calls } = await startedHost();
    expect(timers.at(-1)!.ms).toBe(60_000);
    timers.at(-1)!.fn();
    await host.idle();
    expect(postsTo(calls, 'D:U1,U2').map((c) => c.args.text)).toContainEqual(expect.stringContaining('沒有擊殺目標'));
  });
});
