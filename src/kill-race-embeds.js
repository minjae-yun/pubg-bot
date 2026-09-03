import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import {
  formatKillRaceMode,
  formatKillRaceScoring,
  getKillRaceMode,
} from "./kill-race-config.js";

export function buildKillRaceLobbyEmbed(summary) {
  const { session, teams } = summary;
  const mode = getKillRaceMode(session.mode);
  const createdTimestamp = Math.floor(new Date(session.createdAt).getTime() / 1_000);
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`킬내기 팀 모집 · ${formatKillRaceMode(session.mode)}`)
    .setDescription(
      [
        `목표 **${session.targetScore}점**`,
        formatKillRaceScoring(session.mode),
        "참가 버튼을 누른 순서대로 1티어부터 배치됩니다.",
        "원하는 팀 버튼을 누르면 참가하거나 팀을 옮길 수 있습니다.",
      ].join("\n"),
    )
    .setFooter({ text: "참가자는 먼저 /등록 닉네임을 완료해야 합니다." })
    .setTimestamp(new Date(session.createdAt));

  for (const teamKey of mode.teamKeys) {
    const team = teams.find((candidate) => candidate.teamKey === teamKey);
    const lines = team.players.map(
      (player) => `<@${player.discordUserId}> · ${player.playerName}`,
    );
    embed.addFields({
      name: `TEAM ${teamKey} · ${team.players.length}/${mode.playersPerTeam}`,
      value: lines.join("\n") || "아직 참가자가 없습니다.",
      inline: true,
    });
  }

  embed.addFields({
    name: "개설",
    value: `<@${session.ownerUserId}> · <t:${createdTimestamp}:R>`,
    inline: false,
  });
  return embed;
}

export function buildKillRaceActiveEmbed(summary, { addedMatches } = {}) {
  const { session, teams } = summary;
  const reached = teams.filter((team) => team.score >= session.targetScore);
  const description = [
    formatKillRaceScoring(session.mode),
    addedMatches > 0 ? `방금 **${addedMatches}개 팀 경기**를 새로 반영했습니다.` : null,
    reached.length > 0
      ? `목표 도달: ${reached.map((team) => `**TEAM ${team.teamKey}**`).join(" · ")}`
      : null,
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(reached.length > 0 ? 0x57f287 : 0x2b2d31)
    .setTitle(`킬내기 ${session.targetScore}점 · ${formatKillRaceMode(session.mode)}`)
    .setDescription(description.join("\n"));

  for (const team of teams) {
    const playerLines = team.players.map(
      (player) =>
        `${player.displayName} ${player.score} (${player.kills}-${player.deaths})`,
    );
    embed.addFields({
      name: `TEAM ${team.teamKey} ${team.score}점`,
      value: [
        ...playerLines,
        `경기 ${team.rounds} · 치킨 ${team.chickens}`,
      ].join("\n"),
      inline: true,
    });
  }

  if (session.lastSyncedAt) {
    const timestamp = Math.floor(new Date(session.lastSyncedAt).getTime() / 1_000);
    embed.setFooter({
      text: `마지막 확인: ${new Date(timestamp * 1_000).toLocaleString("ko-KR")} · PUBG API 반영 후 집계`,
    });
  }

  return embed;
}

export function buildKillRaceLobbyButtons(session) {
  const mode = getKillRaceMode(session.mode);
  const buttons = mode.teamKeys.map((teamKey) =>
    new ButtonBuilder()
      .setCustomId(`killrace:join:${teamKey}:${session.id}`)
      .setLabel(`TEAM ${teamKey} 참가`)
      .setStyle(teamKey === "A" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`killrace:start:${session.id}`)
      .setLabel("킬내기 출발")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`killrace:cancel:${session.id}`)
      .setLabel("취소")
      .setStyle(ButtonStyle.Danger),
  );

  return new ActionRowBuilder().addComponents(buttons);
}

export function buildKillRaceActiveButtons(session) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`killrace:refresh:${session.id}`)
      .setLabel("지금 갱신")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel("점수판 열기")
      .setStyle(ButtonStyle.Link)
      .setURL(session.sheetUrl),
    new ButtonBuilder()
      .setCustomId(`killrace:finish:${session.id}`)
      .setLabel("킬내기 종료")
      .setStyle(ButtonStyle.Danger),
  );
}
