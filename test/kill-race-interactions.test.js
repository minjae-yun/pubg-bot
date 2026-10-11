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
      getString: (name) => (name === "모드" ? "3v3" : null),
      getInteger: (name) => (name === "목표점수" ? 30 : null),
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async (payload) => replies.push(payload),
  };

  await handler(startInteraction);

  const session = repository.getOpenKillRaceSession("guild-1", "channel-1");
  assert.equal(session.mode, "3v3");
  assert.equal(session.targetScore, 30);
  assert.equal(session.ruleType, "score");
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

test("시간제한 킬내기를 3시간 모드로 만든다", async () => {
  const repository = createRepository(":memory:");
  register(repository, "owner-1", "account-1", "PUBGOwner", "민재");
  const handler = createInteractionHandler({
    pubgApi: {},
    repository,
    killRaceService: {
      isConfigured: () => true,
      getSheetReference: () => ({
        sheetId: "sheet-id",
        sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
      }),
    },
  });
  const replies = [];

  await handler({
    ...baseInteraction("owner-1", "민재"),
    commandName: "킬내기시작",
    options: {
      getString: (name) => (name === "모드" ? "3v3" : "timed"),
      getInteger: (name) => (name === "제한시간" ? 3 : null),
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async (payload) => replies.push(payload),
  });

  const session = repository.getOpenKillRaceSession("guild-1", "channel-1");
  assert.equal(session.ruleType, "timed");
  assert.equal(session.durationMinutes, 180);
  assert.match(replies[0].embeds[0].data.description, /시간제한 \*\*3시간\*\*/);
  repository.close();
});

test("/킬내기전적에서 전체 기록을 열고 티어별 가로 칸으로 전환한다", async () => {
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
  const repository = { getKillRaceHistory: () => history };
  const replies = [];
  const updates = [];
  const handler = createInteractionHandler({
    pubgApi: {},
    repository,
    killRaceService: {},
  });
  const commandInteraction = {
    ...baseInteraction("owner-1", "민재"),
    commandName: "킬내기전적",
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async (payload) => replies.push(payload),
  };

  await handler(commandInteraction);
  assert.equal(replies[0].embeds[0].data.title, "킬내기 전체 전적");

  const buttonInteraction = {
    ...baseInteraction("owner-1", "민재"),
    customId: "killrace:history:tiers",
    isChatInputCommand: () => false,
    isButton: () => true,
    update: async (payload) => updates.push(payload),
  };
  await handler(buttonInteraction);

  const tierEmbed = updates[0].embeds[0].toJSON();
  assert.equal(tierEmbed.title, "1티어 상대전적");
  assert.equal(tierEmbed.fields[0].inline, true);
  assert.equal(tierEmbed.fields[1].inline, true);
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
