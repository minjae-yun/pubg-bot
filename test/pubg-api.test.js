import test from "node:test";
import assert from "node:assert/strict";
import { PubgApiClient } from "../src/pubg-api.js";

test("PUBG 플레이어와 평생 전적을 조회하고 같은 닉네임은 캐시한다", async () => {
  const requestedUrls = [];
  const responses = [
    {
      data: [
        {
          id: "account.test",
          attributes: { name: "TestPlayer" },
        },
      ],
    },
    {
      data: {
        attributes: {
          gameModeStats: {
            "squad-fpp": { roundsPlayed: 3, wins: 1 },
          },
        },
      },
    },
  ];

  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = new PubgApiClient({
    apiKey: "test-key",
    fetchImpl,
    cacheTtlMs: 60_000,
  });

  const first = await client.getLifetimeStatsByPlayerName("TestPlayer");
  const second = await client.getLifetimeStatsByPlayerName("testplayer");

  assert.equal(first.playerName, "TestPlayer");
  assert.equal(first.modes["squad-fpp"].wins, 1);
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /players\?filter%5BplayerNames%5D=TestPlayer/);
  assert.match(requestedUrls[1], /players\/account.test\/seasons\/lifetime/);
});

test("매치의 텔레메트리 URL을 찾아 조회하고 캐시한다", async () => {
  const requestedUrls = [];
  const events = [{ _T: "LogPlayerMakeGroggy", dBNOId: 1 }];
  const client = new PubgApiClient({
    apiKey: "test-key",
    cacheTtlMs: 60_000,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify(events), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const match = {
    data: {
      relationships: {
        assets: { data: [{ type: "asset", id: "asset-1" }] },
      },
    },
    included: [
      {
        type: "asset",
        id: "asset-1",
        attributes: { URL: "https://telemetry.example/match.json" },
      },
    ],
  };

  const first = await client.getTelemetry(match);
  const second = await client.getTelemetry(match);

  assert.deepEqual(first, events);
  assert.deepEqual(second, events);
  assert.deepEqual(requestedUrls, ["https://telemetry.example/match.json"]);
});
