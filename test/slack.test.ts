import { describe, expect, it } from 'vitest';
import { GIFS } from '../src/gifs.js';
import { StatsStore } from '../src/stats.js';
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
  it('/werewolf new 在頻道貼出有「加入」「離開」「開始遊戲」按鈕的房間公告', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    const post = calls.find((c) => c.method === 'chat.postMessage')!;
    expect(post.args.channel).toBe('C1');
    expect(post.args.text).toContain('<@U1>');
    const ids = buttonsOf(post).map((b: any) => b.action_id);
    expect(ids).toEqual(['ww:join:0', 'ww:leave:1', 'ww:start:2']);
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
      { type: 'skipSpeaker', user: 'U1' },
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
    const wolfTimer = timers.find((t) => t.ms === 60_000)!;
    expect(wolfTimer).toBeDefined();
    wolfTimer.fn();
    await host.idle();
    expect(postsTo(calls, 'D:U1,U2').map((c) => c.args.text)).toContainEqual(expect.stringContaining('沒有擊殺目標'));
  });
});

describe('Slack：bot 玩家', () => {
  it('parseCommand 支援 addbot、removebot 和數量', () => {
    expect(parseCommand('addbot', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 1 });
    expect(parseCommand('addbot 5', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 5 });
    expect(parseCommand('removebot  2', 'U1', 'C1')).toEqual({ type: 'removeBot', user: 'U1', count: 2 });
    expect(parseCommand('addbot 0', 'U1', 'C1')).toBeNull();
    expect(parseCommand('addbot abc', 'U1', 'C1')).toBeNull();
  });

  // rng 固定時：U1 狼人、bot:1 狼人、bot:2 預言家、bot:3 女巫、bot:4、bot:5 村民
  async function botGame(rng?: () => number) {
    const { client, calls } = fakeClient();
    const host = new GameHost(client, { rng: rng ?? (() => 0.99999), setTimer: () => {} });
    await host.command('C1', 'U1', 'alice', 'new');
    await host.command('C1', 'U1', 'alice', 'addbot 5');
    await host.command('C1', 'U1', 'alice', 'start');
    return { host, calls };
  }

  it('不私訊 bot，也不把提示送給 bot', async () => {
    const { calls } = await botGame();
    const opened = calls.filter((c) => c.method === 'conversations.open').map((c) => c.args.users);
    expect(opened.some((u: string) => u.includes('bot:'))).toBe(false);
    expect(calls.some((c) => String(c.args.channel).includes('bot:'))).toBe(false);
    expect(calls.some((c) => c.method === 'chat.postEphemeral' && String(c.args.user).includes('bot:'))).toBe(false);
  });

  it('狼人有真人也有 bot：私密對話只拉真人，名單列出 bot', async () => {
    const { calls } = await botGame();
    expect(calls).toContainEqual({ method: 'conversations.open', args: { users: 'U1' } });
    const wolfPosts = calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1');
    expect(wolfPosts.map((c) => c.args.text).join('\n')).toContain('🤖Bot1');
  });

  it('狼人全部都是 bot 時，不建立狼人的私密對話', async () => {
    // 第一次交換把 U1 換成村民，之後不再交換：狼人是 bot:1 和 bot:5
    const seq = [0, 0.99999, 0.99999, 0.99999, 0.99999];
    const { host, calls } = await botGame(() => seq.shift() ?? 0.99999);
    expect(host.games.get('C1')!.players.find((p) => p.id === 'U1')!.role).toBe('villager');
    const wolfOpens = calls.filter((c) => c.method === 'conversations.open' && c.args.users !== 'U1');
    expect(wolfOpens).toEqual([]);
  });

  it('按鈕上的 bot 顯示成 🤖Bot<編號>', async () => {
    const { calls } = await botGame();
    const wolfPrompt = calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1').find((c) => buttonsOf(c).length)!;
    expect(buttonsOf(wolfPrompt).map((b: any) => b.text.text)).toContain('🤖Bot2');
  });
});

