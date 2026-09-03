import { MessageFlags, PermissionFlagsBits } from "discord.js";
import {
  killRaceEndCommand,
  killRaceStartCommand,
  killRaceStatusCommand,
} from "./commands.js";
import { getKillRaceMode } from "./kill-race-config.js";
import {
  buildKillRaceActiveButtons,
  buildKillRaceActiveEmbed,
  buildKillRaceLobbyButtons,
  buildKillRaceLobbyEmbed,
} from "./kill-race-embeds.js";

export class KillRaceUserError extends Error {}

export async function handleKillRaceCommand(
  interaction,
  { repository, killRaceService },
) {
  switch (interaction.commandName) {
    case killRaceStartCommand.name:
      await handleStartCommand(interaction, repository, killRaceService);
      return true;
    case killRaceStatusCommand.name:
      await handleStatusCommand(interaction, repository);
      return true;
    case killRaceEndCommand.name:
      await handleEndCommand(interaction, repository);
      return true;
    default:
      return false;
  }
}

export async function handleKillRaceButton(
  interaction,
  { repository, killRaceService },
) {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const teamKey = action === "join" ? parts[2] : undefined;
  const sessionId = Number(parts[action === "join" ? 3 : 2]);
  const session = repository.getKillRaceSession(sessionId);

  if (
    !session ||
    session.status === "completed" ||
    session.guildId !== interaction.guildId ||
    session.channelId !== interaction.channelId
  ) {
    throw new KillRaceUserError("이미 종료됐거나 존재하지 않는 킬내기입니다.");
  }

  if (action === "join") {
    await handleJoinButton(interaction, session, teamKey, repository);
    return;
  }

  if (action === "start") {
    assertOwner(interaction, session, "출발");
    if (!killRaceService?.isConfigured()) {
      throw new KillRaceUserError("Google 시트 연결 설정이 완료되지 않았습니다.");
    }

    await interaction.deferUpdate();
    try {
      const summary = await killRaceService.startSession(session.id);
      await interaction.editReply({
        embeds: [buildKillRaceActiveEmbed(summary)],
        components: [buildKillRaceActiveButtons(summary.session)],
      });
    } catch (error) {
      throw new KillRaceUserError(error.message);
    }
    return;
  }

  if (action === "refresh") {
    if (session.status !== "active") {
      throw new KillRaceUserError("킬내기가 출발한 뒤에 갱신할 수 있습니다.");
    }
    await interaction.deferUpdate();
    try {
      const result = await killRaceService.syncSession(session.id);
      await interaction.editReply({
        embeds: [buildKillRaceActiveEmbed(result.summary, result)],
        components: [buildKillRaceActiveButtons(result.summary.session)],
      });
    } catch (error) {
      throw new KillRaceUserError(error.message);
    }
    return;
  }

  if (action === "cancel" || action === "finish") {
    assertOwner(interaction, session, action === "cancel" ? "취소" : "종료");
    const summary = repository.getKillRaceSummary(session.id);
    if (!repository.completeKillRaceSession(session.id)) {
      throw new KillRaceUserError("이미 종료된 킬내기입니다.");
    }

    await interaction.update({
      content:
        action === "cancel"
          ? "킬내기 모집을 취소했습니다."
          : "킬내기를 종료했습니다. 마지막 API 반영 여부는 점수판에서 확인해 주세요.",
      embeds:
        action === "finish" ? [buildKillRaceActiveEmbed(summary)] : [],
      components: [],
    });
  }
}

async function handleStartCommand(interaction, repository, killRaceService) {
  assertGuild(interaction);
  if (!killRaceService?.isConfigured()) {
    throw new KillRaceUserError(
      "Google 시트 연결 설정이 아직 없습니다. 관리자 설정 후 다시 실행해 주세요.",
    );
  }

  const registeredPlayer = repository.getPlayer(
    interaction.guildId,
    interaction.user.id,
  );
  if (!registeredPlayer) {
    throw new KillRaceUserError(
      "먼저 `/등록 닉네임`으로 본인의 PUBG 닉네임을 연결해 주세요.",
    );
  }

  const mode = interaction.options.getString("모드", true);
  const targetScore = interaction.options.getInteger("목표점수") ?? 30;
  const sheet = killRaceService.getSheetReference();
  const { session, created } = repository.createKillRaceSession({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    ownerUserId: interaction.user.id,
    mode,
    targetScore,
    ...sheet,
    ownerMember: memberSnapshot(interaction, registeredPlayer),
  });

  if (!created) {
    throw new KillRaceUserError(
      `이 채널에서는 이미 <@${session.ownerUserId}> 님의 킬내기가 진행 중입니다.`,
    );
  }

  const summary = repository.getKillRaceSummary(session.id);
  await interaction.reply({
    embeds: [buildKillRaceLobbyEmbed(summary)],
    components: [buildKillRaceLobbyButtons(session)],
  });
}

