import test from "node:test";
import assert from "node:assert/strict";
import { createRepository } from "../src/database.js";

test("플레이어 등록과 파티 세션을 SQLite에 저장한다", () => {
  const repository = createRepository(":memory:");

  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId: "user-1",
    accountId: "account-1",
    playerName: "PlayerOne",
    platform: "steam",
  });
  repository.upsertPlayer({
    guildId: "guild-1",
    discordUserId: "user-2",
    accountId: "account-2",
    playerName: "PlayerTwo",
    platform: "steam",
  });

  assert.equal(repository.getPlayer("guild-1", "user-1").playerName, "PlayerOne");

  const { session, created } = repository.createPartySession({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerUserId: "user-1",
  });

  assert.equal(created, true);
  assert.equal(repository.getPartyMembers(session.id).length, 1);
  assert.equal(repository.addPartyMember(session.id, "user-2"), true);
  assert.equal(repository.addPartyMember(session.id, "user-2"), false);
  assert.equal(repository.getPartyMembers(session.id).length, 2);
  assert.equal(repository.completePartySession(session.id), true);
  assert.equal(repository.getPartySession(session.id).status, "completed");

  const { session: cancelledSession, created: recreated } =
    repository.createPartySession({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerUserId: "user-1",
    });

  assert.equal(recreated, true);
  assert.equal(repository.cancelPartySession(cancelledSession.id), true);
  assert.equal(repository.getPartySession(cancelledSession.id).status, "completed");
  assert.equal(
    repository.createPartySession({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerUserId: "user-1",
    }).created,
    true,
  );

  repository.close();
});
