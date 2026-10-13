const TEAM_MISSIONS = [
  mission({
    key: "team-all-four-kill",
    family: "all-kills",
    name: "전원 1킬",
    description: "한 경기에서 파티원 4명 모두 1킬 이상",
    rewardPoints: 80,
    evaluateMatch: (match) => hasFourPlayers(match, (player) => player.kills >= 1),
  }),
  mission({
    key: "team-four-alive-win",
    family: "survival",
    name: "전원 생존 치킨",
    description: "한 경기에서 파티원 4명 모두 생존한 상태로 치킨",
    rewardPoints: 150,
    evaluateMatch: (match) =>
      hasFourPlayers(
        match,
        (player) => player.placement === 1 && player.deaths === 0,
      ),
  }),
  mission({
    key: "team-12-kills",
    family: "team-kills",
    name: "팀 12킬",
    description: "한 경기에서 파티 합계 12킬 이상",
    rewardPoints: 100,
    evaluateMatch: (match) => sum(match.players, "kills") >= 12,
  }),
  mission({
    key: "team-2000-damage",
    family: "team-damage",
    name: "팀 2,000딜",
    description: "한 경기에서 파티 합계 2,000딜 이상",
    rewardPoints: 90,
    evaluateMatch: (match) => sum(match.players, "damage") >= 2_000,
  }),
  mission({
    key: "team-all-four-two-kills",
    family: "all-kills",
    name: "전원 2킬",
    description: "한 경기에서 파티원 4명 모두 2킬 이상",
    rewardPoints: 140,
    evaluateMatch: (match) => hasFourPlayers(match, (player) => player.kills >= 2),
  }),
  mission({
    key: "team-all-four-500-damage",
    family: "all-damage",
    name: "전원 500딜",
    description: "한 경기에서 파티원 4명 모두 500딜 이상",
    rewardPoints: 170,
    evaluateMatch: (match) => hasFourPlayers(match, (player) => player.damage >= 500),
  }),
  mission({
    key: "team-20-kills",
    family: "team-kills",
    name: "팀 20킬",
    description: "한 경기에서 파티 합계 20킬 이상",
    rewardPoints: 200,
    evaluateMatch: (match) => sum(match.players, "kills") >= 20,
  }),
  mission({
    key: "team-3000-damage",
    family: "team-damage",
    name: "팀 3,000딜",
    description: "한 경기에서 파티 합계 3,000딜 이상",
    rewardPoints: 180,
    evaluateMatch: (match) => sum(match.players, "damage") >= 3_000,
  }),
  mission({
    key: "team-all-four-assist",
    family: "all-assists",
    name: "전원 도움",
    description: "한 경기에서 파티원 4명 모두 도움 1회 이상",
    rewardPoints: 110,
    evaluateMatch: (match) => hasFourPlayers(match, (player) => player.assists >= 1),
  }),
];

