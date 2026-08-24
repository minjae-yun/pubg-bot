import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 2;
const DATA_PARSER_VERSION = 1;

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

const DATA_COLLECTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS collected_matches (
    match_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    map_name TEXT NOT NULL,
    game_mode TEXT,
    created_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    telemetry_url TEXT,
    raw_telemetry_path TEXT,
    raw_telemetry_sha256 TEXT,
    raw_telemetry_bytes INTEGER,
    parser_version INTEGER NOT NULL DEFAULT ${DATA_PARSER_VERSION},
    collected_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS party_session_matches (
    session_id INTEGER NOT NULL REFERENCES party_sessions(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL REFERENCES collected_matches(match_id) ON DELETE CASCADE,
    linked_at TEXT NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
    PRIMARY KEY (session_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES collected_matches(match_id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    discord_user_id TEXT,
    player_name TEXT,
    team_id INTEGER,
    placement INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    damage REAL NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    revives INTEGER NOT NULL DEFAULT 0,
    headshot_kills INTEGER NOT NULL DEFAULT 0,
    longest_kill REAL NOT NULL DEFAULT 0,
    team_kills INTEGER NOT NULL DEFAULT 0,
    death_type TEXT,
    survival_seconds REAL NOT NULL DEFAULT 0,
    is_party_member INTEGER NOT NULL DEFAULT 0 CHECK (is_party_member IN (0, 1)),
    PRIMARY KEY (match_id, account_id)
  );

  CREATE TABLE IF NOT EXISTS landing_events (
    match_id TEXT NOT NULL REFERENCES collected_matches(match_id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    team_id INTEGER,
    event_at TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, account_id)
  );

  CREATE TABLE IF NOT EXISTS player_positions (
    match_id TEXT NOT NULL REFERENCES collected_matches(match_id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    event_at TEXT NOT NULL,
    elapsed_seconds REAL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL DEFAULT 0,
    is_in_blue_zone INTEGER NOT NULL DEFAULT 0 CHECK (is_in_blue_zone IN (0, 1)),
    vehicle_type TEXT,
    alive_players INTEGER,
    PRIMARY KEY (match_id, account_id, event_at)
  );

  CREATE TABLE IF NOT EXISTS death_events (
    match_id TEXT NOT NULL REFERENCES collected_matches(match_id) ON DELETE CASCADE,
    victim_account_id TEXT NOT NULL,
    killer_account_id TEXT,
    victim_team_id INTEGER,
    killer_team_id INTEGER,
    event_at TEXT NOT NULL,
    x REAL,
    y REAL,
    z REAL,
    damage_type TEXT,
    damage_causer TEXT,
    distance REAL,
    is_suicide INTEGER NOT NULL DEFAULT 0 CHECK (is_suicide IN (0, 1)),
    is_team_kill INTEGER NOT NULL DEFAULT 0 CHECK (is_team_kill IN (0, 1)),
    PRIMARY KEY (match_id, victim_account_id, event_at)
  );

  CREATE TABLE IF NOT EXISTS zone_snapshots (
    match_id TEXT NOT NULL REFERENCES collected_matches(match_id) ON DELETE CASCADE,
    event_at TEXT NOT NULL,
    elapsed_seconds REAL,
    phase REAL,
    alive_teams INTEGER,
    alive_players INTEGER,
    safety_x REAL,
    safety_y REAL,
    safety_radius REAL,
    warning_x REAL,
    warning_y REAL,
    warning_radius REAL,
    PRIMARY KEY (match_id, event_at)
  );

  CREATE INDEX IF NOT EXISTS collected_matches_map_created_at
    ON collected_matches (map_name, created_at);

  CREATE INDEX IF NOT EXISTS match_players_account_id
    ON match_players (account_id, match_id);

  CREATE INDEX IF NOT EXISTS death_events_victim
    ON death_events (victim_account_id, match_id);
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
    ${DATA_COLLECTION_SCHEMA}
  `);
}

function migrateVersion1To2(database) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ${DATA_COLLECTION_SCHEMA}
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK;");
    }
    throw error;
  }
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
      ${DATA_COLLECTION_SCHEMA}

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

  if (currentVersion === 1) {
    migrateVersion1To2(database);
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

  getRecentPartyMissionKeys(guildId, excludedSessionId, partyCount = 2) {
    return this.database
      .prepare(`
        WITH recent_sessions AS (
          SELECT id
          FROM party_sessions AS sessions
          WHERE sessions.guild_id = ?
            AND sessions.id <> ?
            AND EXISTS (
              SELECT 1
              FROM party_missions AS missions
              WHERE missions.session_id = sessions.id
            )
          ORDER BY
            COALESCE(sessions.started_at, sessions.created_at) DESC,
            sessions.id DESC
          LIMIT ?
        )
        SELECT DISTINCT missions.mission_key AS key
        FROM party_missions AS missions
        JOIN recent_sessions ON recent_sessions.id = missions.session_id
        ORDER BY missions.mission_key ASC
      `)
      .all(guildId, excludedSessionId, partyCount)
      .map((mission) => mission.key);
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

  savePartyReview(
    sessionId,
    { snapshot, syncedMatchCount, lastSyncedMatchAt },
  ) {
    const reviewedAt = new Date().toISOString();
    const result = this.database
      .prepare(`
        UPDATE party_sessions
        SET
          status = 'reviewing',
          reviewed_at = ?,
          last_synced_match_at = ?,
          synced_match_count = ?,
          review_snapshot_json = ?
        WHERE id = ? AND status IN ('active', 'reviewing')
      `)
      .run(
        reviewedAt,
        lastSyncedMatchAt,
        syncedMatchCount,
        JSON.stringify(snapshot),
        sessionId,
      );

    return result.changes > 0 ? this.getPartySession(sessionId) : undefined;
  }

  getPartyReviewSnapshot(sessionId) {
    const row = this.database
      .prepare(`
        SELECT review_snapshot_json AS snapshotJson
        FROM party_sessions
        WHERE id = ?
      `)
      .get(sessionId);

    if (!row?.snapshotJson) {
      return undefined;
    }

    try {
      return JSON.parse(row.snapshotJson);
    } catch {
      return undefined;
    }
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

  confirmPartySession(sessionId) {
    const result = this.database
      .prepare(`
        UPDATE party_sessions
        SET status = 'completed', ended_at = ?
        WHERE id = ? AND status = 'reviewing'
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
