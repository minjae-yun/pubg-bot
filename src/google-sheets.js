import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatMapName, getKillRaceMode } from "./kill-race-config.js";

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
      valueRange(sheet, "H3", [[1]]),
      valueRange(sheet, "K3", [[-2]]),
      valueRange(sheet, "N3", [[8]]),
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
    valueRange(sheet, `${valueColumn}7:${valueColumn}${6 + rowCount}`, names),
  ];
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
