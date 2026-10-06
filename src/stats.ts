// 戰績：把全真人遊戲的結果存在 SQLite，依頻道和玩家計算場數與勝率。
import Database from 'better-sqlite3';
import { isWolf, ROLE_NAME, type Role } from './engine.js';

export interface Tally {
  games: number;
  wins: number;
}

export interface PlayerStats {
  total: Tally;
  factions: Partial<{ good: Tally; wolves: Tally }>;
  roles: Partial<{ [role in Role]: Tally }>;
}

// 角色顯示順序
const ROLE_ORDER: Role[] = ['werewolf', 'wolfKing', 'seer', 'witch', 'hunter', 'knight', 'villager'];

export class StatsStore {
  private db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        ended_at INTEGER NOT NULL,
        winner TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_players (
        game_id INTEGER NOT NULL REFERENCES games(id),
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        won INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_players_user ON game_players(user_id);
    `);
  }

  record(channel: string, winner: 'good' | 'wolves', players: { id: string; role: Role }[], endedAt = Date.now()) {
    const insertGame = this.db.prepare('INSERT INTO games (channel, ended_at, winner) VALUES (?, ?, ?)');
    const insertPlayer = this.db.prepare('INSERT INTO game_players (game_id, user_id, role, won) VALUES (?, ?, ?, ?)');
    this.db.transaction(() => {
      const { lastInsertRowid } = insertGame.run(channel, endedAt, winner);
      for (const p of players) {
        const won = (winner === 'wolves') === isWolf(p.role);
        insertPlayer.run(lastInsertRowid, p.id, p.role, won ? 1 : 0);
      }
    })();
  }

  stats(channel: string, user: string): PlayerStats | null {
    const rows = this.db
      .prepare(
        `SELECT gp.role AS role, COUNT(*) AS games, SUM(gp.won) AS wins
         FROM game_players gp JOIN games g ON g.id = gp.game_id
         WHERE g.channel = ? AND gp.user_id = ?
         GROUP BY gp.role`,
      )
      .all(channel, user) as { role: Role; games: number; wins: number }[];
    if (!rows.length) return null;
    const result: PlayerStats = { total: { games: 0, wins: 0 }, factions: {}, roles: {} };
    for (const r of rows) {
      const faction = isWolf(r.role) ? 'wolves' : 'good';
      const f = (result.factions[faction] ??= { games: 0, wins: 0 });
      f.games += r.games;
      f.wins += r.wins;
      result.total.games += r.games;
      result.total.wins += r.wins;
      result.roles[r.role] = { games: r.games, wins: r.wins };
    }
    return result;
  }

  close() {
    this.db.close();
  }
}

const line = (r: Tally) => `${r.games} 場 ${r.wins} 勝（${Math.round((r.wins / r.games) * 100)}%）`;

export function formatStats(who: string, stats: PlayerStats | null): string {
  if (!stats) return `這個頻道還沒有 ${who} 的戰績。`;
  const lines = [`📊 ${who} 在這個頻道的戰績`, `總計：${line(stats.total)}`];
  if (stats.factions.good) lines.push(`好人陣營：${line(stats.factions.good)}`);
  if (stats.factions.wolves) lines.push(`狼人陣營：${line(stats.factions.wolves)}`);
  const roles = ROLE_ORDER.filter((r) => stats.roles[r]).map((r) => `${ROLE_NAME[r]} ${line(stats.roles[r]!)}`);
  lines.push(`角色：${roles.join('、')}`);
  return lines.join('\n');
}