const PERSONAL_MISSIONS = [
  personalMission({
    key: "personal-7-kills",
    family: "high-kills",
    name: "개인 7킬",
    description: "한 경기에서 개인 7킬 이상",
    rewardPoints: 120,
    evaluatePlayer: (_match, player) => player.kills >= 7,
  }),
  personalMission({
    key: "personal-300m-kill",
    family: "long-range",
    name: "300m 장거리 킬",
    description: "한 경기에서 300m 이상 거리의 킬 달성",
    rewardPoints: 110,
    evaluatePlayer: (_match, player) => player.longestKill >= 300,
  }),
  personalMission({
    key: "personal-1000-damage",
    family: "high-damage",
    name: "개인 1,000딜",
    description: "한 경기에서 개인 피해량 1,000 이상",
    rewardPoints: 120,
    evaluatePlayer: (_match, player) => player.damage >= 1_000,
  }),
  weaponMission({
    key: "personal-panzer-warhead-kill",
    family: "panzer",
    name: "판처파우스트 탄두 킬",
    description: "판처파우스트 탄두 폭발로 적 처치",
    rewardPoints: 160,
    damageCausers: ["PanzerFaust100M_Projectile_C", "WeapPanzerFaust100M1_C"],
    damageTypes: [
      "Damage_Explosion_PanzerFaustWarhead",
      "Damage_Explosion_PanzerFaustWarheadVehicleArmorPenetration",
    ],
  }),
  weaponMission({
    key: "personal-mortar-kill",
    family: "mortar",
    name: "박격포 킬",
    description: "박격포로 적 처치",
    rewardPoints: 180,
    damageCausers: ["Mortar_Projectile_C"],
    damageTypes: ["Damage_Explosion_Mortar"],
  }),
  weaponMission({
    key: "personal-crossbow-kill",
    family: "crossbow",
    name: "석궁 킬",
    description: "석궁으로 적 처치",
    rewardPoints: 140,
    damageCausers: ["WeapCrossbow_1_C"],
  }),
  weaponMission({
    key: "personal-pan-melee-kill",
    family: "pan",
    name: "프라이팬 근접 킬",
    description: "프라이팬 근접 공격으로 적 처치",
    rewardPoints: 180,
    damageCausers: ["WeapPan_C"],
  }),
  personalMission({
    key: "personal-two-grenade-kills",
    family: "frag-grenade",
    name: "수류탄 2킬",
    description: "한 경기에서 수류탄으로 2킬 이상",
    rewardPoints: 130,
    evaluatePlayer: (_match, player) =>
      countWeaponKills(player, ["ProjGrenade_C"], ["Damage_Explosion_Grenade"]) >= 2,
  }),
  personalMission({
    key: "personal-use-flare-gun",
    family: "flare-gun",
    name: "플레어건 사용",
    description: "한 경기에서 플레어건 실제 발사",
    rewardPoints: 200,
    evaluatePlayer: (_match, player) => player.flareGunUses >= 1,
  }),
  personalMission({
    key: "personal-first-firearm-three-kills",
    family: "first-firearm",
    name: "첫 총으로 3킬",
    description: "낙하 후 처음 주운 총기 종류로 한 경기 3킬",
    rewardPoints: 200,
    evaluatePlayer: (_match, player) =>
      Boolean(player.firstFirearmKey) &&
      countKills(player, (kill) => kill.weaponKey === player.firstFirearmKey) >= 3,
  }),
  weaponMission({
    key: "personal-punch-kill",
    family: "punch",
    name: "원펀맨",
    description: "주먹으로 적 처치",
    rewardPoints: 220,
    damageTypes: ["Damage_Punch"],
  }),
  weaponMission({
    key: "personal-thrown-pan-kill",
    family: "pan",
    name: "프라이팬 투척 킬",
    description: "던진 프라이팬으로 적 처치",
    rewardPoints: 250,
    damageCausers: ["WeapPanProjectile_C"],
  }),
  weaponMission({
    key: "personal-panzer-backblast-kill",
    family: "panzer",
    name: "판처파우스트 후폭풍 킬",
    description: "판처파우스트 후폭풍으로 적 처치",
    rewardPoints: 250,
    damageTypes: ["Damage_Explosion_PanzerFaustBackBlast"],
  }),
  weaponMission({
    key: "personal-roadkill",
    family: "vehicle-kill",
    name: "로드킬",
    description: "주행 중인 차량으로 적 처치",
    rewardPoints: 180,
    damageTypes: ["Damage_VehicleHit"],
  }),
  weaponMission({
    key: "personal-vehicle-explosion-kill",
    family: "vehicle-kill",
    name: "차량 폭발 킬",
    description: "차량 폭발로 적 처치",
    rewardPoints: 220,
    damageTypes: ["Damage_Explosion_Vehicle"],
  }),
  weaponMission({
    key: "personal-c4-kill",
    family: "c4",
    name: "C4 킬",
    description: "C4 폭발로 적 처치",
    rewardPoints: 220,
    damageCausers: ["ProjC4_C"],
    damageTypes: ["Damage_Explosion_C4"],
  }),
  personalMission({
    key: "personal-two-molotov-kills",
    family: "molotov",
    name: "불장난",
    description: "한 경기에서 화염병으로 2킬 이상",
    rewardPoints: 180,
    evaluatePlayer: (_match, player) =>
      countWeaponKills(
        player,
        ["ProjMolotov_C", "BP_MolotovFireDebuff_C"],
        ["Damage_Molotov"],
      ) >= 2,
  }),
  weaponMission({
    key: "personal-bluezone-grenade-kill",
    family: "bluezone-grenade",
    name: "블루존 수류탄 킬",
    description: "블루존 수류탄으로 적 처치",
    rewardPoints: 180,
    damageCausers: ["Bluezonebomb_EffectActor_C"],
    damageTypes: ["Damage_BlueZoneGrenade"],
  }),
  personalMission({
    key: "personal-care-package-weapon-three-kills",
    family: "care-package",
    name: "보급 무기로 3킬",
    description: "직접 주운 보급 무기로 한 경기 3킬",
    rewardPoints: 200,
    evaluatePlayer: (_match, player) => {
      const carePackageWeapons = new Set(player.carePackageWeaponKeys ?? []);
      return countKills(player, (kill) => carePackageWeapons.has(kill.weaponKey)) >= 3;
    },
  }),
  personalMission({
    key: "personal-in-vehicle-two-kills",
    family: "vehicle-shooting",
    name: "차량 탑승 중 2킬",
    description: "차량에 탄 상태로 총기를 사용해 한 경기 2킬",
    rewardPoints: 200,
    evaluatePlayer: (_match, player) =>
      countKills(
        player,
        (kill) =>
          kill.isAttackerInVehicle && kill.damageTypeCategory === "Damage_Gun",
      ) >= 2,
  }),
];

