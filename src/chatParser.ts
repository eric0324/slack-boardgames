// 用固定句型比對真人在頻道打的字，讓 bot 參考。只負責拆解訊息，要怎麼用由 engine 決定。

export interface ChatInfo {
  seerClaim: boolean; // 自稱預言家
  godClaim?: 'witch' | 'knight'; // 自稱神職
  wolf: string[]; // 被說是狼人的玩家
  good: string[]; // 被說是好人的玩家
  suspect: string[]; // 被懷疑的玩家
}

const GOD_CLAIMS = { 女巫: 'witch', 騎士: 'knight' } as const;

// 找出這一段提到的玩家：Slack mention（<@U123> 或 <@U123|名字>）或 bot 的名字（不分大小寫、要完整比對）
function mentioned(segment: string, players: string[]): string[] {
  const found = new Set<string>();
  for (const m of segment.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)) if (players.includes(m[1])) found.add(m[1]);
  for (const id of players) {
    const name = id.startsWith('bot:') ? id.split(':')[2] : undefined;
    if (name && new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`, 'i').test(segment)) found.add(id);
  }
  return [...found];
}

function classify(segment: string): 'wolf' | 'good' | 'suspect' | null {
  if (/金水/.test(segment)) return 'good';
  if (/查殺|是狼|狼人|壞人/.test(segment)) return 'wolf';
  if (/好人/.test(segment)) return 'good';
  if (/可疑|懷疑|投|有問題|狼/.test(segment)) return 'suspect';
  return null;
}

export function parseChat(text: string, players: string[]): ChatInfo {
  const god = /我是(女巫|騎士)/.exec(text)?.[1] as keyof typeof GOD_CLAIMS | undefined;
  const info: ChatInfo = { seerClaim: /我(是)?預言家/.test(text), wolf: [], good: [], suspect: [] };
  if (god) info.godClaim = GOD_CLAIMS[god];
  for (const segment of text.split(/[，。、；！？,.;!?\n]+/)) {
    const targets = mentioned(segment, players);
    const kind = classify(segment);
    if (targets.length === 1 && kind) info[kind].push(targets[0]);
  }
  return info;
}
