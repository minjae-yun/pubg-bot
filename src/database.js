import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  calculateKillRacePlayerScore,
  KILL_RACE_CHICKEN_POINTS,
} from "./kill-race-config.js";

const SCHEMA_VERSION = 4;
const DATA_PARSER_VERSION = 1;

const REGISTERED_PLAYERS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS registered_players (
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    pubg_account_id TEXT NOT NULL,
    pubg_name TEXT NOT NULL,
    display_name TEXT,
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

const KILL_RACE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS kill_race_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('2v2', '3v3', '4v4', '2v2v2')),
    target_score INTEGER NOT NULL CHECK (target_score > 0),
    sheet_id TEXT NOT NULL,
    sheet_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    last_synced_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('recruiting', 'active', 'completed'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS open_kill_race_per_channel
    ON kill_race_sessions (guild_id, channel_id)
    WHERE status IN ('recruiting', 'active');

  CREATE TABLE IF NOT EXISTS kill_race_members (
    session_id INTEGER NOT NULL REFERENCES kill_race_sessions(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    team_key TEXT NOT NULL CHECK (team_key IN ('A', 'B', 'C')),
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
    display_name TEXT NOT NULL,
    pubg_account_id TEXT NOT NULL,
    pubg_name TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (session_id, discord_user_id),
    UNIQUE (session_id, team_key, slot)
  );

  CREATE TABLE IF NOT EXISTS kill_race_baseline_matches (
    session_id INTEGER NOT NULL REFERENCES kill_race_sessions(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL,
    PRIMARY KEY (session_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS kill_race_team_matches (
    session_id INTEGER NOT NULL REFERENCES kill_race_sessions(id) ON DELETE CASCADE,
    team_key TEXT NOT NULL CHECK (team_key IN ('A', 'B', 'C')),
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 20),
    map_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    chicken INTEGER NOT NULL DEFAULT 0 CHECK (chicken IN (0, 1)),
    sheet_synced INTEGER NOT NULL DEFAULT 0 CHECK (sheet_synced IN (0, 1)),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (session_id, team_key, match_id),
    UNIQUE (session_id, team_key, round_number)
  );

  CREATE TABLE IF NOT EXISTS kill_race_player_results (
    session_id INTEGER NOT NULL REFERENCES kill_race_sessions(id) ON DELETE CASCADE,
    team_key TEXT NOT NULL CHECK (team_key IN ('A', 'B', 'C')),
    match_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
    died INTEGER NOT NULL DEFAULT 0 CHECK (died IN (0, 1)),
    PRIMARY KEY (session_id, team_key, match_id, discord_user_id),
    FOREIGN KEY (session_id, team_key, match_id)
      REFERENCES kill_race_team_matches(session_id, team_key, match_id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS kill_race_team_matches_session_created
    ON kill_race_team_matches (session_id, created_at);
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

function hasRegisteredPlayerDisplayName(database) {
  return database
    .prepare("PRAGMA table_info(registered_players);")
    .all()
    .some((column) => column.name === "display_name");
}

function createCurrentSchema(database) {
  database.exec(`
    ${REGISTERED_PLAYERS_SCHEMA}
    ${PARTY_SESSIONS_SCHEMA}
    ${PARTY_MEMBERS_SCHEMA}
    ${PARTY_MISSIONS_SCHEMA}
    ${KILL_RACE_SCHEMA}
    ${DATA_COLLECTION_SCHEMA}
  `);
}

function migrateVersion1To2(database) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ${DATA_COLLECTION_SCHEMA}
      PRAGMA user_version = 2;
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK;");
    }
    throw error;
  }
}

function migrateVersion2To3(database) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ${KILL_RACE_SCHEMA}
      PRAGMA user_version = 3;
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK;");
    }
    throw error;
  }
}

