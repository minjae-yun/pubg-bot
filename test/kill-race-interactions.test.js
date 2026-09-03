import test from "node:test";
import assert from "node:assert/strict";
import { createRepository } from "../src/database.js";
import { createInteractionHandler } from "../src/interaction-handler.js";

test("일반 파티가 있어도 별도 3대3 킬내기를 만들고 팀을 선택한다", async () => {
  const repository = createRepository(":memory:");
  register(repository, "owner-1", "account-1", "PUBGOwner", "민재");
  register(repository, "member-1", "account-2", "PUBGMember", "승환");
  repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: "owner-1",
  });
  const killRaceService = {
    isConfigured: () => true,
    getSheetReference: () => ({
      sheetId: "sheet-id",
      sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
    }),
  };
  const replies = [];
  const handler = createInteractionHandler({
    pubgApi: {},
    repository,
    killRaceService,
  });
  const startInteraction = {
    ...baseInteraction("owner-1", "DiscordOwner"),
    commandName: "킬내기시작",
    options: {
      getString: () => "3v3",
      getInteger: () => 30,
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async (payload) => replies.push(payload),
  };

  await handler(startInteraction);

  const session = repository.getOpenKillRaceSession("guild-1", "channel-1");
  assert.equal(session.mode, "3v3");
  assert.equal(session.targetScore, 30);
  assert.equal(repository.getKillRaceMembers(session.id)[0].displayName, "민재");
  assert.equal(repository.getOpenPartySession("guild-1", "channel-1").status, "recruiting");
  assert.match(replies[0].embeds[0].data.title, /3대3/);

  const updates = [];
  const joinInteraction = {
    ...baseInteraction("member-1", "DiscordMember"),
    customId: `killrace:join:B:${session.id}`,
    isChatInputCommand: () => false,
    isButton: () => true,
    update: async (payload) => updates.push(payload),
  };
  await handler(joinInteraction);

  const member = repository
    .getKillRaceMembers(session.id)
    .find((candidate) => candidate.discordUserId === "member-1");
  assert.equal(member.teamKey, "B");
  assert.equal(member.displayName, "승환");
  assert.equal(updates.length, 1);
  repository.close();
});

function register(
  repository,
  discordUserId,
  accountId,
  playerName,
  displayName,
) {
  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId,
    accountId,
    playerName,
    displayName,
    platform: "steam",
  });
}

function baseInteraction(userId, displayName) {
  return {
    guildId: "guild-1",
    channelId: "channel-1",
    user: { id: userId, username: displayName },
    member: { displayName },
    memberPermissions: { has: () => false },
    deferred: false,
    replied: false,
    inGuild: () => true,
    isAutocomplete: () => false,
  };
}
