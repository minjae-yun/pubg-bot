function createRecord(player) {
  return {
    discordUserId: player.discordUserId,
    displayName: player.displayName,
    races: 0,
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    chickens: 0,
    score: 0,
  };
}

function addResult(record, result) {
  if (result === "win") {
    record.wins += 1;
  } else if (result === "draw") {
    record.draws += 1;
  } else {
    record.losses += 1;
  }
}

function resultsById(entries) {
  const maximum = Math.max(...entries.map((entry) => Number(entry.score)));
  const leaders = entries.filter((entry) => Number(entry.score) === maximum);
  const allTied = leaders.length === entries.length;

  return new Map(
    entries.map((entry) => [
      entry.id,
      allTied || (leaders.length > 1 && Number(entry.score) === maximum)
        ? "draw"
        : Number(entry.score) === maximum
          ? "win"
          : "loss",
    ]),
  );
}

function sortRecords(left, right) {
  return (
    right.score - left.score ||
    right.wins - left.wins ||
    right.kills - left.kills ||
    left.deaths - right.deaths ||
    left.displayName.localeCompare(right.displayName, "ko")
  );
}

export function summarizeKillRaceHistory(summaries) {
  const overallByUser = new Map();
  const tierByUser = new Map();
  let matchCount = 0;

  for (const summary of summaries) {
    const teamResults = resultsById(
      summary.teams.map((team) => ({ id: team.teamKey, score: team.score })),
    );
    const tierPlayers = new Map();

    for (const team of summary.teams) {
      matchCount += team.rounds;
      for (const player of team.players) {
        const overall = overallByUser.get(player.discordUserId) ?? createRecord(player);
        overall.displayName = player.displayName;
        overall.races += 1;
        overall.matches += team.rounds;
        overall.kills += player.kills;
        overall.deaths += player.deaths;
        overall.chickens += team.chickens;
        overall.score += player.score;
        addResult(overall, teamResults.get(team.teamKey));
        overallByUser.set(player.discordUserId, overall);

        const tier = Number(player.tier);
        const candidates = tierPlayers.get(tier) ?? [];
        candidates.push({
          id: player.discordUserId,
          player,
          rounds: team.rounds,
          chickens: team.chickens,
        });
        tierPlayers.set(tier, candidates);
      }
    }

    for (const [tier, candidates] of tierPlayers) {
      const tierResults = resultsById(
        candidates.map(({ id, player }) => ({ id, score: player.score })),
      );
      for (const { id, player, rounds, chickens } of candidates) {
        const key = `${tier}:${id}`;
        const record = tierByUser.get(key) ?? {
          ...createRecord(player),
          tier,
        };
        record.displayName = player.displayName;
        record.races += 1;
        record.matches += rounds;
        record.kills += player.kills;
        record.deaths += player.deaths;
        record.chickens += chickens;
        record.score += player.score;
        addResult(record, tierResults.get(id));
        tierByUser.set(key, record);
      }
    }
  }

  const highestTier = Math.max(
    0,
    ...[...tierByUser.values()].map((record) => record.tier),
  );
  const tiers = Array.from({ length: highestTier }, (_, index) => index + 1).map(
    (tier) => ({
      tier,
      players: [...tierByUser.values()]
        .filter((record) => record.tier === tier)
        .sort(sortRecords),
    }),
  );

  return {
    raceCount: summaries.length,
    matchCount,
    players: [...overallByUser.values()].sort(sortRecords),
    tiers,
  };
}
