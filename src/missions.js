const TEAM_MISSIONS = [
  mission({
    key: "team-all-four-kill",
    scope: "team",
    name: "전원 1킬",
    description: "한 경기에서 파티원 4명 모두 1킬 이상",
    rewardPoints: 80,
    evaluateMatch: (match) =>
      match.players.length === 4 && match.players.every((player) => player.kills >= 1),
  }),
  mission({
    key: "team-four-alive-win",
    scope: "team",
    name: "전원 생존 치킨",
    description: "한 경기에서 파티원 4명 모두 생존한 상태로 치킨",
    rewardPoints: 150,
    evaluateMatch: (match) =>
      match.players.length === 4 &&
      match.players.every((player) => player.placement === 1 && player.deaths === 0),
  }),
  mission({
    key: "team-12-kills",
    scope: "team",
    name: "팀 12킬",
    description: "한 경기에서 파티 합계 12킬 이상",
    rewardPoints: 100,
    evaluateMatch: (match) => sum(match.players, "kills") >= 12,
  }),
  mission({
    key: "team-2000-damage",
    scope: "team",
    name: "팀 2,000딜",
    description: "한 경기에서 파티 합계 2,000딜 이상",
    rewardPoints: 90,
    evaluateMatch: (match) => sum(match.players, "damage") >= 2_000,
  }),
];

const PERFORMANCE_MISSIONS = [
  mission({
    key: "personal-7-kills",
    scope: "personal",
    category: "performance",
    name: "개인 7킬",
    description: "한 경기에서 개인 7킬 이상",
    rewardPoints: 120,
    evaluatePlayer: (_match, player) => player.kills >= 7,
  }),
  mission({
    key: "personal-squad-breaker-3",
    scope: "personal",
    category: "performance",
    name: "스쿼드 브레이크",
    description: "한 경기에서 동일 적 스쿼드 3명 이상 처치",
    rewardPoints: 140,
    evaluatePlayer: (_match, player) => player.squadBreakerCount >= 3,
  }),
  mission({
    key: "personal-300m-kill",
    scope: "personal",
    category: "performance",
    name: "300m 장거리 킬",
    description: "한 경기에서 300m 이상 거리의 킬 달성",
    rewardPoints: 110,
    evaluatePlayer: (_match, player) => player.longestKill >= 300,
  }),
  mission({
    key: "personal-1000-damage",
    scope: "personal",
    category: "performance",
    name: "개인 1,000딜",
    description: "한 경기에서 개인 피해량 1,000 이상",
    rewardPoints: 120,
    evaluatePlayer: (_match, player) => player.damage >= 1_000,
  }),
];

const SPECIAL_WEAPON_MISSIONS = [
  weaponMission({
    key: "personal-panzer-kill",
    name: "판처파우스트 킬",
    description: "판처파우스트로 적 처치",
    rewardPoints: 160,
    damageCausers: ["PanzerFaust100M_Projectile_C", "WeapPanzerFaust100M1_C"],
    damageTypes: [
      "Damage_Explosion_PanzerFaustBackBlast",
      "Damage_Explosion_PanzerFaustWarhead",
      "Damage_Explosion_PanzerFaustWarheadVehicleArmorPenetration",
    ],
  }),
  weaponMission({
    key: "personal-mortar-kill",
    name: "박격포 킬",
    description: "박격포로 적 처치",
    rewardPoints: 180,
    damageCausers: ["Mortar_Projectile_C"],
    damageTypes: ["Damage_Explosion_Mortar"],
  }),
  weaponMission({
    key: "personal-crossbow-kill",
    name: "석궁 킬",
    description: "석궁으로 적 처치",
    rewardPoints: 140,
    damageCausers: ["WeapCrossbow_1_C"],
  }),
  weaponMission({
    key: "personal-pan-kill",
    name: "프라이팬 킬",
    description: "프라이팬으로 적 처치",
    rewardPoints: 180,
    damageCausers: ["WeapPan_C", "WeapPanProjectile_C"],
  }),
  mission({
    key: "personal-two-grenade-kills",
    scope: "personal",
    category: "special",
    name: "수류탄 2킬",
    description: "한 경기에서 수류탄으로 2킬 이상",
    rewardPoints: 130,
    evaluatePlayer: (_match, player) =>
      countWeaponKills(player, ["ProjGrenade_C"], ["Damage_Explosion_Grenade"]) >= 2,
  }),
];

