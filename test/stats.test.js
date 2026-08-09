import test from "node:test";
import assert from "node:assert/strict";
import { summarizeModeStats } from "../src/stats.js";

test("전적 요약에서 K/D와 평균 딜량을 계산한다", () => {
  const summary = summarizeModeStats({
    roundsPlayed: 10,
    wins: 2,
    top10s: 5,
    kills: 16,
    damageDealt: 2345,
    assists: 7,
    headshotKills: 4,
    longestKill: 321.45,
  });

  assert.equal(summary.deaths, 8);
  assert.equal(summary.kd, 2);
  assert.equal(summary.averageDamage, 234.5);
  assert.equal(summary.winRate, 20);
  assert.equal(summary.top10Rate, 50);
});

test("경기 기록이 없으면 모든 비율을 0으로 처리한다", () => {
  const summary = summarizeModeStats();

  assert.equal(summary.matches, 0);
  assert.equal(summary.kd, 0);
  assert.equal(summary.averageDamage, 0);
  assert.equal(summary.winRate, 0);
  assert.equal(summary.top10Rate, 0);
});

test("승리만 기록된 경우 사망 0과 무한대 K/D를 처리한다", () => {
  const summary = summarizeModeStats({
    roundsPlayed: 1,
    wins: 1,
    kills: 3,
  });

  assert.equal(summary.deaths, 0);
  assert.equal(summary.kd, Number.POSITIVE_INFINITY);
});
