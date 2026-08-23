import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPartyReport,
  collectCandidateMatchIds,
  extractPartyMatch,
} from "../src/party-stats.js";

const members = [
  { discordUserId: "user-1", accountId: "account-1", playerName: "PlayerOne" },
  { discordUserId: "user-2", accountId: "account-2", playerName: "PlayerTwo" },
];

test("두 명 이상이 공유하는 매치 ID만 결산 후보로 고른다", () => {
  const players = [
    { accountId: "account-1", matchIds: ["shared", "one-only"] },
    { accountId: "account-2", matchIds: ["shared", "two-only"] },
  ];

  assert.deepEqual(collectCandidateMatchIds(players), ["shared"]);
});

test("파티 시작 이후 매치에서 멤버 기록과 어워드를 계산한다", () => {
  const match = {
    data: {
      id: "match-1",
      attributes: {
        createdAt: "2026-07-23T12:10:00.000Z",
        gameMode: "squad-fpp",
        mapName: "Baltic_Main",
      },
    },
    included: [
      {
        type: "participant",
        attributes: {
          stats: {
            playerId: "account-1",
            name: "PlayerOne",
            kills: 2,
            damageDealt: 400,
            assists: 1,
            revives: 0,
            headshotKills: 1,
            teamKills: 0,
            deathType: "byplayer",
            winPlace: 2,
            timeSurvived: 1200,
          },
        },
      },
      {
        type: "participant",
        attributes: {
          stats: {
            playerId: "account-2",
            name: "PlayerTwo",
            kills: 0,
            damageDealt: 200,
            assists: 2,
            revives: 0,
            headshotKills: 0,
            teamKills: 0,
            deathType: "byplayer",
            winPlace: 2,
            timeSurvived: 1500,
          },
        },
      },
    ],
  };

  const extracted = extractPartyMatch(
    match,
    members,
    "2026-07-23T12:00:00.000Z",
    new Date("2026-07-23T13:00:00.000Z"),
  );
  const report = buildPartyReport([extracted], members);

  assert.equal(report.matches, 1);
  assert.equal(report.bestPlacement, 2);
  assert.equal(report.totalKills, 2);
  assert.equal(report.averageTeamDamage, 600);
  assert.equal(report.awards.ace.discordUserId, "user-1");
  assert.deepEqual(report.awards.squadBreaker, []);
  assert.deepEqual(
    report.awards.trolls.map((player) => player.discordUserId),
    ["user-2"],
  );
  assert.match(report.awards.trolls[0].trollReasons[0], /팀 내 최저/);
});

test("팀킬한 사람이 여러 명이면 모두 공동 인간쓰레기로 선정한다", () => {
  const squadMembers = [
    ...members,
    { discordUserId: "user-3", accountId: "account-3", playerName: "PlayerThree" },
    { discordUserId: "user-4", accountId: "account-4", playerName: "PlayerFour" },
  ];
  const match = {
    bestPlacement: 3,
    players: [
      partyPlayer("user-1", { kills: 5, assists: 2, damage: 500, friendlyKills: 1 }),
      partyPlayer("user-2", { kills: 4, damage: 400, friendlyKills: 2 }),
      partyPlayer("user-3", { kills: 3, damage: 300 }),
      partyPlayer("user-4", { kills: 2, damage: 250 }),
    ],
  };

  const report = buildPartyReport([match], squadMembers);

  assert.deepEqual(
    report.awards.trolls.map((player) => player.discordUserId),
    ["user-1", "user-2"],
  );
  assert.deepEqual(
    report.awards.trolls.map((player) => player.trollReasons[0]),
    ["팀킬 1회", "팀킬 2회"],
  );
});

test("팀 평균 기여도의 절반 이하인 플레이어를 인간쓰레기로 선정한다", () => {
  const match = {
    bestPlacement: 5,
    players: [
      partyPlayer("user-1", { kills: 4, assists: 2, damage: 600 }),
      partyPlayer("user-2", { kills: 0, assists: 0, damage: 20 }),
    ],
  };

  const report = buildPartyReport([match], members);

  assert.equal(report.awards.trolls.length, 1);
  assert.equal(report.awards.trolls[0].discordUserId, "user-2");
  assert.match(report.awards.trolls[0].trollReasons[0], /인분/);
});

