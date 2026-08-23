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
  const createdTimestamp = Math.floor(new Date(session.createdAt).getTime() / 1_000);
  const memberList = members.map((member) => `<@${member.discordUserId}>`).join("\n");

  return new EmbedBuilder()
    .setColor(0xf2a900)
    .setTitle("스쿼드 파티원을 모집합니다")
    .setDescription(
      "함께 플레이할 멤버는 아래 **파티 참가** 버튼을 눌러주세요. " +
        "모두 모이면 파티장이 **파티 출발**을 눌러 참가자 명단을 확정합니다. " +
        "경기 없이 끝낼 때는 **파티 취소**를 눌러주세요.",
    )
    .addFields(
      {
        name: "파티장",
        value: `<@${session.ownerUserId}>`,
        inline: true,
      },
      {
        name: "모집 시작",
        value: `<t:${createdTimestamp}:R>`,
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

export function buildPartyActiveEmbed(session, members) {
  const startedTimestamp = Math.floor(new Date(session.startedAt).getTime() / 1_000);
  const memberList = members.map((member) => `<@${member.discordUserId}>`).join("\n");

  return new EmbedBuilder()
    .setColor(0xb7a36a)
    .setTitle("스쿼드 파티가 출발했습니다")
    .setDescription(
      "참가자 명단이 확정되었습니다. 게임이 끝나면 파티장이 **결산하기**를 눌러주세요.",
    )
    .addFields(
      {
        name: "파티장",
        value: `<@${session.ownerUserId}>`,
        inline: true,
      },
      {
        name: "출발 시각",
        value: `<t:${startedTimestamp}:R>`,
        inline: true,
      },
      {
        name: `참가자 ${members.length}명 · 모집 마감`,
        value: memberList,
        inline: false,
      },
    );
}

export function buildPartyButtons(sessionId, status = "recruiting") {
  const buttons = [];

  if (status === "recruiting") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`party:join:${sessionId}`)
        .setLabel("파티 참가")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`party:start:${sessionId}`)
        .setLabel("파티 출발")
        .setStyle(ButtonStyle.Success),
    );
  }

  if (status === "active") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`party:summary:${sessionId}`)
        .setLabel("결산하기")
        .setStyle(ButtonStyle.Success),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`party:cancel:${sessionId}`)
      .setLabel("파티 취소")
      .setStyle(ButtonStyle.Danger),
  );

  return new ActionRowBuilder().addComponents(buttons);
}

export function buildPartyReportEmbed(report, session) {
  const awards = report.awards;
  const squadBreakerWinners = awards.squadBreaker
    .map((player) => `<@${player.discordUserId}>`)
    .join(" · ");
  const squadBreakerCount = awards.squadBreaker[0]?.squadBreakerCount ?? 0;
  const trollWinners = awards.trolls
    .map(
      (player) =>
        `<@${player.discordUserId}> (${player.trollReasons.join(", ")})`,
    )
    .join(", ");
  const awardLines = [
    awards.ace
      ? `**ACE** <@${awards.ace.discordUserId}> ` +
        `(평균 ${awards.ace.averageKills.toFixed(1)}킬 · ` +
        `${integerFormatter.format(awards.ace.averageDamage)}딜 · ` +
        `${awards.ace.averageAssists.toFixed(1)}도움)`
      : null,
    awards.squadBreaker.length > 0
      ? `**SQUAD BREAKER** ${squadBreakerWinners} ` +
        `(한 경기에서 동일 적 스쿼드 ${squadBreakerCount}명 처치)`
      : null,
    `**오늘의 씹쓰레기** ${trollWinners}`,
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
      text: "ACE는 평균 딜 + 평균 킬×100 + 평균 도움×50 기준입니다.",
    })
    .setTimestamp()
    .setAuthor({ name: `파티 시작: ${new Date(startedTimestamp * 1_000).toLocaleString("ko-KR")}` });
}

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "∞";
}
