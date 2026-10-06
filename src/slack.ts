// Slack adapter：把 slash command 和按鈕轉成 engine action，再把 engine event 轉成 Slack API 呼叫。
import { applyAction, isBot, MAX_PLAYERS, mention, type Action, type GameEvent, type GameState, type GifKey, type Rng } from './engine.js';
import { GIFS } from './gifs.js';

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
  setTimer?: (fn: () => void, ms: number) => void;
}

const HELP = '用法：`/werewolf new` 開房、`/werewolf addbot [數量]`／`/werewolf removebot [數量]` 加入或移除 bot、`/werewolf start` 開始、`/werewolf next` 跳過目前的發言者、`/werewolf vote` 直接進入投票、`/werewolf cancel` 取消遊戲';

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
    case 'hunterShoot':
      return { type: 'hunterShoot', user, target: value };
    case 'endSpeech':
      return { type: 'endSpeech', user };
    case 'rematch':
      return { type: 'rematch', user, channel };
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
  private lobbyTs = new Map<string, string>();
  private names = new Map<string, string>();
  private dms = new Map<string, string>(); // user → 私訊頻道
  private wolfChats = new Map<string, { users: string; id: string }>(); // 遊戲頻道 → 狼人多人私訊
  private queue: Promise<void> = Promise.resolve();
  private rng: Rng;
  private gifs: Partial<Record<GifKey, string[]>>;
  private setTimer: (fn: () => void, ms: number) => void;

  constructor(
    private client: SlackClient,
    opts: HostOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
    this.gifs = opts.gifs ?? GIFS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  // 等目前排隊中的訊息都送完（測試用）
  idle(): Promise<void> {
    return this.queue;
  }

  command(channel: string, user: string, userName: string, text: string): Promise<void> {
    this.names.set(user, userName);
    const action = parseCommand(text, user, channel);
    if (!action) return this.deliver(channel, [{ type: 'ephemeral', to: user, text: HELP }]);
    return this.dispatch(channel, action);
  }

  button(actionId: string, value: string, user: string, userName: string): Promise<void> {
    this.names.set(user, userName);
    const kind = actionId.split(':')[1];
    const sep = value.indexOf('|');
    const channel = value.slice(0, sep);
    const action = buttonAction(kind, value.slice(sep + 1), user, channel);
    return action ? this.dispatch(channel, action) : Promise.resolve();
  }

  dispatch(channel: string, action: Action): Promise<void> {
    const { state, events } = applyAction(this.games.get(channel), action, this.rng);
    if (state) this.games.set(channel, state);
    return this.deliver(channel, events);
  }

  // 依序送出，避免同一局的訊息順序錯亂
  private deliver(channel: string, events: GameEvent[]): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        for (const e of events) await this.send(channel, e);
      })
      .catch((err) => console.error('[werewolf] Slack API 錯誤', err));
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

  private async send(channel: string, e: GameEvent) {
    const chat = this.client.chat;
    switch (e.type) {
      case 'startTimer':
        this.setTimer(() => void this.dispatch(channel, { type: 'timeout', id: e.id }), e.ms);
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
        const text = `狼人殺房間（房主 ${mention(e.host)}）\n玩家（${e.players.length}/${MAX_PLAYERS}）：${e.players.map(mention).join(' ')}`;
        const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];
        if (e.open) {
          const elements = [button('join', 0, '加入', channel, 'join'), button('leave', 1, '離開', channel, 'leave')];
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
