import test from "node:test";
import assert from "node:assert/strict";
import { createRepository } from "../src/database.js";
import { KillRaceService } from "../src/kill-race-service.js";

test("출발 전 경기 기준선을 저장하고 새 완주 경기만 한 번 시트에 반영한다", async () => {
  const repository = createRepository(":memory:");
  const owner = raceMember("user-1", "account-1", "민재");
  const teammate = raceMember("user-2", "account-2", "승환");
  const enemyOne = raceMember("user-3", "account-3", "재현");
  const enemyTwo = raceMember("user-4", "account-4", "민우");
  const { session } = repository.createKillRaceSession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: owner.discordUserId,
    mode: "2v2",
    targetScore: 30,
    sheetId: "sheet-id",
    sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
    ownerMember: owner,
  });
  repository.setKillRaceMemberTeam({
    sessionId: session.id,
    teamKey: "A",
    maxTeamSize: 2,
    member: teammate,
  });
  for (const member of [enemyOne, enemyTwo]) {
    repository.setKillRaceMemberTeam({
      sessionId: session.id,
      teamKey: "B",
      maxTeamSize: 2,
      member,
    });
  }

  let phase = "baseline";
  const sheetWrites = [];
  const pubgApi = {
    async getPlayersByAccountIds(accountIds) {
      return accountIds.map((accountId) => ({
        accountId,
        matchIds: phase === "baseline" ? ["old-match"] : ["new-match", "old-match"],
      }));
    },
    async getMatches(matchIds) {
      if (matchIds.length === 0) {
        return [];
      }
      assert.deepEqual(matchIds, ["new-match"]);
      return [rawMatch(repository.getKillRaceSession(session.id).startedAt)];
    },
    async getTelemetry() {
      return [
        killEvent("account-1", "enemy", 1, 9),
        killEvent("enemy", "account-2", 9, 1),
        killEvent("account-3", "enemy-2", 2, 8),
      ];
    },
  };
  const sheets = {
    async initializeRace(startedSession, members) {
      assert.equal(startedSession.mode, "2v2");
      assert.equal(members.length, 4);
    },
    async writeTeamMatch(startedSession, row) {
      sheetWrites.push({ startedSession, row });
    },
  };
  const service = new KillRaceService({ pubgApi, repository, sheets });

  await service.startSession(session.id);
  phase = "playing";
  const firstSync = await service.syncSession(session.id);
  const secondSync = await service.syncSession(session.id);

  assert.equal(firstSync.addedMatches, 2);
  assert.equal(secondSync.addedMatches, 0);
  assert.equal(sheetWrites.length, 2);
  assert.deepEqual(
    sheetWrites.map(({ row }) => [row.teamKey, row.roundNumber]),
    [
      ["A", 1],
      ["B", 1],
    ],
  );
  assert.equal(firstSync.summary.teams[0].score, -1);
  assert.equal(firstSync.summary.teams[1].score, 1);
  repository.close();
});

function raceMember(discordUserId, accountId, displayName) {
  return {
    discordUserId,
    accountId,
    displayName,
    playerName: displayName,
  };
}

function rawMatch(createdAt) {
  return {
    data: {
      id: "new-match",
      attributes: {
        createdAt,
        gameMode: "squad",
        mapName: "Savage_Main",
      },
    },
    included: [
      participant("account-1", 3, "alive"),
      participant("account-2", 3, "byplayer"),
      participant("account-3", 4, "alive"),
      participant("account-4", 4, "alive"),
    ],
  };
}

function participant(playerId, winPlace, deathType) {
  return {
    type: "participant",
    attributes: { stats: { playerId, winPlace, deathType } },
  };
}

function killEvent(killerId, victimId, killerTeamId, victimTeamId) {
  return {
    _T: "LogPlayerKillV2",
    _D: new Date().toISOString(),
    killer: { accountId: killerId, teamId: killerTeamId },
    victim: { accountId: victimId, teamId: victimTeamId },
    victimGameResult: { teamId: victimTeamId },
    killerDamageInfo: { damageCauserName: "WeapM416_C" },
  };
}
