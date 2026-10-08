import { describe, expect, it } from 'vitest';
import { CODENAMES_WORDS } from '../src/codenamesWords.js';

describe('codenames/setup: 詞庫', () => {
  it('至少 200 個不重複、沒有空白、1～4 個字的詞', () => {
    expect(CODENAMES_WORDS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(CODENAMES_WORDS).size).toBe(CODENAMES_WORDS.length);
    for (const w of CODENAMES_WORDS) {
      expect(w).not.toMatch(/\s/);
      expect([...w].length, w).toBeGreaterThanOrEqual(1);
      expect([...w].length, w).toBeLessThanOrEqual(4);
    }
  });
});
