import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle } from "discord.js";
import {
  buildPartyButtons,
  buildPartyReportEmbed,
} from "../src/party-embeds.js";

test("파티 모집 중에는 참가, 출발, 취소 버튼을 제공한다", () => {
  const row = buildPartyButtons(42).toJSON();

  assert.deepEqual(
    row.components.map((button) => button.custom_id),
    ["party:join:42", "party:start:42", "party:cancel:42"],
  );
  assert.equal(row.components[2].label, "파티 취소");
  assert.equal(row.components[2].style, ButtonStyle.Danger);
});

test("파티 출발 후에는 결산과 취소 버튼만 제공한다", () => {
  const row = buildPartyButtons(42, "active").toJSON();

  assert.deepEqual(
    row.components.map((button) => button.custom_id),
    ["party:summary:42", "party:cancel:42"],
  );
});

test("결산 화면에 ACE와 공동 SQUAD BREAKER를 표시한다", () => {
  const ace = {
    discordUserId: "user-1",
    averageKills: 3.5,
    averageDamage: 520,
    averageAssists: 1,
  };
  const report = {
    matches: 2,
    bestPlacement: 1,
    totalKills: 12,
    averageTeamDamage: 1400,
    players: [
      {
        ...ace,
        matches: 2,
        kills: 7,
        kda: 4,
        contributionRatio: 1.2,
        friendlyKnocks: 0,
        friendlyKills: 0,
      },
    ],
    awards: {
      ace,
      squadBreaker: [
        { discordUserId: "user-1", squadBreakerCount: 3 },
        { discordUserId: "user-2", squadBreakerCount: 3 },
      ],
      trolls: [
        {
          discordUserId: "user-1",
          trollReasons: ["아군 기절 1회"],
        },
      ],
    },
  };

  const embed = buildPartyReportEmbed(report, {
    startedAt: "2026-08-23T00:00:00.000Z",
  }).toJSON();

  assert.match(embed.description, /\*\*ACE\*\*/);
  assert.match(embed.description, /<@user-1> · <@user-2>/);
  assert.match(embed.description, /동일 적 스쿼드 3명 처치/);
  assert.match(embed.description, /오늘의 씹쓰레기/);
  assert.doesNotMatch(embed.description, /킬왕|딜왕/);
});
