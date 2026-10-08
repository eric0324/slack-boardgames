import { describe, expect, it } from 'vitest';
import { GIFS } from '../src/gifs.js';
import { StatsStore } from '../src/stats.js';
import { mention } from '../src/engine.js';
import { buttonAction, GameHost, parseAvalonCommand, parseCodenamesCommand, parseCommand, parseHanabiCommand, parseJustOneCommand, parseLiarsDiceCommand, parseSpyfallCommand, parseUndercoverCommand, type SlackClient } from '../src/slack.js';

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
    expect(buttonAction('shoot', 'none', 'U6')).toEqual({ type: 'shoot', user: 'U6', target: 'none' });
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

  // rng 固定時：U1 狼人、第 1 個 bot 狼人、第 2 個預言家、第 3 個女巫、第 4、5 個村民
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
    const { host, calls } = await botGame();
    expect(calls).toContainEqual({ method: 'conversations.open', args: { users: 'U1' } });
    const wolfPosts = calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1');
    const bot1 = host.games.get('C1')!.players[1].id;
    expect(wolfPosts.map((c) => c.args.text).join('\n')).toContain(mention(bot1));
  });

  it('狼人全部都是 bot 時，不建立狼人的私密對話', async () => {
    // bot 加完之後才換上控制發牌的數字：第一次交換把 U1 換成村民，之後不再交換，狼人是第 1 和第 5 個 bot
    let seq: number[] = [];
    const { client, calls } = fakeClient();
    const host = new GameHost(client, { rng: () => seq.shift() ?? 0.99999, setTimer: () => {} });
    await host.command('C1', 'U1', 'alice', 'new');
    await host.command('C1', 'U1', 'alice', 'addbot 5');
    seq = [0, 0.99999, 0.99999, 0.99999, 0.99999];
    await host.command('C1', 'U1', 'alice', 'start');
    expect(host.games.get('C1')!.players.find((p) => p.id === 'U1')!.role).toBe('villager');
    const wolfOpens = calls.filter((c) => c.method === 'conversations.open' && c.args.users !== 'U1');
    expect(wolfOpens).toEqual([]);
  });

  it('按鈕上的 bot 顯示成 🤖<名字>', async () => {
    const { host, calls } = await botGame();
    const bot2 = host.games.get('C1')!.players[2].id;
    const wolfPrompt = calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1').find((c) => buttonsOf(c).length)!;
    expect(buttonsOf(wolfPrompt).map((b: any) => b.text.text)).toContain(mention(bot2));
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

  it('預設設定檔每個時刻都有至少 10 張 Giphy GIF，而且不重複', () => {
    const keys = [
      'start', 'night', 'dawnDeath', 'dawnPeace', 'exile', 'wolfKingShot', 'pk', 'duelWin', 'duelLose', 'goodWin', 'wolvesWin',
      'guessRight', 'guessWrong', 'teamApproved', 'teamRejected', 'questSuccess', 'questFail', 'assassination',
    ];
    expect(Object.keys(GIFS).sort()).toEqual([...keys].sort());
    const all = Object.values(GIFS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const k of keys) {
      const urls = GIFS[k as keyof typeof GIFS];
      expect(urls.length, k).toBeGreaterThanOrEqual(10);
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
    expect(lines.at(-1)).toContain('https://github.com/eric0324/slack-gamebuddy/wiki/');
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

describe('Slack：讀取頻道訊息', () => {
  it('頻道訊息轉成 chat action，不會產生任何 Slack 呼叫', async () => {
    const { host, calls } = setup();
    await host.command('C1', 'U1', 'alice', 'new');
    for (const u of ['U2', 'U3', 'U4', 'U5', 'U6']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.command('C1', 'U1', 'alice', 'start');
    // 第一夜：U1、U2 狼人刀 U5，U3 預言家查 U1，U4 女巫不用藥 → 天亮後 U5 的遺言
    for (const a of [
      { type: 'wolfVote', user: 'U1', target: 'U5' },
      { type: 'wolfVote', user: 'U2', target: 'U5' },
      { type: 'seerCheck', user: 'U3', target: 'U1' },
      { type: 'witchAct', user: 'U4', choice: 'skip' },
      { type: 'skipSpeaker', user: 'U1' },
    ] as const) {
      await host.dispatch('C1', a);
    }
    const before = calls.length;
    await host.chat('C1', 'U3', '我是預言家，查殺 <@U1>');
    expect(calls.length).toBe(before);
    expect(host.games.get('C1')!.claims).toContainEqual({ by: 'U3', night: 1, target: 'U1', wolf: true });
  });

  it('沒有遊戲的頻道直接忽略', async () => {
    const { host, calls } = setup();
    await host.chat('C9', 'U1', '我是預言家');
    expect(calls).toEqual([]);
    expect(host.games.has('C9')).toBe(false);
  });
});

describe('game-commands: /game 指令與多款遊戲', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game 列出可以玩的遊戲', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', '');
    const text = lastEph(calls).text;
    for (const s of ['狼人殺', 'werewolf', '誰是臥底', 'undercover', '/game undercover new', '間諜危機', 'spyfall', '4～10 人', '/game spyfall new', '阿瓦隆', 'avalon', '5～10 人', '/game avalon new', '機密代號', 'codenames', '4～12 人', '/game codenames new']) {
      expect(text).toContain(s);
    }
  });

  it('/game werewolf new 和 /werewolf new 效果相同', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'werewolf new');
    expect(host.games.get('C1')).toMatchObject({ phase: 'lobby', host: 'U1' });
    expect(calls.find((c) => c.method === 'chat.postMessage')!.args.text).toContain('狼人殺房間');
  });

  it('/game undercover new 開誰是臥底的房間，按鈕加入會更新公告', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'undercover new');
    expect(calls.at(-1)!.args.text).toContain('誰是臥底房間');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    expect(host.undercoverGames.get('C1')!.players.map((p) => p.id)).toEqual(['U1', 'U2']);
    expect(calls.at(-1)).toMatchObject({ method: 'chat.update', args: { text: expect.stringContaining('<@U2>') } });
  });

  it('/game undercover help 列出誰是臥底的指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'undercover help');
    const text = lastEph(calls).text;
    for (const s of ['new', 'addbot', 'removebot', 'start', 'next', 'vote', 'cancel', 'guess']) expect(text).toContain(`/game undercover ${s}`);
  });

  it('一個頻道同時只有一局：狼人殺進行中不能開誰是臥底，反過來也一樣', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'werewolf new');
    await host.game('C1', 'U2', 'bob', 'undercover new');
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    expect(host.undercoverGames.has('C1')).toBe(false);

    const other = setup();
    await other.host.game('C2', 'U1', 'alice', 'undercover new');
    await other.host.command('C2', 'U2', 'bob', 'new');
    expect(lastEph(other.calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
  });

  it('遊戲結束後可以換一款遊戲', async () => {
    const { host } = setup();
    await host.game('C1', 'U1', 'alice', 'werewolf new');
    await host.game('C1', 'U1', 'alice', 'werewolf cancel');
    await host.game('C1', 'U1', 'alice', 'undercover new');
    expect(host.undercoverGames.get('C1')).toMatchObject({ phase: 'lobby' });
  });

  it('對誰是臥底使用狼人殺的指令：只讓輸入的人看到不適用', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'undercover new');
    await host.game('C1', 'U1', 'alice', 'werewolf start');
    expect(lastEph(calls)).toMatchObject({ user: 'U1', text: '這個指令不適用於目前的遊戲。' });
    await host.command('C1', 'U1', 'alice', 'start');
    expect(lastEph(calls)).toMatchObject({ text: '這個指令不適用於目前的遊戲。' });
  });

  it('誰是臥底的開始按鈕、私訊發詞和計時都交給誰是臥底', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'undercover new');
    for (const u of ['U2', 'U3', 'U4']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    const s = host.undercoverGames.get('C1')!;
    expect(s.phase).toBe('speech');
    expect(calls.some((c) => c.method === 'chat.postMessage' && String(c.args.text).includes('你的詞是：'))).toBe(true);
    const speaker = s.speaker;
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.undercoverGames.get('C1')!.speaker).not.toBe(speaker);
  });

  it('白板用 /game undercover guess 猜詞', () => {
    expect(parseUndercoverCommand('guess  牛奶 ', 'U1', 'C1')).toEqual({ type: 'guess', user: 'U1', word: '牛奶' });
    expect(parseUndercoverCommand('addbot 3', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 3 });
    expect(parseUndercoverCommand('vote', 'U1', 'C1')).toEqual({ type: 'endDiscussion', user: 'U1' });
    expect(parseUndercoverCommand('dance', 'U1', 'C1')).toBeNull();
  });

  it('/game stats 查詢戰績', async () => {
    const { client, calls } = fakeClient();
    const stats = new StatsStore(':memory:');
    stats.record('C1', 'good', [{ id: 'U1', role: 'seer' }]);
    const host = new GameHost(client, { stats, setTimer: () => {} });
    await host.game('C1', 'U1', 'alice', 'stats');
    expect(lastEph(calls).text).toContain('總計：1 場 1 勝');
  });
});