test("ACE와 오늘의 씹쓰레기는 중복 수상할 수 있다", () => {
  const match = {
    bestPlacement: 2,
    players: [
      partyPlayer("user-1", {
        kills: 2,
        assists: 1,
        damage: 300,
        deaths: 0,
        friendlyKnocks: 1,
      }),
      partyPlayer("user-2", {
        kills: 2,
        assists: 1,
        damage: 300,
        deaths: 1,
      }),
    ],
  };

  const report = buildPartyReport([match], members);

  assert.equal(report.awards.trolls[0].discordUserId, "user-1");
  assert.equal(report.awards.trolls[0].trollReasons[0], "아군 기절 1회");
  assert.equal(report.awards.ace.discordUserId, "user-1");
});

test("ACE는 평균 딜, 평균 킬, 평균 도움만으로 계산한다", () => {
  const match = {
    bestPlacement: 5,
    players: [
      partyPlayer("user-1", { damage: 300, revives: 0 }),
      partyPlayer("user-2", { damage: 200, revives: 10 }),
    ],
  };

  const report = buildPartyReport([match], members);

  assert.equal(report.awards.ace.discordUserId, "user-1");
  assert.equal(report.players[0].contributionScore, 300);
  assert.equal(report.players[1].contributionScore, 200);
});

test("파티 전체 경기의 최고 동일 스쿼드 처치 기록으로 공동 수상자를 정한다", () => {
  const matches = [
    {
      matchId: "match-1",
      bestPlacement: 5,
      players: [
        partyPlayer("user-1", { squadBreakerCount: 3 }),
        partyPlayer("user-2", { squadBreakerCount: 2 }),
      ],
    },
    {
      matchId: "match-2",
      bestPlacement: 4,
      players: [
        partyPlayer("user-1", { squadBreakerCount: 1 }),
        partyPlayer("user-2", { squadBreakerCount: 3 }),
      ],
    },
  ];

  const report = buildPartyReport(matches, members);

  assert.deepEqual(
    report.awards.squadBreaker.map((player) => player.discordUserId),
    ["user-1", "user-2"],
  );
  assert.equal(report.players[0].squadBreakerCount, 3);
  assert.equal(report.players[0].squadBreakerMatchId, "match-1");
  assert.equal(report.players[1].squadBreakerMatchId, "match-2");
});

test("동일 적 스쿼드 최고 기록이 1명이면 SQUAD BREAKER를 숨긴다", () => {
  const match = {
    matchId: "match-1",
    bestPlacement: 5,
    players: [
      partyPlayer("user-1", { squadBreakerCount: 1 }),
      partyPlayer("user-2", { squadBreakerCount: 0 }),
    ],
  };

  assert.deepEqual(buildPartyReport([match], members).awards.squadBreaker, []);
});

test("파티 시작 전 매치는 제외한다", () => {
  const match = {
    data: { attributes: { createdAt: "2026-07-23T11:59:00.000Z" } },
    included: [],
  };

  assert.equal(
    extractPartyMatch(
      match,
      members,
      "2026-07-23T12:00:00.000Z",
      new Date("2026-07-23T13:00:00.000Z"),
    ),
    null,
  );
});

function partyPlayer(
  discordUserId,
  {
    kills = 0,
    damage = 0,
    assists = 0,
    revives = 0,
    friendlyKills = 0,
    friendlyKnocks = 0,
    deaths = 1,
    squadBreakerCount = 0,
  } = {},
) {
  return {
    discordUserId,
    kills,
    damage,
    assists,
    revives,
    friendlyKills,
    friendlyKnocks,
    deaths,
    squadBreakerCount,
    headshotKills: 0,
    placement: 5,
    survivalSeconds: 1000,
  };
}
