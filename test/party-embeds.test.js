import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle } from "discord.js";
import {
  buildMissionDetailEmbed,
  buildPartyActiveEmbed,
  buildPartyButtons,
  buildPartyReportEmbed,
  buildPartyReviewButtons,
  buildRankingDetailEmbed,
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

test("결산 검토 화면에는 새로고침, 상세보기, 확정 버튼을 제공한다", () => {
  const row = buildPartyReviewButtons(42).toJSON();

  assert.deepEqual(
    row.components.map((button) => button.custom_id),
    [
      "party:refresh:42",
      "party:missions:42",
      "party:ranking:42",
      "party:confirm:42",
    ],
  );
  assert.equal(row.components[0].style, ButtonStyle.Primary);
  assert.equal(row.components[3].style, ButtonStyle.Success);
});

test("파티 출발 화면에 선정된 미션과 점수를 공개한다", () => {
  const embed = buildPartyActiveEmbed(
    {
      ownerUserId: "user-1",
      startedAt: "2026-08-23T00:00:00.000Z",
    },
    [{ discordUserId: "user-1" }],
    [
      {
        key: "team-12-kills",
        scope: "team",
        rewardPoints: 100,
      },
      {
        key: "personal-7-kills",
        scope: "personal",
        rewardPoints: 120,
      },
    ],
  ).toJSON();

  assert.match(embed.fields.at(-1).value, /TEAM · 팀 12킬/);
  assert.match(embed.fields.at(-1).value, /PERSONAL · 개인 7킬/);
  assert.match(embed.fields.at(-1).value, /120P/);
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
        missionPoints: 120,
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
      missionLeaders: [
        { discordUserId: "user-1", points: 120 },
      ],
      trolls: [
        {
          discordUserId: "user-1",
          trollReasons: ["아군 기절 1회"],
        },
      ],
    },
    missionReport: {
      missions: [
        {
          name: "개인 7킬",
          description: "한 경기에서 개인 7킬 이상",
          scope: "personal",
          rewardPoints: 120,
          completedBy: ["user-1"],
        },
        {
          name: "박격포 킬",
          description: "박격포로 적 처치",
          scope: "personal",
          rewardPoints: 180,
          completedBy: [],
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
  assert.match(embed.description, /미션 포인트 1위/);
  assert.doesNotMatch(embed.description, /킬왕|딜왕/);
  assert.match(embed.fields.at(-1).value, /완료 · 개인 7킬/);
  assert.match(embed.fields.at(-1).value, /미완료 · 박격포 킬/);

  const reviewEmbed = buildPartyReportEmbed(
    report,
    { startedAt: "2026-08-23T00:00:00.000Z" },
    {
      reviewing: true,
      refreshedAt: "2026-08-23T01:00:00.000Z",
    },
  ).toJSON();
  assert.equal(reviewEmbed.title, "스쿼드 결산 검토");
  assert.match(reviewEmbed.description, /아직 확정되지 않은 결산/);
  assert.match(reviewEmbed.footer.text, /결산을 확정/);

  const missionEmbed = buildMissionDetailEmbed(report).toJSON();
  assert.match(missionEmbed.fields[0].value, /개인 7킬 · 120P/);
  assert.match(missionEmbed.fields[0].value, /완료 · <@user-1>/);
  assert.match(missionEmbed.fields[0].value, /박격포 킬 · 180P/);

  const rankingEmbed = buildRankingDetailEmbed(report).toJSON();
  assert.match(rankingEmbed.description, /1위.*<@user-1>.*미션 120P/);
});
