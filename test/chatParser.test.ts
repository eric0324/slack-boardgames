import { describe, expect, it } from 'vitest';
import { parseChat } from '../src/chatParser.js';

const players = ['U1', 'U2', 'U3', 'bot:1:Sam', 'bot:2:Carmen'];

describe('chatParser：比對真人的發言', () => {
  it('自稱預言家並查殺 @mention', () => {
    expect(parseChat('我是預言家，查殺 <@U2>', players)).toEqual({
      seerClaim: true,
      wolf: ['U2'],
      good: [],
      suspect: [],
    });
  });

  it('一則訊息報兩個結果，支援 <@U|名字> 和 bot 名字', () => {
    const info = parseChat('我預言家，第一晚查殺 <@U2|bob>，第二晚金水 Sam', players);
    expect(info).toMatchObject({ seerClaim: true, wolf: ['U2'], good: ['bot:1:Sam'] });
  });

  it('各種說法：X 是狼、X 狼人、X 是好人、X 好人', () => {
    expect(parseChat('<@U2> 是狼', players).wolf).toEqual(['U2']);
    expect(parseChat('Carmen 狼人', players).wolf).toEqual(['bot:2:Carmen']);
    expect(parseChat('<@U3> 是好人', players).good).toEqual(['U3']);
    expect(parseChat('Sam 好人', players).good).toEqual(['bot:1:Sam']);
  });

  it('懷疑的說法', () => {
    expect(parseChat('我覺得 Sam 很可疑', players)).toMatchObject({ seerClaim: false, suspect: ['bot:1:Sam'] });
    expect(parseChat('懷疑 <@U3>', players).suspect).toEqual(['U3']);
    expect(parseChat('今天投 Carmen', players).suspect).toEqual(['bot:2:Carmen']);
  });

  it('用 🤖 名字或小寫名字提到 bot', () => {
    expect(parseChat('查殺 🤖Sam', players).wolf).toEqual(['bot:1:Sam']);
    expect(parseChat('查殺 sam', players).wolf).toEqual(['bot:1:Sam']);
  });

  it('名字要完整比對，不會把 Samson 當成 Sam', () => {
    expect(parseChat('Samson 很可疑', players).suspect).toEqual([]);
  });

  it('同一段提到兩個人就不判斷', () => {
    expect(parseChat('<@U2> <@U3> 都可疑', players).suspect).toEqual([]);
  });

  it('不在遊戲中的 mention 會被忽略', () => {
    expect(parseChat('查殺 <@U9>', players).wolf).toEqual([]);
  });

  it('自稱神職', () => {
    expect(parseChat('我是獵人，別投我', players).godClaim).toBe('hunter');
    expect(parseChat('我是女巫', players).godClaim).toBe('witch');
    expect(parseChat('我是騎士', players).godClaim).toBe('knight');
    expect(parseChat('大家好', players).godClaim).toBeUndefined();
  });
});