describe('game-commands: 間諜危機', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game spyfall new 開間諜危機的房間，按鈕加入會更新公告', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'spyfall new');
    expect(calls.at(-1)!.args.text).toContain('間諜危機房間');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    expect(host.spyfallGames.get('C1')!.players.map((p) => p.id)).toEqual(['U1', 'U2']);
  });

  it('/game spyfall help 列出間諜危機的指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'spyfall help');
    const text = lastEph(calls).text;
    for (const s of ['new', 'addbot', 'removebot', 'start', 'next', 'vote', 'cancel', 'guess']) expect(text).toContain(`/game spyfall ${s}`);
  });

  it('一個頻道同時只有一局：間諜危機和其他遊戲互相擋', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'spyfall new');
    await host.game('C1', 'U2', 'bob', 'undercover new');
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    await host.game('C1', 'U2', 'bob', 'werewolf start');
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個指令不適用於目前的遊戲。' });

    const other = setup();
    await other.host.game('C2', 'U1', 'alice', 'undercover new');
    await other.host.game('C2', 'U2', 'bob', 'spyfall new');
    expect(lastEph(other.calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    expect(other.host.spyfallGames.has('C2')).toBe(false);
  });

  it('開始按鈕、私訊、選人和回答完畢按鈕、計時都交給間諜危機', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'spyfall new');
    for (const u of ['U2', 'U3', 'U4']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    expect(host.spyfallGames.get('C1')!.qa).toMatchObject({ step: 'choose', asker: 'U4' });
    expect(calls.some((c) => c.method === 'chat.postMessage' && String(c.args.text).includes('你是間諜'))).toBe(true);
    await host.button('ww:askTarget:1', 'C1|U2', 'U4', 'U4');
    expect(host.spyfallGames.get('C1')!.qa).toMatchObject({ step: 'answer', target: 'U2' });
    await host.button('ww:endAnswer:0', 'C1|U2', 'U2', 'U2');
    expect(host.spyfallGames.get('C1')!.qa).toMatchObject({ step: 'choose', asker: 'U2' });
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.spyfallGames.get('C1')!.qa!.step).toBe('answer');
  });

  it('指令解析：guess 地點、next、vote、addbot', () => {
    expect(parseSpyfallCommand('guess  KTV包廂 ', 'U1', 'C1')).toEqual({ type: 'guess', user: 'U1', location: 'KTV包廂' });
    expect(parseSpyfallCommand('next', 'U1', 'C1')).toEqual({ type: 'skipSpeaker', user: 'U1' });
    expect(parseSpyfallCommand('vote', 'U1', 'C1')).toEqual({ type: 'endDiscussion', user: 'U1' });
    expect(parseSpyfallCommand('addbot 2', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 2 });
    expect(parseSpyfallCommand('guess', 'U1', 'C1')).toBeNull();
    expect(parseSpyfallCommand('dance', 'U1', 'C1')).toBeNull();
  });
});

