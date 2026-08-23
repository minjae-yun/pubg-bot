const KILL_EVENT_TYPES = new Set(["LogPlayerKill", "LogPlayerKillV2"]);
const ITEM_PICKUP_EVENT_TYPES = new Set([
  "LogItemPickup",
  "LogItemPickupFromCarepackage",
  "LogItemPickupFromCustomPackage",
  "LogItemPickupFromLootbox",
  "LogItemPickupFromVehicleTrunk",
]);
const FIREARM_SUBCATEGORIES = new Set(["Main", "Handgun"]);
const NON_FIREARM_ITEM_PATTERN =
  /(FlareGun|Crossbow|PanzerFaust|M79|Mortar|Grenade|Molotov|C4|Bluezone|Pan_C|Sickle|Cowbar|Crowbar|Machete|JerryCan|Drone|Detector|Decoy|FlashBang|SmokeBomb|SpikeTrap)/i;
const WEAPON_KEY_ALIASES = new Map([
  ["duncansm416", "hk416"],
  ["duncanshk416", "hk416"],
  ["julieskar98k", "kar98k"],
  ["lunchmeatsak47", "ak47"],
  ["madsqbu88", "qbu88"],
  ["mosin", "mosinnagant"],
  ["win1894", "win94"],
]);

export function countSameSquadKills(events, accountIds) {
  return analyzeTrackedKills(events, accountIds).sameSquadKills;
}

export function analyzeTrackedKills(events, accountIds) {
  const trackedAccounts = new Set(accountIds.filter(Boolean));
  const orderedEvents = orderTelemetryEvents(events);
  const killsByPlayer = createTrackedMap(trackedAccounts, () => []);
  const playerTelemetry = createTrackedMap(trackedAccounts, () => ({
    firstFirearmKey: undefined,
    carePackageWeaponKeys: new Set(),
    flareGunUses: 0,
    hasLanded: false,
  }));
  const victimsByKillerAndTeam = createTrackedMap(
    trackedAccounts,
    () => new Map(),
  );
  const groggyById = new Map();
  const attacksById = new Map();

  for (const event of orderedEvents) {
    if (event?._T === "LogParachuteLanding") {
      const accountId = event.character?.accountId;
      if (trackedAccounts.has(accountId)) {
        playerTelemetry.get(accountId).hasLanded = true;
      }
    }

    if (event?._T === "LogPlayerMakeGroggy" && event.dBNOId !== undefined) {
      groggyById.set(String(event.dBNOId), event);
    }

    if (event?._T === "LogPlayerAttack" && event.attackId !== undefined) {
      attacksById.set(String(event.attackId), event);
    }

    if (event?._T === "LogPlayerUseFlareGun") {
      const accountId = event.attacker?.accountId;
      if (trackedAccounts.has(accountId)) {
        playerTelemetry.get(accountId).flareGunUses += 1;
      }
    }

    if (!ITEM_PICKUP_EVENT_TYPES.has(event?._T)) {
      continue;
    }

    const accountId = event.character?.accountId;
    if (!trackedAccounts.has(accountId)) {
      continue;
    }

    const firearmKey = firearmKeyFromItem(event.item);
    if (!firearmKey) {
      continue;
    }

    const telemetry = playerTelemetry.get(accountId);
    if (telemetry.hasLanded) {
      telemetry.firstFirearmKey ??= firearmKey;
    }

    if (event._T === "LogItemPickupFromCarepackage") {
      telemetry.carePackageWeaponKeys.add(firearmKey);
    }
  }

  for (const event of orderedEvents) {
    if (!KILL_EVENT_TYPES.has(event?._T)) {
      continue;
    }

    const killer = event.killer;
    const victim = event.victim;
    const killerAccountId = killer?.accountId;
    const victimAccountId = victim?.accountId;
    const killerTeamId = killer?.teamId;
    const victimTeamId = victim?.teamId ?? event.victimGameResult?.teamId;

    if (
      !trackedAccounts.has(killerAccountId) ||
      !victimAccountId ||
      killerAccountId === victimAccountId ||
      killerTeamId === undefined ||
      victimTeamId === undefined ||
      String(killerTeamId) === String(victimTeamId)
    ) {
      continue;
    }

    const damageInfo = resolveKillerDamageInfo(event, killerAccountId);
    const damageCauserName =
      damageInfo?.damageCauserName ?? event.damageCauserName;
    const groggyEvent =
      event.dBNOId === undefined ? undefined : groggyById.get(String(event.dBNOId));
    const attackEvent = resolveAttackEvent(event, groggyEvent, attacksById);
    const isAttackerInVehicle =
      (groggyEvent?.attacker?.accountId === killerAccountId &&
        groggyEvent.isAttackerInVehicle === true) ||
      (attackEvent?.attacker?.accountId === killerAccountId &&
        hasVehicle(attackEvent.vehicle));

    killsByPlayer.get(killerAccountId).push({
      killerAccountId,
      victimAccountId,
      killerTeamId,
      victimTeamId,
      damageCauserName,
      damageTypeCategory:
        damageInfo?.damageTypeCategory ?? event.damageTypeCategory,
      distance: damageInfo?.distance ?? event.distance,
      weaponKey: canonicalWeaponKey(damageCauserName),
      isAttackerInVehicle,
    });

    const victimsByTeam = victimsByKillerAndTeam.get(killerAccountId);
    const teamKey = String(victimTeamId);
    const victims = victimsByTeam.get(teamKey) ?? new Set();
    victims.add(victimAccountId);
    victimsByTeam.set(teamKey, victims);
  }

  const sameSquadKills = new Map(
    [...victimsByKillerAndTeam].map(([accountId, victimsByTeam]) => {
      const bestTeam = [...victimsByTeam.entries()].reduce(
        (best, [enemyTeamId, victims]) => {
          if (!best || victims.size > best.count) {
            return {
              count: victims.size,
              enemyTeamId,
              victimAccountIds: [...victims],
            };
          }

          return best;
        },
        undefined,
      );

      return [
        accountId,
        bestTeam ?? { count: 0, enemyTeamId: undefined, victimAccountIds: [] },
      ];
    }),
  );

  return { killsByPlayer, sameSquadKills, playerTelemetry };
}

