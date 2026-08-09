import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const integerFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

export function buildPartyLobbyEmbed(session, members) {
  const startedTimestamp = Math.floor(new Date(session.startedAt).getTime() / 1_000);
  const memberList = members.map((member) => `<@${member.discordUserId}>`).join("\n");

  return new EmbedBuilder()
    .setColor(0xf2a900)
    .setTitle("🍗 스쿼드 기록을 시작했습니다")
    .setDescription(
      "함께 플레이할 멤버는 아래 **파티 참가** 버튼을 눌러주세요. " +
        "게임이 끝나면 파티장이 **결산하기**를 누르면 됩니다. " +
        "경기 없이 끝낼 때는 **파티 취소**를 눌러주세요.",
    )
    .addFields(
      {
        name: "파티장",
        value: `<@${session.ownerUserId}>`,
        inline: true,
      },
      {
        name: "시작 시각",
        value: `<t:${startedTimestamp}:R>`,
        inline: true,
      },
      {
        name: `참가자 ${members.length}/10`,
        value: memberList || "아직 참가자가 없습니다.",
        inline: false,
      },
    )
    .setFooter({ text: "참가하려면 먼저 /등록 닉네임을 실행해야 합니다." });
}

export function buildPartyButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`party:join:${sessionId}`)
      .setLabel("파티 참가")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`party:summary:${sessionId}`)
      .setLabel("결산하기")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`party:cancel:${sessionId}`)
      .setLabel("파티 취소")
      .setEmoji("🛑")
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildPartyReportEmbed(report, session) {
  const awards = report.awards;
  const trollWinners = awards.trolls
    .map(
      (player) =>
        `<@${player.discordUserId}> (${player.trollReasons.join(", ")})`,
    )
    .join(", ");
  const awardLines = [
    awards.mvp
      ? `🏆 **오늘의 MVP** <@${awards.mvp.discordUserId}> (KDA ${formatRatio(awards.mvp.kda)})`
      : null,
    awards.killKing
      ? `🎯 **킬왕** <@${awards.killKing.discordUserId}> (${integerFormatter.format(awards.killKing.kills)}킬)`
      : null,
    awards.damageKing
      ? `💥 **딜왕** <@${awards.damageKing.discordUserId}> (평균딜 ${integerFormatter.format(awards.damageKing.averageDamage)})`
      : null,
    `🤡 **오늘의 쓰레기** ${trollWinners}`,
  ].filter(Boolean);
  const playerLines = report.players.map(
    (player) =>
      `<@${player.discordUserId}> · ${player.matches}경기 · ${integerFormatter.format(player.kills)}킬 · ` +
      `KDA ${formatRatio(player.kda)} · 평균딜 ${integerFormatter.format(player.averageDamage)} · ` +
      `${player.contributionRatio.toFixed(2)}인분` +
      (player.friendlyKnocks > 0
        ? ` · 아군 기절 ${player.friendlyKnocks}회`
        : "") +
      (player.friendlyKills > 0 ? ` · 팀킬 ${player.friendlyKills}회` : ""),
  );
  const startedTimestamp = Math.floor(new Date(session.startedAt).getTime() / 1_000);

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🍗 오늘의 스쿼드 결산")
    .setDescription(awardLines.join("\n"))
    .addFields(
      {
        name: "팀 기록",
        value: [
          `함께한 경기 **${integerFormatter.format(report.matches)}경기**`,
          `최고 순위 **${integerFormatter.format(report.bestPlacement)}위**`,
          `팀 전체 킬 **${integerFormatter.format(report.totalKills)}킬**`,
          `경기당 팀 딜량 **${integerFormatter.format(report.averageTeamDamage)}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "플레이어 기록",
        value: playerLines.join("\n"),
        inline: false,
      },
    )
    .setFooter({
      text: "MVP는 파티 기간 KDA, 킬왕은 총킬, 딜왕은 평균딜 기준입니다.",
    })
    .setTimestamp()
    .setAuthor({ name: `파티 시작: ${new Date(startedTimestamp * 1_000).toLocaleString("ko-KR")}` });
}

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "∞";
}
