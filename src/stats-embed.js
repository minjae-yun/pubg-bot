import { EmbedBuilder } from "discord.js";
import { MODE_LABELS, summarizeModeStats } from "./stats.js";

const integerFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function integer(value) {
  return integerFormatter.format(value);
}

function decimal(value) {
  return Number.isFinite(value) ? decimalFormatter.format(value) : "∞";
}

export function buildStatsEmbed(result, mode) {
  const summary = summarizeModeStats(result.modes[mode]);
  const modeLabel = MODE_LABELS[mode] ?? mode;

  const embed = new EmbedBuilder()
    .setColor(0xf2a900)
    .setTitle(`${result.playerName}의 PUBG 전적`)
    .setDescription(`**${modeLabel} · 전체 전적**`)
    .addFields(
      {
        name: "경기 결과",
        value: [
          `경기 **${integer(summary.matches)}회**`,
          `승리 **${integer(summary.wins)}회** (${decimal(summary.winRate)}%)`,
          `Top 10 **${integer(summary.top10s)}회** (${decimal(summary.top10Rate)}%)`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "전투 기록",
        value: [
          `킬 **${integer(summary.kills)}**`,
          `K/D **${decimal(summary.kd)}**`,
          `평균 딜량 **${decimal(summary.averageDamage)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "추가 기록",
        value: [
          `헤드샷 킬 **${integer(summary.headshotKills)}**`,
          `어시스트 **${integer(summary.assists)}**`,
          `최장 킬 **${decimal(summary.longestKill)}m**`,
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({
      text: `PUBG 공식 API · ${result.platform.toUpperCase()}${result.fromCache ? " · 캐시 결과" : ""}`,
    })
    .setTimestamp();

  if (summary.matches === 0) {
    embed.setDescription(`**${modeLabel} · 전체 전적**\n이 모드에서 확인되는 경기가 없습니다.`);
  }

  return embed;
}
