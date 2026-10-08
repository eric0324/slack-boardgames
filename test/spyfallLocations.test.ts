import { describe, expect, it } from 'vitest';
import { LOCATIONS, QUESTIONS, SPY_ANSWERS } from '../src/spyfallLocations.js';

describe('spyfall/setup: 地點庫', () => {
  it('至少 30 個地點，每個地點至少 6 個角色和 4 句描述句', () => {
    expect(LOCATIONS.length).toBeGreaterThanOrEqual(30);
    for (const l of LOCATIONS) {
      expect(l.roles.length, l.name).toBeGreaterThanOrEqual(6);
      expect(l.hints.length, l.name).toBeGreaterThanOrEqual(4);
    }
  });

  it('描述句不包含地點名稱', () => {
    for (const l of LOCATIONS) for (const h of l.hints) expect(h, `${l.name}：${h}`).not.toContain(l.name);
  });

  it('地點名稱不重複，也不包含空白（方便用指令猜）', () => {
    const names = LOCATIONS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/\s/);
  });

  it('bot 的通用問題和間諜回答各至少 8 句，而且不包含任何地點名稱', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(SPY_ANSWERS.length).toBeGreaterThanOrEqual(8);
    for (const line of [...QUESTIONS, ...SPY_ANSWERS]) {
      for (const l of LOCATIONS) expect(line, `${line} 含有 ${l.name}`).not.toContain(l.name);
    }
  });
});
