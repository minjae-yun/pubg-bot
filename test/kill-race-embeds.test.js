import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKillRaceActiveButtons,
  buildKillRaceActiveEmbed,
  buildKillRaceHistoryButtons,
  buildKillRaceHistoryEmbed,
  buildKillRaceLobbyButtons,
  buildKillRaceLobbyEmbed,
  buildKillRaceTierEmbeds,
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
          { displayName: "민재", tier: 1, score: 3, kills: 4, deaths: 1 },
          { displayName: "승환", tier: 2, score: 1, kills: 1, deaths: 1 },
        ],
      },
      { teamKey: "B", score: 0, rounds: 0, chickens: 0, players: [] },
    ],
  };
  const embed = buildKillRaceActiveEmbed(summary).toJSON();
  const buttons = buildKillRaceActiveButtons(session).toJSON().components;

  assert.equal(embed.fields[0].name, "TEAM A 12점");
  assert.match(embed.description, /1티어.*\+1.*2티어.*\+2.*3티어.*\+3/);
  assert.match(embed.fields[0].value, /1티어 민재 3점 \(4K-1D\)/);
  assert.doesNotMatch(embed.fields[0].value, /경기|치킨/);
  assert.equal(buttons[1].url, session.sheetUrl);
});

test("시간제한 모집·진행·종료 카드에 남은 시간과 승자를 표시한다", () => {
  const timedSession = {
    ...session,
    ruleType: "timed",
    durationMinutes: 180,
    status: "active",
    createdAt: "2026-09-03T09:00:00.000Z",
    expiresAt: "2026-09-03T12:00:00.000Z",
  };
  const summary = {
    session: timedSession,
    teams: [
      { teamKey: "A", score: 18, players: [] },
      { teamKey: "B", score: 15, players: [] },
    ],
  };

  const lobby = buildKillRaceLobbyEmbed(summary).toJSON();
  const active = buildKillRaceActiveEmbed(summary).toJSON();
  const completed = buildKillRaceActiveEmbed({
    ...summary,
    session: { ...timedSession, status: "completed" },
  }).toJSON();

  assert.match(lobby.description, /시간제한 \*\*3시간\*\*/);
  assert.equal(active.title, "킬내기 3시간 · 3대3");
  assert.match(active.description, /자동 종료:/);
  assert.match(completed.description, /TEAM A 승리/);
});

test("전체 전적과 티어별 상대전적을 별도 화면으로 구성한다", () => {
  const history = {
    raceCount: 2,
    matchCount: 8,
    players: [
      {
        displayName: "민재",
        races: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        kills: 34,
        deaths: 26,
        chickens: 1,
        score: 8,
      },
      {
        displayName: "승환",
        races: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        kills: 20,
        deaths: 17,
        chickens: 0,
        score: 3,
      },
    ],
    tiers: [
      {
        tier: 1,
        players: [
          {
            displayName: "민재",
            wins: 1,
            draws: 0,
            losses: 1,
            kills: 34,
            deaths: 26,
            score: 8,
          },
          {
            displayName: "승환",
            wins: 1,
            draws: 0,
            losses: 1,
            kills: 20,
            deaths: 17,
            score: 3,
          },
        ],
      },
    ],
  };

  const overall = buildKillRaceHistoryEmbed(history).toJSON();
  const tiers = buildKillRaceTierEmbeds(history).map((embed) => embed.toJSON());
  const overallButtons = buildKillRaceHistoryButtons("overall").toJSON().components;

  assert.equal(overall.title, "킬내기 전체 전적");
  assert.match(overall.description, /민재.*1승 0무 1패/s);
  assert.equal(tiers[0].title, "1티어 상대전적");
  assert.deepEqual(
    tiers[0].fields.map((field) => [field.name, field.value, field.inline]),
    [
      ["민재", "1승 0무 1패\n34K-26D · 8점", true],
      ["승환", "1승 0무 1패\n20K-17D · 3점", true],
    ],
  );
  assert.equal(overallButtons[0].disabled, true);
  assert.equal(overallButtons[1].custom_id, "killrace:history:tiers");
});

test("한 티어에 선수가 많아도 두 명씩 한 줄에 배치한다", () => {
  const player = (displayName) => ({
    displayName,
    wins: 1,
    draws: 0,
    losses: 0,
    kills: 1,
    deaths: 1,
    score: 0,
  });
  const [embed] = buildKillRaceTierEmbeds({
    tiers: [
      {
        tier: 1,
        players: [player("민재"), player("승환"), player("유림")],
      },
    ],
  }).map((value) => value.toJSON());

  assert.deepEqual(
    embed.fields.map((field) => [field.name, field.inline]),
    [
      ["민재", true],
      ["승환", true],
      ["\u200b", false],
      ["유림", true],
      ["\u200b", true],
    ],
  );
});
