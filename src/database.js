import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;

const REGISTERED_PLAYERS_SCHEMA = `
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
`;

const PARTY_SESSIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS party_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    reviewed_at TEXT,
    ended_at TEXT,
    last_synced_match_at TEXT,
    synced_match_count INTEGER NOT NULL DEFAULT 0,
    review_snapshot_json TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('recruiting', 'active', 'reviewing', 'completed')
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS open_party_per_channel
    ON party_sessions (guild_id, channel_id)
    WHERE status IN ('recruiting', 'active', 'reviewing');
`;

const PARTY_MEMBERS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS party_members (
    session_id INTEGER NOT NULL REFERENCES party_sessions(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (session_id, discord_user_id)
  );
`;

const PARTY_MISSIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS party_missions (
    session_id INTEGER NOT NULL REFERENCES party_sessions(id) ON DELETE CASCADE,
    mission_key TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('team', 'personal')),
    reward_points INTEGER NOT NULL CHECK (reward_points > 0),
    selected_at TEXT NOT NULL,
    PRIMARY KEY (session_id, mission_key)
  );

  CREATE TABLE IF NOT EXISTS mission_completions (
    session_id INTEGER NOT NULL,
    mission_key TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (session_id, mission_key, discord_user_id),
    FOREIGN KEY (session_id, mission_key)
      REFERENCES party_missions(session_id, mission_key)
      ON DELETE CASCADE
  );
`;

function tableExists(database, tableName) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function getSchemaVersion(database) {
  return Number(database.prepare("PRAGMA user_version;").get().user_version);
}

function createCurrentSchema(database) {
  database.exec(`
    ${REGISTERED_PLAYERS_SCHEMA}
    ${PARTY_SESSIONS_SCHEMA}
    ${PARTY_MEMBERS_SCHEMA}
    ${PARTY_MISSIONS_SCHEMA}
  `);
}

function migrateLegacyPartySchema(database) {
  database.exec("PRAGMA foreign_keys = OFF;");

  try {
    database.exec(`
      BEGIN IMMEDIATE;

      DROP INDEX IF EXISTS active_party_per_channel;
      ALTER TABLE party_members RENAME TO party_members_legacy;
      ALTER TABLE party_sessions RENAME TO party_sessions_legacy;

      ${PARTY_SESSIONS_SCHEMA}
      ${PARTY_MEMBERS_SCHEMA}

      INSERT INTO party_sessions (
        id,
        guild_id,
        channel_id,
        owner_user_id,
        created_at,
        started_at,
        ended_at,
        status
      )
      SELECT
        id,
        guild_id,
        channel_id,
        owner_user_id,
        started_at,
        started_at,
        ended_at,
        status
      FROM party_sessions_legacy;

      INSERT INTO party_members (session_id, discord_user_id, joined_at)
      SELECT session_id, discord_user_id, joined_at
      FROM party_members_legacy;

      DROP TABLE party_members_legacy;
      DROP TABLE party_sessions_legacy;

      ${PARTY_MISSIONS_SCHEMA}

      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK;");
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }

  const violations = database.prepare("PRAGMA foreign_key_check;").all();
  if (violations.length > 0) {
    throw new Error("SQLite 마이그레이션 후 외래 키 무결성 검사에 실패했습니다.");
  }
}

