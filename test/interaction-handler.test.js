import test from "node:test";
import assert from "node:assert/strict";
import { createInteractionHandler } from "../src/interaction-handler.js";

test("/파티취소는 현재 파티를 종료한다", async () => {
  const replies = [];
  let cancelledSessionId;
  const repository = {
    getOpenPartySession() {
      return {
        id: 7,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        status: "active",
      };
    },
    cancelPartySession(sessionId) {
      cancelledSessionId = sessionId;
      return true;
    },
  };
  const handler = createInteractionHandler({ pubgApi: {}, repository });
  const interaction = commandInteraction({
    commandName: "파티취소",
    userId: "owner-1",
    replies,
  });

  await handler(interaction);

  assert.equal(cancelledSessionId, 7);
  assert.match(replies[0], /새 파티를 시작할 수 있습니다/);
});

test("파티 취소 버튼은 기존 로비의 버튼을 제거한다", async () => {
  const updates = [];
  let cancelledSessionId;
  const repository = {
    getPartySession() {
      return {
        id: 9,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        status: "active",
      };
    },
    cancelPartySession(sessionId) {
      cancelledSessionId = sessionId;
      return true;
    },
  };
  const handler = createInteractionHandler({ pubgApi: {}, repository });
  const interaction = {
    ...baseInteraction({ userId: "owner-1" }),
    customId: "party:cancel:9",
    isChatInputCommand: () => false,
    isButton: () => true,
    update: async (payload) => updates.push(payload),
  };

  await handler(interaction);

  assert.equal(cancelledSessionId, 9);
  assert.deepEqual(updates[0].components, []);
  assert.deepEqual(updates[0].embeds, []);
});

test("파티장이 출발하면 참가자 명단을 잠그고 출발 화면으로 바꾼다", async () => {
  const updates = [];
  let startedSessionId;
  let selectedMissions = [];
  const repository = {
    getPartySession() {
      return {
        id: 12,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        createdAt: "2026-08-23T00:00:00.000Z",
        startedAt: null,
        status: "recruiting",
      };
    },
    getRecentPartyMissionKeys() {
      return ["team-12-kills", "personal-7-kills"];
    },
    startPartySession(sessionId, missions) {
      startedSessionId = sessionId;
      selectedMissions = missions;
      return {
        id: sessionId,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        createdAt: "2026-08-23T00:00:00.000Z",
        startedAt: "2026-08-23T00:05:00.000Z",
        status: "active",
      };
    },
    getPartyMembers() {
      return [
        { discordUserId: "owner-1" },
        { discordUserId: "member-1" },
      ];
    },
    getPartyMissions() {
      return selectedMissions;
    },
  };
  const handler = createInteractionHandler({ pubgApi: {}, repository });
  const interaction = {
    ...baseInteraction({ userId: "owner-1" }),
    customId: "party:start:12",
    isChatInputCommand: () => false,
    isButton: () => true,
    update: async (payload) => updates.push(payload),
  };

  await handler(interaction);

  assert.equal(startedSessionId, 12);
  assert.equal(selectedMissions.length, 6);
  assert.equal(selectedMissions.filter((mission) => mission.scope === "team").length, 2);
  assert.equal(
    selectedMissions.filter((mission) => mission.scope === "personal").length,
    4,
  );
  assert.equal(
    selectedMissions.some((mission) =>
      ["team-12-kills", "personal-7-kills"].includes(mission.key),
    ),
    false,
  );
  assert.equal(updates.length, 1);
  assert.deepEqual(
    updates[0].components[0].toJSON().components.map((button) => button.custom_id),
    ["party:summary:12", "party:cancel:12"],
  );
});

test("출발한 파티의 이전 참가 버튼은 사용할 수 없다", async () => {
  const replies = [];
  const repository = {
    getPartySession() {
      return {
        id: 12,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        status: "active",
      };
    },
  };
  const handler = createInteractionHandler({ pubgApi: {}, repository });
  const interaction = {
    ...baseInteraction({ userId: "member-2" }),
    customId: "party:join:12",
    isChatInputCommand: () => false,
    isButton: () => true,
    reply: async (payload) => replies.push(payload),
  };

  await handler(interaction);

  assert.match(replies[0].content, /추가로 참가할 수 없습니다/);
});

test("파티장이 아닌 사람은 파티를 출발시킬 수 없다", async () => {
  const replies = [];
  let startCalled = false;
  const repository = {
    getPartySession() {
      return {
        id: 12,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        status: "recruiting",
      };
    },
    startPartySession() {
      startCalled = true;
    },
  };
  const handler = createInteractionHandler({ pubgApi: {}, repository });
  const interaction = {
    ...baseInteraction({ userId: "member-1" }),
    customId: "party:start:12",
    isChatInputCommand: () => false,
    isButton: () => true,
    reply: async (payload) => replies.push(payload),
  };

  await handler(interaction);

  assert.equal(startCalled, false);
  assert.match(replies[0].content, /파티장 또는 서버 관리자만/);
});

test("모집 중에는 파티 결산을 시작할 수 없다", async () => {
  const replies = [];
  const repository = {
    getOpenPartySession() {
      return {
        id: 12,
        guildId: "guild-1",
        channelId: "channel-1",
        ownerUserId: "owner-1",
        status: "recruiting",
      };
    },
  };
  const handler = createInteractionHandler({ pubgApi: {}, repository });
  const interaction = commandInteraction({
    commandName: "파티결산",
    userId: "owner-1",
    replies,
  });

  await handler(interaction);

  assert.match(replies[0].content, /파티 출발/);
});

function commandInteraction({ commandName, userId, replies }) {
  return {
    ...baseInteraction({ userId }),
    commandName,
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async (payload) => replies.push(payload),
  };
}

function baseInteraction({ userId }) {
  return {
    guildId: "guild-1",
    channelId: "channel-1",
    user: { id: userId },
    memberPermissions: { has: () => false },
    deferred: false,
    replied: false,
    inGuild: () => true,
    isAutocomplete: () => false,
  };
}
