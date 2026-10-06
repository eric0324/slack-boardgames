import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Role } from '../src/engine.js';
import { formatStats, StatsStore } from '../src/stats.js';

// A 在 C1 玩了 4 場：好人 3 場贏 2 場（預言家贏、村民贏、女巫輸），狼人 1 場贏
function seed(store: StatsStore) {
  const game = (channel: string, winner: 'good' | 'wolves', roleOfA: Role) =>
    store.record(channel, winner, [
      { id: 'A', role: roleOfA },
      { id: 'B', role: roleOfA === 'werewolf' ? 'villager' : 'werewolf' },
    ]);
  game('C1', 'good', 'seer');
  game('C1', 'good', 'villager');
  game('C1', 'wolves', 'witch');
  game('C1', 'wolves', 'werewolf');
  game('C2', 'good', 'villager');
}

describe('player-stats: 查詢戰績', () => {
  it('計算總計、陣營、角色的場數和勝場', () => {
    const store = new StatsStore(':memory:');
    seed(store);
    expect(store.stats('C1', 'A')).toEqual({
      total: { games: 4, wins: 3 },
      factions: { good: { games: 3, wins: 2 }, wolves: { games: 1, wins: 1 } },
      roles: {
        seer: { games: 1, wins: 1 },
        villager: { games: 1, wins: 1 },
        witch: { games: 1, wins: 0 },
        werewolf: { games: 1, wins: 1 },
      },
    });
  });

  it('每個頻道分開統計', () => {
    const store = new StatsStore(':memory:');
    seed(store);
    expect(store.stats('C2', 'A')!.total).toEqual({ games: 1, wins: 1 });
  });

  it('沒有戰績時回傳 null', () => {
    const store = new StatsStore(':memory:');
    seed(store);
    expect(store.stats('C1', 'Z')).toBeNull();
    expect(store.stats('C3', 'A')).toBeNull();
  });

  it('狼王算狼人陣營', () => {
    const store = new StatsStore(':memory:');
    store.record('C1', 'wolves', [{ id: 'A', role: 'wolfKing' }]);
    expect(store.stats('C1', 'A')!.factions).toEqual({ wolves: { games: 1, wins: 1 } });
  });

  it('格式化：百分比四捨五入，沒玩過的陣營不列出，依角色列出', () => {
    const store = new StatsStore(':memory:');
    seed(store);
    const text = formatStats('<@A>', store.stats('C1', 'A'));
    expect(text).toContain('📊 <@A> 在這個頻道的戰績');
    expect(text).toContain('總計：4 場 3 勝（75%）');
    expect(text).toContain('好人陣營：3 場 2 勝（67%）');
    expect(text).toContain('狼人陣營：1 場 1 勝（100%）');
    expect(text).toContain('預言家 1 場 1 勝（100%）');
    expect(text).toContain('女巫 1 場 0 勝（0%）');

    const onlyGood = new StatsStore(':memory:');
    onlyGood.record('C1', 'good', [{ id: 'A', role: 'seer' }]);
    expect(formatStats('<@A>', onlyGood.stats('C1', 'A'))).not.toContain('狼人陣營');
  });

  it('沒有戰績時的訊息', () => {
    expect(formatStats('<@Z>', null)).toBe('這個頻道還沒有 <@Z> 的戰績。');
  });
});

describe('player-stats: bot 重新啟動後戰績還在', () => {
  it('關掉再重新開啟同一個資料庫檔，紀錄還在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'werewolf-stats-'));
    const file = join(dir, 'stats.db');
    try {
      const first = new StatsStore(file);
      seed(first);
      first.close();
      const reopened = new StatsStore(file);
      expect(reopened.stats('C1', 'A')!.total).toEqual({ games: 4, wins: 3 });
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
