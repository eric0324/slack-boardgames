// Slack adapter：把 slash command 和按鈕轉成 engine action，再把 engine event 轉成 Slack API 呼叫。
import { applyAction, isBot, MAX_PLAYERS, mention, RULES_URL, type Action, type GameEvent, type GameState, type GifKey, type Rng } from './engine.js';
import { GIFS } from './gifs.js';
import { formatStats, type StatsStore } from './stats.js';
import { applyUndercover, type UAction, type UState } from './undercover.js';

// 只列出用到的 WebClient 方法，測試時可以換成假的 client
export interface SlackClient {
  chat: {
    postMessage(args: any): Promise<any>;
    update(args: any): Promise<any>;
    postEphemeral(args: any): Promise<any>;
  };
  conversations: {
    open(args: any): Promise<any>;
  };
}

export interface HostOptions {
  rng?: Rng;
  gifs?: Partial<Record<GifKey, string[]>>;
  stats?: StatsStore;
  setTimer?: (fn: () => void, ms: number) => void;
}

const HELP = [
  '*狼人殺指令*',
  '• `/werewolf new`：開房（任何人）',
  '• `/werewolf addbot [數量]`：加入 bot 補人數（房主，開始前）',
  '• `/werewolf removebot [數量]`：移除 bot（房主，開始前）',
  '• `/werewolf start`：開始遊戲，需要 6～12 人（房主）',
  '• `/werewolf next`：跳過目前的發言者或遺言（房主）',
  '• `/werewolf vote`：結束輪流發言，直接投票（房主）',
  '• `/werewolf cancel`：取消遊戲（房主）',
  '• `/werewolf stats [@某人]`：查詢自己或別人在這個頻道的戰績（任何人）',
  `📖 完整說明：<${encodeURI('https://github.com/eric0324/slack-gamebuddy/wiki/狼人殺-指令')}|指令>、<${RULES_URL}|遊戲規則>`,
].join('\n');

const WIKI = 'https://github.com/eric0324/slack-gamebuddy/wiki';