export const MISSION_POOL = Object.freeze([
  ...TEAM_MISSIONS,
  ...PERSONAL_MISSIONS,
]);

const MISSION_BY_KEY = new Map(MISSION_POOL.map((item) => [item.key, item]));

export function selectPartyMissions({
  random = Math.random,
  excludedKeys = [],
} = {}) {
  const excluded = new Set(excludedKeys);
  return [
    ...sampleMissions(TEAM_MISSIONS, 2, random, excluded),
    ...sampleMissions(PERSONAL_MISSIONS, 4, random, excluded),
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
  return Object.freeze({ scope: "team", ...definition });
}

function personalMission(definition) {
  return mission({ ...definition, scope: "personal" });
}

function weaponMission({ damageCausers = [], damageTypes = [], ...definition }) {
  return personalMission({
    ...definition,
    evaluatePlayer: (_match, player) =>
      countWeaponKills(player, damageCausers, damageTypes) >= 1,
  });
}

function countWeaponKills(player, damageCausers, damageTypes) {
  const causers = new Set(damageCausers);
  const types = new Set(damageTypes);

  return countKills(
    player,
    (kill) =>
      causers.has(kill.damageCauserName) ||
      types.has(kill.damageTypeCategory),
  );
}

function countKills(player, predicate) {
  return (player.killEvents ?? []).filter(predicate).length;
}

function hasFourPlayers(match, predicate) {
  return match.players.length === 4 && match.players.every(predicate);
}

function sum(players, key) {
  return players.reduce((total, player) => total + Number(player[key] ?? 0), 0);
}

function sampleMissions(items, count, random, excludedKeys) {
  const excludedFamilies = new Set(
    items
      .filter((item) => excludedKeys.has(item.key))
      .map((item) => item.family),
  );
  const ordered = [
    ...shuffle(
      items.filter(
        (item) =>
          !excludedKeys.has(item.key) &&
          !excludedFamilies.has(item.family),
      ),
      random,
    ),
    ...shuffle(
      items.filter(
        (item) =>
          !excludedKeys.has(item.key) &&
          excludedFamilies.has(item.family),
      ),
      random,
    ),
    ...shuffle(items.filter((item) => excludedKeys.has(item.key)), random),
  ];
  const selected = [];
  const selectedFamilies = new Set();

  for (const item of ordered) {
    if (selected.length >= count) {
      break;
    }

    if (!selectedFamilies.has(item.family)) {
      selected.push(item);
      selectedFamilies.add(item.family);
    }
  }

  for (const item of ordered) {
    if (selected.length >= count) {
      break;
    }

    if (!selected.includes(item)) {
      selected.push(item);
    }
  }

  return selected;
}

function shuffle(items, random) {
  return items
    .map((item, index) => ({ item, index, order: random() }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(({ item }) => item);
}
