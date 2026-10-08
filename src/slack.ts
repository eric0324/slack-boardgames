// Slack adapter：把 slash command 和按鈕轉成 engine action，再把 engine event 轉成 Slack API 呼叫。
import { applyAction, isBot, MAX_PLAYERS, mention, RULES_URL, type Action, type GameEvent, type GameState, type GifKey, type Rng } from './engine.js';
import { GIFS } from './gifs.js';
import { formatStats, type StatsStore } from './stats.js';
import { applyAvalon, type AAction, type AState } from './avalon.js';
import { applyCodenames, type CAction, type CState } from './codenames.js';
import { applyCoup, type KAction, type KState } from './coup.js';
import { applyJustOne, type JAction, type JState } from './justone.js';
import { applyLiarsDice, type LAction, type LState } from './liarsdice.js';
import { applySpyfall, type SAction, type SState } from './spyfall.js';
import { applyUndercover, type UAction, type UState } from './undercover.js';

type Kind = 'werewolf' | 'undercover' | 'spyfall' | 'avalon' | 'codenames' | 'liarsdice' | 'justone' | 'coup';
type OtherKind = Exclude<Kind, 'werewolf'>;

// 狼人殺以外的遊戲都用同一套方式接上 adapter：engine、指令解析、按鈕對應、說明
interface GameDef {
  states: Map<string, { phase: string }>;
  apply(state: any, action: any, rng: Rng): { state: any; events: GameEvent[] };
  parse(text: string, user: string, channel: string): { type: string } | null;
  button(kind: string, value: string, user: string, channel: string): { type: string } | null;
  help: string;
}

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
  '• 📍 *間諜危機*（`spyfall`）：4～10 人，開房 `/game spyfall new`',
  '• 🏰 *阿瓦隆*（`avalon`）：5～10 人，開房 `/game avalon new`',
  '• 🟥 *機密代號*（`codenames`）：4～12 人（不支援 bot），開房 `/game codenames new`',
  '• 🎲 *吹牛骰*（`liarsdice`）：2～8 人，開房 `/game liarsdice new`',
  '• 💡 *一字千金*（`justone`）：3～7 人（不支援 bot），開房 `/game justone new`',
  '• 👑 *政變*（`coup`）：3～6 人，開房 `/game coup new`',
  '各遊戲的指令：`/game <遊戲代號> help`，例如 `/game liarsdice help`',
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

