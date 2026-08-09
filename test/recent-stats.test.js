import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRecentPlayerMatch,
  summarizeRecentMatches,
} from "../src/recent-stats.js";

test("매치 응답에서 지정 플레이어의 최근 경기 기록을 추출한다", () => {
  const match = {
    data: {
      id: "match-1",
      attributes: {
        createdAt: "2026-07-23T12:00:00.000Z",
        gameMode: "squad",
        matchType: "official",
        mapName: "Baltic_Main",
      },
    },
    included: [
      {
        type: "participant",
        attributes: {
          stats: {
            playerId: "account.test",
            kills: 3,
            assists: 2,
            damageDealt: 456.7,
            headshotKills: 1,
            winPlace: 4,
            timeSurvived: 1300,
            deathType: "byplayer",
          },
        },
      },
    ],
  };

  const result = extractRecentPlayerMatch(match, "account.test");

  assert.equal(result.gameMode, "squad");
  assert.equal(result.damage, 456.7);
  assert.equal(result.died, true);
});

test("최근 경기 평딜, K/D, KDA와 경기 결과를 계산한다", () => {
  const summary = summarizeRecentMatches([
    {
      kills: 2,
      assists: 1,
      damage: 300,
      headshotKills: 1,
      placement: 1,
      survivalSeconds: 1500,
      friendlyKnocks: 1,
      friendlyKnocksReceived: 2,
      died: false,
    },
    {
      kills: 1,
      assists: 2,
      damage: 100,
      headshotKills: 0,
      placement: 11,
      survivalSeconds: 600,
      friendlyKnocks: 2,
      friendlyKnocksReceived: 1,
      died: true,
    },
  ]);

  assert.equal(summary.matches, 2);
  assert.equal(summary.averageDamage, 200);
  assert.equal(summary.kd, 3);
  assert.equal(summary.kda, 6);
  assert.equal(summary.averagePlacement, 6);
  assert.equal(summary.wins, 1);
  assert.equal(summary.top10s, 1);
  assert.equal(summary.averageSurvivalSeconds, 1050);
  assert.equal(summary.friendlyKnocks, 3);
  assert.equal(summary.friendlyKnocksReceived, 3);
});

test("사망이 없고 킬이 있으면 K/D와 KDA를 무한대로 계산한다", () => {
  const summary = summarizeRecentMatches([
    {
      kills: 4,
      assists: 1,
      damage: 500,
      headshotKills: 2,
      placement: 1,
      survivalSeconds: 1800,
      died: false,
    },
  ]);

  assert.equal(summary.kd, Number.POSITIVE_INFINITY);
  assert.equal(summary.kda, Number.POSITIVE_INFINITY);
});
