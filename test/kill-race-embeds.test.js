import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKillRaceActiveButtons,
  buildKillRaceActiveEmbed,
  buildKillRaceLobbyButtons,
} from "../src/kill-race-embeds.js";

const session = {
  id: 7,
  mode: "3v3",
  targetScore: 30,
  sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
};

test("3대3 모집 카드에는 두 팀 참가·출발·취소 버튼이 있다", () => {
  const buttonIds = buildKillRaceLobbyButtons(session)
    .toJSON()
    .components.map((button) => button.custom_id);

  assert.deepEqual(buttonIds, [
    "killrace:join:A:7",
    "killrace:join:B:7",
    "killrace:start:7",
    "killrace:cancel:7",
  ]);
});

test("진행 카드와 시트에 표시할 선수 점수 형식을 맞춘다", () => {
  const summary = {
    session,
    teams: [
      {
        teamKey: "A",
        score: 12,
        rounds: 2,
        chickens: 1,
        players: [
          { displayName: "민재", score: 3, kills: 4, deaths: 1 },
          { displayName: "승환", score: 1, kills: 1, deaths: 1 },
        ],
      },
      { teamKey: "B", score: 0, rounds: 0, chickens: 0, players: [] },
    ],
  };
  const embed = buildKillRaceActiveEmbed(summary).toJSON();
  const buttons = buildKillRaceActiveButtons(session).toJSON().components;

  assert.equal(embed.fields[0].name, "TEAM A 12점");
  assert.match(embed.description, /1티어.*\+1.*2티어.*\+2.*3티어.*\+3/);
  assert.match(embed.fields[0].value, /민재 3 \(4-1\)/);
  assert.equal(buttons[1].url, session.sheetUrl);
});
