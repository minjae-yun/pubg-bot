import test from "node:test";
import assert from "node:assert/strict";
import { createInteractionHandler } from "../src/interaction-handler.js";

test("/파티취소는 현재 파티를 종료한다", async () => {
  const replies = [];
  let cancelledSessionId;
  const repository = {
    getActivePartySession() {
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