export const MISSION_POOL = Object.freeze([
  ...TEAM_MISSIONS,
  ...PERFORMANCE_MISSIONS,
  ...SPECIAL_WEAPON_MISSIONS,
]);

const MISSION_BY_KEY = new Map(MISSION_POOL.map((item) => [item.key, item]));

export function selectPartyMissions({ random = Math.random } = {}) {
  return [
    ...sample(TEAM_MISSIONS, 2, random),
    ...sample(PERFORMANCE_MISSIONS, 3, random),
    ...sample(SPECIAL_WEAPON_MISSIONS, 1, random),
  ];
}

export function getMissionDefinition(key) {
  return MISSION_BY_KEY.get(key);
}

export function evaluatePartyMissions(selectedMissions, matches) {
  const orderedMatches = [...matches].sort((left, right) =>
    String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
  );
  const completions = [];

  for (const selectedMission of selectedMissions) {
    const definition = getMissionDefinition(selectedMission.key);
    if (!definition) {
      continue;
    }

    if (definition.scope === "team") {
      const completedMatch = orderedMatches.find((match) =>
        definition.evaluateMatch(match),
      );

      if (!completedMatch) {
        continue;
      }

      for (const player of completedMatch.players) {
        completions.push({
          missionKey: definition.key,
          discordUserId: player.discordUserId,
          matchId: completedMatch.matchId,
        });
      }
      continue;
    }

    const completedUsers = new Set();
    for (const match of orderedMatches) {
      for (const player of match.players) {
        if (
          !completedUsers.has(player.discordUserId) &&
          definition.evaluatePlayer(match, player)
        ) {
          completedUsers.add(player.discordUserId);
          completions.push({
            missionKey: definition.key,
            discordUserId: player.discordUserId,
            matchId: match.matchId,
          });
        }
      }
    }
  }

  return completions;
}

export function buildMissionReport(selectedMissions, completions, members) {
  const pointsByUser = new Map(
    members.map((member) => [member.discordUserId, 0]),
  );
  const completionsByMission = new Map();
  const missionByKey = new Map(selectedMissions.map((item) => [item.key, item]));

  for (const completion of completions) {
    const selectedMission = missionByKey.get(completion.missionKey);
    if (!selectedMission || !pointsByUser.has(completion.discordUserId)) {
      continue;
    }

    pointsByUser.set(
      completion.discordUserId,
      pointsByUser.get(completion.discordUserId) + selectedMission.rewardPoints,
    );
    const users = completionsByMission.get(completion.missionKey) ?? [];
    users.push(completion.discordUserId);
    completionsByMission.set(completion.missionKey, users);
  }

  const ranking = members
    .map((member) => ({
      discordUserId: member.discordUserId,
      playerName: member.playerName,
      points: pointsByUser.get(member.discordUserId) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        left.discordUserId.localeCompare(right.discordUserId),
    );
  const highestPoints = ranking[0]?.points ?? 0;

  return {
    missions: selectedMissions.map((selectedMission) => {
      const definition = getMissionDefinition(selectedMission.key);
      return {
        ...selectedMission,
        name: definition?.name ?? selectedMission.key,
        description: definition?.description ?? selectedMission.key,
        completedBy: completionsByMission.get(selectedMission.key) ?? [],
      };
    }),
    ranking,
    leaders:
      highestPoints > 0
        ? ranking.filter((player) => player.points === highestPoints)
        : [],
  };
}

function mission(definition) {
  return Object.freeze({ category: "team", ...definition });
}

function weaponMission({ damageCausers = [], damageTypes = [], ...definition }) {
  return mission({
    ...definition,
    scope: "personal",
    category: "special",
    evaluatePlayer: (_match, player) =>
      countWeaponKills(player, damageCausers, damageTypes) >= 1,
  });
}

function countWeaponKills(player, damageCausers, damageTypes) {
  const causers = new Set(damageCausers);
  const types = new Set(damageTypes);

  return (player.killEvents ?? []).filter(
    (kill) =>
      causers.has(kill.damageCauserName) ||
      types.has(kill.damageTypeCategory),
  ).length;
}

function sum(players, key) {
  return players.reduce((total, player) => total + Number(player[key] ?? 0), 0);
}

function sample(items, count, random) {
  return items
    .map((item, index) => ({ item, index, order: random() }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .slice(0, count)
    .map(({ item }) => item);
}