describe('game-commands: 阿瓦隆', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game avalon new 開阿瓦隆的房間，按鈕加入會更新公告', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'avalon new');
    expect(calls.at(-1)!.args.text).toContain('阿瓦隆房間');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    expect(host.avalonGames.get('C1')!.players.map((p) => p.id)).toEqual(['U1', 'U2']);
  });

  it('/game avalon help 列出阿瓦隆的指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'avalon help');
    const text = lastEph(calls).text;
    for (const s of ['new', 'addbot', 'removebot', 'start', 'next', 'cancel']) expect(text).toContain(`/game avalon ${s}`);
  });

  it('一個頻道同時只有一局：阿瓦隆和其他遊戲互相擋', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'avalon new');
    await host.game('C1', 'U2', 'bob', 'spyfall new');
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    const other = setup();
    await other.host.game('C2', 'U1', 'alice', 'werewolf new');
    await other.host.game('C2', 'U2', 'bob', 'avalon new');
    expect(lastEph(other.calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    expect(other.host.avalonGames.has('C2')).toBe(false);
  });

  it('開始、身分私訊、壞人群組、發言、選人、投票、出任務、計時都交給阿瓦隆', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'avalon new');
    for (const u of ['U2', 'U3', 'U4', 'U5']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    expect(calls.some((c) => c.method === 'chat.postMessage' && String(c.args.text).includes('你是梅林'))).toBe(true);
    expect(calls.some((c) => c.method === 'conversations.open' && c.args.users === 'U4,U5')).toBe(true);
    for (const u of ['U1', 'U2', 'U3', 'U4', 'U5']) await host.button('ww:endSpeech:0', `C1|${u}`, u, u);
    expect(host.avalonGames.get('C1')!.phase).toBe('pick');
    await host.button('ww:pickMember:0', 'C1|U1', 'U5', 'U5');
    await host.button('ww:pickMember:1', 'C1|U2', 'U5', 'U5');
    await host.button('ww:confirmTeam:0', 'C1|confirm', 'U5', 'U5');
    for (const u of ['U1', 'U2', 'U3', 'U4', 'U5']) await host.button('ww:teamVote:0', 'C1|approve', u, u);
    expect(host.avalonGames.get('C1')!.phase).toBe('quest');
    expect(calls.some((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1' && String(c.args.text).includes('任務 1'))).toBe(true);
    await host.button('ww:quest:0', 'C1|success', 'U1', 'U1');
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.avalonGames.get('C1')!.results).toEqual(['success']);
  });

  it('刺殺按鈕貼在壞人群組，刺客按下後結束', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'avalon new');
    for (const u of ['U2', 'U3', 'U4', 'U5']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    // 沒人操作：投票算贊成、任務算成功 → 3 個任務成功後進入刺殺
    for (let i = 0; i < 100 && host.avalonGames.get('C1')!.phase !== 'assassinate'; i++) {
      timers.at(-1)!.fn();
      await host.idle();
    }
    expect(host.avalonGames.get('C1')!.phase).toBe('assassinate');
    const post = calls.filter((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U4,U5').at(-1)!;
    expect(buttonsOf(post).map((b: any) => b.action_id)).toEqual(['ww:assassinate:0', 'ww:assassinate:1', 'ww:assassinate:2']);
    await host.button('ww:assassinate:0', 'C1|U1', 'U4', 'U4');
    expect(host.avalonGames.get('C1')).toMatchObject({ phase: 'ended', winner: 'evil' });
  });

  it('指令解析：next、addbot；沒有 vote 和 guess', () => {
    expect(parseAvalonCommand('next', 'U1', 'C1')).toEqual({ type: 'skipSpeaker', user: 'U1' });
    expect(parseAvalonCommand('addbot 4', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 4 });
    expect(parseAvalonCommand('vote', 'U1', 'C1')).toBeNull();
    expect(parseAvalonCommand('guess x', 'U1', 'C1')).toBeNull();
  });
});

