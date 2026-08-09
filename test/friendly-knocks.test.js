import test from "node:test";
import assert from "node:assert/strict";
import {
  countFriendlyKnocks,
  countFriendlyKnockStats,
} from "../src/friendly-knocks.js";

test("같은 팀원을 기절시킨 이벤트만 아군 기절로 계산한다", () => {
  const events = [
    groggyEvent("knock-1", "account-1", 10, "account-2", 10),
    groggyEvent("knock-2", "account-1", 10, "enemy-1", 20),
    groggyEvent("knock-3", "account-1", 10, "account-1", 10),
    { _T: "LogPlayerTakeDamage" },
  ];

  const counts = countFriendlyKnocks(events, ["account-1"]);

  assert.equal(counts.get("account-1"), 1);
});

test("같은 기절 이벤트가 중복되면 한 번만 계산한다", () => {
  const event = groggyEvent("knock-1", "account-1", 10, "account-2", 10);
  const counts = countFriendlyKnocks([event, { ...event }], ["account-1"]);

  assert.equal(counts.get("account-1"), 1);
});

test("아군에게 기절당한 횟수를 피해자 기준으로 계산한다", () => {
  const events = [
    groggyEvent("knock-1", "teammate-1", 10, "account-1", 10),
    groggyEvent("knock-2", "enemy-1", 20, "account-1", 10),
  ];
  const stats = countFriendlyKnockStats(events, ["account-1"]);

  assert.equal(stats.inflicted.get("account-1"), 0);
  assert.equal(stats.received.get("account-1"), 1);
});

function groggyEvent(dBNOId, attackerId, attackerTeamId, victimId, victimTeamId) {
  return {
    _T: "LogPlayerMakeGroggy",
    dBNOId,
    attacker: { accountId: attackerId, teamId: attackerTeamId },
    victim: { accountId: victimId, teamId: victimTeamId },
  };
}
