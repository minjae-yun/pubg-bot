export const MODE_LABELS = {
  "squad-fpp": "스쿼드 FPP",
  "duo-fpp": "듀오 FPP",
  "solo-fpp": "솔로 FPP",
  squad: "스쿼드 TPP",
  duo: "듀오 TPP",
  solo: "솔로 TPP",
};

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function summarizeModeStats(stats = {}) {
  const matches = safeNumber(stats.roundsPlayed);
  const wins = safeNumber(stats.wins);
  const top10s = safeNumber(stats.top10s);
  const kills = safeNumber(stats.kills);
  const damageDealt = safeNumber(stats.damageDealt);
  const deaths = Math.max(matches - wins, 0);

  return {
    matches,
    wins,
    top10s,
    kills,
    deaths,
    assists: safeNumber(stats.assists),
    headshotKills: safeNumber(stats.headshotKills),
    longestKill: safeNumber(stats.longestKill),
    averageDamage: matches > 0 ? damageDealt / matches : 0,
    kd: deaths > 0 ? kills / deaths : kills > 0 ? Number.POSITIVE_INFINITY : 0,
    winRate: matches > 0 ? (wins / matches) * 100 : 0,
    top10Rate: matches > 0 ? (top10s / matches) * 100 : 0,
  };
}