describe('game-commands: 機密代號', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;
  async function startedHost() {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'codenames new');
    for (const u of ['U2', 'U3', 'U4']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    return { host, calls, timers };
  }

  it('/game codenames new 開機密代號的房間，按鈕加入會更新公告', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'codenames new');
    expect(calls.at(-1)!.args.text).toContain('機密代號房間');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    expect(host.codenamesGames.get('C1')!.players.map((p) => p.id)).toEqual(['U1', 'U2']);
  });

  it('/game codenames help 列出機密代號的指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'codenames help');
    const text = lastEph(calls).text;
    for (const s of ['new', 'start', 'clue', 'next', 'cancel']) expect(text).toContain(`/game codenames ${s}`);
  });

  it('一個頻道同時只有一局', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'codenames new');
    await host.game('C1', 'U2', 'bob', 'avalon new');
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    const other = setup();
    await other.host.game('C2', 'U1', 'alice', 'undercover new');
    await other.host.game('C2', 'U2', 'bob', 'codenames new');
    expect(lastEph(other.calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
  });

  it('開始後貼出 5×5 牌桌，隊長收到答案；給提示、按字卡翻牌後牌桌原地更新', async () => {
    const { host, calls } = await startedHost();
    const boardPost = calls.find((c) => c.method === 'chat.postMessage' && buttonsOf(c).some((b: any) => b.action_id.startsWith('ww:guess:')))!;
    const rows = boardPost.args.blocks.filter((b: any) => b.type === 'actions');
    expect(rows).toHaveLength(5);
    expect(rows[0].elements.map((b: any) => b.action_id)).toEqual(['ww:guess:0', 'ww:guess:1', 'ww:guess:2', 'ww:guess:3', 'ww:guess:4']);
    expect(rows[0].elements[0].value).toBe('C1|0');
    expect(calls.some((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U2' && String(c.args.text).includes('答案'))).toBe(true);
    await host.game('C1', 'U2', 'U2', 'codenames clue 水果 2');
    expect(host.codenamesGames.get('C1')!.phase).toBe('guess');
    await host.button('ww:guess:0', 'C1|0', 'U4', 'U4');
    expect(host.codenamesGames.get('C1')!.cards[0].revealed).toBe(true);
    const boardPosts = calls.filter((c) => c.method === 'chat.postMessage' && buttonsOf(c).some((b: any) => b.action_id.startsWith('ww:guess:')));
    expect(boardPosts).toHaveLength(1);
    const update = calls.filter((c) => c.method === 'chat.update' && buttonsOf(c).some((b: any) => b.action_id.startsWith('ww:guess:'))).at(-1);
    expect(update).toBeDefined();
    const first = update!.args.blocks.find((b: any) => b.type === 'actions').elements[0];
    expect(first).toMatchObject({ style: 'primary', text: { text: expect.stringContaining('🟦') } });
  });

  it('結束猜牌按鈕和計時交給機密代號', async () => {
    const { host, timers } = await startedHost();
    await host.game('C1', 'U2', 'U2', 'codenames clue 水果 2');
    await host.button('ww:guess:0', 'C1|0', 'U4', 'U4');
    await host.button('ww:endGuess:0', 'C1|end', 'U4', 'U4');
    expect(host.codenamesGames.get('C1')).toMatchObject({ phase: 'clue', turn: 'red' });
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.codenamesGames.get('C1')!.turn).toBe('blue');
  });

  it('指令解析：clue、next', () => {
    expect(parseCodenamesCommand('clue 水果 2', 'U1', 'C1')).toEqual({ type: 'clue', user: 'U1', word: '水果', count: 2 });
    expect(parseCodenamesCommand('clue 水 果 2', 'U1', 'C1')).toEqual({ type: 'clue', user: 'U1', word: '水 果', count: 2 });
    expect(parseCodenamesCommand('clue 水果', 'U1', 'C1')).toBeNull();
    expect(parseCodenamesCommand('next', 'U1', 'C1')).toEqual({ type: 'skipTurn', user: 'U1' });
    expect(parseCodenamesCommand('addbot', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 1 });
  });
});

