import { analyzeTrackedKills } from "./squad-kills.js";

const KILL_EVENT_TYPES = new Set(["LogPlayerKill", "LogPlayerKillV2"]);

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
  const createdAt = new Date(match?.data?.attributes?.createdAt);
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const gameMode = match?.data?.attributes?.gameMode ?? "";

  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt < start ||
    createdAt > end ||
    !["squad", "squad-fpp"].includes(gameMode)
  ) {
    return null;
  }

  const statsByAccountId = participantStatsByAccountId(match);
  if (members.some((member) => !statsByAccountId.has(member.accountId))) {
    return null;
  }

  const accountIds = members.map((member) => member.accountId);
  const trackedAccounts = new Set(accountIds);
  const killAnalysis = analyzeTrackedKills(telemetry, accountIds);
  const deaths = new Set();

  for (const event of telemetry ?? []) {
    if (KILL_EVENT_TYPES.has(event?._T) && trackedAccounts.has(event.victim?.accountId)) {
      deaths.add(event.victim.accountId);
    }
  }

  const players = members.map((member) => {
    const stats = statsByAccountId.get(member.accountId);
    const telemetryShowsDeath = deaths.has(member.accountId);
    const finalStatsShowDeath = stats.deathType && stats.deathType !== "alive";

    return {
      discordUserId: member.discordUserId,
      accountId: member.accountId,
      slot: member.slot,
      kills: killAnalysis.killsByPlayer.get(member.accountId)?.length ?? 0,
      died: telemetryShowsDeath || Boolean(finalStatsShowDeath),
      placement: Number(stats.winPlace) || 0,
    };
  });

  return {
    matchId: match.data?.id,
    mapName: match.data?.attributes?.mapName ?? "Unknown",
    createdAt: createdAt.toISOString(),
    chicken: players.some((player) => player.placement === 1),
    players,
  };
}

export function sharedNewMatchIds(players, members, excludedMatchIds = []) {
  const playerByAccountId = new Map(
    players.map((player) => [player.accountId, player]),
  );
  const memberMatchSets = members.map(
    (member) => new Set(playerByAccountId.get(member.accountId)?.matchIds ?? []),
  );

  if (memberMatchSets.length === 0 || memberMatchSets.some((matches) => matches.size === 0)) {
    return [];
  }

  const excluded = new Set(excludedMatchIds);
  return [...memberMatchSets[0]].filter(
    (matchId) =>
      !excluded.has(matchId) &&
      memberMatchSets.every((matches) => matches.has(matchId)),
  );
}
