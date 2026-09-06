import { analyzeTrackedKills } from "./squad-kills.js";

function participantStatsByAccountId(match) {
  return new Map(
    (match?.included ?? [])
      .filter((item) => item.type === "participant")
      .map((item) => item.attributes?.stats)
      .filter((stats) => stats?.playerId)
      .map((stats) => [stats.playerId, stats]),
  );
}

export function extractKillRaceTeamMatch({
  match,
  telemetry,
  members,
  startedAt,
  endedAt = new Date(),
}) {
  if (!isKillRaceTeamMatch({ match, members, startedAt, endedAt })) {
    return null;
  }

  const createdAt = new Date(match?.data?.attributes?.createdAt);
  const statsByAccountId = participantStatsByAccountId(match);
  const accountIds = members.map((member) => member.accountId);
  const killAnalysis = analyzeTrackedKills(telemetry, accountIds);
  const chicken = members.some(
    (member) => Number(statsByAccountId.get(member.accountId).winPlace) === 1,
  );

  const players = members.map((member) => {
    const stats = statsByAccountId.get(member.accountId);
    const finalStatsShowDeath = stats.deathType && stats.deathType !== "alive";

    return {
      discordUserId: member.discordUserId,
      accountId: member.accountId,
      slot: member.slot,
      kills: killAnalysis.killsByPlayer.get(member.accountId)?.length ?? 0,
      died: !chicken && Boolean(finalStatsShowDeath),
      placement: Number(stats.winPlace) || 0,
    };
  });

  return {
    matchId: match.data?.id,
    mapName: match.data?.attributes?.mapName ?? "Unknown",
    createdAt: createdAt.toISOString(),
    chicken,
    players,
  };
}

export function isKillRaceTeamMatch({
  match,
  members,
  startedAt,
  endedAt = new Date(),
}) {
  const createdAt = new Date(match?.data?.attributes?.createdAt);
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const gameMode = match?.data?.attributes?.gameMode ?? "";
  const statsByAccountId = participantStatsByAccountId(match);

  return !(
    Number.isNaN(createdAt.getTime()) ||
    createdAt < start ||
    createdAt > end ||
    !["squad", "squad-fpp"].includes(gameMode) ||
    members.some((member) => !statsByAccountId.has(member.accountId))
  );
}

export function newMatchIdsFromAnyMember(players, members, excludedMatchIds = []) {
  const memberAccountIds = new Set(members.map((member) => member.accountId));
  const excluded = new Set(excludedMatchIds);
  const candidates = [];
  const seen = new Set();

  for (const player of players) {
    if (!memberAccountIds.has(player.accountId)) {
      continue;
    }

    for (const matchId of player.matchIds ?? []) {
      if (!matchId || excluded.has(matchId) || seen.has(matchId)) {
        continue;
      }

      seen.add(matchId);
      candidates.push(matchId);
    }
  }

  return candidates;
}