describe('Slack：公告 GIF', () => {
  async function nightAnnounce(gifs: Record<string, string[]>, rng: () => number) {
    const { client, calls } = fakeClient();
    const host = new GameHost(client, { rng, setTimer: () => {}, gifs });
    await host.command('C1', 'U1', 'alice', 'new');
    await host.command('C1', 'U1', 'alice', 'addbot 5');
    await host.command('C1', 'U1', 'alice', 'start');
    return calls.find((c) => c.method === 'chat.postMessage' && String(c.args.text).includes('天黑'))!;
  }
  const imageOf = (call: Call) => (call.args.blocks ?? []).find((b: any) => b.type === 'image');

  it('有設定 GIF 的公告送出文字加 image block', async () => {
    const call = await nightAnnounce({ night: ['https://x/a.gif'] }, () => 0.99999);
    expect(call.args.text).toContain('天黑');
    expect(imageOf(call)).toMatchObject({ type: 'image', image_url: 'https://x/a.gif' });
  });

  it('多張 GIF 隨機選', async () => {
    const urls = ['https://x/a.gif', 'https://x/b.gif', 'https://x/c.gif'];
    const a = imageOf(await nightAnnounce({ night: urls }, () => 0)).image_url;
    const c = imageOf(await nightAnnounce({ night: urls }, () => 0.99999)).image_url;
    expect(urls).toContain(a);
    expect(urls).toContain(c);
    expect(a).not.toBe(c);
  });

  it('沒有設定 GIF 時只送文字', async () => {
    const call = await nightAnnounce({}, () => 0.99999);
    expect(call.args.text).toContain('天黑');
    expect(call.args.blocks).toBeUndefined();
  });

  it('預設設定檔每個時刻都有至少 6 張 Giphy GIF，而且不重複', () => {
    const keys = ['start', 'night', 'dawnDeath', 'dawnPeace', 'exile', 'hunterShot', 'wolfKingShot', 'pk', 'duelWin', 'duelLose', 'goodWin', 'wolvesWin'];
    expect(Object.keys(GIFS).sort()).toEqual([...keys].sort());
    const all = Object.values(GIFS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const k of keys) {
      const urls = GIFS[k as keyof typeof GIFS];
      expect(urls.length, k).toBeGreaterThanOrEqual(6);
      for (const u of urls) expect(u).toMatch(/^https:\/\/media\.giphy\.com\/media\/\w+\/200\.gif$/);
    }
  });
});

describe('Slack：輪流發言', () => {
  it('/werewolf next 轉成跳過發言者', () => {
    expect(parseCommand('next', 'U1', 'C1')).toEqual({ type: 'skipSpeaker', user: 'U1' });
  });

  it('「結束發言」按鈕轉成 endSpeech', () => {
    expect(buttonAction('endSpeech', 'U3', 'U3')).toEqual({ type: 'endSpeech', user: 'U3' });
  });
});

describe('Slack：再來一局', () => {
  it('「再來一局」按鈕轉成 rematch action，帶著遊戲頻道', () => {
    expect(buttonAction('rematch', 'rematch', 'U1', 'C1')).toEqual({ type: 'rematch', user: 'U1', channel: 'C1' });
  });

  it('遊戲結束後按「再來一局」，頻道出現新的房間公告', async () => {
    const { client, calls } = fakeClient();
    const timers: (() => void)[] = [];
    // 固定值的 rng 會讓 bot 每次都平票、遊戲永遠不會結束，所以用有種子的 LCG
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const host = new GameHost(client, { rng, setTimer: (fn) => void timers.push(fn), gifs: {} });
    await host.command('C1', 'U1', 'alice', 'new');
    await host.command('C1', 'U1', 'alice', 'addbot 5');
    await host.command('C1', 'U1', 'alice', 'start');
    for (let i = 0; i < 500 && host.games.get('C1')!.phase !== 'ended'; i++) {
      timers.shift()?.();
      await host.idle();
    }
    expect(host.games.get('C1')!.phase).toBe('ended');
    const rematch = calls.filter((c) => buttonsOf(c).some((b: any) => b.action_id.startsWith('ww:rematch')));
    expect(rematch).toHaveLength(1);

    await host.button('ww:rematch:0', 'C1|rematch', 'U1', 'alice');
    expect(host.games.get('C1')).toMatchObject({ phase: 'lobby', host: 'U1' });
    const lobby = calls.at(-1)!;
    expect(lobby.method).toBe('chat.postMessage');
    expect(buttonsOf(lobby).map((b: any) => b.action_id)).toEqual(['ww:join:0', 'ww:leave:1', 'ww:start:2']);
  });
});

describe('Slack：騎士決鬥', () => {
  it('決鬥按鈕轉成 duel action', () => {
    expect(buttonAction('duel', 'U2', 'U7', 'C1')).toEqual({ type: 'duel', user: 'U7', target: 'U2' });
  });
});

