import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createRepository } from "../src/database.js";
import {
  archiveTelemetry,
  extractSanhokDataset,
  SANHOK_MAP_NAME,
} from "../src/data-collection/sanhok-collector.js";

const gunzipAsync = promisify(gunzip);

test("사녹 경기에서 학습용 전적과 텔레메트리 사건을 추출한다", () => {
  const rawMatch = createRawMatch();
  const telemetry = createTelemetry();
  const dataset = extractSanhokDataset({
    rawMatch,
    telemetry,
    partyMembers: [
      {
        accountId: "account-party",
        discordUserId: "discord-party",
        playerName: "PartyPlayer",
      },
    ],
    platform: "steam",
  });

  assert.equal(dataset.match.matchId, "match-sanhok-1");
  assert.equal(dataset.match.mapName, SANHOK_MAP_NAME);
  assert.equal(dataset.match.durationSeconds, 1_620);
  assert.equal(dataset.match.telemetryUrl, "https://telemetry.example/match-sanhok-1");
  assert.equal(dataset.players.length, 2);
  assert.deepEqual(
    dataset.players.map((player) => ({
      accountId: player.accountId,
      teamId: player.teamId,
      isPartyMember: player.isPartyMember,
    })),
    [
      { accountId: "account-party", teamId: 10, isPartyMember: true },
      { accountId: "account-enemy", teamId: 20, isPartyMember: false },
    ],
  );
  assert.equal(dataset.landings.length, 2);
  assert.equal(dataset.landings[0].accountId, "account-party");
  assert.equal(dataset.landings[0].x, 100_000);
  assert.equal(dataset.positions.length, 1);
  assert.equal(dataset.positions[0].accountId, "account-party");
  assert.equal(dataset.positions[0].alivePlayers, 80);
  assert.equal(dataset.positions[0].elapsedSeconds, 100);
  assert.equal(dataset.deaths.length, 2);
  assert.equal(dataset.deaths[0].killerAccountId, "account-party");
  assert.equal(dataset.deaths[0].victimAccountId, "account-enemy");
  assert.equal(dataset.deaths[0].damageCauser, "WeapAK47_C");
  assert.equal(dataset.deaths[0].isTeamKill, false);
  assert.equal(dataset.deaths[1].victimAccountId, "account-enemy");
  assert.notEqual(dataset.deaths[0].eventAt, dataset.deaths[1].eventAt);
  assert.equal(dataset.zones.length, 1);
  assert.equal(dataset.zones[0].safetyRadius, 200_000);
});

test("사녹이 아닌 경기는 수집 대상에서 제외한다", () => {
  const rawMatch = createRawMatch();
  rawMatch.data.attributes.mapName = "Baltic_Main";

  assert.equal(
    extractSanhokDataset({ rawMatch, telemetry: createTelemetry() }),
    null,
  );
});

