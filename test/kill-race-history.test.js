import test from "node:test";
import assert from "node:assert/strict";
import { summarizeKillRaceHistory } from "../src/kill-race-history.js";

test("완료된 킬내기를 전체 전적과 동일 티어 상대전적으로 집계한다", () => {
  const history = summarizeKillRaceHistory([
    {
      teams: [
        {
          teamKey: "A",
          score: 11,
          rounds: 2,
          chickens: 1,
          players: [
            {
              discordUserId: "user-a1",
              displayName: "민재",
              tier: 1,
              score: 2,
              kills: 3,
              deaths: 1,
            },
            {
              discordUserId: "user-a2",
              displayName: "건우",
              tier: 2,
              score: 1,
              kills: 1,
              deaths: 1,
            },
          ],
        },
        {
          teamKey: "B",
          score: 3,
          rounds: 2,
          chickens: 0,
          players: [
            {
              discordUserId: "user-b1",
              displayName: "승환",
              tier: 1,
              score: 0,
              kills: 1,
              deaths: 1,
            },
            {
              discordUserId: "user-b2",
              displayName: "유림",
              tier: 2,
              score: 3,
              kills: 2,
              deaths: 1,
            },
          ],
        },
      ],
    },
  ]);

  assert.equal(history.raceCount, 1);
  assert.equal(history.matchCount, 4);
  assert.deepEqual(
    history.players.map((player) => player.displayName),
    ["유림", "민재", "건우", "승환"],
  );
  const minjae = history.players.find((player) => player.displayName === "민재");
  assert.deepEqual(
    {
      races: minjae.races,
      matches: minjae.matches,
      wins: minjae.wins,
      draws: minjae.draws,
      losses: minjae.losses,
      kills: minjae.kills,
      deaths: minjae.deaths,
      chickens: minjae.chickens,
      score: minjae.score,
    },
    {
      races: 1,
      matches: 2,
      wins: 1,
      draws: 0,
      losses: 0,
      kills: 3,
      deaths: 1,
      chickens: 1,
      score: 2,
    },
  );
  assert.deepEqual(
    history.tiers[0].players.map((player) => [
      player.displayName,
      player.wins,
      player.draws,
      player.losses,
    ]),
    [
      ["민재", 1, 0, 0],
      ["승환", 0, 0, 1],
    ],
  );
  assert.deepEqual(
    history.tiers[1].players.map((player) => [
      player.displayName,
      player.wins,
      player.draws,
      player.losses,
    ]),
    [
      ["유림", 1, 0, 0],
      ["건우", 0, 0, 1],
    ],
  );
});

test("동일 티어 개인점수가 같으면 둘 다 무승부로 기록한다", () => {
  const history = summarizeKillRaceHistory([
    {
      teams: [
        {
          teamKey: "A",
          score: 0,
          rounds: 1,
          chickens: 0,
          players: [
            {
              discordUserId: "user-a",
              displayName: "민재",
              tier: 1,
              score: 0,
              kills: 1,
              deaths: 1,
            },
          ],
        },
        {
          teamKey: "B",
          score: 0,
          rounds: 1,
          chickens: 0,
          players: [
            {
              discordUserId: "user-b",
              displayName: "승환",
              tier: 1,
              score: 0,
              kills: 1,
              deaths: 1,
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(
    history.tiers[0].players.map((player) => [player.wins, player.draws, player.losses]),
    [
      [0, 1, 0],
      [0, 1, 0],
    ],
  );
});