describe('game-commands: 吹牛骰', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game 清單有吹牛骰；/game liarsdice help 列出指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', '');
    for (const s of ['吹牛骰', 'liarsdice', '2～8 人', '/game liarsdice new']) expect(lastEph(calls).text).toContain(s);
    await host.game('C1', 'U1', 'alice', 'liarsdice help');
    for (const s of ['new', 'addbot', 'removebot', 'start', 'bid', 'cancel']) expect(lastEph(calls).text).toContain(`/game liarsdice ${s}`);
  });

  it('開房、加入、開始、私訊骰子、喊數、開、計時都交給吹牛骰', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'liarsdice new');
    expect(calls.at(-1)!.args.text).toContain('吹牛骰房間');
    for (const u of ['U2', 'U3']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    expect(calls.some((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1' && String(c.args.text).includes('你的骰子'))).toBe(true);
    await host.game('C1', 'U3', 'U3', 'liarsdice bid 16 6');
    expect(host.games.get('C1')).toBeUndefined();
    await host.button('ww:challenge:0', 'C1|U1', 'U1', 'U1');
    timers.at(-1)!.fn();
    await host.idle();
    expect(calls.some((c) => String(c.args.text).includes('<@U3> 輸了'))).toBe(true);
  });

  it('一個頻道同時只有一局；指令解析', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'liarsdice new');
    await host.game('C1', 'U2', 'bob', 'codenames new');
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
    expect(parseLiarsDiceCommand('bid 3 5', 'U1', 'C1')).toEqual({ type: 'bid', user: 'U1', quantity: 3, face: 5 });
    expect(parseLiarsDiceCommand('bid 3', 'U1', 'C1')).toBeNull();
    expect(parseLiarsDiceCommand('addbot 2', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 2 });
    expect(parseLiarsDiceCommand('next', 'U1', 'C1')).toBeNull();
  });
});