test("원본 텔레메트리를 gzip 파일로 보관하고 무결성 값을 남긴다", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pubg-telemetry-"));
  const telemetry = createTelemetry();

  try {
    const archive = await archiveTelemetry({
      matchId: "match-sanhok-1",
      telemetry,
      archiveRoot: temporaryDirectory,
    });
    const compressed = await readFile(archive.path);
    const restored = JSON.parse((await gunzipAsync(compressed)).toString("utf8"));

    assert.deepEqual(restored, telemetry);
    assert.match(archive.path, /Savage_Main\/match-sanhok-1\.json\.gz$/);
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    assert.equal(archive.bytes, Buffer.byteLength(JSON.stringify(telemetry)));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("같은 경기를 다시 저장해도 중복되지 않고 결산 확정 상태가 연결된다", () => {
  const repository = createRepository(":memory:");
  const { session } = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: "owner-1",
  });
  repository.startPartySession(session.id);
  const dataset = extractSanhokDataset({
    rawMatch: createRawMatch(),
    telemetry: createTelemetry(),
    partyMembers: [
      {
        accountId: "account-party",
        discordUserId: "owner-1",
        playerName: "PartyPlayer",
      },
    ],
  });
  const archive = {
    path: "/data/telemetry/Savage_Main/match-sanhok-1.json.gz",
    sha256: "a".repeat(64),
    bytes: 1_234,
  };

  repository.saveCollectedMatch(session.id, dataset, archive);
  repository.saveCollectedMatch(session.id, dataset, archive);

  assert.equal(repository.getPartyCollectedMatches(session.id).length, 1);
  assert.equal(repository.getPartyCollectedMatches(session.id)[0].confirmed, 0);
  assert.equal(countRows(repository, "collected_matches"), 1);
  assert.equal(countRows(repository, "match_players"), 2);
  assert.equal(countRows(repository, "landing_events"), 2);
  assert.equal(countRows(repository, "player_positions"), 1);
  assert.equal(countRows(repository, "death_events"), 2);
  assert.equal(countRows(repository, "zone_snapshots"), 1);
  assert.equal(
    repository.getCollectedMatch("match-sanhok-1").rawTelemetrySha256,
    "a".repeat(64),
  );

  repository.savePartyReview(session.id, {
    snapshot: { version: 1, report: {} },
    syncedMatchCount: 1,
    lastSyncedMatchAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(repository.confirmPartySession(session.id), true);
  assert.equal(repository.getPartyCollectedMatches(session.id)[0].confirmed, 1);
  repository.close();
});

function countRows(repository, tableName) {
  return repository.database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function createRawMatch() {
  return {
    data: {
      id: "match-sanhok-1",
      attributes: {
        createdAt: "2026-08-24T00:00:00.000Z",
        duration: 1_620,
        gameMode: "squad",
        mapName: SANHOK_MAP_NAME,
      },
      relationships: {
        assets: { data: [{ type: "asset", id: "asset-1" }] },
      },
    },
    included: [
      participant("participant-1", "account-party", "PartyPlayer", 3),
      participant("participant-2", "account-enemy", "EnemyPlayer", 1),
      {
        type: "roster",
        id: "roster-1",
        attributes: { stats: { teamId: 10 } },
        relationships: {
          participants: { data: [{ type: "participant", id: "participant-1" }] },
        },
      },
      {
        type: "roster",
        id: "roster-2",
        attributes: { stats: { teamId: 20 } },
        relationships: {
          participants: { data: [{ type: "participant", id: "participant-2" }] },
        },
      },
      {
        type: "asset",
        id: "asset-1",
        attributes: { URL: "https://telemetry.example/match-sanhok-1" },
      },
    ],
  };
}

function participant(id, accountId, name, kills) {
  return {
    type: "participant",
    id,
    attributes: {
      stats: {
        playerId: accountId,
        name,
        winPlace: 2,
        kills,
        damageDealt: kills * 100,
        assists: 1,
        revives: 0,
        headshotKills: 1,
        longestKill: 55.5,
        teamKills: 0,
        deathType: "byplayer",
        timeSurvived: 1_200,
      },
    },
  };
}

function createTelemetry() {
  const party = character("account-party", "PartyPlayer", 10, 100_000, 120_000);
  const enemy = character("account-enemy", "EnemyPlayer", 20, 140_000, 150_000);

  return [
    {
      _T: "LogMatchStart",
      _D: "2026-08-24T00:00:00.000Z",
      mapName: SANHOK_MAP_NAME,
      characters: [party, enemy],
    },
    {
      _T: "LogGameStatePeriodic",
      _D: "2026-08-24T00:01:00.000Z",
      common: { isGame: 60 },
      gameState: {
        safetyZonePhase: 1,
        numAliveTeams: 25,
        numAlivePlayers: 80,
        safetyZonePosition: { x: 204_000, y: 204_000 },
        safetyZoneRadius: 200_000,
        poisonGasWarningPosition: { x: 205_000, y: 203_000 },
        poisonGasWarningRadius: 190_000,
      },
    },
    {
      _T: "LogParachuteLanding",
      _D: "2026-08-24T00:01:20.000Z",
      character: party,
    },
    {
      _T: "LogParachuteLanding",
      _D: "2026-08-24T00:01:21.000Z",
      character: enemy,
    },
    {
      _T: "LogPlayerPosition",
      _D: "2026-08-24T00:01:40.000Z",
      common: { isGame: 100 },
      character: party,
      vehicle: { vehicleType: "None" },
    },
    {
      _T: "LogPlayerPosition",
      _D: "2026-08-24T00:01:41.000Z",
      character: enemy,
    },
    killEvent("2026-08-24T00:05:00.000Z", party, enemy, 75),
    killEvent("2026-08-24T00:15:00.000Z", party, enemy, 25),
  ];
}

function character(accountId, name, teamId, x, y) {
  return {
    accountId,
    name,
    teamId,
    location: { x, y, z: 500 },
    isInBlueZone: false,
  };
}

function killEvent(eventAt, killer, victim, distance) {
  return {
    _T: "LogPlayerKillV2",
    _D: eventAt,
    killer,
    victim,
    killerDamageInfo: {
      damageTypeCategory: "Damage_Gun",
      damageCauserName: "WeapAK47_C",
      distance,
    },
    victimGameResult: {
      teamId: victim.teamId,
      teamKillers_AccountId: [],
    },
  };
}
