function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function extractRecentPlayerMatch(match, accountId) {
  const participant = (match.included ?? []).find((item) => {
    const stats = item.type === "participant" ? item.attributes?.stats : null;
    return stats?.playerId === accountId;
  });

  if (!participant) {
    return null;
  }

  const stats = participant.attributes.stats;
  const placement = safeNumber(stats.winPlace);
  const deathType = stats.deathType;
  const died = deathType ? deathType !== "alive" : placement !== 1;

  return {
    matchId: match.data?.id,
    createdAt: match.data?.attributes?.createdAt,
    gameMode: match.data?.attributes?.gameMode,
    matchType: match.data?.attributes?.matchType,
    mapName: match.data?.attributes?.mapName,
    kills: safeNumber(stats.kills),
    assists: safeNumber(stats.assists),
    damage: safeNumber(stats.damageDealt),
    headshotKills: safeNumber(stats.headshotKills),
    placement,
    survivalSeconds: safeNumber(stats.timeSurvived),
    friendlyKnocks: 0,
    friendlyKnocksReceived: 0,
    died,
  };
}

export function summarizeRecentMatches(matches) {
  const totals = matches.reduce(
    (result, match) => {
      result.kills += match.kills;
      result.assists += match.assists;
      result.damage += match.damage;
      result.headshotKills += match.headshotKills;
      result.placement += match.placement;
      result.survivalSeconds += match.survivalSeconds;
      result.friendlyKnocks += safeNumber(match.friendlyKnocks);
      result.friendlyKnocksReceived += safeNumber(match.friendlyKnocksReceived);
      result.deaths += match.died ? 1 : 0;
      result.wins += match.placement === 1 ? 1 : 0;
      result.top10s += match.placement > 0 && match.placement <= 10 ? 1 : 0;
      return result;
    },
    {
      kills: 0,
      assists: 0,
      damage: 0,
      headshotKills: 0,
      placement: 0,
      survivalSeconds: 0,
      friendlyKnocks: 0,
      friendlyKnocksReceived: 0,
      deaths: 0,
      wins: 0,
      top10s: 0,
    },
  );
  const count = matches.length;

  return {
    matches: count,
    ...totals,
    averageDamage: count > 0 ? totals.damage / count : 0,
    averagePlacement: count > 0 ? totals.placement / count : 0,
    averageSurvivalSeconds: count > 0 ? totals.survivalSeconds / count : 0,
    kd: ratio(totals.kills, totals.deaths),
    kda: ratio(totals.kills + totals.assists, totals.deaths),
    winRate: count > 0 ? (totals.wins / count) * 100 : 0,
    top10Rate: count > 0 ? (totals.top10s / count) * 100 : 0,
  };
}

function ratio(numerator, denominator) {
  if (denominator > 0) {
    return numerator / denominator;
  }

  return numerator > 0 ? Number.POSITIVE_INFINITY : 0;
}