const SPYFALL_HELP = [
  '*間諜危機指令*',
  '• `/game spyfall new`：開房（任何人）',
  '• `/game spyfall addbot [數量]`：加入 bot 補人數（房主，開始前）',
  '• `/game spyfall removebot [數量]`：移除 bot（房主，開始前）',
  '• `/game spyfall start`：開始遊戲，需要 4～10 人（房主）',
  '• `/game spyfall next`：跳過目前卡住的提問或回答（房主）',
  '• `/game spyfall vote`：結束提問，直接投票（房主）',
  '• `/game spyfall cancel`：取消遊戲（房主）',
  '• `/game spyfall guess <地點>`：間諜猜地點（提問期間一次，或被指控後 60 秒內）',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const AVALON_HELP = [
  '*阿瓦隆指令*',
  '• `/game avalon new`：開房（任何人）',
  '• `/game avalon addbot [數量]`：加入 bot 補人數（房主，開始前）',
  '• `/game avalon removebot [數量]`：移除 bot（房主，開始前）',
  '• `/game avalon start`：開始遊戲，需要 5～10 人（房主）',
  '• `/game avalon next`：跳過目前的發言者（房主）',
  '• `/game avalon cancel`：取消遊戲（房主）',
  '選隊員、投票、出任務、刺殺都用按鈕',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const CODENAMES_HELP = [
  '*機密代號指令*',
  '• `/game codenames new`：開房（任何人）',
  '• `/game codenames start`：開始遊戲，需要 4～12 位真人（房主）',
  '• `/game codenames clue <詞> <數字>`：隊長給提示，數字 1～9',
  '• `/game codenames next`：直接結束目前隊伍的回合（房主）',
  '• `/game codenames cancel`：取消遊戲（房主）',
  '翻牌、結束猜牌都用按鈕',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const LIARSDICE_HELP = [
  '*吹牛骰指令*',
  '• `/game liarsdice new`：開房（任何人）',
  '• `/game liarsdice addbot [數量]`：加入 bot 補人數（房主，開始前）',
  '• `/game liarsdice removebot [數量]`：移除 bot（房主，開始前）',
  '• `/game liarsdice start`：開始遊戲，需要 2～8 人（房主）',
  '• `/game liarsdice bid <數量> <點數>`：喊「全場至少有 N 個 X 點」（輪到你時）',
  '• `/game liarsdice cancel`：取消遊戲（房主）',
  '覺得上一個喊數是吹牛就按「開！」；1 點是萬用，這一輪有人喊過 1 點就不再萬用',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const JUSTONE_HELP = [
  '*一字千金指令*',
  '• `/game justone new`：開房（任何人）',
  '• `/game justone start`：開始遊戲，需要 3～7 位真人（房主）',
  '• `/game justone clue <詞>`：給一個提示（猜詞以外的人，其他人看不到你打的字）',
  '• `/game justone guess <詞>`：猜詞（猜詞的人），沒把握可以按「跳過」',
  '• `/game justone next`：跳過卡住的步驟（房主）',
  '• `/game justone cancel`：取消遊戲（房主）',
  `📖 完整說明：<${WIKI}|wiki>`,
].join('\n');

const COUP_HELP = [
  '*政變指令*',
  '• `/game coup new`：開房（任何人）',
  '• `/game coup addbot [數量]`：加入 bot 補人數（房主，開始前）',
  '• `/game coup removebot [數量]`：移除 bot（房主，開始前）',
  '• `/game coup start`：開始遊戲，需要 3～6 人（房主）',
  '• `/game coup cancel`：取消遊戲（房主）',
  '行動、選目標、質疑、阻擋都用頻道按鈕；翻牌和大使交換用私訊按鈕',
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

// 間諜危機的子指令和誰是臥底一樣，只有 guess 猜的是地點
export function parseSpyfallCommand(text: string, user: string, channel: string): SAction | null {
  const action = parseUndercoverCommand(text, user, channel);
  if (action?.type === 'guess') return { type: 'guess', user, location: action.word };
  return action as SAction | null;
}

// 阿瓦隆的子指令：沒有 vote（組隊投票用按鈕）和 guess
export function parseAvalonCommand(text: string, user: string, channel: string): AAction | null {
  const action = parseUndercoverCommand(text, user, channel);
  if (!action || action.type === 'guess' || action.type === 'endDiscussion') return null;
  return action as AAction;
}

// 機密代號的子指令：clue <詞> <數字>，next 是跳過目前隊伍的回合
export function parseCodenamesCommand(text: string, user: string, channel: string): CAction | null {
  const [sub, ...rest] = text.trim().split(/\s+/);
  if (sub === 'clue') {
    if (rest.length < 2) return null;
    return { type: 'clue', user, word: rest.slice(0, -1).join(' '), count: Number(rest.at(-1)) };
  }
  if (sub === 'next') return { type: 'skipTurn', user };
  const action = parseUndercoverCommand(text, user, channel);
  if (!action || action.type === 'guess' || action.type === 'endDiscussion' || action.type === 'skipSpeaker') return null;
  return action as CAction;
}

// 吹牛骰的子指令：bid <數量> <點數>
export function parseLiarsDiceCommand(text: string, user: string, channel: string): LAction | null {
  const [sub, ...rest] = text.trim().split(/\s+/);
  if (sub === 'bid') return rest.length === 2 ? { type: 'bid', user, quantity: Number(rest[0]), face: Number(rest[1]) } : null;
  const action = parseUndercoverCommand(text, user, channel);
  if (!action || !['new', 'start', 'cancel', 'addBot', 'removeBot'].includes(action.type)) return null;
  return action as LAction;
}

function liarsDiceButton(kind: string, _value: string, user: string, channel: string): LAction | null {
  if (kind === 'join' || kind === 'leave' || kind === 'start' || kind === 'challenge') return { type: kind, user };
  if (kind === 'rematch') return { type: 'rematch', user, channel };
  return null;
}

// 一字千金的子指令：clue <詞>、guess <詞>，next 是跳過卡住的步驟
export function parseJustOneCommand(text: string, user: string, channel: string): JAction | null {
  const [sub, ...rest] = text.trim().split(/\s+/);
  if (sub === 'clue' || sub === 'guess') return rest.length ? { type: sub, user, word: rest.join(' ') } : null;
  if (sub === 'next') return { type: 'skipStep', user };
  const action = parseUndercoverCommand(text, user, channel);
  if (!action || !['new', 'start', 'cancel', 'addBot', 'removeBot'].includes(action.type)) return null;
  return action as JAction;
}

function justOneButton(kind: string, _value: string, user: string, channel: string): JAction | null {
  if (kind === 'join' || kind === 'leave' || kind === 'start' || kind === 'skipGuess') return { type: kind, user };
  if (kind === 'rematch') return { type: 'rematch', user, channel };
  return null;
}

// 政變只有房間指令，遊戲中都用按鈕
export function parseCoupCommand(text: string, user: string, channel: string): KAction | null {
  const action = parseUndercoverCommand(text, user, channel);
  if (!action || !['new', 'start', 'cancel', 'addBot', 'removeBot'].includes(action.type)) return null;
  return action as KAction;
}

function coupButton(kind: string, value: string, user: string, channel: string): KAction | null {
  switch (kind) {
    case 'join':
    case 'leave':
    case 'start':
    case 'challenge':
      return { type: kind, user };
    case 'coupAction':
      return { type: 'act', user, kind: value as Extract<KAction, { type: 'act' }>['kind'] };
    case 'coupTarget':
      return { type: 'target', user, target: value };
    case 'block':
      return { type: 'block', user, role: value as Extract<KAction, { type: 'block' }>['role'] };
    case 'loseCard':
      return { type: 'reveal', user, index: Number(value) };
    case 'keepCard':
      return { type: 'keep', user, index: Number(value) };
    case 'rematch':
      return { type: 'rematch', user, channel };
    default:
      return null;
  }
}

function codenamesButton(kind: string, value: string, user: string, channel: string): CAction | null {
  switch (kind) {
    case 'join':
    case 'leave':
    case 'start':
    case 'endGuess':
      return { type: kind, user };
    case 'guess':
      return { type: 'guess', user, index: Number(value) };
    case 'rematch':
      return { type: 'rematch', user, channel };
    default:
      return null;
  }
}

function avalonButton(kind: string, value: string, user: string, channel: string): AAction | null {
  switch (kind) {
    case 'join':
    case 'leave':
    case 'start':
    case 'endSpeech':
    case 'confirmTeam':
      return { type: kind, user };
    case 'pickMember':
    case 'assassinate':
      return { type: kind, user, target: value };
    case 'teamVote':
      return value === 'approve' || value === 'reject' ? { type: 'teamVote', user, vote: value } : null;
    case 'quest':
      return value === 'success' || value === 'fail' ? { type: 'quest', user, card: value } : null;
    case 'rematch':
      return { type: 'rematch', user, channel };
    default:
      return null;
  }
}

function spyfallButton(kind: string, value: string, user: string, channel: string): SAction | null {
  switch (kind) {
    case 'join':
    case 'leave':
    case 'start':
    case 'endSpeech':
    case 'endAnswer':
      return { type: kind, user };
    case 'askTarget':
      return { type: 'askTarget', user, target: value };
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
  spyfallGames = new Map<string, SState>();
  avalonGames = new Map<string, AState>();
  codenamesGames = new Map<string, CState>();
  liarsDiceGames = new Map<string, LState>();
  justOneGames = new Map<string, JState>();
  coupGames = new Map<string, KState>();
  private lastKind = new Map<string, Kind>(); // 每個頻道最近一局是哪款遊戲
  private lobbyTs = new Map<string, string>();
  private boardTs = new Map<string, string>(); // 機密代號的牌桌訊息
  private names = new Map<string, string>();
  private dms = new Map<string, string>(); // user → 私訊頻道
  private wolfChats = new Map<string, { users: string; id: string }>(); // 遊戲頻道 → 狼人多人私訊
  private queue: Promise<void> = Promise.resolve();
  private rng: Rng;
  private gifs: Partial<Record<GifKey, string[]>>;
  private stats?: StatsStore;
  private setTimer: (fn: () => void, ms: number) => void;
  private defs: Record<OtherKind, GameDef>;

  constructor(
    private client: SlackClient,
    opts: HostOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
    this.gifs = opts.gifs ?? GIFS;
    this.stats = opts.stats;
    this.setTimer = opts.setTimer ?? ((fn, ms) => void setTimeout(fn, ms));
    this.defs = {
      undercover: { states: this.undercoverGames, apply: applyUndercover, parse: parseUndercoverCommand, button: undercoverButton, help: UNDERCOVER_HELP },
      spyfall: { states: this.spyfallGames, apply: applySpyfall, parse: parseSpyfallCommand, button: spyfallButton, help: SPYFALL_HELP },
      avalon: { states: this.avalonGames, apply: applyAvalon, parse: parseAvalonCommand, button: avalonButton, help: AVALON_HELP },
      codenames: { states: this.codenamesGames, apply: applyCodenames, parse: parseCodenamesCommand, button: codenamesButton, help: CODENAMES_HELP },
      liarsdice: { states: this.liarsDiceGames, apply: applyLiarsDice, parse: parseLiarsDiceCommand, button: liarsDiceButton, help: LIARSDICE_HELP },
      justone: { states: this.justOneGames, apply: applyJustOne, parse: parseJustOneCommand, button: justOneButton, help: JUSTONE_HELP },
      coup: { states: this.coupGames, apply: applyCoup, parse: parseCoupCommand, button: coupButton, help: COUP_HELP },
    };
  }

  private isOther(kind: string | undefined): kind is OtherKind {
    return kind !== undefined && kind in this.defs;
  }

  // 等目前排隊中的訊息都送完（測試用）
  idle(): Promise<void> {
    return this.queue;
  }

  // 頻道裡正在進行（還沒結束）的是哪款遊戲
  private active(channel: string): Kind | null {
    const w = this.games.get(channel);
    if (w && w.phase !== 'ended') return 'werewolf';
    for (const [kind, def] of Object.entries(this.defs) as [OtherKind, GameDef][]) {
      const st = def.states.get(channel);
      if (st && st.phase !== 'ended') return kind;
    }
    return null;
  }

  // 頻道裡有別款遊戲正在進行
  private blocked(channel: string, kind: Kind): boolean {
    const a = this.active(channel);
    return a !== null && a !== kind;
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
    if (this.isOther(g)) return this.play(g, channel, user, restText);
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
    if (this.blocked(channel, 'werewolf')) return this.reply(channel, user, action.type === 'new' ? BUSY : NOT_APPLICABLE);
    return this.dispatch(channel, action);
  }





  // `/game <遊戲> <子指令>`（狼人殺以外的遊戲）
  private play(kind: OtherKind, channel: string, user: string, text: string): Promise<void> {
    const def = this.defs[kind];
    const action = def.parse(text, user, channel);
    if (!action) return this.reply(channel, user, def.help);
    if (this.blocked(channel, kind)) return this.reply(channel, user, action.type === 'new' ? BUSY : NOT_APPLICABLE);
    return this.dispatchGame(kind, channel, action);
  }

  dispatchGame(kind: OtherKind, channel: string, action: { type: string }): Promise<void> {
    const def = this.defs[kind];
    const { state, events } = def.apply(def.states.get(channel), action, this.rng);
    if (state) {
      def.states.set(channel, state);
      this.lastKind.set(channel, kind);
    }
    return this.deliver(channel, events, kind);
  }

  button(actionId: string, value: string, user: string, userName: string): Promise<void> {
    this.names.set(user, userName);
    const kind = actionId.split(':')[1];
    const sep = value.indexOf('|');
    const channel = value.slice(0, sep);
    const last = this.lastKind.get(channel);
    if (this.isOther(last)) {
      const action = this.defs[last].button(kind, value.slice(sep + 1), user, channel);
      return action ? this.dispatchGame(last, channel, action) : Promise.resolve();
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





  // 依序送出，避免同一局的訊息順序錯亂
  private deliver(channel: string, events: GameEvent[], kind: Kind = 'werewolf'): Promise<void> {
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

  private async send(channel: string, e: GameEvent, kind: Kind) {
    const chat = this.client.chat;
    switch (e.type) {
      case 'gameRecord':
        this.stats?.record(channel, e.winner, e.players);
        return;
      case 'startTimer':
        this.setTimer(() => {
          const timeout = { type: 'timeout' as const, id: e.id };
          if (this.isOther(kind)) void this.dispatchGame(kind, channel, timeout);
          else void this.dispatch(channel, timeout);
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
        if (!e.open) {
          this.lobbyTs.delete(channel);
          this.boardTs.delete(channel); // 新的一局開始，牌桌要重新貼
        }
        return;
      }
      case 'board': {
        const blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: e.text } },
          ...e.rows.map((row) => ({
            type: 'actions',
            elements: row.map((b) => ({ ...button('guess', Number(b.value), b.label, channel, b.value), ...(b.style ? { style: b.style } : {}) })),
          })),
        ];
        const ts = this.boardTs.get(channel);
        if (ts) {
          await chat.update({ channel, ts, text: e.text, blocks });
        } else {
          const res = await chat.postMessage({ channel, text: e.text, blocks });
          this.boardTs.set(channel, res.ts);
        }
        return;
      }
    }
  }
}
