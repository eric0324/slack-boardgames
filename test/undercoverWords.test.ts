import { describe, expect, it } from 'vitest';
import { BLANK_LINES, WORD_PAIRS } from '../src/undercoverWords.js';

describe('undercover/setup: 詞庫', () => {
  it('至少 60 組詞，每組是兩個不同的詞，每個詞至少 3 句描述句', () => {
    expect(WORD_PAIRS.length).toBeGreaterThanOrEqual(60);
    for (const { a, b } of WORD_PAIRS) {
      expect(a.word, `${a.word}/${b.word}`).not.toBe(b.word);
      expect(a.hints.length, a.word).toBeGreaterThanOrEqual(3);
      expect(b.hints.length, b.word).toBeGreaterThanOrEqual(3);
    }
  });

  it('描述句不包含自己的詞，也不包含同一組的另一個詞', () => {
    for (const { a, b } of WORD_PAIRS) {
      for (const [self, other] of [
        [a, b],
        [b, a],
      ]) {
        for (const hint of self.hints) {
          expect(hint, `${self.word}：${hint}`).not.toContain(self.word);
          expect(hint, `${self.word}：${hint}`).not.toContain(other.word);
        }
      }
    }
  });

  it('同一個詞不會出現在兩組裡', () => {
    const words = WORD_PAIRS.flatMap(({ a, b }) => [a.word, b.word]);
    expect(new Set(words).size).toBe(words.length);
  });

  it('白板 bot 的通用台詞至少 6 句，而且不包含詞庫裡的任何詞', () => {
    expect(BLANK_LINES.length).toBeGreaterThanOrEqual(6);
    const words = WORD_PAIRS.flatMap(({ a, b }) => [a.word, b.word]);
    for (const line of BLANK_LINES) for (const w of words) expect(line, `${line} 含有 ${w}`).not.toContain(w);
  });
});
