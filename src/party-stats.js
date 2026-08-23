function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function collectCandidateMatchIds(players, minimumPlayers = players.length > 1 ? 2 : 1) {
  const counts = new Map();

  for (const player of players) {
    for (const matchId of new Set(player.matchIds ?? [])) {
      counts.set(matchId, (counts.get(matchId) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minimumPlayers)
    .map(([matchId]) => matchId)
    .slice(0, 32);
}

export function extractPartyMatch(match, members, startedAt, endedAt = new Date()) {
  const createdAt = new Date(match.data?.attributes?.createdAt);
  const start = new Date(startedAt);
  const end = new Date(endedAt);

  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt < start ||
    createdAt > end
  ) {
    return null;
  }

  const memberByAccountId = new Map(members.map((member) => [member.accountId, member]));
  const players = (match.included ?? [])
    .filter((item) => item.type === "participant")
    .map((item) => item.attributes?.stats ?? {})
    .filter((stats) => memberByAccountId.has(stats.playerId))
    .map((stats) => {
      const member = memberByAccountId.get(stats.playerId);
      return {
        discordUserId: member.discordUserId,
        accountId: member.accountId,
        playerName: stats.name || member.playerName,
        kills: safeNumber(stats.kills),
        damage: safeNumber(stats.damageDealt),
        assists: safeNumber(stats.assists),
        revives: safeNumber(stats.revives),
        headshotKills: safeNumber(stats.headshotKills),
        longestKill: safeNumber(stats.longestKill),
        friendlyKills: safeNumber(stats.teamKills),
        friendlyKnocks: 0,
        deaths: stats.deathType === "alive" ? 0 : 1,
        placement: safeNumber(stats.winPlace),
        survivalSeconds: safeNumber(stats.timeSurvived),
      };
    });

  if (players.length === 0) {
    return null;
  }

  return {
    matchId: match.data?.id,
    createdAt: createdAt.toISOString(),
    gameMode: match.data?.attributes?.gameMode,
    mapName: match.data?.attributes?.mapName,
    players,
    bestPlacement: Math.min(...players.map((player) => player.placement).filter(Boolean)),
  };
}

export function buildPartyReport(matches, members) {
  const playerReports = new Map(
    members.map((member) => [
      member.discordUserId,
      {
        discordUserId: member.discordUserId,
        playerName: member.playerName,
        matches: 0,
        kills: 0,
        damage: 0,
        assists: 0,
        revives: 0,
        headshotKills: 0,
        friendlyKills: 0,
        friendlyKnocks: 0,
        deaths: 0,
        survivalSeconds: 0,
        wins: 0,
        squadBreakerCount: 0,
        squadBreakerMatchId: null,
      },
    ]),
  );

  let totalKills = 0;
  let teamDamage = 0;
  let bestPlacement = Number.POSITIVE_INFINITY;

  for (const match of matches) {
    bestPlacement = Math.min(bestPlacement, match.bestPlacement || Number.POSITIVE_INFINITY);

    for (const player of match.players) {
      const report = playerReports.get(player.discordUserId);

      if (!report) {
        continue;
      }

      report.matches += 1;
      report.kills += player.kills;
      report.damage += player.damage;
      report.assists += player.assists;
      report.revives += player.revives;
      report.headshotKills += player.headshotKills;
      report.friendlyKills += safeNumber(player.friendlyKills);
      report.friendlyKnocks += safeNumber(player.friendlyKnocks);
      report.deaths += player.deaths;
      report.survivalSeconds += player.survivalSeconds;
      report.wins += player.placement === 1 ? 1 : 0;
      if (safeNumber(player.squadBreakerCount) > report.squadBreakerCount) {
        report.squadBreakerCount = safeNumber(player.squadBreakerCount);
        report.squadBreakerMatchId = match.matchId ?? null;
      }
      totalKills += player.kills;
      teamDamage += player.damage;
    }
  }

  const players = [...playerReports.values()]
    .filter((player) => player.matches > 0)
    .map((player) => {
      const averageDamage = player.damage / player.matches;
      const averageKills = player.kills / player.matches;
      const averageAssists = player.assists / player.matches;
      const averageRevives = player.revives / player.matches;
      const averageSurvivalSeconds = player.survivalSeconds / player.matches;
      const kda = calculateKda(player.kills, player.assists, player.deaths);
      const contributionScore =
        averageDamage +
        averageKills * 100 +
        averageAssists * 50;

      return {
        ...player,
        averageDamage,
        averageKills,
        averageAssists,
        averageRevives,
        averageSurvivalSeconds,
        kda,
        contributionScore,
      };
    });
  const averageContribution =
    players.length > 0
      ? players.reduce((sum, player) => sum + player.contributionScore, 0) / players.length
      : 0;

  for (const player of players) {
    player.contributionRatio =
      averageContribution > 0 ? player.contributionScore / averageContribution : 0;
  }
  const trolls = pickTrolls(players);

  return {
    matches: matches.length,
    totalKills,
    averageTeamDamage: matches.length > 0 ? teamDamage / matches.length : 0,
    bestPlacement: Number.isFinite(bestPlacement) ? bestPlacement : 0,
    players,
    awards: {
      ace: pickHighest(players, "contributionScore", ["averageDamage", "kills"]),
      squadBreaker: pickSquadBreakers(players),
      trolls,
    },
  };
}

function calculateKda(kills, assists, deaths) {
  if (deaths > 0) {
    return (kills + assists) / deaths;
  }

  return kills + assists > 0 ? Number.POSITIVE_INFINITY : 0;
}

function pickHighest(players, key, tieBreakers = []) {
  return players.reduce((winner, player) => {
    if (!winner || comparePlayers(player, winner, [key, ...tieBreakers]) > 0) {
      return player;
    }

    return winner;
  }, null);
}

function comparePlayers(left, right, keys) {
  for (const key of keys) {
    const leftValue = safeNumberForComparison(left[key]);
    const rightValue = safeNumberForComparison(right[key]);

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return right.discordUserId.localeCompare(left.discordUserId);
}

function safeNumberForComparison(value) {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.MAX_VALUE;
  }

  return safeNumber(value);
}

function pickSquadBreakers(players) {
  const highestCount = players.reduce(
    (highest, player) => Math.max(highest, safeNumber(player.squadBreakerCount)),
    0,
  );

  if (highestCount < 2) {
    return [];
  }

  return players.filter(
    (player) => safeNumber(player.squadBreakerCount) === highestCount,
  );
}

function pickTrolls(players) {
  const selected = new Map();

  for (const player of players) {
    const reasons = [];

    if (player.friendlyKills > 0) {
      reasons.push(`팀킬 ${player.friendlyKills}회`);
    }

    if (player.friendlyKnocks > 0) {
      reasons.push(`아군 기절 ${player.friendlyKnocks}회`);
    }

    if (player.contributionRatio <= 0.5) {
      reasons.push(`${player.contributionRatio.toFixed(2)}인분`);
    }

    if (reasons.length > 0) {
      selected.set(player.discordUserId, { ...player, trollReasons: reasons });
    }
  }

  if (selected.size === 0 && players.length > 0) {
    const lowest = players.reduce((loser, player) => {
      if (
        !loser ||
        comparePlayers(player, loser, [
          "contributionScore",
          "averageDamage",
          "kills",
        ]) < 0
      ) {
        return player;
      }

      return loser;
    }, null);

    selected.set(lowest.discordUserId, {
      ...lowest,
      trollReasons: [`팀 내 최저 ${lowest.contributionRatio.toFixed(2)}인분`],
    });
  }

  return [...selected.values()];
}
