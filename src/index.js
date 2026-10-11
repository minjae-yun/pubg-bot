import { Client, Events, GatewayIntentBits } from "discord.js";
import { createRepository } from "./database.js";
import { createMatchDataCollector } from "./data-collection/sanhok-collector.js";
import { optionalEnv, positiveNumberEnv, requireEnv } from "./env.js";
import { createInteractionHandler } from "./interaction-handler.js";
import { createGoogleSheetsClient } from "./google-sheets.js";
import { buildKillRaceActiveEmbed } from "./kill-race-embeds.js";
import { KillRaceService } from "./kill-race-service.js";
import { PubgApiClient } from "./pubg-api.js";

const discordToken = requireEnv("DISCORD_TOKEN");
const allowedChannelId = optionalEnv("ALLOWED_CHANNEL_ID");
const pubgPlatform = optionalEnv("PUBG_PLATFORM", "steam");
const cacheTtlMs = positiveNumberEnv("CACHE_TTL_SECONDS", 120) * 1_000;
const databasePath = optionalEnv("DATABASE_PATH", "data/bot.sqlite");
const telemetryArchivePath = optionalEnv(
  "TELEMETRY_ARCHIVE_PATH",
  "data/telemetry",
);
const killRaceSheetId = optionalEnv("KILL_RACE_SHEET_ID");
const killRaceSheetUrl = optionalEnv("KILL_RACE_SHEET_URL");
const googleServiceAccountKeyPath = optionalEnv(
  "GOOGLE_SERVICE_ACCOUNT_KEY_PATH",
);
const killRaceRefreshIntervalMs =
  positiveNumberEnv("KILL_RACE_AUTO_REFRESH_SECONDS", 20) * 1_000;

const pubgApi = new PubgApiClient({
  apiKey: requireEnv("PUBG_API_KEY"),
  platform: pubgPlatform,
  cacheTtlMs,
});
const repository = createRepository(databasePath);
const dataCollector = createMatchDataCollector({
  repository,
  archiveRoot: telemetryArchivePath,
});
let sheets;
if (killRaceSheetId && googleServiceAccountKeyPath) {
  try {
    sheets = createGoogleSheetsClient({
      sheetId: killRaceSheetId,
      credentialsPath: googleServiceAccountKeyPath,
    });
  } catch (error) {
    console.error("Google 시트 설정을 불러오지 못했습니다:", error.message);
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const killRaceService = new KillRaceService({
  pubgApi,
  repository,
  sheets,
  sheetUrl: killRaceSheetUrl,
  refreshIntervalMs: killRaceRefreshIntervalMs,
  onAutoComplete: async (result) => {
    const channel = await client.channels.fetch(result.summary.session.channelId);
    if (!channel?.isTextBased() || typeof channel.send !== "function") {
      throw new Error("자동 종료 결과를 보낼 수 있는 채널이 아닙니다.");
    }

    await channel.send({
      content: "시간제한 킬내기가 자동 종료되었습니다.",
      embeds: [buildKillRaceActiveEmbed(result.summary, result)],
    });
  },
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`${readyClient.user.tag} 치킨로그 봇이 준비되었습니다.`);
  if (killRaceService.isConfigured()) {
    killRaceService.startPolling();
    console.log(
      `킬내기 점수판을 ${killRaceRefreshIntervalMs / 1_000}초마다 확인합니다.`,
    );
  } else {
    console.log("킬내기 Google 시트 연결은 아직 비활성화되어 있습니다.");
  }
});

client.on(
  Events.InteractionCreate,
  createInteractionHandler({
    pubgApi,
    repository,
    allowedChannelId,
    dataCollector,
    killRaceService,
  }),
);

client.on(Events.Error, (error) => {
  console.error("Discord 클라이언트 오류:", error.message);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    killRaceService.stopPolling();
    repository.close();
    client.destroy();
    process.exit(0);
  });
}

await client.login(discordToken);