describe('game-commands: 一字千金', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game 清單有一字千金；/game justone help 列出指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', '');
    for (const s of ['一字千金', 'justone', '3～7 人', '/game justone new']) expect(lastEph(calls).text).toContain(s);
    await host.game('C1', 'U1', 'alice', 'justone help');
    for (const s of ['new', 'start', 'clue', 'guess', 'next', 'cancel']) expect(lastEph(calls).text).toContain(`/game justone ${s}`);
  });

  it('開房、開始、私訊詞、給提示、猜詞、跳過按鈕、計時都交給一字千金', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'justone new');
    expect(calls.at(-1)!.args.text).toContain('一字千金房間');
    for (const u of ['U2', 'U3']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    const word = host.justOneGames.get('C1')!.word!;
    expect(calls.some((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1' && String(c.args.text).includes(word))).toBe(true);
    await host.game('C1', 'U1', 'U1', 'justone clue 牛頓');
    await host.game('C1', 'U2', 'U2', 'justone clue 紅色');
    expect(host.justOneGames.get('C1')!.phase).toBe('guess');
    await host.game('C1', 'U3', 'U3', `justone guess ${word}`);
    expect(host.justOneGames.get('C1')).toMatchObject({ score: 1, card: 2 });
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.justOneGames.get('C1')!.phase).toBe('guess');
    await host.button('ww:skipGuess:0', 'C1|U1', 'U1', 'U1');
    expect(host.justOneGames.get('C1')!.card).toBe(3);
  });

  it('指令解析', () => {
    expect(parseJustOneCommand('clue 牛頓', 'U1', 'C1')).toEqual({ type: 'clue', user: 'U1', word: '牛頓' });
    expect(parseJustOneCommand('clue 水 果', 'U1', 'C1')).toEqual({ type: 'clue', user: 'U1', word: '水 果' });
    expect(parseJustOneCommand('guess 蘋果', 'U1', 'C1')).toEqual({ type: 'guess', user: 'U1', word: '蘋果' });
    expect(parseJustOneCommand('next', 'U1', 'C1')).toEqual({ type: 'skipStep', user: 'U1' });
    expect(parseJustOneCommand('clue', 'U1', 'C1')).toBeNull();
  });
});

