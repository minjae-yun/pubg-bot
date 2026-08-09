import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { optionalEnv, requireEnv } from "./env.js";

const token = requireEnv("DISCORD_TOKEN");
const clientId = requireEnv("DISCORD_CLIENT_ID");
const registerGlobally = optionalEnv("REGISTER_GLOBALLY", "false").toLowerCase() === "true";
const rest = new REST({ version: "10" }).setToken(token);
const body = commands.map((command) => command.toJSON());

if (registerGlobally) {
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log("전역 디스코드 명령어 등록을 완료했습니다.");
} else {
  const guildId = requireEnv("DISCORD_GUILD_ID");
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log(`테스트 서버(${guildId})에 디스코드 명령어 등록을 완료했습니다.`);
}