function initializeDatabase(database) {
  database.exec(REGISTERED_PLAYERS_SCHEMA);

  const currentVersion = getSchemaVersion(database);
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `지원하지 않는 SQLite 스키마 버전입니다. ` +
        `(현재: ${currentVersion}, 지원: ${SCHEMA_VERSION})`,
    );
  }

  if (currentVersion === 0 && tableExists(database, "party_sessions")) {
    migrateLegacyPartySchema(database);
    return;
  }

  createCurrentSchema(database);
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export function createRepository(databasePath = "data/bot.sqlite") {
  const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(databasePath);

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  initializeDatabase(database);

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
    const openSession = this.getOpenPartySession(guildId, channelId);

    if (openSession) {
      return { session: openSession, created: false };
    }

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const result = this.database
        .prepare(`
          INSERT INTO party_sessions (
            guild_id, channel_id, owner_user_id, created_at, status
          ) VALUES (?, ?, ?, ?, 'recruiting')
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
          created_at AS createdAt,
          started_at AS startedAt,
          reviewed_at AS reviewedAt,
          ended_at AS endedAt,
          last_synced_match_at AS lastSyncedMatchAt,
          synced_match_count AS syncedMatchCount,
          review_snapshot_json AS reviewSnapshotJson,
          status
        FROM party_sessions
        WHERE id = ?
      `)
      .get(sessionId);
  }

  getOpenPartySession(guildId, channelId) {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          created_at AS createdAt,
          started_at AS startedAt,
          reviewed_at AS reviewedAt,
          ended_at AS endedAt,
          last_synced_match_at AS lastSyncedMatchAt,
          synced_match_count AS syncedMatchCount,
          review_snapshot_json AS reviewSnapshotJson,
          status
        FROM party_sessions
        WHERE guild_id = ?
          AND channel_id = ?
          AND status IN ('recruiting', 'active', 'reviewing')
        LIMIT 1
      `)
      .get(guildId, channelId);
  }

  getActivePartySession(guildId, channelId) {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          created_at AS createdAt,
          started_at AS startedAt,
          reviewed_at AS reviewedAt,
          ended_at AS endedAt,
          last_synced_match_at AS lastSyncedMatchAt,
          synced_match_count AS syncedMatchCount,
          review_snapshot_json AS reviewSnapshotJson,
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
        SELECT ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM party_sessions
          WHERE id = ? AND status = 'recruiting'
        )
      `)
      .run(sessionId, discordUserId, new Date().toISOString(), sessionId);

    return result.changes > 0;
  }

  startPartySession(sessionId, missions = []) {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const result = this.database
        .prepare(`
          UPDATE party_sessions
          SET status = 'active', started_at = ?
          WHERE id = ? AND status = 'recruiting'
        `)
        .run(now, sessionId);

      if (result.changes === 0) {
        this.database.exec("ROLLBACK;");
        return undefined;
      }

      const insertMission = this.database.prepare(`
        INSERT INTO party_missions (
          session_id, mission_key, scope, reward_points, selected_at
        ) VALUES (?, ?, ?, ?, ?)
      `);

      for (const mission of missions) {
        insertMission.run(
          sessionId,
          mission.key,
          mission.scope,
          mission.rewardPoints,
          now,
        );
      }

      this.database.exec("COMMIT;");
      return this.getPartySession(sessionId);
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  getPartyMissions(sessionId) {
    return this.database
      .prepare(`
        SELECT
          session_id AS sessionId,
          mission_key AS key,
          scope,
          reward_points AS rewardPoints,
          selected_at AS selectedAt
        FROM party_missions
        WHERE session_id = ?
        ORDER BY selected_at ASC, mission_key ASC
      `)
      .all(sessionId);
  }

  recordMissionCompletions(sessionId, completions) {
    if (completions.length === 0) {
      return 0;
    }

    const completedAt = new Date().toISOString();
    let inserted = 0;
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const insertCompletion = this.database.prepare(`
        INSERT OR IGNORE INTO mission_completions (
          session_id, mission_key, discord_user_id, match_id, completed_at
        ) VALUES (?, ?, ?, ?, ?)
      `);

      for (const completion of completions) {
        const result = insertCompletion.run(
          sessionId,
          completion.missionKey,
          completion.discordUserId,
          completion.matchId,
          completedAt,
        );
        inserted += result.changes;
      }

      this.database.exec("COMMIT;");
      return inserted;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  getMissionCompletions(sessionId) {
    return this.database
      .prepare(`
        SELECT
          session_id AS sessionId,
          mission_key AS missionKey,
          discord_user_id AS discordUserId,
          match_id AS matchId,
          completed_at AS completedAt
        FROM mission_completions
        WHERE session_id = ?
        ORDER BY completed_at ASC, mission_key ASC, discord_user_id ASC
      `)
      .all(sessionId);
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
        WHERE id = ? AND status IN ('recruiting', 'active', 'reviewing')
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
