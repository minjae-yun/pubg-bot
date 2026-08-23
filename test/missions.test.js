import test from "node:test";
import assert from "node:assert/strict";
import {
  MISSION_POOL,
  buildMissionReport,
  evaluatePartyMissions,
  getMissionDefinition,
  selectPartyMissions,
} from "../src/missions.js";

test("파티마다 TEAM 2개, PERSONAL 4개를 중복 없이 선정한다", () => {
  let value = 0;
  const selected = selectPartyMissions({
    random: () => (value += 0.01),
  });

  assert.equal(selected.length, 6);
  assert.equal(selected.filter((mission) => mission.scope === "team").length, 2);
  assert.equal(selected.filter((mission) => mission.scope === "personal").length, 4);
  assert.equal(selected.filter((mission) => mission.category === "special").length, 1);
  assert.equal(new Set(selected.map((mission) => mission.key)).size, 6);
  assert.equal(selected.some((mission) => /headshot|revive/i.test(mission.key)), false);
});

test("TEAM 미션은 최초 성공 경기의 참가자 전원에게 완료 기록을 만든다", () => {
  const mission = selectedMission("team-12-kills");
  const matches = [
    partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
      player("user-1", { kills: 4 }),
      player("user-2", { kills: 3 }),
      player("user-3", { kills: 3 }),
      player("user-4", { kills: 2 }),
    ]),
    partyMatch("match-2", "2026-08-23T02:00:00.000Z", [
      player("user-1", { kills: 5 }),
      player("user-2", { kills: 4 }),
      player("user-3", { kills: 2 }),
      player("user-4", { kills: 1 }),
    ]),
  ];

  const completions = evaluatePartyMissions([mission], matches);

  assert.equal(completions.length, 4);
  assert.ok(completions.every((completion) => completion.matchId === "match-1"));
});

test("전원 생존 치킨은 우승했어도 죽은 파티원이 있으면 실패한다", () => {
  const mission = selectedMission("team-four-alive-win");
  const deadWinnerMatch = partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
    player("user-1", { placement: 1, deaths: 0 }),
    player("user-2", { placement: 1, deaths: 0 }),
    player("user-3", { placement: 1, deaths: 0 }),
    player("user-4", { placement: 1, deaths: 1 }),
  ]);
  const allAliveMatch = partyMatch("match-2", "2026-08-23T02:00:00.000Z", [
    player("user-1", { placement: 1, deaths: 0 }),
    player("user-2", { placement: 1, deaths: 0 }),
    player("user-3", { placement: 1, deaths: 0 }),
    player("user-4", { placement: 1, deaths: 0 }),
  ]);

  assert.deepEqual(evaluatePartyMissions([mission], [deadWinnerMatch]), []);
  assert.equal(evaluatePartyMissions([mission], [allAliveMatch]).length, 4);
});

test("PERSONAL 미션은 플레이어마다 최초 성공 경기 한 번만 인정한다", () => {
  const mission = selectedMission("personal-7-kills");
  const matches = [
    partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
      player("user-1", { kills: 7 }),
      player("user-2", { kills: 2 }),
    ]),
    partyMatch("match-2", "2026-08-23T02:00:00.000Z", [
      player("user-1", { kills: 8 }),
      player("user-2", { kills: 7 }),
    ]),
  ];

  assert.deepEqual(evaluatePartyMissions([mission], matches), [
    {
      missionKey: "personal-7-kills",
      discordUserId: "user-1",
      matchId: "match-1",
    },
    {
      missionKey: "personal-7-kills",
      discordUserId: "user-2",
      matchId: "match-2",
    },
  ]);
});

test("공식 텔레메트리 무기 식별자로 특수 무기 미션을 판정한다", () => {
  const missionKeysAndKills = [
    ["personal-panzer-kill", "PanzerFaust100M_Projectile_C", "Damage_Explosion_PanzerFaustWarhead"],
    ["personal-mortar-kill", "Mortar_Projectile_C", "Damage_Explosion_Mortar"],
    ["personal-crossbow-kill", "WeapCrossbow_1_C", "Damage_Gun"],
    ["personal-pan-kill", "WeapPan_C", "Damage_Melee"],
  ];

  for (const [missionKey, damageCauserName, damageTypeCategory] of missionKeysAndKills) {
    const match = partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
      player("user-1", {
        killEvents: [{ damageCauserName, damageTypeCategory }],
      }),
    ]);

    assert.equal(
      evaluatePartyMissions([selectedMission(missionKey)], [match]).length,
      1,
      missionKey,
    );
  }
});

test("수류탄 2킬은 같은 경기 안에서 달성해야 한다", () => {
  const mission = selectedMission("personal-two-grenade-kills");
  const oneGrenadeKill = {
    damageCauserName: "ProjGrenade_C",
    damageTypeCategory: "Damage_Explosion_Grenade",
  };
  const splitMatches = [
    partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
      player("user-1", { killEvents: [oneGrenadeKill] }),
    ]),
    partyMatch("match-2", "2026-08-23T02:00:00.000Z", [
      player("user-1", { killEvents: [oneGrenadeKill] }),
    ]),
  ];
  const completedMatch = partyMatch("match-3", "2026-08-23T03:00:00.000Z", [
    player("user-1", { killEvents: [oneGrenadeKill, oneGrenadeKill] }),
  ]);

  assert.deepEqual(evaluatePartyMissions([mission], splitMatches), []);
  assert.equal(evaluatePartyMissions([mission], [completedMatch]).length, 1);
});

test("누적 포인트가 같은 플레이어는 미션 포인트 공동 1위가 된다", () => {
  const selected = [
    selectedMission("personal-7-kills"),
    selectedMission("personal-300m-kill"),
  ];
  const members = [
    { discordUserId: "user-1", playerName: "One" },
    { discordUserId: "user-2", playerName: "Two" },
    { discordUserId: "user-3", playerName: "Three" },
  ];
  const completions = [
    { missionKey: "personal-7-kills", discordUserId: "user-1" },
    { missionKey: "personal-7-kills", discordUserId: "user-2" },
  ];

  const report = buildMissionReport(selected, completions, members);

  assert.deepEqual(
    report.leaders.map((leader) => leader.discordUserId),
    ["user-1", "user-2"],
  );
  assert.equal(report.leaders[0].points, 120);
  assert.equal(report.ranking[2].points, 0);
});

test("미션 풀에는 합의에서 제외한 부활·헤드샷 미션이 없다", () => {
  assert.ok(MISSION_POOL.length >= 10);
  assert.equal(
    MISSION_POOL.some((mission) => /부활|헤드샷/.test(`${mission.name} ${mission.description}`)),
    false,
  );
});

function selectedMission(key) {
  const definition = getMissionDefinition(key);
  return {
    key: definition.key,
    scope: definition.scope,
    rewardPoints: definition.rewardPoints,
  };
}

function partyMatch(matchId, createdAt, players) {
  return { matchId, createdAt, players };
}

function player(
  discordUserId,
  {
    kills = 0,
    damage = 0,
    deaths = 1,
    placement = 5,
    longestKill = 0,
    squadBreakerCount = 0,
    killEvents = [],
  } = {},
) {
  return {
    discordUserId,
    kills,
    damage,
    deaths,
    placement,
    longestKill,
    squadBreakerCount,
    killEvents,
  };
}
