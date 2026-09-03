import test from "node:test";
import assert from "node:assert/strict";
import {
  extractKillRaceTeamMatch,
  sharedNewMatchIds,
} from "../src/kill-race-scoring.js";

const members = [
  {
    discordUserId: "user-1",
    accountId: "account-1",
    slot: 1,
  },
  {
    discordUserId: "user-2",
    accountId: "account-2",
    slot: 2,
  },
];

test("팀 전원이 공유하는 시작 후 경기만 후보로 고른다", () => {
  const players = [
    { accountId: "account-1", matchIds: ["old", "shared", "solo-1"] },
    { accountId: "account-2", matchIds: ["old", "shared", "solo-2"] },
  ];

  assert.deepEqual(sharedNewMatchIds(players, members, ["old"]), ["shared"]);
});

test("적 처치만 점수로 세고 한 경기의 여러 사망은 한 번만 감점한다", () => {
  const match = rawMatch([
    participant("account-1", 1, "alive"),
    participant("account-2", 3, "byplayer"),
  ]);
  const telemetry = [
    killEvent("account-1", "enemy-1", 1, 20, "2026-09-03T03:01:00.000Z"),
    killEvent("account-1", "enemy-1", 1, 20, "2026-09-03T03:05:00.000Z"),
    killEvent("account-1", "account-2", 1, 1, "2026-09-03T03:06:00.000Z"),
    killEvent("enemy-2", "account-2", 20, 1, "2026-09-03T03:07:00.000Z"),
    killEvent("enemy-3", "account-2", 30, 1, "2026-09-03T03:08:00.000Z"),
  ];

  const result = extractKillRaceTeamMatch({
    match,
    telemetry,
    members,
    startedAt: "2026-09-03T03:00:00.000Z",
    endedAt: new Date("2026-09-03T04:00:00.000Z"),
  });

  assert.equal(result.players[0].kills, 2);
  assert.equal(result.players[0].died, false);
  assert.equal(result.players[1].kills, 0);
  assert.equal(result.players[1].died, true);
  assert.equal(result.chicken, true);
});

test("팀원 일부가 없는 경기와 스쿼드가 아닌 경기는 제외한다", () => {
  const missingMemberMatch = rawMatch([participant("account-1", 2, "byplayer")]);
  const duoMatch = rawMatch(
    [participant("account-1", 2), participant("account-2", 2)],
    { gameMode: "duo" },
  );

  assert.equal(
    extractKillRaceTeamMatch({
      match: missingMemberMatch,
      telemetry: [],
      members,
      startedAt: "2026-09-03T03:00:00.000Z",
    }),
    null,
  );
  assert.equal(
    extractKillRaceTeamMatch({
      match: duoMatch,
      telemetry: [],
      members,
      startedAt: "2026-09-03T03:00:00.000Z",
    }),
    null,
  );
});

function rawMatch(participants, overrides = {}) {
  return {
    data: {
      id: "match-1",
      attributes: {
        createdAt: "2026-09-03T03:00:30.000Z",
        gameMode: "squad",
        mapName: "Savage_Main",
        ...overrides,
      },
    },
    included: participants,
  };
}

function participant(playerId, winPlace, deathType = "alive") {
  return {
    type: "participant",
    attributes: { stats: { playerId, winPlace, deathType } },
  };
}

function killEvent(killerId, victimId, killerTeamId, victimTeamId, timestamp) {
  return {
    _T: "LogPlayerKillV2",
    _D: timestamp,
    killer: { accountId: killerId, teamId: killerTeamId },
    victim: { accountId: victimId, teamId: victimTeamId },
    victimGameResult: { teamId: victimTeamId },
    killerDamageInfo: { damageCauserName: "WeapM416_C" },
  };
}
