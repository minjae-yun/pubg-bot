import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle } from "discord.js";
import { buildPartyButtons } from "../src/party-embeds.js";

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
