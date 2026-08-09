import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createRepository(databasePath = "data/bot.sqlite") {
  const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(databasePath);

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS registered_players (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      pubg_account_id TEXT NOT NULL,
      pubg_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_user_id)
    );

    CREATE TABLE IF NOT EXISTS party_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS active_party_per_channel
      ON party_sessions (guild_id, channel_id)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS party_members (
      session_id INTEGER NOT NULL REFERENCES party_sessions(id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (session_id, discord_user_id)
    );
  `);

  return new BotRepository(database);
}

export class BotRepository {
  constructor(database) {
    this.database = database;
  }

  upsertPlayer({ guildId, discordUserId, accountId, playerName, platform }) {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO registered_players (
          guild_id, discord_user_id, pubg_account_id, pubg_name, platform, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
          pubg_account_id = excluded.pubg_account_id,
          pubg_name = excluded.pubg_name,
          platform = excluded.platform,
          updated_at = excluded.updated_at
      `)
      .run(guildId, discordUserId, accountId, playerName, platform, now, now);

    return this.getPlayer(guildId, discordUserId);
  }

  getPlayer(guildId, discordUserId) {
    return this.database
      .prepare(`
        SELECT
          guild_id AS guildId,
          discord_user_id AS discordUserId,
          pubg_account_id AS accountId,
          pubg_name AS playerName,
          platform,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM registered_players
        WHERE guild_id = ? AND discord_user_id = ?
      `)
      .get(guildId, discordUserId);
  }

  createPartySession({ guildId, channelId, ownerUserId }) {
    const activeSession = this.getActivePartySession(guildId, channelId);

    if (activeSession) {
      return { session: activeSession, created: false };
    }

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const result = this.database
        .prepare(`
          INSERT INTO party_sessions (
            guild_id, channel_id, owner_user_id, started_at, status
          ) VALUES (?, ?, ?, ?, 'active')
        `)
        .run(guildId, channelId, ownerUserId, now);
      const sessionId = Number(result.lastInsertRowid);

      this.database
        .prepare(`
          INSERT INTO party_members (session_id, discord_user_id, joined_at)
          VALUES (?, ?, ?)
        `)
        .run(sessionId, ownerUserId, now);
      this.database.exec("COMMIT;");

      return { session: this.getPartySession(sessionId), created: true };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  getPartySession(sessionId) {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          started_at AS startedAt,
          ended_at AS endedAt,
          status
        FROM party_sessions
        WHERE id = ?
      `)
      .get(sessionId);
  }

  getActivePartySession(guildId, channelId) {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          started_at AS startedAt,
          ended_at AS endedAt,
          status
        FROM party_sessions
        WHERE guild_id = ? AND channel_id = ? AND status = 'active'
        LIMIT 1
      `)
      .get(guildId, channelId);
  }

  addPartyMember(sessionId, discordUserId) {
    const result = this.database
      .prepare(`
        INSERT OR IGNORE INTO party_members (session_id, discord_user_id, joined_at)
        VALUES (?, ?, ?)
      `)
      .run(sessionId, discordUserId, new Date().toISOString());

    return result.changes > 0;
  }

  getPartyMembers(sessionId) {
    return this.database
      .prepare(`
        SELECT
          m.discord_user_id AS discordUserId,
          p.pubg_account_id AS accountId,
          p.pubg_name AS playerName,
          p.platform,
          m.joined_at AS joinedAt
        FROM party_members AS m
        JOIN party_sessions AS s ON s.id = m.session_id
        LEFT JOIN registered_players AS p
          ON p.guild_id = s.guild_id
          AND p.discord_user_id = m.discord_user_id
        WHERE m.session_id = ?
        ORDER BY m.joined_at ASC
      `)
      .all(sessionId);
  }

  completePartySession(sessionId) {
    const result = this.database
      .prepare(`
        UPDATE party_sessions
        SET status = 'completed', ended_at = ?
        WHERE id = ? AND status = 'active'
      `)
      .run(new Date().toISOString(), sessionId);

    return result.changes > 0;
  }

  cancelPartySession(sessionId) {
    return this.completePartySession(sessionId);
  }

  close() {
    this.database.close();
  }
}
