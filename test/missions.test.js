import test from "node:test";
import assert from "node:assert/strict";
import {
  MISSION_POOL,
  buildMissionReport,
  evaluatePartyMissions,
  getMissionDefinition,
  selectPartyMissions,
} from "../src/missions.js";

test("29개 통합 풀에서 TEAM 2개, PERSONAL 4개를 중복 없이 선정한다", () => {
  let value = 0;
  const selected = selectPartyMissions({
    random: () => (value += 0.01),
  });

  assert.equal(MISSION_POOL.length, 29);
  assert.equal(MISSION_POOL.filter((mission) => mission.scope === "team").length, 9);
  assert.equal(MISSION_POOL.filter((mission) => mission.scope === "personal").length, 20);
  assert.equal(selected.length, 6);
  assert.equal(selected.filter((mission) => mission.scope === "team").length, 2);
  assert.equal(selected.filter((mission) => mission.scope === "personal").length, 4);
  assert.equal(new Set(selected.map((mission) => mission.key)).size, 6);
  assert.equal(selected.some((mission) => /squad-breaker/i.test(mission.key)), false);
});

test("최근 두 파티 미션과 같은 계열 미션을 우선 제외한다", () => {
  let value = 0;
  const selected = selectPartyMissions({
    random: () => (value += 0.01),
    excludedKeys: [
      "team-all-four-kill",
      "team-four-alive-win",
      "personal-7-kills",
      "personal-300m-kill",
      "personal-1000-damage",
      "personal-panzer-warhead-kill",
    ],
  });

  assert.equal(
    selected.some((mission) =>
      [
        "team-all-four-kill",
        "team-four-alive-win",
        "personal-7-kills",
        "personal-300m-kill",
        "personal-1000-damage",
        "personal-panzer-warhead-kill",
      ].includes(mission.key),
    ),
    false,
  );
  assert.equal(
    selected.some((mission) =>
      [
        "all-kills",
        "survival",
        "high-kills",
        "long-range",
        "high-damage",
        "panzer",
      ].includes(mission.family),
    ),
    false,
  );
  assert.equal(new Set(selected.map((mission) => mission.family)).size, 6);
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
    ["personal-panzer-warhead-kill", "PanzerFaust100M_Projectile_C", "Damage_Explosion_PanzerFaustWarhead"],
    ["personal-mortar-kill", "Mortar_Projectile_C", "Damage_Explosion_Mortar"],
    ["personal-crossbow-kill", "WeapCrossbow_1_C", "Damage_Gun"],
    ["personal-pan-melee-kill", "WeapPan_C", "Damage_Melee"],
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

test("추가된 TEAM 미션은 네 명 모두가 조건을 충족한 경기에서 성공한다", () => {
  const missions = [
    "team-all-four-two-kills",
    "team-all-four-500-damage",
    "team-20-kills",
    "team-3000-damage",
    "team-all-four-assist",
  ].map(selectedMission);
  const match = partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
    player("user-1", { kills: 5, damage: 750, assists: 1 }),
    player("user-2", { kills: 5, damage: 750, assists: 1 }),
    player("user-3", { kills: 5, damage: 750, assists: 1 }),
    player("user-4", { kills: 5, damage: 750, assists: 1 }),
  ]);

  const completions = evaluatePartyMissions(missions, [match]);

  assert.equal(completions.length, 20);
  assert.equal(new Set(completions.map((item) => item.missionKey)).size, 5);
});

test("새로운 단일 킬 PERSONAL 미션을 피해 유형별로 구분한다", () => {
  const cases = [
    ["personal-punch-kill", "PlayerMale_A_C", "Damage_Punch"],
    ["personal-thrown-pan-kill", "WeapPanProjectile_C", "Damage_MeleeThrow"],
    [
      "personal-panzer-backblast-kill",
      "PanzerFaust100M_Projectile_C",
      "Damage_Explosion_PanzerFaustBackBlast",
    ],
    ["personal-roadkill", "Dacia_A_01_v2_C", "Damage_VehicleHit"],
    [
      "personal-vehicle-explosion-kill",
      "Dacia_A_01_v2_C",
      "Damage_Explosion_Vehicle",
    ],
    ["personal-c4-kill", "ProjC4_C", "Damage_Explosion_C4"],
    [
      "personal-bluezone-grenade-kill",
      "Bluezonebomb_EffectActor_C",
      "Damage_BlueZoneGrenade",
    ],
  ];

  for (const [missionKey, damageCauserName, damageTypeCategory] of cases) {
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

test("플레어건·첫 총·보급 무기·차량 탑승·불장난 미션을 판정한다", () => {
  const akmKill = {
    weaponKey: "ak47",
    damageCauserName: "WeapAK47_C",
    damageTypeCategory: "Damage_Gun",
  };
  const awmKill = {
    weaponKey: "awm",
    damageCauserName: "WeapAWM_C",
    damageTypeCategory: "Damage_Gun",
  };
  const vehicleKill = {
    ...akmKill,
    isAttackerInVehicle: true,
  };
  const molotovKill = {
    damageCauserName: "BP_MolotovFireDebuff_C",
    damageTypeCategory: "Damage_Molotov",
  };
  const match = partyMatch("match-1", "2026-08-23T01:00:00.000Z", [
    player("user-1", {
      flareGunUses: 1,
      firstFirearmKey: "ak47",
      carePackageWeaponKeys: ["awm"],
      killEvents: [
        akmKill,
        akmKill,
        akmKill,
        awmKill,
        awmKill,
        awmKill,
        vehicleKill,
        vehicleKill,
        molotovKill,
        molotovKill,
      ],
    }),
  ]);
  const missions = [
    "personal-use-flare-gun",
    "personal-first-firearm-three-kills",
    "personal-care-package-weapon-three-kills",
    "personal-in-vehicle-two-kills",
    "personal-two-molotov-kills",
  ].map(selectedMission);

  const completions = evaluatePartyMissions(missions, [match]);

  assert.equal(completions.length, 5);
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
  assert.equal(
    MISSION_POOL.some((mission) =>
      /부활|헤드샷|더블 캐리|서로 다른 무기/.test(
        `${mission.name} ${mission.description}`,
      ),
    ),
    false,
  );
  assert.equal(
    MISSION_POOL.some((mission) => /squad-breaker/i.test(mission.key)),
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
    assists = 0,
    deaths = 1,
    placement = 5,
    longestKill = 0,
    squadBreakerCount = 0,
    killEvents = [],
    flareGunUses = 0,
    firstFirearmKey,
    carePackageWeaponKeys = [],
  } = {},
) {
  return {
    discordUserId,
    kills,
    damage,
    assists,
    deaths,
    placement,
    longestKill,
    squadBreakerCount,
    killEvents,
    flareGunUses,
    firstFirearmKey,
    carePackageWeaponKeys,
  };
}
