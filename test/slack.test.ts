import { describe, expect, it } from 'vitest';
import { GameHost, parseCommand, type SlackClient } from '../src/slack.js';

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
