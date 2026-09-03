import test from "node:test";
import assert from "node:assert/strict";
import { GoogleSheetsClient } from "../src/google-sheets.js";

test("3대3 참가자와 점수 규칙을 2팀 입력 시트에 초기화한다", async () => {
  const requests = [];
  const client = testClient(requests);
  const session = { mode: "3v3", targetScore: 30 };
  const members = [
    member("A", 1, "민재"),
    member("A", 2, "승환"),
    member("A", 3, "원석"),
    member("B", 1, "재현"),
    member("B", 2, "민우"),
    member("B", 3, "성민"),
  ];

  await client.initializeRace(session, members);

  assert.match(requests[0].url, /values:batchClear$/);
  assert.deepEqual(requests[0].body.ranges, ["'2팀 입력'!B16:V35"]);
  const updates = new Map(
    requests[1].body.data.map((range) => [range.range, range.values]),
  );
  assert.deepEqual(updates.get("'2팀 입력'!E3"), [[30]]);
  assert.deepEqual(updates.get("'2팀 입력'!K3"), [[-1]]);
  assert.match(updates.get("'2팀 입력'!A12")[0][0], /블루칩으로 살아남거나 치킨이면/);
  assert.deepEqual(updates.get("'2팀 입력'!A7:A10"), [
    ["1티어"],
    ["2티어"],
    ["3티어"],
    ["4티어"],
  ]);
  assert.deepEqual(updates.get("'2팀 입력'!B7:B10"), [
    ["민재"],
    ["승환"],
    ["원석"],
    [""],
  ]);
  assert.deepEqual(updates.get("'2팀 입력'!G7:G10"), [
    ["재현"],
    ["민우"],
    ["성민"],
    [""],
  ]);
  assert.match(updates.get("'2팀 점수판'!A4")[0][0], /\$H\$3\*1/);
  assert.match(updates.get("'2팀 점수판'!A5")[0][0], /\$H\$3\*2/);
  assert.match(updates.get("'2팀 점수판'!A6")[0][0], /\$H\$3\*3/);
  assert.match(updates.get("'2팀 점수판'!A7")[0][0], /\$H\$3\*4/);
});

test("팀별 경기 결과를 선수 슬롯에 맞춰 시트 한 행에 기록한다", async () => {
  const requests = [];
  const client = testClient(requests);

  await client.writeTeamMatch(
    { mode: "2v2v2" },
    {
      teamKey: "B",
      roundNumber: 2,
      mapName: "Tiger_Main",
      chicken: true,
      players: [
        { slot: 1, kills: 3, died: true },
        { slot: 2, kills: 1, died: false },
      ],
    },
  );

  const updates = new Map(
    requests[0].body.data.map((range) => [range.range, range.values]),
  );
  assert.deepEqual(updates.get("'3팀 입력'!B17"), [["태이고"]]);
  assert.deepEqual(updates.get("'3팀 입력'!I17:M17"), [[3, 1, 1, 0, 1]]);
});

function testClient(requests) {
  return new GoogleSheetsClient({
    sheetId: "sheet-id",
    accessTokenProvider: async () => "token",
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    },
  });
}

function member(teamKey, slot, displayName) {
  return { teamKey, slot, displayName };
}
