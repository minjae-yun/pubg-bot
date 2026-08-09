import { EmbedBuilder } from "discord.js";
import { summarizeRecentMatches } from "./recent-stats.js";
import { MODE_LABELS } from "./stats.js";

const integerFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function buildRecentStatsEmbed({
  playerName,
  platform,
  mode,
  matches,
  requestedCount,
  friendlyKnocksStatus = "ready",
}) {
  const summary = summarizeRecentMatches(matches);
  const modeLabel = MODE_LABELS[mode] ?? mode;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${playerName}의 최근 경기 전적`)
    .setDescription(`**${modeLabel} · 최근 ${summary.matches}경기**`)
    .setFooter({
      text: `PUBG 공식 API · ${platform.toUpperCase()} · 최근 14일 내 제공 매치 기준`,
    })
    .setTimestamp();

  if (summary.matches === 0) {
    return embed.setDescription(
      `**${modeLabel}**\n최근 제공된 매치에서 이 모드의 경기 기록을 찾지 못했습니다.`,
    );
  }

  embed.addFields(
    {
      name: "핵심 지표",
      value: [
        `평균 딜량 **${decimal(summary.averageDamage)}**`,
        `K/D **${decimal(summary.kd)}**`,
        `KDA **${decimal(summary.kda)}**`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "경기 결과",
      value: [
        `승리 **${integer(summary.wins)}회** (${decimal(summary.winRate)}%)`,
        `Top 10 **${integer(summary.top10s)}회** (${decimal(summary.top10Rate)}%)`,
        `평균 순위 **${decimal(summary.averagePlacement)}위**`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "전투 기록",
      value: [
        `킬 **${integer(summary.kills)}** · 어시스트 **${integer(summary.assists)}**`,
        `헤드샷 킬 **${integer(summary.headshotKills)}**`,
        friendlyKnockLine(summary.friendlyKnocks, friendlyKnocksStatus),
        friendlyKnockReceivedLine(
          summary.friendlyKnocksReceived,
          friendlyKnocksStatus,
        ),
        `평균 생존 **${formatDuration(summary.averageSurvivalSeconds)}**`,
      ].join("\n"),
      inline: false,
    },
  );

  if (summary.matches < requestedCount) {
    embed.setDescription(
      `**${modeLabel} · 최근 ${summary.matches}경기**\n요청한 ${requestedCount}경기 중 API에서 확인 가능한 경기만 반영했습니다.`,
    );
  }

  return embed;
}

function friendlyKnockReceivedLine(count, status) {
  if (status === "pending") {
    return "아군에게 기절당함 **집계 중…**";
  }

  if (status === "unavailable") {
    return "아군에게 기절당함 **집계 실패**";
  }

  return `아군에게 기절당함 **${integer(count)}회**`;
}

function friendlyKnockLine(count, status) {
  if (status === "pending") {
    return "아군 기절 **집계 중…**";
  }

  if (status === "unavailable") {
    return "아군 기절 **집계 실패**";
  }

  return `아군 기절 **${integer(count)}회**`;
}

function integer(value) {
  return integerFormatter.format(value);
}

function decimal(value) {
  return Number.isFinite(value) ? decimalFormatter.format(value) : "∞";
}

function formatDuration(seconds) {
  const rounded = Math.max(Math.round(seconds), 0);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}분 ${remainingSeconds}초`;
}
