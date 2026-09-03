import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRepository } from "../src/database.js";

test("일반 파티와 별개로 킬내기 팀과 점수를 저장한다", () => {
  const repository = createRepository(":memory:");
  const owner = {
    discordUserId: "owner-1",
    displayName: "민재",
    accountId: "account-owner",
    playerName: "PUBGOwner",
  };
  const member = {
    discordUserId: "member-1",
    displayName: "승환",
    accountId: "account-member",
    playerName: "PUBGMember",
  };
  const party = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: owner.discordUserId,
  });
  const race = repository.createKillRaceSession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: owner.discordUserId,
    mode: "2v2",
    targetScore: 30,
    sheetId: "sheet-1",
    sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    ownerMember: owner,
  });

  assert.equal(party.created, true);
  assert.equal(race.created, true);
  assert.equal(race.session.status, "recruiting");
  assert.deepEqual(
    repository.getKillRaceMembers(race.session.id).map((player) => [
      player.discordUserId,
      player.teamKey,
      player.slot,
    ]),
    [["owner-1", "A", 1]],
  );
  assert.deepEqual(
    repository.setKillRaceMemberTeam({
      sessionId: race.session.id,
      teamKey: "B",
      maxTeamSize: 2,
      member,
    }),
    { changed: true, reason: "joined" },
  );
  assert.equal(
    repository.setKillRaceMemberTeam({
      sessionId: race.session.id,
      teamKey: "A",
      maxTeamSize: 2,
      member,
    }).reason,
    "moved",
  );
  repository.setKillRaceMemberTeam({
    sessionId: race.session.id,
    teamKey: "B",
    maxTeamSize: 2,
    member,
  });

  const started = repository.startKillRaceSession(race.session.id, [
    "old-match-1",
    "old-match-2",
  ]);
  assert.equal(started.status, "active");
  assert.deepEqual(
    repository.getKillRaceBaselineMatchIds(race.session.id).sort(),
    ["old-match-1", "old-match-2"],
  );

  const recorded = repository.addKillRaceTeamMatch({
    sessionId: race.session.id,
    teamKey: "A",
    matchId: "new-match-1",
    mapName: "Savage_Main",
    createdAt: "2026-09-03T03:00:00.000Z",
    chicken: true,
    players: [
      { discordUserId: owner.discordUserId, kills: 4, died: true },
    ],
  });
  assert.deepEqual(recorded, { created: true, roundNumber: 1 });
  assert.equal(
    repository.addKillRaceTeamMatch({
      sessionId: race.session.id,
      teamKey: "A",
      matchId: "new-match-1",
      mapName: "Savage_Main",
      createdAt: "2026-09-03T03:00:00.000Z",
      chicken: true,
      players: [{ discordUserId: owner.discordUserId, kills: 4, died: true }],
    }).created,
    false,
  );

  const pending = repository.getPendingKillRaceSheetRows(race.session.id);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].players[0].died, true);
  repository.markKillRaceSheetRowSynced(
    race.session.id,
    "A",
    "new-match-1",
  );
  assert.equal(repository.getPendingKillRaceSheetRows(race.session.id).length, 0);

  const summary = repository.getKillRaceSummary(race.session.id);
  assert.equal(summary.teams[0].kills, 4);
  assert.equal(summary.teams[0].deaths, 1);
  assert.equal(summary.teams[0].chickens, 1);
  assert.equal(summary.teams[0].score, 10);
  assert.equal(summary.teams[0].players[0].score, 2);
  assert.equal(repository.completeKillRaceSession(race.session.id), true);
  assert.equal(repository.getKillRaceSession(race.session.id).status, "completed");
  repository.close();
});