describe('Slack：戰績查詢', () => {
  async function statsHost() {
    const { client, calls } = fakeClient();
    const stats = new StatsStore(':memory:');
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: () => {}, gifs: {}, stats });
    return { host, calls, stats };
  }
  const lastEphemeral = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/werewolf stats 查自己，只有自己看得到', async () => {
    const { host, calls, stats } = await statsHost();
    stats.record('C1', 'good', [{ id: 'U1', role: 'seer' }]);
    await host.command('C1', 'U1', 'alice', 'stats');
    expect(lastEphemeral(calls)).toMatchObject({ channel: 'C1', user: 'U1', text: expect.stringContaining('總計：1 場 1 勝（100%）') });
  });

  it('/werewolf stats @某人 查別人（支援有名字和沒名字的 mention 格式）', async () => {
    const { host, calls, stats } = await statsHost();
    stats.record('C1', 'wolves', [{ id: 'U2', role: 'werewolf' }]);
    for (const text of ['stats <@U2|bob>', 'stats <@U2>']) {
      await host.command('C1', 'U1', 'alice', text);
      expect(lastEphemeral(calls)).toMatchObject({ user: 'U1', text: expect.stringContaining('📊 <@U2> 在這個頻道的戰績') });
    }
  });

  it('不是 mention 時提示要用 @ 選擇玩家', async () => {
    const { host, calls } = await statsHost();
    await host.command('C1', 'U1', 'alice', 'stats bob');
    expect(lastEphemeral(calls).text).toContain('@');
  });

  it('全真人的遊戲結束時存進戰績', async () => {
    const { host, stats } = await statsHost();
    await host.command('C1', 'U1', 'alice', 'new');
    for (const u of ['U2', 'U3', 'U4', 'U5', 'U6']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.command('C1', 'U1', 'alice', 'start');
    // U1、U2 狼人，U3 預言家，U4 女巫。預言家先死，今晚刀女巫 → 狼人獲勝
    const s = host.games.get('C1')!;
    host.games.set('C1', {
      ...s,
      players: s.players.map((p) => (p.id === 'U3' ? { ...p, alive: false } : p)),
      night: { ...s.night!, seerDone: true },
    });
    await host.dispatch('C1', { type: 'wolfVote', user: 'U1', target: 'U4' });
    await host.dispatch('C1', { type: 'wolfVote', user: 'U2', target: 'U4' });
    await host.dispatch('C1', { type: 'witchAct', user: 'U4', choice: 'skip' });
    expect(host.games.get('C1')!.phase).toBe('ended');
    expect(stats.stats('C1', 'U1')!.total).toEqual({ games: 1, wins: 1 });
    expect(stats.stats('C1', 'U3')!.total).toEqual({ games: 1, wins: 0 });
  });
});

describe('Slack：使用說明', () => {
  const helpFor = async (text: string) => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', text);
    return calls.at(-1)!;
  };

  it('/werewolf help 回覆條列式使用說明，每個指令一行，最後附 wiki 連結', async () => {
    const call = await helpFor('help');
    expect(call).toMatchObject({ method: 'chat.postEphemeral', args: { user: 'U1' } });
    const lines = call.args.text.split('\n');
    for (const cmd of ['new', 'addbot', 'removebot', 'start', 'next', 'vote', 'cancel', 'stats']) {
      expect(lines.filter((l: string) => l.includes(`/werewolf ${cmd}`)).length, cmd).toBe(1);
    }
    expect(lines.at(-1)).toContain('https://github.com/eric0324/slack-werewolve/wiki/');
  });

  it('只輸入 /werewolf 或不認識的子指令，回覆同一份說明', async () => {
    const help = (await helpFor('help')).args.text;
    expect((await helpFor('')).args.text).toBe(help);
    expect((await helpFor('dance')).args.text).toBe(help);
  });
});

describe('Slack：開始遊戲按鈕', () => {
  it('「開始遊戲」按鈕轉成 start action', () => {
    expect(buttonAction('start', 'start', 'U1', 'C1')).toEqual({ type: 'start', user: 'U1' });
  });

  it('房主按下會開始遊戲；非房主和人數不足時只有按的人看到提示', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    expect(calls.at(-1)).toMatchObject({ method: 'chat.postEphemeral', args: { user: 'U1', text: expect.stringContaining('至少需要 6 人') } });

    for (const u of ['U2', 'U3', 'U4', 'U5', 'U6']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U2', 'U2');
    expect(calls.at(-1)).toMatchObject({ method: 'chat.postEphemeral', args: { user: 'U2', text: '只有房主可以開始遊戲。' } });
    expect(host.games.get('C1')!.phase).toBe('lobby');

    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    expect(host.games.get('C1')!.phase).toBe('night');
  });
});
