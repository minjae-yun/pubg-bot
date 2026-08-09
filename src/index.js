import { Client, Events, GatewayIntentBits } from "discord.js";
import { createRepository } from "./database.js";
import { optionalEnv, positiveNumberEnv, requireEnv } from "./env.js";
import { createInteractionHandler } from "./interaction-handler.js";
import { PubgApiClient } from "./pubg-api.js";

const discordToken = requireEnv("DISCORD_TOKEN");
const allowedChannelId = optionalEnv("ALLOWED_CHANNEL_ID");
const pubgPlatform = optionalEnv("PUBG_PLATFORM", "steam");
const cacheTtlMs = positiveNumberEnv("CACHE_TTL_SECONDS", 120) * 1_000;
const databasePath = optionalEnv("DATABASE_PATH", "data/bot.sqlite");

const pubgApi = new PubgApiClient({
  apiKey: requireEnv("PUBG_API_KEY"),
  platform: pubgPlatform,
  cacheTtlMs,
});
const repository = createRepository(databasePath);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`${readyClient.user.tag} 치킨로그 봇이 준비되었습니다.`);
});

client.on(
  Events.InteractionCreate,
  createInteractionHandler({ pubgApi, repository, allowedChannelId }),
);

client.on(Events.Error, (error) => {
  console.error("Discord 클라이언트 오류:", error.message);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    repository.close();
    client.destroy();
    process.exit(0);
  });
}

await client.login(discordToken);
