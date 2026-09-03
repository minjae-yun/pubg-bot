import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatMapName,
  getKillRaceMode,
  KILL_RACE_CHICKEN_POINTS,
  KILL_RACE_DEATH_POINTS,
  KILL_RACE_TIER_KILL_POINTS,
} from "./kill-race-config.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const TWO_TEAM_COLUMNS = Object.freeze({
  A: { start: "C", chicken: "K", playerCount: 4 },
  B: { start: "M", chicken: "U", playerCount: 4 },
});
const THREE_TEAM_COLUMNS = Object.freeze({
  A: { start: "C", chicken: "G", playerCount: 2 },
  B: { start: "I", chicken: "M", playerCount: 2 },
  C: { start: "O", chicken: "S", playerCount: 2 },
});

export function createGoogleSheetsClient({
  sheetId,
  credentialsPath,
  fetchImpl = fetch,
}) {
  const credentials = JSON.parse(readFileSync(resolve(credentialsPath), "utf8"));
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google 서비스 계정 JSON에 client_email 또는 private_key가 없습니다.");
  }

  return new GoogleSheetsClient({
    sheetId,
    fetchImpl,
    accessTokenProvider: createServiceAccountTokenProvider({
      credentials,
      fetchImpl,
    }),
  });
}

export class GoogleSheetsClient {
  constructor({ sheetId, accessTokenProvider, fetchImpl = fetch }) {
    this.sheetId = sheetId;
    this.accessTokenProvider = accessTokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async initializeRace(session, members) {
    const mode = getKillRaceMode(session.mode);
    if (!mode) {
      throw new Error(`지원하지 않는 킬내기 모드입니다: ${session.mode}`);
    }

    const sheet = mode.inputSheet;
    const clearRange = session.mode === "2v2v2" ? "B16:T35" : "B16:V35";
    await this.request("values:batchClear", {
      ranges: [`'${sheet}'!${clearRange}`],
    });

    const membersByTeam = new Map(
      mode.teamKeys.map((teamKey) => [
        teamKey,
        members
          .filter((member) => member.teamKey === teamKey)
          .sort((left, right) => left.slot - right.slot),
      ]),
    );
    const data = [
      valueRange(sheet, "B3", [["킬내기"]]),
      valueRange(sheet, "E3", [[session.targetScore]]),
      ...scoringRuleRanges(session.mode),
    ];

    if (session.mode === "2v2v2") {
      data.push(
        ...setupRanges(sheet, "A", "A", membersByTeam.get("A"), 2),
        ...setupRanges(sheet, "D", "B", membersByTeam.get("B"), 2),
        ...setupRanges(sheet, "G", "C", membersByTeam.get("C"), 2),
      );
    } else {
      data.push(
        ...setupRanges(sheet, "A", "A", membersByTeam.get("A"), 4),
        ...setupRanges(sheet, "F", "B", membersByTeam.get("B"), 4),
      );
    }

    await this.batchUpdate(data);
  }

  async updateScoringRules(mode) {
    if (!getKillRaceMode(mode)) {
      throw new Error(`지원하지 않는 킬내기 모드입니다: ${mode}`);
    }
    await this.batchUpdate(scoringRuleRanges(mode));
  }

  async writeTeamMatch(session, result) {
    const mode = getKillRaceMode(session.mode);
    const sheet = mode.inputSheet;
    const row = 15 + result.roundNumber;
    const columns =
      session.mode === "2v2v2"
        ? THREE_TEAM_COLUMNS[result.teamKey]
        : TWO_TEAM_COLUMNS[result.teamKey];

    if (!columns || result.roundNumber < 1 || result.roundNumber > 20) {
      throw new Error("시트에 기록할 수 없는 킬내기 경기입니다.");
    }

    const playersBySlot = new Map(
      result.players.map((player) => [player.slot, player]),
    );
    const values = [];
    for (let slot = 1; slot <= columns.playerCount; slot += 1) {
      const player = playersBySlot.get(slot);
      values.push(player?.kills ?? 0, player?.died ? 1 : 0);
    }
    values.push(result.chicken ? 1 : 0);

    await this.batchUpdate([
      valueRange(sheet, `B${row}`, [[sheetText(formatMapName(result.mapName))]]),
      valueRange(
        sheet,
        `${columns.start}${row}:${columns.chicken}${row}`,
        [values],
      ),
    ]);
  }

  async batchUpdate(data) {
    await this.request("values:batchUpdate", {
      valueInputOption: "USER_ENTERED",
      data,
    });
  }

  async request(method, body) {
    const token = await this.accessTokenProvider();
    const response = await this.fetchImpl(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.sheetId)}/${method}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const detail = errorBody?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Google 시트 업데이트에 실패했습니다: ${detail}`);
    }

    return response.json().catch(() => ({}));
  }
}

function setupRanges(sheet, startColumn, teamKey, members, rowCount) {
  const startCode = startColumn.charCodeAt(0);
  const valueColumn = String.fromCharCode(startCode + 1);
  const names = Array.from({ length: rowCount }, (_, index) => [
    sheetText(members[index]?.displayName ?? ""),
  ]);

  return [
    valueRange(sheet, `${valueColumn}6`, [[`TEAM ${teamKey}`]]),
    valueRange(
      sheet,
      `${startColumn}7:${startColumn}${6 + rowCount}`,
      Array.from({ length: rowCount }, (_, index) => [`${index + 1}티어`]),
    ),
    valueRange(sheet, `${valueColumn}7:${valueColumn}${6 + rowCount}`, names),
  ];
}

function scoringRuleRanges(mode) {
  const isThreeTeam = mode === "2v2v2";
  const inputSheet = isThreeTeam ? "3팀 입력" : "2팀 입력";
  const scoreSheet = isThreeTeam ? "3팀 점수판" : "2팀 점수판";
  const teams = isThreeTeam
    ? [
        scoreTeam("A", "B6", "A3", "A7", "A", ["C", "E"], ["D", "F"], "G", "H"),
        scoreTeam("B", "E6", "D3", "D7", "D", ["I", "K"], ["J", "L"], "M", "N"),
        scoreTeam("C", "H6", "G3", "G7", "G", ["O", "Q"], ["P", "R"], "S", "T"),
      ]
    : [
        scoreTeam("A", "B6", "A3", "A8", "A", ["C", "E", "G", "I"], ["D", "F", "H", "J"], "K", "L"),
        scoreTeam("B", "G6", "E3", "E8", "E", ["M", "O", "Q", "S"], ["N", "P", "R", "T"], "U", "V"),
      ];
  const tierRows = isThreeTeam
    ? [
        ["A7:A8", 2],
        ["D7:D8", 2],
        ["G7:G8", 2],
      ]
    : [
        ["A7:A10", 4],
        ["F7:F10", 4],
      ];
  const data = [
    valueRange(inputSheet, "G3", [["1티어 킬"]]),
    valueRange(inputSheet, "H3", [[KILL_RACE_TIER_KILL_POINTS[0]]]),
    valueRange(inputSheet, "J3", [["사망 감점"]]),
    valueRange(inputSheet, "K3", [[KILL_RACE_DEATH_POINTS]]),
    valueRange(inputSheet, "M3", [["치킨 보너스"]]),
    valueRange(inputSheet, "N3", [[KILL_RACE_CHICKEN_POINTS]]),
    valueRange(inputSheet, "A12", [[
      "위에서부터 1·2·3·4티어이며 킬당 +1·+2·+3·+4점입니다. 최종 사망은 -1점이고, 블루칩으로 살아남거나 치킨이면 사망 감점이 없습니다.",
    ]]),
    valueRange(
      scoreSheet,
      "A1",
      [[`='${inputSheet}'!$B$3&" "&'${inputSheet}'!$E$3&"점"`]],
    ),
  ];

  for (const [range, rowCount] of tierRows) {
    data.push(
      valueRange(
        inputSheet,
        range,
        Array.from({ length: rowCount }, (_, index) => [`${index + 1}티어`]),
      ),
    );
  }

  for (const team of teams) {
    data.push(
      valueRange(scoreSheet, team.scoreCell, [[teamScoreFormula(inputSheet, team)]]),
      valueRange(scoreSheet, team.chickenCell, [[chickenFormula(inputSheet, team.chickenColumn)]]),
    );
    for (let index = 0; index < team.killColumns.length; index += 1) {
      data.push(
        valueRange(
          scoreSheet,
          `${team.playerStartColumn}${4 + index}`,
          [[playerScoreFormula(inputSheet, team, index)]],
        ),
      );
    }
  }

  return data;
}

function scoreTeam(
  teamKey,
  teamNameCell,
  scoreCell,
  chickenCell,
  playerStartColumn,
  killColumns,
  deathColumns,
  chickenColumn,
  bonusColumn,
) {
  return {
    teamKey,
    teamNameCell,
    scoreCell,
    chickenCell,
    playerStartColumn,
    killColumns,
    deathColumns,
    chickenColumn,
    bonusColumn,
  };
}

function teamScoreFormula(inputSheet, team) {
  const killScore = team.killColumns
    .map(
      (column, index) =>
        `SUM('${inputSheet}'!${column}16:${column}35)*'${inputSheet}'!$H$3*${index + 1}`,
    )
    .join("+");
  const deathRanges = team.deathColumns
    .map((column) => `'${inputSheet}'!${column}16:${column}35`)
    .join(",");
  return (
    `='${inputSheet}'!$${team.teamNameCell.slice(0, 1)}$${team.teamNameCell.slice(1)}` +
    `&" "&((${killScore})+SUM(${deathRanges})*'${inputSheet}'!$K$3+` +
    `SUM('${inputSheet}'!${team.chickenColumn}16:${team.chickenColumn}35)*'${inputSheet}'!$N$3+` +
    `SUM('${inputSheet}'!${team.bonusColumn}16:${team.bonusColumn}35))&"점"`
  );
}

function playerScoreFormula(inputSheet, team, index) {
  const nameColumn = team.teamNameCell.slice(0, 1);
  const nameRow = 7 + index;
  const killColumn = team.killColumns[index];
  const deathColumn = team.deathColumns[index];
  const tier = index + 1;
  return (
    `=IF('${inputSheet}'!$${nameColumn}$${nameRow}="","",` +
    `'${inputSheet}'!$${nameColumn}$${nameRow}&" "&(` +
    `SUM('${inputSheet}'!${killColumn}16:${killColumn}35)*'${inputSheet}'!$H$3*${tier}+` +
    `SUM('${inputSheet}'!${deathColumn}16:${deathColumn}35)*'${inputSheet}'!$K$3)` +
    `&" ("&SUM('${inputSheet}'!${killColumn}16:${killColumn}35)&"-"&` +
    `SUM('${inputSheet}'!${deathColumn}16:${deathColumn}35)&")")`
  );
}

function chickenFormula(inputSheet, chickenColumn) {
  return `="치킨 ["&SUM('${inputSheet}'!${chickenColumn}16:${chickenColumn}35)&"]"`;
}

function valueRange(sheet, range, values) {
  return { range: `'${sheet}'!${range}`, values };
}

function sheetText(value) {
  const text = String(value);
  return /^[=+@-]/.test(text) ? `'${text}` : text;
}

function createServiceAccountTokenProvider({ credentials, fetchImpl }) {
  let cachedToken;
  let expiresAt = 0;

  return async function getAccessToken() {
    if (cachedToken && expiresAt > Date.now() + 60_000) {
      return cachedToken;
    }

    const now = Math.floor(Date.now() / 1_000);
    const header = base64Url({
      alg: "RS256",
      typ: "JWT",
      ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
    });
    const claims = base64Url({
      iss: credentials.client_email,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3_600,
    });
    const unsignedToken = `${header}.${claims}`;
    const signature = createSign("RSA-SHA256")
      .update(unsignedToken)
      .end()
      .sign(credentials.private_key, "base64url");
    const assertion = `${unsignedToken}.${signature}`;
    const form = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok || !body?.access_token) {
      throw new Error(
        `Google 서비스 계정 인증에 실패했습니다: ${body?.error_description ?? response.status}`,
      );
    }

    cachedToken = body.access_token;
    expiresAt = Date.now() + Number(body.expires_in ?? 3_600) * 1_000;
    return cachedToken;
  };
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