test("플레이어 등록과 파티 세션을 SQLite에 저장한다", () => {
  const repository = createRepository(":memory:");

  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId: "user-1",
    accountId: "account-1",
    playerName: "PlayerOne",
    displayName: "민재",
    platform: "steam",
  });
  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId: "user-2",
    accountId: "account-2",
    playerName: "PlayerTwo",
    platform: "steam",
  });

  assert.equal(repository.getPlayer("guild-1", "user-1").playerName, "PlayerOne");
  assert.equal(repository.getPlayer("guild-1", "user-1").displayName, "민재");
  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId: "user-1",
    accountId: "account-1",
    playerName: "PlayerOne",
    platform: "steam",
  });
  assert.equal(repository.getPlayer("guild-1", "user-1").displayName, "민재");
  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId: "user-1",
    accountId: "account-1",
    playerName: "PlayerOne",
    displayName: "민재2",
    platform: "steam",
  });
  assert.equal(repository.getPlayer("guild-1", "user-1").displayName, "민재2");
  assert.equal(
    repository.database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM registered_players
        WHERE guild_id = ? AND discord_user_id = ?
      `)
      .get("guild-1", "user-1").count,
    1,
  );

  const { session, created } = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: "user-1",
  });

  assert.equal(created, true);
  assert.equal(session.status, "recruiting");
  assert.equal(session.startedAt, null);
  assert.equal(repository.getPartyMembers(session.id).length, 1);
  assert.equal(repository.addPartyMember(session.id, "user-2"), true);
  assert.equal(repository.addPartyMember(session.id, "user-2"), false);
  assert.equal(repository.getPartyMembers(session.id).length, 2);
  const startedSession = repository.startPartySession(session.id, [
    {
      key: "team-12-kills",
      scope: "team",
      rewardPoints: 100,
    },
    {
      key: "personal-7-kills",
      scope: "personal",
      rewardPoints: 120,
    },
  ]);
  assert.equal(startedSession.status, "active");
  assert.ok(startedSession.startedAt);
  assert.deepEqual(
    repository.getPartyMissions(session.id).map((mission) => mission.key),
    ["personal-7-kills", "team-12-kills"],
  );
  assert.equal(
    repository.recordMissionCompletions(session.id, [
      {
        missionKey: "personal-7-kills",
        discordUserId: "user-1",
        matchId: "match-1",
      },
    ]),
    1,
  );
  assert.equal(
    repository.recordMissionCompletions(session.id, [
      {
        missionKey: "personal-7-kills",
        discordUserId: "user-1",
        matchId: "match-2",
      },
      {
        missionKey: "personal-7-kills",
        discordUserId: "user-2",
        matchId: "match-2",
      },
    ]),
    1,
  );
  assert.deepEqual(
    repository.getMissionCompletions(session.id).map((completion) => ({
      user: completion.discordUserId,
      match: completion.matchId,
    })),
    [
      { user: "user-1", match: "match-1" },
      { user: "user-2", match: "match-2" },
    ],
  );
  assert.equal(repository.startPartySession(session.id), undefined);
  assert.equal(repository.addPartyMember(session.id, "user-3"), false);
  assert.equal(repository.completePartySession(session.id), true);
  assert.equal(repository.getPartySession(session.id).status, "completed");

  const { session: cancelledSession, created: recreated } =
    repository.createPartySession({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerUserId: "user-1",
    });

  assert.equal(recreated, true);
  assert.equal(repository.cancelPartySession(cancelledSession.id), true);
  assert.equal(repository.getPartySession(cancelledSession.id).status, "completed");
  assert.equal(
    repository.createPartySession({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerUserId: "user-1",
    }).created,
    true,
  );

  repository.close();
});

test("최근 두 파티에서 선정된 미션 키를 다시 뽑지 않도록 조회한다", () => {
  const repository = createRepository(":memory:");
  const historicalMissions = [
    { key: "team-12-kills", scope: "team", rewardPoints: 100 },
    { key: "personal-7-kills", scope: "personal", rewardPoints: 120 },
    { key: "team-2000-damage", scope: "team", rewardPoints: 90 },
  ];

  for (let index = 0; index < historicalMissions.length; index += 1) {
    const { session } = repository.createPartySession({
      guildId: "guild-1",
      channelId: `channel-${index}`,
      ownerUserId: "user-1",
    });
    repository.startPartySession(session.id, [historicalMissions[index]]);
    repository.completePartySession(session.id);
  }

  const { session: currentSession } = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-current",
    ownerUserId: "user-1",
  });
  const recentKeys = repository.getRecentPartyMissionKeys(
    "guild-1",
    currentSession.id,
    2,
  );

  assert.deepEqual(recentKeys, ["personal-7-kills", "team-2000-damage"]);
  repository.close();
});

test("결산 초안을 새로고침하고 확정할 때만 파티를 종료한다", () => {
  const repository = createRepository(":memory:");
  const { session } = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: "user-1",
  });
  repository.startPartySession(session.id);

  const firstReview = repository.savePartyReview(session.id, {
    snapshot: {
      version: 1,
      generatedAt: "2026-08-23T01:00:00.000Z",
      report: { matches: 1 },
    },
    syncedMatchCount: 1,
    lastSyncedMatchAt: "2026-08-23T00:30:00.000Z",
  });

  assert.equal(firstReview.status, "reviewing");
  assert.ok(firstReview.reviewedAt);
  assert.equal(firstReview.syncedMatchCount, 1);
  assert.equal(firstReview.lastSyncedMatchAt, "2026-08-23T00:30:00.000Z");
  assert.equal(repository.getPartyReviewSnapshot(session.id).report.matches, 1);
  assert.equal(
    repository.createPartySession({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerUserId: "user-1",
    }).created,
    false,
  );

  const refreshedReview = repository.savePartyReview(session.id, {
    snapshot: {
      version: 1,
      generatedAt: "2026-08-23T01:02:00.000Z",
      report: { matches: 2 },
    },
    syncedMatchCount: 2,
    lastSyncedMatchAt: "2026-08-23T00:55:00.000Z",
  });

  assert.equal(refreshedReview.status, "reviewing");
  assert.equal(refreshedReview.syncedMatchCount, 2);
  assert.equal(repository.getPartyReviewSnapshot(session.id).report.matches, 2);
  assert.equal(repository.confirmPartySession(session.id), true);
  assert.equal(repository.getPartySession(session.id).status, "completed");
  assert.equal(repository.confirmPartySession(session.id), false);
  assert.equal(
    repository.savePartyReview(session.id, {
      snapshot: { report: { matches: 3 } },
      syncedMatchCount: 3,
      lastSyncedMatchAt: "2026-08-23T01:05:00.000Z",
    }),
    undefined,
  );

  repository.close();
});

test("기존 SQLite 파티 기록을 새 상태 스키마로 안전하게 이전한다", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "pubg-bot-migration-"));
  const databasePath = join(temporaryDirectory, "legacy.sqlite");
  const legacyDatabase = new DatabaseSync(databasePath);

  legacyDatabase.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE registered_players (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      pubg_account_id TEXT NOT NULL,
      pubg_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_user_id)
    );

    CREATE TABLE party_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed'))
    );

    CREATE UNIQUE INDEX active_party_per_channel
      ON party_sessions (guild_id, channel_id)
      WHERE status = 'active';

    CREATE TABLE party_members (
      session_id INTEGER NOT NULL REFERENCES party_sessions(id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (session_id, discord_user_id)
    );

    INSERT INTO registered_players VALUES (
      'guild-1', 'user-1', 'account-1', 'PlayerOne', 'steam',
      '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z'
    );

    INSERT INTO party_sessions (
      id, guild_id, channel_id, owner_user_id, started_at, status
    ) VALUES (
      7, 'guild-1', 'channel-1', 'user-1', '2026-08-20T10:00:00.000Z', 'active'
    );

    INSERT INTO party_members VALUES (
      7, 'user-1', '2026-08-20T10:00:00.000Z'
    );
  `);
  legacyDatabase.close();

  try {
    const repository = createRepository(databasePath);
    const session = repository.getPartySession(7);

    assert.equal(session.status, "active");
    assert.equal(session.createdAt, "2026-08-20T10:00:00.000Z");
    assert.equal(session.startedAt, "2026-08-20T10:00:00.000Z");
    assert.equal(session.syncedMatchCount, 0);
    assert.equal(repository.getPartyMembers(7)[0].playerName, "PlayerOne");
    assert.equal(
      repository.database.prepare("PRAGMA user_version;").get().user_version,
      4,
    );
    assert.deepEqual(repository.database.prepare("PRAGMA foreign_key_check;").all(), []);

    const schema = repository.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'party_sessions'")
      .get().sql;
    assert.match(schema, /'recruiting'/);
    assert.match(schema, /'reviewing'/);

    repository.close();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("스키마 V1 데이터를 보존하면서 사녹 수집 테이블을 추가한다", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "pubg-bot-v2-migration-"));
  const databasePath = join(temporaryDirectory, "version-1.sqlite");

  try {
    const initialRepository = createRepository(databasePath);
    initialRepository.upsertPlayer({
      guildId: "guild-1",
      discordUserId: "user-1",
      accountId: "account-1",
      playerName: "PlayerOne",
      platform: "steam",
    });
    const { session } = initialRepository.createPartySession({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerUserId: "user-1",
    });
    initialRepository.close();

    const versionOneDatabase = new DatabaseSync(databasePath);
    versionOneDatabase.exec(`
      DROP TABLE zone_snapshots;
      DROP TABLE death_events;
      DROP TABLE player_positions;
      DROP TABLE landing_events;
      DROP TABLE match_players;
      DROP TABLE party_session_matches;
      DROP TABLE collected_matches;
      PRAGMA user_version = 1;
    `);
    versionOneDatabase.close();

    const migratedRepository = createRepository(databasePath);
    const tableNames = migratedRepository.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);

    assert.equal(
      migratedRepository.database.prepare("PRAGMA user_version;").get().user_version,
      4,
    );
    assert.equal(
      migratedRepository.getPlayer("guild-1", "user-1").playerName,
      "PlayerOne",
    );
    assert.equal(migratedRepository.getPartySession(session.id).status, "recruiting");
    assert.deepEqual(
      [
        "collected_matches",
        "party_session_matches",
        "match_players",
        "landing_events",
        "player_positions",
        "death_events",
        "zone_snapshots",
      ].filter((tableName) => !tableNames.includes(tableName)),
      [],
    );
    assert.deepEqual(
      migratedRepository.database.prepare("PRAGMA foreign_key_check;").all(),
      [],
    );
    migratedRepository.close();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("스키마 V3의 기존 플레이어 ID와 등록 정보를 보존하며 표시 이름을 추가한다", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "pubg-bot-v4-migration-"));
  const databasePath = join(temporaryDirectory, "version-3.sqlite");
  const versionThreeDatabase = new DatabaseSync(databasePath);

  versionThreeDatabase.exec(`
    CREATE TABLE registered_players (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      pubg_account_id TEXT NOT NULL,
      pubg_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_user_id)
    );

    INSERT INTO registered_players VALUES (
      'guild-1', 'user-1', 'account-1', 'PlayerOne', 'steam',
      '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z'
    );

    PRAGMA user_version = 3;
  `);
  versionThreeDatabase.close();

  try {
    const repository = createRepository(databasePath);
    const existingPlayer = repository.getPlayer("guild-1", "user-1");

    assert.equal(existingPlayer.discordUserId, "user-1");
    assert.equal(existingPlayer.accountId, "account-1");
    assert.equal(existingPlayer.playerName, "PlayerOne");
    assert.equal(existingPlayer.displayName, null);
    assert.equal(existingPlayer.createdAt, "2026-08-20T10:00:00.000Z");
    assert.equal(
      repository.database.prepare("PRAGMA user_version;").get().user_version,
      4,
    );

    repository.upsertPlayer({
      guildId: "guild-1",
      discordUserId: "user-1",
      accountId: "account-1",
      playerName: "PlayerOne",
      displayName: "민재",
      platform: "steam",
    });

    const updatedPlayer = repository.getPlayer("guild-1", "user-1");
    assert.equal(updatedPlayer.displayName, "민재");
    assert.equal(updatedPlayer.accountId, "account-1");
    assert.equal(updatedPlayer.createdAt, "2026-08-20T10:00:00.000Z");
    assert.equal(
      repository.database
        .prepare("SELECT COUNT(*) AS count FROM registered_players")
        .get().count,
      1,
    );
    repository.close();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