describe('game-commands: 政變', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game 清單有政變；/game coup help 列出指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', '');
    for (const s of ['政變', 'coup', '3～6 人', '/game coup new']) expect(lastEph(calls).text).toContain(s);
    await host.game('C1', 'U1', 'alice', 'coup help');
    for (const s of ['new', 'addbot', 'removebot', 'start', 'cancel']) expect(lastEph(calls).text).toContain(`/game coup ${s}`);
  });

  it('行動、目標、質疑、阻擋、私訊翻牌和交換的按鈕都交給政變', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'coup new');
    expect(calls.at(-1)!.args.text).toContain('政變房間');
    for (const u of ['U2', 'U3']) await host.button('ww:join:0', 'C1|join', u, u);
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    expect(calls.some((c) => c.method === 'chat.postMessage' && c.args.channel === 'D:U1' && String(c.args.text).includes('你的手牌'))).toBe(true);
    // U3 宣稱公爵收稅，U1 質疑成功 → U3 在私訊選一張翻開
    await host.button('ww:coupAction:2', 'C1|tax', 'U3', 'U3');
    await host.button('ww:challenge:0', 'C1|challenge', 'U1', 'U1');
    expect(host.coupGames.get('C1')!.losing).toEqual(['U3']);
    await host.button('ww:loseCard:0', 'C1|0', 'U3', 'U3');
    expect(host.coupGames.get('C1')!.players[2].cards[0].revealed).toBe(true);
    // U1 外援，U2 用公爵阻擋，沒人質疑就擋下來
    await host.button('ww:coupAction:1', 'C1|foreignAid', 'U1', 'U1');
    await host.button('ww:block:0', 'C1|duke', 'U2', 'U2');
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.coupGames.get('C1')!.players[0].coins).toBe(2);
    // U2 對 U1 勒索：選目標
    await host.button('ww:coupAction:3', 'C1|steal', 'U2', 'U2');
    await host.button('ww:coupTarget:0', 'C1|U1', 'U2', 'U2');
    expect(host.coupGames.get('C1')!.phase).toBe('challenge');
    // U3 交換
    const s = host.coupGames.get('C1')!;
    host.coupGames.set('C1', { ...s, phase: 'action', turn: 2, pending: undefined });
    await host.button('ww:coupAction:4', 'C1|exchange', 'U3', 'U3');
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.coupGames.get('C1')!.phase).toBe('exchange');
    await host.button('ww:keepCard:0', 'C1|1', 'U3', 'U3');
    expect(host.coupGames.get('C1')!.phase).toBe('action');
  });
});