function resolveKillerDamageInfo(event, killerAccountId) {
  if (event?._T === "LogPlayerKill") {
    return event;
  }

  const candidates = [];

  if (event.dBNOMaker?.accountId === killerAccountId) {
    candidates.push(event.dBNODamageInfo);
  }

  if (event.finisher?.accountId === killerAccountId) {
    candidates.push(event.finishDamageInfo);
  }

  candidates.push(event.killerDamageInfo);

  return (
    candidates.find(
      (damageInfo) =>
        damageInfo?.damageCauserName && damageInfo.damageCauserName !== "None",
    ) ?? candidates.find(Boolean)
  );
}

function resolveAttackEvent(event, groggyEvent, attacksById) {
  const attackId = groggyEvent?.attackId ?? event.attackId;
  return attackId === undefined ? undefined : attacksById.get(String(attackId));
}

function firearmKeyFromItem(item) {
  const itemId = item?.itemId;
  if (
    !itemId?.startsWith("Item_Weapon_") ||
    NON_FIREARM_ITEM_PATTERN.test(itemId) ||
    (item.category && item.category !== "Weapon") ||
    (item.subCategory && !FIREARM_SUBCATEGORIES.has(item.subCategory))
  ) {
    return undefined;
  }

  return canonicalWeaponKey(itemId);
}

function canonicalWeaponKey(identifier) {
  if (!identifier) {
    return undefined;
  }

  const normalized = identifier
    .replace(/^Item_Weapon_/, "")
    .replace(/^Weap/, "")
    .replace(/_C$/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  return WEAPON_KEY_ALIASES.get(normalized) ?? normalized;
}

function hasVehicle(vehicle) {
  return Boolean(vehicle?.vehicleId && vehicle.vehicleId !== "None");
}

function createTrackedMap(trackedAccounts, createValue) {
  return new Map(
    [...trackedAccounts].map((accountId) => [accountId, createValue()]),
  );
}

function orderTelemetryEvents(events) {
  return [...(events ?? [])]
    .map((event, index) => ({ event, index, time: Date.parse(event?._D ?? "") }))
    .sort((left, right) => {
      if (Number.isFinite(left.time) && Number.isFinite(right.time)) {
        return left.time - right.time || left.index - right.index;
      }

      return left.index - right.index;
    })
    .map(({ event }) => event);
}
