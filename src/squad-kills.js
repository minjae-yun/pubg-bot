const KILL_EVENT_TYPES = new Set(["LogPlayerKill", "LogPlayerKillV2"]);

export function countSameSquadKills(events, accountIds) {
  const trackedAccounts = new Set(accountIds.filter(Boolean));
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

    const victimsByTeam = victimsByKillerAndTeam.get(killerAccountId);
    const teamKey = String(victimTeamId);
    const victims = victimsByTeam.get(teamKey) ?? new Set();
    victims.add(victimAccountId);
    victimsByTeam.set(teamKey, victims);
  }

  return new Map(
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
}