function migrateVersion3To4(database) {
  const addDisplayNameColumn = hasRegisteredPlayerDisplayName(database)
    ? ""
    : "ALTER TABLE registered_players ADD COLUMN display_name TEXT;";

  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ${addDisplayNameColumn}
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
  const addDisplayNameColumn = hasRegisteredPlayerDisplayName(database)
    ? ""
    : "ALTER TABLE registered_players ADD COLUMN display_name TEXT;";
  database.exec("PRAGMA foreign_keys = OFF;");

  try {
    database.exec(`
      BEGIN IMMEDIATE;

      ${addDisplayNameColumn}

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
      ${KILL_RACE_SCHEMA}
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

  let currentVersion = getSchemaVersion(database);
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
    currentVersion = 2;
  }

  if (currentVersion === 2) {
    migrateVersion2To3(database);
    currentVersion = 3;
  }

  if (currentVersion === 3) {
    migrateVersion3To4(database);
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

  upsertPlayer({
    guildId,
    discordUserId,
    accountId,
    playerName,
    displayName,
    platform,
  }) {
    const now = new Date().toISOString();
    const normalizedDisplayName =
      typeof displayName === "string" ? displayName.trim() || null : null;
    this.database
      .prepare(`
        INSERT INTO registered_players (
          guild_id, discord_user_id, pubg_account_id, pubg_name, display_name,
          platform, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
          pubg_account_id = excluded.pubg_account_id,
          pubg_name = excluded.pubg_name,
          display_name = COALESCE(excluded.display_name, display_name),
          platform = excluded.platform,
          updated_at = excluded.updated_at
      `)
      .run(
        guildId,
        discordUserId,
        accountId,
        playerName,
        normalizedDisplayName,
        platform,
        now,
        now,
      );

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
          display_name AS displayName,
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

  createKillRaceSession({
    guildId,
    channelId,
    ownerUserId,
    mode,
    targetScore,
    sheetId,
    sheetUrl,
    ownerMember,
  }) {
    const openSession = this.getOpenKillRaceSession(guildId, channelId);

    if (openSession) {
      return { session: openSession, created: false };
    }

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const result = this.database
        .prepare(`
          INSERT INTO kill_race_sessions (
            guild_id, channel_id, owner_user_id, mode, target_score,
            sheet_id, sheet_url, created_at, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recruiting')
        `)
        .run(
          guildId,
          channelId,
          ownerUserId,
          mode,
          targetScore,
          sheetId,
          sheetUrl,
          now,
        );
      const sessionId = Number(result.lastInsertRowid);

      this.database
        .prepare(`
          INSERT INTO kill_race_members (
            session_id, discord_user_id, team_key, slot, display_name,
            pubg_account_id, pubg_name, joined_at
          ) VALUES (?, ?, 'A', 1, ?, ?, ?, ?)
        `)
        .run(
          sessionId,
          ownerMember.discordUserId,
          ownerMember.displayName,
          ownerMember.accountId,
          ownerMember.playerName,
          now,
        );
      this.database.exec("COMMIT;");
      return { session: this.getKillRaceSession(sessionId), created: true };
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec("ROLLBACK;");
      }
      throw error;
    }
  }

  getKillRaceSession(sessionId) {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          mode,
          target_score AS targetScore,
          sheet_id AS sheetId,
          sheet_url AS sheetUrl,
          created_at AS createdAt,
          started_at AS startedAt,
          ended_at AS endedAt,
          last_synced_at AS lastSyncedAt,
          status
        FROM kill_race_sessions
        WHERE id = ?
      `)
      .get(sessionId);
  }

  getOpenKillRaceSession(guildId, channelId) {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          mode,
          target_score AS targetScore,
          sheet_id AS sheetId,
          sheet_url AS sheetUrl,
          created_at AS createdAt,
          started_at AS startedAt,
          ended_at AS endedAt,
          last_synced_at AS lastSyncedAt,
          status
        FROM kill_race_sessions
        WHERE guild_id = ?
          AND channel_id = ?
          AND status IN ('recruiting', 'active')
        LIMIT 1
      `)
      .get(guildId, channelId);
  }

  getActiveKillRaceSessions() {
    return this.database
      .prepare(`
        SELECT
          id,
          guild_id AS guildId,
          channel_id AS channelId,
          owner_user_id AS ownerUserId,
          mode,
          target_score AS targetScore,
          sheet_id AS sheetId,
          sheet_url AS sheetUrl,
          created_at AS createdAt,
          started_at AS startedAt,
          ended_at AS endedAt,
          last_synced_at AS lastSyncedAt,
          status
        FROM kill_race_sessions
        WHERE status = 'active'
        ORDER BY started_at ASC
      `)
      .all();
  }

  getKillRaceMembers(sessionId) {
    return this.database
      .prepare(`
        SELECT
          session_id AS sessionId,
          discord_user_id AS discordUserId,
          team_key AS teamKey,
          slot,
          display_name AS displayName,
          pubg_account_id AS accountId,
          pubg_name AS playerName,
          joined_at AS joinedAt
        FROM kill_race_members
        WHERE session_id = ?
        ORDER BY team_key ASC, slot ASC
      `)
      .all(sessionId);
  }

  setKillRaceMemberTeam({ sessionId, teamKey, maxTeamSize, member }) {
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const session = this.database
        .prepare("SELECT status FROM kill_race_sessions WHERE id = ?")
        .get(sessionId);

      if (session?.status !== "recruiting") {
        this.database.exec("ROLLBACK;");
        return { changed: false, reason: "closed" };
      }

      const existing = this.database
        .prepare(`
          SELECT team_key AS teamKey, slot
          FROM kill_race_members
          WHERE session_id = ? AND discord_user_id = ?
        `)
        .get(sessionId, member.discordUserId);

      if (existing?.teamKey === teamKey) {
        this.database.exec("ROLLBACK;");
        return { changed: false, reason: "already" };
      }

      const occupiedSlots = new Set(
        this.database
          .prepare(`
            SELECT slot
            FROM kill_race_members
            WHERE session_id = ? AND team_key = ?
          `)
          .all(sessionId, teamKey)
          .map((row) => row.slot),
      );
      const slot = Array.from(
        { length: maxTeamSize },
        (_, index) => index + 1,
      ).find((candidate) => !occupiedSlots.has(candidate));

      if (!slot) {
        this.database.exec("ROLLBACK;");
        return { changed: false, reason: "full" };
      }

      this.database
        .prepare(`
          INSERT INTO kill_race_members (
            session_id, discord_user_id, team_key, slot, display_name,
            pubg_account_id, pubg_name, joined_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (session_id, discord_user_id) DO UPDATE SET
            team_key = excluded.team_key,
            slot = excluded.slot,
            display_name = excluded.display_name,
            pubg_account_id = excluded.pubg_account_id,
            pubg_name = excluded.pubg_name
        `)
        .run(
          sessionId,
          member.discordUserId,
          teamKey,
          slot,
          member.displayName,
          member.accountId,
          member.playerName,
          new Date().toISOString(),
        );
      this.database.exec("COMMIT;");
      return { changed: true, reason: existing ? "moved" : "joined" };
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec("ROLLBACK;");
      }
      throw error;
    }
  }

  startKillRaceSession(sessionId, baselineMatchIds = []) {
    const startedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const result = this.database
        .prepare(`
          UPDATE kill_race_sessions
          SET status = 'active', started_at = ?, last_synced_at = ?
          WHERE id = ? AND status = 'recruiting'
        `)
        .run(startedAt, startedAt, sessionId);

      if (result.changes === 0) {
        this.database.exec("ROLLBACK;");
        return undefined;
      }

      const insertBaseline = this.database.prepare(`
        INSERT OR IGNORE INTO kill_race_baseline_matches (session_id, match_id)
        VALUES (?, ?)
      `);
      for (const matchId of new Set(baselineMatchIds.filter(Boolean))) {
        insertBaseline.run(sessionId, matchId);
      }

      this.database.exec("COMMIT;");
      return this.getKillRaceSession(sessionId);
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec("ROLLBACK;");
      }
      throw error;
    }
  }

  getKillRaceBaselineMatchIds(sessionId) {
    return this.database
      .prepare(`
        SELECT match_id AS matchId
        FROM kill_race_baseline_matches
        WHERE session_id = ?
      `)
      .all(sessionId)
      .map((row) => row.matchId);
  }

  getKillRaceRecordedMatchIds(sessionId, teamKey) {
    return this.database
      .prepare(`
        SELECT match_id AS matchId
        FROM kill_race_team_matches
        WHERE session_id = ? AND team_key = ?
      `)
      .all(sessionId, teamKey)
      .map((row) => row.matchId);
  }

  addKillRaceTeamMatch({
    sessionId,
    teamKey,
    matchId,
    mapName,
    createdAt,
    chicken,
    players,
  }) {
    const recordedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const existing = this.database
        .prepare(`
          SELECT round_number AS roundNumber
          FROM kill_race_team_matches
          WHERE session_id = ? AND team_key = ? AND match_id = ?
        `)
        .get(sessionId, teamKey, matchId);

      if (existing) {
        this.database.exec("ROLLBACK;");
        return { created: false, roundNumber: existing.roundNumber };
      }

      const session = this.database
        .prepare("SELECT status FROM kill_race_sessions WHERE id = ?")
        .get(sessionId);
      if (session?.status !== "active") {
        this.database.exec("ROLLBACK;");
        return { created: false, reason: "closed" };
      }

      const row = this.database
        .prepare(`
          SELECT COALESCE(MAX(round_number), 0) + 1 AS roundNumber
          FROM kill_race_team_matches
          WHERE session_id = ? AND team_key = ?
        `)
        .get(sessionId, teamKey);
      const roundNumber = Number(row.roundNumber);

      if (roundNumber > 20) {
        this.database.exec("ROLLBACK;");
        return { created: false, reason: "sheet-full" };
      }

      this.database
        .prepare(`
          INSERT INTO kill_race_team_matches (
            session_id, team_key, match_id, round_number, map_name,
            created_at, chicken, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          sessionId,
          teamKey,
          matchId,
          roundNumber,
          mapName,
          createdAt,
          chicken ? 1 : 0,
          recordedAt,
        );

      const insertPlayer = this.database.prepare(`
        INSERT INTO kill_race_player_results (
          session_id, team_key, match_id, discord_user_id, kills, died
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const player of players) {
        insertPlayer.run(
          sessionId,
          teamKey,
          matchId,
          player.discordUserId,
          player.kills,
          player.died ? 1 : 0,
        );
      }

      this.database.exec("COMMIT;");
      return { created: true, roundNumber };
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec("ROLLBACK;");
      }
      throw error;
    }
  }

  getPendingKillRaceSheetRows(sessionId) {
    const matches = this.database
      .prepare(`
        SELECT
          session_id AS sessionId,
          team_key AS teamKey,
          match_id AS matchId,
          round_number AS roundNumber,
          map_name AS mapName,
          created_at AS createdAt,
          chicken
        FROM kill_race_team_matches
        WHERE session_id = ? AND sheet_synced = 0
        ORDER BY created_at ASC, team_key ASC
      `)
      .all(sessionId);
    const getPlayers = this.database.prepare(`
      SELECT
        results.discord_user_id AS discordUserId,
        members.slot,
        results.kills,
        results.died
      FROM kill_race_player_results AS results
      JOIN kill_race_members AS members
        ON members.session_id = results.session_id
        AND members.discord_user_id = results.discord_user_id
      WHERE results.session_id = ?
        AND results.team_key = ?
        AND results.match_id = ?
      ORDER BY members.slot ASC
    `);

    return matches.map((match) => ({
      ...match,
      chicken: Boolean(match.chicken),
      players: getPlayers.all(sessionId, match.teamKey, match.matchId).map(
        (player) => ({ ...player, died: Boolean(player.died) }),
      ),
    }));
  }

  markKillRaceSheetRowSynced(sessionId, teamKey, matchId) {
    const result = this.database
      .prepare(`
        UPDATE kill_race_team_matches
        SET sheet_synced = 1
        WHERE session_id = ? AND team_key = ? AND match_id = ?
      `)
      .run(sessionId, teamKey, matchId);

    return result.changes > 0;
  }

  touchKillRaceSync(sessionId, syncedAt = new Date().toISOString()) {
    this.database
      .prepare(`
        UPDATE kill_race_sessions
        SET last_synced_at = ?
        WHERE id = ? AND status = 'active'
      `)
      .run(syncedAt, sessionId);
  }

  getKillRaceSummary(sessionId) {
    const session = this.getKillRaceSession(sessionId);
    if (!session) {
      return undefined;
    }

    const members = this.database
      .prepare(`
        SELECT
          members.discord_user_id AS discordUserId,
          members.team_key AS teamKey,
          members.slot,
          members.display_name AS displayName,
          members.pubg_account_id AS accountId,
          members.pubg_name AS playerName,
          COALESCE(SUM(results.kills), 0) AS kills,
          COALESCE(SUM(results.died), 0) AS deaths
        FROM kill_race_members AS members
        LEFT JOIN kill_race_player_results AS results
          ON results.session_id = members.session_id
          AND results.discord_user_id = members.discord_user_id
        WHERE members.session_id = ?
        GROUP BY members.session_id, members.discord_user_id
        ORDER BY members.team_key ASC, members.slot ASC
      `)
      .all(sessionId)
      .map((member) => ({
        ...member,
        tier: Number(member.slot),
        score: calculateKillRacePlayerScore({
          kills: member.kills,
          deaths: member.deaths,
          tier: member.slot,
        }),
      }));
    const matchTotals = this.database
      .prepare(`
        SELECT
          team_key AS teamKey,
          COUNT(*) AS rounds,
          COALESCE(SUM(chicken), 0) AS chickens
        FROM kill_race_team_matches
        WHERE session_id = ?
        GROUP BY team_key
      `)
      .all(sessionId);
    const totalsByTeam = new Map(
      matchTotals.map((team) => [team.teamKey, team]),
    );
    const teamKeys = session.mode === "2v2v2" ? ["A", "B", "C"] : ["A", "B"];
    const teams = teamKeys.map((teamKey) => {
      const players = members.filter((member) => member.teamKey === teamKey);
      const matchTotal = totalsByTeam.get(teamKey);
      const kills = players.reduce((sum, player) => sum + Number(player.kills), 0);
      const deaths = players.reduce((sum, player) => sum + Number(player.deaths), 0);
      const chickens = Number(matchTotal?.chickens ?? 0);
      const playerScore = players.reduce(
        (sum, player) => sum + Number(player.score),
        0,
      );

      return {
        teamKey,
        rounds: Number(matchTotal?.rounds ?? 0),
        kills,
        deaths,
        chickens,
        score: playerScore + chickens * KILL_RACE_CHICKEN_POINTS,
        players,
      };
    });

    return { session, teams };
  }

  completeKillRaceSession(sessionId) {
    const result = this.database
      .prepare(`
        UPDATE kill_race_sessions
        SET status = 'completed', ended_at = ?
        WHERE id = ? AND status IN ('recruiting', 'active')
      `)
      .run(new Date().toISOString(), sessionId);

    return result.changes > 0;
  }

  saveCollectedMatch(sessionId, dataset, archive = {}) {
    const collectedAt = new Date().toISOString();
    const match = dataset.match;
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      this.database
        .prepare(`
          INSERT INTO collected_matches (
            match_id,
            platform,
            map_name,
            game_mode,
            created_at,
            duration_seconds,
            telemetry_url,
            raw_telemetry_path,
            raw_telemetry_sha256,
            raw_telemetry_bytes,
            parser_version,
            collected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (match_id) DO UPDATE SET
            platform = excluded.platform,
            map_name = excluded.map_name,
            game_mode = excluded.game_mode,
            created_at = excluded.created_at,
            duration_seconds = excluded.duration_seconds,
            telemetry_url = excluded.telemetry_url,
            raw_telemetry_path = COALESCE(
              excluded.raw_telemetry_path,
              collected_matches.raw_telemetry_path
            ),
            raw_telemetry_sha256 = COALESCE(
              excluded.raw_telemetry_sha256,
              collected_matches.raw_telemetry_sha256
            ),
            raw_telemetry_bytes = COALESCE(
              excluded.raw_telemetry_bytes,
              collected_matches.raw_telemetry_bytes
            ),
            parser_version = excluded.parser_version,
            collected_at = excluded.collected_at
        `)
        .run(
          match.matchId,
          match.platform,
          match.mapName,
          match.gameMode,
          match.createdAt,
          match.durationSeconds,
          match.telemetryUrl,
          archive.path ?? null,
          archive.sha256 ?? null,
          archive.bytes ?? null,
          match.parserVersion,
          collectedAt,
        );

      this.database
        .prepare(`
          INSERT OR IGNORE INTO party_session_matches (
            session_id, match_id, linked_at, confirmed
          ) VALUES (?, ?, ?, 0)
        `)
        .run(sessionId, match.matchId, collectedAt);

      for (const tableName of [
        "match_players",
        "landing_events",
        "player_positions",
        "death_events",
        "zone_snapshots",
      ]) {
        this.database
          .prepare(`DELETE FROM ${tableName} WHERE match_id = ?`)
          .run(match.matchId);
      }

      this.insertMatchPlayers(match.matchId, dataset.players ?? []);
      this.insertLandingEvents(match.matchId, dataset.landings ?? []);
      this.insertPlayerPositions(match.matchId, dataset.positions ?? []);
      this.insertDeathEvents(match.matchId, dataset.deaths ?? []);
      this.insertZoneSnapshots(match.matchId, dataset.zones ?? []);
      this.database.exec("COMMIT;");
      return this.getCollectedMatch(match.matchId);
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec("ROLLBACK;");
      }
      throw error;
    }
  }

  getCollectedMatch(matchId) {
    return this.database
      .prepare(`
        SELECT
          match_id AS matchId,
          platform,
          map_name AS mapName,
          game_mode AS gameMode,
          created_at AS createdAt,
          duration_seconds AS durationSeconds,
          telemetry_url AS telemetryUrl,
          raw_telemetry_path AS rawTelemetryPath,
          raw_telemetry_sha256 AS rawTelemetrySha256,
          raw_telemetry_bytes AS rawTelemetryBytes,
          parser_version AS parserVersion,
          collected_at AS collectedAt
        FROM collected_matches
        WHERE match_id = ?
      `)
      .get(matchId);
  }

  getPartyCollectedMatches(sessionId) {
    return this.database
      .prepare(`
        SELECT
          matches.match_id AS matchId,
          matches.map_name AS mapName,
          matches.game_mode AS gameMode,
          matches.created_at AS createdAt,
          links.confirmed
        FROM party_session_matches AS links
        JOIN collected_matches AS matches ON matches.match_id = links.match_id
        WHERE links.session_id = ?
        ORDER BY matches.created_at ASC
      `)
      .all(sessionId);
  }

  insertMatchPlayers(matchId, players) {
    const statement = this.database.prepare(`
      INSERT INTO match_players (
        match_id, account_id, discord_user_id, player_name, team_id,
        placement, kills, damage, assists, revives, headshot_kills,
        longest_kill, team_kills, death_type, survival_seconds, is_party_member
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const player of players) {
      statement.run(
        matchId,
        player.accountId,
        player.discordUserId,
        player.playerName,
        player.teamId,
        player.placement,
        player.kills,
        player.damage,
        player.assists,
        player.revives,
        player.headshotKills,
        player.longestKill,
        player.teamKills,
        player.deathType,
        player.survivalSeconds,
        player.isPartyMember ? 1 : 0,
      );
    }
  }

  insertLandingEvents(matchId, landings) {
    const statement = this.database.prepare(`
      INSERT INTO landing_events (
        match_id, account_id, team_id, event_at, x, y, z
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const landing of landings) {
      statement.run(
        matchId,
        landing.accountId,
        landing.teamId,
        landing.eventAt,
        landing.x,
        landing.y,
        landing.z,
      );
    }
  }

  insertPlayerPositions(matchId, positions) {
    const statement = this.database.prepare(`
      INSERT INTO player_positions (
        match_id, account_id, event_at, elapsed_seconds, x, y, z,
        is_in_blue_zone, vehicle_type, alive_players
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const position of positions) {
      statement.run(
        matchId,
        position.accountId,
        position.eventAt,
        position.elapsedSeconds,
        position.x,
        position.y,
        position.z,
        position.isInBlueZone ? 1 : 0,
        position.vehicleType,
        position.alivePlayers,
      );
    }
  }

  insertDeathEvents(matchId, deaths) {
    const statement = this.database.prepare(`
      INSERT INTO death_events (
        match_id, victim_account_id, killer_account_id, victim_team_id,
        killer_team_id, event_at, x, y, z, damage_type, damage_causer,
        distance, is_suicide, is_team_kill
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const death of deaths) {
      statement.run(
        matchId,
        death.victimAccountId,
        death.killerAccountId,
        death.victimTeamId,
        death.killerTeamId,
        death.eventAt,
        death.x,
        death.y,
        death.z,
        death.damageType,
        death.damageCauser,
        death.distance,
        death.isSuicide ? 1 : 0,
        death.isTeamKill ? 1 : 0,
      );
    }
  }

  insertZoneSnapshots(matchId, zones) {
    const statement = this.database.prepare(`
      INSERT INTO zone_snapshots (
        match_id, event_at, elapsed_seconds, phase, alive_teams, alive_players,
        safety_x, safety_y, safety_radius, warning_x, warning_y, warning_radius
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const zone of zones) {
      statement.run(
        matchId,
        zone.eventAt,
        zone.elapsedSeconds,
        zone.phase,
        zone.aliveTeams,
        zone.alivePlayers,
        zone.safetyX,
        zone.safetyY,
        zone.safetyRadius,
        zone.warningX,
        zone.warningY,
        zone.warningRadius,
      );
    }
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
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      const result = this.database
        .prepare(`
          UPDATE party_sessions
          SET status = 'completed', ended_at = ?
          WHERE id = ? AND status = 'reviewing'
        `)
        .run(new Date().toISOString(), sessionId);

      if (result.changes === 0) {
        this.database.exec("ROLLBACK;");
        return false;
      }

      this.database
        .prepare(`
          UPDATE party_session_matches
          SET confirmed = 1
          WHERE session_id = ?
        `)
        .run(sessionId);
      this.database.exec("COMMIT;");
      return true;
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec("ROLLBACK;");
      }
      throw error;
    }
  }

  cancelPartySession(sessionId) {
    return this.completePartySession(sessionId);
  }

  close() {
    this.database.close();
  }
}
