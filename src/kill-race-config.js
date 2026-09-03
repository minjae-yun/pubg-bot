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

export function formatMapName(mapName) {
  return MAP_LABELS[mapName] ?? mapName ?? "알 수 없음";
}
