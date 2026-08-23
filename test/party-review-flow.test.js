import test from "node:test";
import assert from "node:assert/strict";
import { createRepository } from "../src/database.js";
import { createInteractionHandler } from "../src/interaction-handler.js";

test("늦게 반영된 마지막 경기를 새로고침으로 추가한 뒤 결산을 확정한다", async () => {
  const repository = createRepository(":memory:");
  registerPlayer(repository, "owner-1", "account-1", "PlayerOne");
  registerPlayer(repository, "member-1", "account-2", "PlayerTwo");

  const { session } = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: "owner-1",
  });
  repository.addPartyMember(session.id, "member-1");
  repository.startPartySession(session.id, [
    { key: "team-12-kills", scope: "team", rewardPoints: 100 },
    { key: "personal-7-kills", scope: "personal", rewardPoints: 120 },
  ]);

  const now = Date.now();
  const startedAt = new Date(now - 10 * 60_000).toISOString();
  repository.database
    .prepare("UPDATE party_sessions SET started_at = ? WHERE id = ?")
    .run(startedAt, session.id);

  const matches = new Map([
    [
      "match-1",
      rawMatch({
        id: "match-1",
        createdAt: new Date(now - 8 * 60_000).toISOString(),
        ownerKills: 7,
        memberKills: 5,
      }),
    ],
    [
      "match-2",
      rawMatch({
        id: "match-2",
        createdAt: new Date(now - 3 * 60_000).toISOString(),
        ownerKills: 8,
        memberKills: 4,
      }),
    ],
  ]);
  let visibleMatchIds = ["match-1"];
  const pubgApi = {
    platform: "steam",
    async getPlayersByAccountIds(accountIds) {
      return accountIds.map((accountId) => ({
        accountId,
        matchIds: visibleMatchIds,
      }));
    },
    async getMatches(matchIds) {
      return matchIds.map((matchId) => matches.get(matchId));
    },
    async getTelemetries(rawMatches) {
      return rawMatches.map(() => []);
    },
  };
  const handler = createInteractionHandler({ pubgApi, repository });

  const first = buttonInteraction(`party:summary:${session.id}`);
  await handler(first.interaction);

  assert.equal(first.deferUpdateCalls.length, 1);
  assert.equal(repository.getPartySession(session.id).status, "reviewing");
  assert.equal(repository.getPartySession(session.id).syncedMatchCount, 1);
  assert.equal(repository.getPartyReviewSnapshot(session.id).report.matches, 1);
  assert.deepEqual(
    first.editReplies[0].components[0]
      .toJSON()
      .components.map((button) => button.custom_id),
    [
      `party:refresh:${session.id}`,
      `party:missions:${session.id}`,
      `party:ranking:${session.id}`,
      `party:confirm:${session.id}`,
    ],
  );
  assert.equal(repository.getMissionCompletions(session.id).length, 3);

  visibleMatchIds = ["match-2", "match-1"];
  const refresh = buttonInteraction(`party:refresh:${session.id}`);
  await handler(refresh.interaction);

  assert.equal(repository.getPartySession(session.id).status, "reviewing");
  assert.equal(repository.getPartySession(session.id).syncedMatchCount, 2);
  assert.equal(repository.getPartyReviewSnapshot(session.id).report.matches, 2);
  assert.equal(repository.getMissionCompletions(session.id).length, 3);
  assert.match(
    refresh.editReplies[0].embeds[0].toJSON().fields[0].value,
    /함께한 경기 \*\*2경기\*\*/,
  );

  const confirm = buttonInteraction(`party:confirm:${session.id}`);
  await handler(confirm.interaction);

  assert.equal(repository.getPartySession(session.id).status, "completed");
  assert.deepEqual(confirm.updates[0].components, []);
  assert.equal(confirm.updates[0].embeds[0].toJSON().title, "🍗 오늘의 스쿼드 결산");
  repository.close();
});

function registerPlayer(repository, discordUserId, accountId, playerName) {
  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId,
    accountId,
    playerName,
    platform: "steam",
  });
}

function rawMatch({ id, createdAt, ownerKills, memberKills }) {
  return {
    data: {
      id,
      attributes: {
        createdAt,
        gameMode: "squad",
        mapName: "Baltic_Main",
      },
    },
    included: [
      participant({
        accountId: "account-1",
        playerName: "PlayerOne",
        kills: ownerKills,
        damage: ownerKills * 100,
      }),
      participant({
        accountId: "account-2",
        playerName: "PlayerTwo",
        kills: memberKills,
        damage: memberKills * 100,
      }),
    ],
  };
}

function participant({ accountId, playerName, kills, damage }) {
  return {
    type: "participant",
    attributes: {
      stats: {
        playerId: accountId,
        name: playerName,
        kills,
        damageDealt: damage,
        assists: 1,
        revives: 0,
        headshotKills: 0,
        longestKill: 100,
        teamKills: 0,
        deathType: "byplayer",
        winPlace: 2,
        timeSurvived: 1_200,
      },
    },
  };
}

function buttonInteraction(customId) {
  const deferUpdateCalls = [];
  const editReplies = [];
  const updates = [];
  const replies = [];
  const followUps = [];
  let deferred = false;
  const interaction = {
    customId,
    guildId: "guild-1",
    channelId: "channel-1",
    user: { id: "owner-1" },
    memberPermissions: { has: () => false },
    get deferred() {
      return deferred;
    },
    replied: false,
    inGuild: () => true,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    deferUpdate: async () => {
      deferred = true;
      deferUpdateCalls.push(true);
    },
    editReply: async (payload) => editReplies.push(payload),
    update: async (payload) => updates.push(payload),
    reply: async (payload) => replies.push(payload),
    followUp: async (payload) => followUps.push(payload),
  };

  return {
    interaction,
    deferUpdateCalls,
    editReplies,
    updates,
    replies,
    followUps,
  };
}