async function handleStatusCommand(interaction, repository) {
  assertGuild(interaction);
  const session = repository.getOpenKillRaceSession(
    interaction.guildId,
    interaction.channelId,
  );
  if (!session) {
    throw new KillRaceUserError(
      "이 채널에서 진행 중인 킬내기가 없습니다. `/킬내기시작`을 실행해 주세요.",
    );
  }

  const summary = repository.getKillRaceSummary(session.id);
  await interaction.reply({
    embeds: [
      session.status === "recruiting"
        ? buildKillRaceLobbyEmbed(summary)
        : buildKillRaceActiveEmbed(summary),
    ],
    components: [
      session.status === "recruiting"
        ? buildKillRaceLobbyButtons(session)
        : buildKillRaceActiveButtons(session),
    ],
  });
}

async function handleEndCommand(interaction, repository) {
  assertGuild(interaction);
  const session = repository.getOpenKillRaceSession(
    interaction.guildId,
    interaction.channelId,
  );
  if (!session) {
    throw new KillRaceUserError("이 채널에서 진행 중인 킬내기가 없습니다.");
  }

  assertOwner(interaction, session, "종료");
  const summary = repository.getKillRaceSummary(session.id);
  repository.completeKillRaceSession(session.id);
  await interaction.reply({
    content: "킬내기를 종료했습니다. 마지막 API 반영 여부는 점수판에서 확인해 주세요.",
    embeds: session.status === "active" ? [buildKillRaceActiveEmbed(summary)] : [],
  });
}

async function handleJoinButton(interaction, session, teamKey, repository) {
  if (session.status !== "recruiting") {
    throw new KillRaceUserError("이미 출발한 킬내기에는 참가하거나 팀을 바꿀 수 없습니다.");
  }

  const mode = getKillRaceMode(session.mode);
  if (!mode.teamKeys.includes(teamKey)) {
    throw new KillRaceUserError("이 킬내기에 없는 팀입니다.");
  }

  const registeredPlayer = repository.getPlayer(
    interaction.guildId,
    interaction.user.id,
  );
  if (!registeredPlayer) {
    throw new KillRaceUserError(
      "먼저 `/등록 닉네임`으로 본인의 PUBG 닉네임을 연결해 주세요.",
    );
  }

  const result = repository.setKillRaceMemberTeam({
    sessionId: session.id,
    teamKey,
    maxTeamSize: mode.playersPerTeam,
    member: memberSnapshot(interaction, registeredPlayer),
  });
  if (result.reason === "already") {
    throw new KillRaceUserError(`이미 TEAM ${teamKey}에 참가하고 있습니다.`);
  }
  if (result.reason === "full") {
    throw new KillRaceUserError(`TEAM ${teamKey} 자리가 모두 찼습니다.`);
  }
  if (!result.changed) {
    throw new KillRaceUserError("참가자 모집이 이미 마감됐습니다.");
  }

  await interaction.update({
    embeds: [buildKillRaceLobbyEmbed(repository.getKillRaceSummary(session.id))],
    components: [buildKillRaceLobbyButtons(session)],
  });
}

function memberSnapshot(interaction, registeredPlayer) {
  return {
    discordUserId: interaction.user.id,
    displayName:
      registeredPlayer.displayName ||
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username ||
      registeredPlayer.playerName,
    accountId: registeredPlayer.accountId,
    playerName: registeredPlayer.playerName,
  };
}

function assertOwner(interaction, session, action) {
  const isManager = interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild,
  );
  if (interaction.user.id !== session.ownerUserId && !isManager) {
    throw new KillRaceUserError(
      `킬내기 개설자 또는 서버 관리자만 ${action}할 수 있습니다.`,
    );
  }
}

function assertGuild(interaction) {
  if (!interaction.inGuild()) {
    throw new KillRaceUserError("이 명령어는 디스코드 서버 안에서만 사용할 수 있습니다.");
  }
}