const GAME_LIST = [
  '*可以玩的遊戲*',
  '• 🐺 *狼人殺*（`werewolf`）：6～12 人，開房 `/game werewolf new`（或 `/werewolf new`）',
  '• 🕵️ *誰是臥底*（`undercover`）：4～12 人，開房 `/game undercover new`',
  '各遊戲的指令：`/game werewolf help`、`/game undercover help`',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const UNDERCOVER_HELP = [
  '*誰是臥底指令*',
  '• `/game undercover new`：開房（任何人）',
  '• `/game undercover addbot [數量]`：加入 bot 補人數（房主，開始前）',
  '• `/game undercover removebot [數量]`：移除 bot（房主，開始前）',
  '• `/game undercover start`：開始遊戲，需要 4～12 人（房主）',
  '• `/game undercover next`：跳過目前的描述者（房主）',
  '• `/game undercover vote`：結束描述，直接投票（房主）',
  '• `/game undercover cancel`：取消遊戲（房主）',
  '• `/game undercover guess <詞>`：被投出去的白板猜平民詞（60 秒內）',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const NOT_APPLICABLE = '這個指令不適用於目前的遊戲。';
const BUSY = '這個頻道已經有遊戲了。';

export function parseUndercoverCommand(text: string, user: string, channel: string): UAction | null {
  const [sub, ...rest] = text.trim().split(/\s+/);
  switch (sub) {
    case 'new':
      return { type: 'new', user, channel };
    case 'start':
      return { type: 'start', user };
    case 'cancel':
      return { type: 'cancel', user };
    case 'next':
      return { type: 'skipSpeaker', user };
    case 'vote':
      return { type: 'endDiscussion', user };
    case 'guess':
      return rest.length ? { type: 'guess', user, word: rest.join(' ') } : null;
    case 'addbot':
    case 'removebot': {
      const count = rest[0] === undefined ? 1 : Number(rest[0]);
      if (rest.length > 1 || !Number.isInteger(count) || count < 1) return null;
      return { type: sub === 'addbot' ? 'addBot' : 'removeBot', user, count };
    }
    default:
      return null;
  }
}

// 誰是臥底的按鈕和狼人殺共用 action_id 的種類
function undercoverButton(kind: string, value: string, user: string, channel: string): UAction | null {
  switch (kind) {
    case 'join':
    case 'leave':
    case 'start':
    case 'endSpeech':
      return { type: kind, user };
    case 'dayVote':
    case 'pkVote':
      return { type: 'dayVote', user, target: value };
    case 'rematch':
      return { type: 'rematch', user, channel };
    default:
      return null;
  }
}

export function parseCommand(text: string, user: string, channel: string): Action | null {
  const [sub, arg, ...rest] = text.trim().split(/\s+/);
  if (sub === 'addbot' || sub === 'removebot') {
    const count = arg === undefined ? 1 : Number(arg);
    if (rest.length || !Number.isInteger(count) || count < 1) return null;
    return { type: sub === 'addbot' ? 'addBot' : 'removeBot', user, count };
  }
  switch (text.trim()) {
    case 'new':
      return { type: 'new', user, channel };
    case 'start':
      return { type: 'start', user };
    case 'cancel':
      return { type: 'cancel', user };
    case 'vote':
      return { type: 'endDiscussion', user };
    case 'next':
      return { type: 'skipSpeaker', user };
    default:
      return null;
  }
}

export function buttonAction(kind: string, value: string, user: string, channel = ''): Action | null {
  switch (kind) {
    case 'join':
    case 'leave':
    case 'start':
      return { type: kind, user };
    case 'wolfKill':
      return { type: 'wolfVote', user, target: value };
    case 'seerCheck':
      return { type: 'seerCheck', user, target: value };
    case 'witch':
      return { type: 'witchAct', user, choice: value };
    case 'dayVote':
    case 'pkVote':
      return { type: 'dayVote', user, target: value };
    case 'shoot':
      return { type: 'shoot', user, target: value };
    case 'endSpeech':
      return { type: 'endSpeech', user };
    case 'rematch':
      return { type: 'rematch', user, channel };
    case 'duel':
      return { type: 'duel', user, target: value };
    default:
      return null;
  }
}

// 每個按鈕的 action_id 是 `ww:<kind>:<index>`（同一則訊息裡不能重複），value 是 `<遊戲頻道>|<選項值>`
const button = (kind: string, i: number, label: string, channel: string, value: string) => ({
  type: 'button',
  action_id: `ww:${kind}:${i}`,
  text: { type: 'plain_text', text: label },
  value: `${channel}|${value}`,
});

export class GameHost {
  games = new Map<string, GameState>();
  undercoverGames = new Map<string, UState>();
  private lastKind = new Map<string, 'werewolf' | 'undercover'>(); // 每個頻道最近一局是哪款遊戲
  private lobbyTs = new Map<string, string>();
  private names = new Map<string, string>();
  private dms = new Map<string, string>(); // user → 私訊頻道
  private wolfChats = new Map<string, { users: string; id: string }>(); // 遊戲頻道 → 狼人多人私訊
  private queue: Promise<void> = Promise.resolve();
  private rng: Rng;
  private gifs: Partial<Record<GifKey, string[]>>;
  private stats?: StatsStore;
  private setTimer: (fn: () => void, ms: number) => void;

  constructor(
    private client: SlackClient,
    opts: HostOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
    this.gifs = opts.gifs ?? GIFS;
    this.stats = opts.stats;
    this.setTimer = opts.setTimer ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  // 等目前排隊中的訊息都送完（測試用）
  idle(): Promise<void> {
    return this.queue;
  }

  // 頻道裡正在進行（還沒結束）的是哪款遊戲
  private active(channel: string): 'werewolf' | 'undercover' | null {
    const w = this.games.get(channel);
    if (w && w.phase !== 'ended') return 'werewolf';
    const u = this.undercoverGames.get(channel);
    if (u && u.phase !== 'ended') return 'undercover';
    return null;
  }

  private reply(channel: string, user: string, text: string): Promise<void> {
    return this.deliver(channel, [{ type: 'ephemeral', to: user, text }]);
  }

  // `/game <遊戲> <子指令>`
  game(channel: string, user: string, userName: string, text: string): Promise<void> {
    this.names.set(user, userName);
    const [g, ...rest] = text.trim().split(/\s+/);
    const restText = rest.join(' ');
    if (g === 'werewolf') return this.command(channel, user, userName, restText);
    if (g === 'undercover') return this.undercover(channel, user, restText);
    if (g === 'stats') return this.showStats(channel, user, restText);
    return this.reply(channel, user, GAME_LIST);
  }

  // `/werewolf <子指令>`（也是 `/game werewolf <子指令>`）
  command(channel: string, user: string, userName: string, text: string): Promise<void> {
    this.names.set(user, userName);
    const [sub, ...args] = text.trim().split(/\s+/);
    if (sub === 'stats') return this.showStats(channel, user, args.join(' '));
    const action = parseCommand(text, user, channel);
    if (!action) return this.reply(channel, user, HELP);
    if (this.active(channel) === 'undercover') return this.reply(channel, user, action.type === 'new' ? BUSY : NOT_APPLICABLE);
    return this.dispatch(channel, action);
  }

  // `/game undercover <子指令>`
  private undercover(channel: string, user: string, text: string): Promise<void> {
    const action = parseUndercoverCommand(text, user, channel);
    if (!action) return this.reply(channel, user, UNDERCOVER_HELP);
    if (this.active(channel) === 'werewolf') return this.reply(channel, user, action.type === 'new' ? BUSY : NOT_APPLICABLE);
    return this.dispatchUndercover(channel, action);
  }

  button(actionId: string, value: string, user: string, userName: string): Promise<void> {
    this.names.set(user, userName);
    const kind = actionId.split(':')[1];
    const sep = value.indexOf('|');
    const channel = value.slice(0, sep);
    if (this.lastKind.get(channel) === 'undercover') {
      const u = undercoverButton(kind, value.slice(sep + 1), user, channel);
      return u ? this.dispatchUndercover(channel, u) : Promise.resolve();
    }
    const action = buttonAction(kind, value.slice(sep + 1), user, channel);
    return action ? this.dispatch(channel, action) : Promise.resolve();
  }

  // `/werewolf stats [@某人]`：開啟 should_escape 後，mention 會是 <@U123> 或 <@U123|名字>
  private showStats(channel: string, user: string, arg: string): Promise<void> {
    const target = arg ? /^<@([A-Z0-9]+)(\|[^>]*)?>$/.exec(arg)?.[1] : user;
    const text = target
      ? formatStats(mention(target), this.stats?.stats(channel, target) ?? null)
      : '請用 @ 選擇要查詢的玩家，例如 `/werewolf stats @某人`。';
    return this.deliver(channel, [{ type: 'ephemeral', to: user, text }]);
  }

  // 頻道裡的一般訊息：只在有遊戲進行時交給 engine，engine 只讀不回應
  chat(channel: string, user: string, text: string): Promise<void> {
    if (this.active(channel) !== 'werewolf') return Promise.resolve();
    return this.dispatch(channel, { type: 'chat', user, text });
  }

  dispatch(channel: string, action: Action): Promise<void> {
    const { state, events } = applyAction(this.games.get(channel), action, this.rng);
    if (state) {
      this.games.set(channel, state);
      this.lastKind.set(channel, 'werewolf');
    }
    return this.deliver(channel, events);
  }

  dispatchUndercover(channel: string, action: UAction): Promise<void> {
    const { state, events } = applyUndercover(this.undercoverGames.get(channel), action, this.rng);
    if (state) {
      this.undercoverGames.set(channel, state);
      this.lastKind.set(channel, 'undercover');
    }
    return this.deliver(channel, events, 'undercover');
  }

  // 依序送出，避免同一局的訊息順序錯亂
  private deliver(channel: string, events: GameEvent[], kind: 'werewolf' | 'undercover' = 'werewolf'): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        for (const e of events) await this.send(channel, e, kind);
      })
      .catch((err) => console.error('[werewolf] Slack API error', err));
    return this.queue;
  }

  private async dm(user: string): Promise<string> {
    let id = this.dms.get(user);
    if (!id) {
      id = (await this.client.conversations.open({ users: user })).channel.id as string;
      this.dms.set(user, id);
    }
    return id;
  }

  // 只拉真人狼人；狼人全是 bot 時回傳 null
  private async wolfChat(channel: string, wolves: string[]): Promise<string | null> {
    const users = wolves.filter((w) => !isBot(w)).join(',');
    if (!users) {
      this.wolfChats.delete(channel);
      return null;
    }
    const cached = this.wolfChats.get(channel);
    if (cached?.users === users) return cached.id;
    const id = (await this.client.conversations.open({ users })).channel.id as string;
    this.wolfChats.set(channel, { users, id });
    return id;
  }

  // 把選項文字裡的玩家 id 換成名字（按鈕只能放純文字，不能用 <@id>）
  private label(text: string) {
    return text
      .split(' ')
      .map((t) => this.names.get(t) ?? (isBot(t) ? mention(t) : t))
      .join(' ');
  }

  private async send(channel: string, e: GameEvent, kind: 'werewolf' | 'undercover') {
    const chat = this.client.chat;
    switch (e.type) {
      case 'gameRecord':
        this.stats?.record(channel, e.winner, e.players);
        return;
      case 'startTimer':
        this.setTimer(() => {
          const timeout = { type: 'timeout' as const, id: e.id };
          void (kind === 'undercover' ? this.dispatchUndercover(channel, timeout) : this.dispatch(channel, timeout));
        }, e.ms);
        return;
      case 'dm':
        if (isBot(e.to)) return;
        await chat.postMessage({ channel: await this.dm(e.to), text: e.text });
        return;
      case 'wolfChat': {
        const id = await this.wolfChat(channel, e.wolves);
        if (id) await chat.postMessage({ channel: id, text: e.text });
        return;
      }
      case 'prompt': {
        if (e.audience === 'user' && isBot(e.user!)) return;
        const target =
          e.audience === 'channel' ? channel : e.audience === 'wolves' ? this.wolfChats.get(channel)?.id : await this.dm(e.user!);
        if (!target) return;
        const elements = e.options.map((o, i) => button(e.kind, i, this.label(o.label), channel, o.value));
        const blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: e.text } },
          { type: 'actions', elements },
        ];
        await chat.postMessage({ channel: target, text: e.text, blocks });
        return;
      }
      case 'announce': {
        const urls = (e.gif && this.gifs[e.gif]) || [];
        if (!urls.length) {
          await chat.postMessage({ channel, text: e.text });
          return;
        }
        const url = urls[Math.floor(this.rng() * urls.length)];
        const blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: e.text } },
          { type: 'image', image_url: url, alt_text: e.gif },
        ];
        await chat.postMessage({ channel, text: e.text, blocks });
        return;
      }
      case 'ephemeral':
        if (isBot(e.to)) return;
        await chat.postEphemeral({ channel, user: e.to, text: e.text });
        return;
      case 'lobby': {
        const text = `${e.title ?? '狼人殺'}房間（房主 ${mention(e.host)}）\n玩家（${e.players.length}/${MAX_PLAYERS}）：${e.players.map(mention).join(' ')}`;
        const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];
        if (e.open) {
          const elements = [
            button('join', 0, '加入', channel, 'join'),
            button('leave', 1, '離開', channel, 'leave'),
            { ...button('start', 2, '開始遊戲', channel, 'start'), style: 'primary' },
          ];
          blocks.push({ type: 'actions', elements });
        }
        const ts = this.lobbyTs.get(channel);
        if (ts) {
          await chat.update({ channel, ts, text, blocks });
        } else {
          const res = await chat.postMessage({ channel, text, blocks });
          this.lobbyTs.set(channel, res.ts);
        }
        if (!e.open) this.lobbyTs.delete(channel);
        return;
      }
    }
  }
}