describe('game-commands: 花火', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;

  it('/game 清單有花火；/game hanabi help 列出指令', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', '');
    for (const s of ['花火', 'hanabi', '2～5 人', '/game hanabi new']) expect(lastEph(calls).text).toContain(s);
    await host.game('C1', 'U1', 'alice', 'hanabi help');
    for (const s of ['new', 'start', 'hint', 'cancel']) expect(lastEph(calls).text).toContain(`/game hanabi ${s}`);
  });

  it('看牌、出牌、棄牌按鈕和提示指令、計時都交給花火', async () => {
    const { client, calls } = fakeClient();
    const timers: { fn: () => void; ms: number }[] = [];
    const host = new GameHost(client, { rng: () => 0.99999, setTimer: (fn, ms) => void timers.push({ fn, ms }), gifs: {} });
    await host.game('C1', 'U1', 'alice', 'hanabi new');
    expect(calls.at(-1)!.args.text).toContain('花火房間');
    await host.button('ww:join:0', 'C1|join', 'U2', 'bob');
    await host.button('ww:start:2', 'C1|start', 'U1', 'alice');
    await host.button('ww:hanabiTurn:0', 'C1|peek', 'U1', 'alice');
    expect(lastEph(calls)).toMatchObject({ user: 'U1', text: expect.stringContaining('<@U2>：🟥3') });
    await host.game('C1', 'U2', 'bob', 'hanabi hint <@U1|alice> 紅');
    expect(host.hanabiGames.get('C1')).toMatchObject({ hints: 7, turn: 0 });
    await host.button('ww:hanabiTurn:1', 'C1|play:0', 'U1', 'alice');
    expect(host.hanabiGames.get('C1')!.fireworks.red).toBe(1);
    await host.button('ww:hanabiTurn:6', 'C1|discard:0', 'U2', 'bob');
    expect(host.hanabiGames.get('C1')!.hints).toBe(8);
    timers.at(-1)!.fn();
    await host.idle();
    expect(host.hanabiGames.get('C1')!.turn).toBe(1);
  });

  it('提示指令解析：@某人 加上顏色或數字', () => {
    expect(parseHanabiCommand('hint <@U2|bob> 紅', 'U1', 'C1')).toEqual({ type: 'hint', user: 'U1', target: 'U2', color: 'red' });
    expect(parseHanabiCommand('hint <@U2> 3', 'U1', 'C1')).toEqual({ type: 'hint', user: 'U1', target: 'U2', number: 3 });
    expect(parseHanabiCommand('hint <@U2> 紫', 'U1', 'C1')).toBeNull();
    expect(parseHanabiCommand('hint bob 3', 'U1', 'C1')).toBeNull();
    expect(parseHanabiCommand('addbot', 'U1', 'C1')).toEqual({ type: 'addBot', user: 'U1', count: 1 });
  });
});

describe('game-commands: 遊戲大廳', () => {
  const lastEph = (calls: Call[]) => calls.filter((c) => c.method === 'chat.postEphemeral').at(-1)!.args;
  const KINDS = ['werewolf', 'undercover', 'spyfall', 'avalon', 'codenames', 'liarsdice', 'justone', 'coup', 'hanabi'];

  it('/game、/game help、不認識的代號：只讓自己看到大廳，每款遊戲一列加開房按鈕', async () => {
    for (const text of ['', 'help', 'chess']) {
      const { host, calls } = setup();
      await host.game('C1', 'U1', 'alice', text);
      const eph = lastEph(calls);
      expect(eph.user).toBe('U1');
      const buttons = (eph.blocks as any[]).filter((b) => b.accessory).map((b) => b.accessory);
      expect(buttons.map((b) => b.value)).toEqual(KINDS.map((k) => `C1|${k}`));
      expect(buttons.every((b: any) => b.action_id.startsWith('ww:lobbyOpen:') && b.text.text === '開房')).toBe(true);
      const all = JSON.stringify(eph.blocks);
      for (const s of ['狼人殺', '吹牛骰', '花火', '2～8 人', 'wiki', '/game <代號> help']) expect(all).toContain(s);
    }
  });

  it('按開房等同 /game <代號> new，按的人當房主', async () => {
    const { host, calls } = setup();
    await host.button('ww:lobbyOpen:5', 'C1|liarsdice', 'U2', 'bob');
    expect(host.liarsDiceGames.get('C1')).toMatchObject({ phase: 'lobby', host: 'U2' });
    expect(calls.at(-1)!.args.text).toContain('吹牛骰房間');
    const ww = setup();
    await ww.host.button('ww:lobbyOpen:0', 'C1|werewolf', 'U3', 'carol');
    expect(ww.host.games.get('C1')).toMatchObject({ phase: 'lobby', host: 'U3' });
  });

  it('頻道已經有遊戲時拒絕', async () => {
    const { host, calls } = setup();
    await host.game('C1', 'U1', 'alice', 'werewolf new');
    await host.button('ww:lobbyOpen:7', 'C1|coup', 'U2', 'bob');
    expect(host.coupGames.has('C1')).toBe(false);
    expect(lastEph(calls)).toMatchObject({ user: 'U2', text: '這個頻道已經有遊戲了。' });
  });
});
