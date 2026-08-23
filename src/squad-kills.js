const KILL_EVENT_TYPES = new Set(["LogPlayerKill", "LogPlayerKillV2"]);

export function countSameSquadKills(events, accountIds) {
  return analyzeTrackedKills(events, accountIds).sameSquadKills;
}

export function analyzeTrackedKills(events, accountIds) {
  const trackedAccounts = new Set(accountIds.filter(Boolean));
  const killsByPlayer = new Map(
    [...trackedAccounts].map((accountId) => [accountId, []]),
  );
  const victimsByKillerAndTeam = new Map(
    [...trackedAccounts].map((accountId) => [accountId, new Map()]),
  );

  for (const event of events ?? []) {
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
    killsByPlayer.get(killerAccountId).push({
      killerAccountId,
      victimAccountId,
      killerTeamId,
      victimTeamId,
      damageCauserName: damageInfo?.damageCauserName ?? event.damageCauserName,
      damageTypeCategory:
        damageInfo?.damageTypeCategory ?? event.damageTypeCategory,
      distance: damageInfo?.distance ?? event.distance,
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

  return { killsByPlayer, sameSquadKills };
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
