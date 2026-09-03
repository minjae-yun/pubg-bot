export const KILL_RACE_MODES = Object.freeze({
  "2v2": { teamKeys: ["A", "B"], playersPerTeam: 2, inputSheet: "2팀 입력" },
  "3v3": { teamKeys: ["A", "B"], playersPerTeam: 3, inputSheet: "2팀 입력" },
  "4v4": { teamKeys: ["A", "B"], playersPerTeam: 4, inputSheet: "2팀 입력" },
  "2v2v2": {
    teamKeys: ["A", "B", "C"],
    playersPerTeam: 2,
    inputSheet: "3팀 입력",
  },
});

export const KILL_RACE_TIER_KILL_POINTS = Object.freeze([1, 2, 3, 4]);
export const KILL_RACE_DEATH_POINTS = -1;
export const KILL_RACE_CHICKEN_POINTS = 8;

const MAP_LABELS = Object.freeze({
  Baltic_Main: "에란겔",
  Chimera_Main: "파라모",
  Desert_Main: "미라마",
  DihorOtok_Main: "비켄디",
  Erangel_Main: "에란겔",
  Heaven_Main: "헤이븐",
  Kiki_Main: "데스턴",
  Range_Main: "캠프 자칼",
  Savage_Main: "사녹",
  Summerland_Main: "카라킨",
  Tiger_Main: "태이고",
});

export function getKillRaceMode(mode) {
  return KILL_RACE_MODES[mode];
}

export function formatKillRaceMode(mode) {
  return mode.replaceAll("v", "대");
}

export function getTierKillPoints(tier) {
  return KILL_RACE_TIER_KILL_POINTS[Number(tier) - 1] ?? 0;
}

export function calculateKillRacePlayerScore({ kills, deaths, tier }) {
  return (
    Number(kills) * getTierKillPoints(tier) +
    Number(deaths) * KILL_RACE_DEATH_POINTS
  );
}

export function formatKillRaceScoring(mode) {
  const playersPerTeam = getKillRaceMode(mode)?.playersPerTeam ?? 4;
  const killRules = KILL_RACE_TIER_KILL_POINTS.slice(0, playersPerTeam)
    .map((points, index) => `${index + 1}티어 **+${points}**`)
    .join(" · ");

  return `${killRules} · 최종 사망 **${KILL_RACE_DEATH_POINTS}** · 치킨 **+${KILL_RACE_CHICKEN_POINTS}**`;
}

export function formatMapName(mapName) {
  return MAP_LABELS[mapName] ?? mapName ?? "알 수 없음";
}
