import { MessageFlags, PermissionFlagsBits } from "discord.js";
import {
  partyCancelCommand,
  partyStartCommand,
  partySummaryCommand,
  recentStatsCommand,
  registerPlayerCommand,
  statsCommand,
} from "./commands.js";
import {
  buildPartyActiveEmbed,
  buildPartyButtons,
  buildPartyLobbyEmbed,
  buildPartyReportEmbed,
} from "./party-embeds.js";
import {
  buildPartyReport,
  collectCandidateMatchIds,
  extractPartyMatch,
} from "./party-stats.js";
import {
  countFriendlyKnocks,
  countFriendlyKnockStats,
} from "./friendly-knocks.js";
import { PubgApiError } from "./pubg-api.js";
import { extractRecentPlayerMatch } from "./recent-stats.js";
import { buildRecentStatsEmbed } from "./recent-stats-embed.js";
import { buildStatsEmbed } from "./stats-embed.js";
import {
  buildMissionReport,
  evaluatePartyMissions,
  selectPartyMissions,
} from "./missions.js";
import { analyzeTrackedKills } from "./squad-kills.js";

const MAX_PARTY_MEMBERS = 10;

export function createInteractionHandler({ pubgApi, repository, allowedChannelId = "" }) {
  return async function handleInteraction(interaction) {
    try {
      if (interaction.isAutocomplete()) {
        await handleNicknameAutocomplete(interaction, repository);
        return;
      }

      if (interaction.isChatInputCommand()) {
        if (allowedChannelId && interaction.channelId !== allowedChannelId) {
          await interaction.reply({
            content: "이 명령어는 지정된 봇 채널에서만 사용할 수 있습니다.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await handleCommand(interaction, pubgApi, repository);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith("party:")) {
        await handlePartyButton(interaction, pubgApi, repository);
      }
    } catch (error) {
      if (!(error instanceof InteractionAlreadyHandledError)) {
        console.error("상호작용 처리 실패:", error?.message || error);
      }

      if (interaction.isAutocomplete()) {
        await interaction.respond([]).catch(() => {});
        return;
      }

      await respondWithError(interaction, error);
    }
  };
}

async function handleCommand(interaction, pubgApi, repository) {
  switch (interaction.commandName) {
    case statsCommand.name:
      await handleStats(interaction, pubgApi, repository);
      break;
    case recentStatsCommand.name:
      await handleRecentStats(interaction, pubgApi, repository);
      break;
    case registerPlayerCommand.name:
      await handleRegister(interaction, pubgApi, repository);
      break;
    case partyStartCommand.name:
      await handlePartyStart(interaction, repository);
      break;
    case partySummaryCommand.name:
      await handlePartySummaryCommand(interaction, pubgApi, repository);
      break;
    case partyCancelCommand.name:
      await handlePartyCancelCommand(interaction, repository);
      break;
    default:
      break;
  }
}

async function handleStats(interaction, pubgApi, repository) {
  await interaction.deferReply();
  const playerName = resolvePlayerName(interaction, repository);
  const mode = interaction.options.getString("모드") ?? "squad";
  const result = await pubgApi.getLifetimeStatsByPlayerName(playerName);
  await interaction.editReply({ embeds: [buildStatsEmbed(result, mode)] });
}

async function handleRecentStats(interaction, pubgApi, repository) {
  await interaction.deferReply();

  const playerName = resolvePlayerName(interaction, repository);
  const mode = interaction.options.getString("모드") ?? "squad";
  const requestedCount = interaction.options.getInteger("경기수") ?? 10;
  const player = await pubgApi.getPlayerByName(playerName);
  const rawMatches = await pubgApi.getMatches(player.matchIds);
  const selectedMatches = rawMatches
    .map((rawMatch) => ({
      rawMatch,
      playerMatch: extractRecentPlayerMatch(rawMatch, player.accountId),
    }))
    .filter(({ playerMatch }) => playerMatch?.gameMode === mode)
    .sort(
      (left, right) =>
        new Date(right.playerMatch.createdAt) - new Date(left.playerMatch.createdAt),
    )
    .slice(0, requestedCount);
  const baseEmbedInput = {
    playerName: player.playerName,
    platform: pubgApi.platform,
    mode,
    requestedCount,
  };
  const pendingMatches = selectedMatches.map(({ playerMatch }) => playerMatch);
  await interaction.editReply({
    embeds: [
      buildRecentStatsEmbed({
        ...baseEmbedInput,
        matches: pendingMatches,
        friendlyKnocksStatus: "pending",
      }),
    ],
  });

  if (selectedMatches.length === 0) {
    return;
  }

  try {
    const telemetries = await pubgApi.getTelemetries(
      selectedMatches.map(({ rawMatch }) => rawMatch),
    );
    const matches = selectedMatches.map(({ playerMatch }, index) => {
      const friendlyKnockStats = countFriendlyKnockStats(
        telemetries[index],
        [player.accountId],
      );

      return {
        ...playerMatch,
        friendlyKnocks:
          friendlyKnockStats.inflicted.get(player.accountId) ?? 0,
        friendlyKnocksReceived:
          friendlyKnockStats.received.get(player.accountId) ?? 0,
      };
    });

    await interaction.editReply({
      embeds: [
        buildRecentStatsEmbed({
          ...baseEmbedInput,
          matches,
          friendlyKnocksStatus: "ready",
        }),
      ],
    });
  } catch (error) {
    console.error("아군 기절 집계 실패:", error?.message || error);
    await interaction.editReply({
      embeds: [
        buildRecentStatsEmbed({
          ...baseEmbedInput,
          matches: pendingMatches,
          friendlyKnocksStatus: "unavailable",
        }),
      ],
    });
  }
}

async function handleRegister(interaction, pubgApi, repository) {
  assertGuildInteraction(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requestedName = interaction.options.getString("닉네임", true);
  const player = await pubgApi.getPlayerByName(requestedName);
  repository.upsertPlayer({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
    accountId: player.accountId,
    playerName: player.playerName,
    platform: pubgApi.platform,
  });

  await interaction.editReply(
    `✅ <@${interaction.user.id}> 계정에 PUBG 닉네임 **${player.playerName}**을(를) 연결했습니다.`,
  );
}

async function handlePartyStart(interaction, repository) {
  assertGuildInteraction(interaction);
  const registeredPlayer = repository.getPlayer(interaction.guildId, interaction.user.id);

  if (!registeredPlayer) {
    await interaction.reply({
      content: "먼저 `/등록 닉네임`으로 본인의 PUBG 닉네임을 연결해 주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { session, created } = repository.createPartySession({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    ownerUserId: interaction.user.id,
  });

  if (!created) {
    await interaction.reply({
      content: `이 채널에서는 이미 <@${session.ownerUserId}> 님의 파티가 진행 중입니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const members = repository.getPartyMembers(session.id);
  await interaction.reply({
    embeds: [buildPartyLobbyEmbed(session, members)],
    components: [buildPartyButtons(session.id, session.status)],
  });
}

async function handlePartySummaryCommand(interaction, pubgApi, repository) {
  assertGuildInteraction(interaction);
  const session = repository.getOpenPartySession(interaction.guildId, interaction.channelId);

  if (!session) {
    await interaction.reply({
      content: "이 채널에서 진행 중인 파티가 없습니다. 먼저 `/파티시작`을 실행해 주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.status === "recruiting") {
    await interaction.reply({
      content: "아직 파티원을 모집 중입니다. 파티장이 **파티 출발**을 눌러주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.status !== "active") {
    await interaction.reply({
      content: "현재 파티의 결산 초안을 확인하고 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await assertPartyOwner(interaction, session);
  await interaction.deferReply();
  await finishParty(interaction, session, pubgApi, repository);
}

async function handlePartyCancelCommand(interaction, repository) {
  assertGuildInteraction(interaction);
  const session = repository.getOpenPartySession(interaction.guildId, interaction.channelId);

  if (!session) {
    await interaction.reply({
      content: "이 채널에서 진행 중인 파티가 없습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await assertPartyOwner(interaction, session, "취소");

  if (!repository.cancelPartySession(session.id)) {
    await interaction.reply({
      content: "이미 종료된 파티입니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(
    `🛑 <@${interaction.user.id}> 님이 현재 파티를 취소했습니다. 이제 새 파티를 시작할 수 있습니다.`,
  );
}

async function handlePartyButton(interaction, pubgApi, repository) {
  const [, action, rawSessionId] = interaction.customId.split(":");
  const sessionId = Number(rawSessionId);
  const session = repository.getPartySession(sessionId);

  if (!session || session.status === "completed" || session.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "이미 종료됐거나 존재하지 않는 파티입니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "join") {
    if (session.status !== "recruiting") {
      await interaction.reply({
        content: "이미 출발한 파티에는 추가로 참가할 수 없습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await handlePartyJoin(interaction, session, repository);
    return;
  }

  if (action === "start") {
    if (session.status !== "recruiting") {
      await interaction.reply({
        content: "이미 출발했거나 결산 중인 파티입니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await assertPartyOwner(interaction, session, "출발");
    const recentlySelectedMissionKeys = repository.getRecentPartyMissionKeys(
      session.guildId,
      session.id,
      2,
    );
    const selectedMissions = selectPartyMissions({
      excludedKeys: recentlySelectedMissionKeys,
    });
    const startedSession = repository.startPartySession(session.id, selectedMissions);

    if (!startedSession) {
      await interaction.reply({
        content: "이미 다른 요청에서 파티가 출발했습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const members = repository.getPartyMembers(session.id);
    const missions = repository.getPartyMissions(session.id);
    await interaction.update({
      embeds: [buildPartyActiveEmbed(startedSession, members, missions)],
      components: [buildPartyButtons(session.id, startedSession.status)],
    });
    return;
  }

  if (action === "summary") {
    if (session.status !== "active") {
      await interaction.reply({
        content: "파티가 출발한 뒤에 결산할 수 있습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await assertPartyOwner(interaction, session);
    await interaction.deferReply();
    await finishParty(interaction, session, pubgApi, repository);
    return;
  }

  if (action === "cancel") {
    await assertPartyOwner(interaction, session, "취소");

    if (!repository.cancelPartySession(session.id)) {
      await interaction.reply({
        content: "이미 종료된 파티입니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update({
      content: `🛑 <@${interaction.user.id}> 님이 파티를 취소했습니다. 새 파티를 시작할 수 있습니다.`,
      embeds: [],
      components: [],
    });
  }
}

async function handlePartyJoin(interaction, session, repository) {
  const player = repository.getPlayer(interaction.guildId, interaction.user.id);

  if (!player) {
    await interaction.reply({
      content: "먼저 `/등록 닉네임`으로 본인의 PUBG 닉네임을 연결해 주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingMembers = repository.getPartyMembers(session.id);

  if (existingMembers.some((member) => member.discordUserId === interaction.user.id)) {
    await interaction.reply({
      content: "이미 이 파티에 참가하고 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (existingMembers.length >= MAX_PARTY_MEMBERS) {
    await interaction.reply({
      content: `한 파티에는 최대 ${MAX_PARTY_MEMBERS}명까지 참가할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!repository.addPartyMember(session.id, interaction.user.id)) {
    const latestSession = repository.getPartySession(session.id);
    await interaction.reply({
      content:
        latestSession?.status === "recruiting"
          ? "이미 이 파티에 참가하고 있습니다."
          : "파티가 출발하여 참가자 모집이 마감됐습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const members = repository.getPartyMembers(session.id);
  await interaction.update({
    embeds: [buildPartyLobbyEmbed(session, members)],
    components: [buildPartyButtons(session.id, session.status)],
  });
}

async function finishParty(interaction, session, pubgApi, repository) {
  const members = repository.getPartyMembers(session.id);
  const registeredMembers = members.filter((member) => member.accountId);

  if (registeredMembers.length === 0) {
    await interaction.editReply("등록된 PUBG 플레이어가 없어 결산할 수 없습니다.");
    return;
  }

  const players = await pubgApi.getPlayersByAccountIds(
    registeredMembers.map((member) => member.accountId),
  );
  const minimumPlayers = registeredMembers.length > 1 ? 2 : 1;
  const candidateIds = collectCandidateMatchIds(players, minimumPlayers);
  const rawMatches = await pubgApi.getMatches(candidateIds);
  const selectedMatches = rawMatches
    .map((rawMatch) => ({
      rawMatch,
      partyMatch: extractPartyMatch(rawMatch, registeredMembers, session.startedAt),
    }))
    .filter(
      ({ partyMatch }) =>
        partyMatch && partyMatch.players.length >= minimumPlayers,
    )
    .sort((left, right) =>
      left.partyMatch.createdAt.localeCompare(right.partyMatch.createdAt),
    );

  if (selectedMatches.length === 0) {
    await interaction.editReply(
      "파티 시작 이후 함께 플레이한 경기를 아직 찾지 못했습니다. 전적 반영을 기다린 뒤 다시 결산해 주세요.",
    );
    return;
  }

  const accountIds = registeredMembers.map((member) => member.accountId);
  const telemetries = await pubgApi.getTelemetries(
    selectedMatches.map(({ rawMatch }) => rawMatch),
  );
  const partyMatches = selectedMatches.map(({ partyMatch }, index) => {
    const friendlyKnocks = countFriendlyKnocks(telemetries[index], accountIds);
    const killAnalysis = analyzeTrackedKills(telemetries[index], accountIds);

    return {
      ...partyMatch,
      players: partyMatch.players.map((player) => {
        const telemetry = killAnalysis.playerTelemetry.get(player.accountId);
        return {
          ...player,
          friendlyKnocks: friendlyKnocks.get(player.accountId) ?? 0,
          squadBreakerCount:
            killAnalysis.sameSquadKills.get(player.accountId)?.count ?? 0,
          killEvents: killAnalysis.killsByPlayer.get(player.accountId) ?? [],
          firstFirearmKey: telemetry?.firstFirearmKey,
          carePackageWeaponKeys: [
            ...(telemetry?.carePackageWeaponKeys ?? []),
          ],
          flareGunUses: telemetry?.flareGunUses ?? 0,
        };
      }),
    };
  });
  const report = buildPartyReport(partyMatches, registeredMembers);
  const selectedMissions = repository.getPartyMissions(session.id);
  const completionCandidates = evaluatePartyMissions(
    selectedMissions,
    partyMatches,
  );
  repository.recordMissionCompletions(session.id, completionCandidates);
  const missionReport = buildMissionReport(
    selectedMissions,
    repository.getMissionCompletions(session.id),
    registeredMembers,
  );
  const missionPointsByUser = new Map(
    missionReport.ranking.map((player) => [player.discordUserId, player.points]),
  );
  for (const player of report.players) {
    player.missionPoints = missionPointsByUser.get(player.discordUserId) ?? 0;
  }
  report.missionReport = missionReport;
  report.awards.missionLeaders = missionReport.leaders;
  repository.completePartySession(session.id);
  await interaction.editReply({ embeds: [buildPartyReportEmbed(report, session)] });
}

async function assertPartyOwner(interaction, session, action = "결산") {
  const isManager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  if (interaction.user.id !== session.ownerUserId && !isManager) {
    await interaction.reply({
      content: `파티장 또는 서버 관리자만 파티를 ${action}할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    throw new InteractionAlreadyHandledError();
  }
}

function assertGuildInteraction(interaction) {
  if (!interaction.inGuild()) {
    throw new UserInputError("이 명령어는 디스코드 서버 안에서만 사용할 수 있습니다.");
  }
}

function resolvePlayerName(interaction, repository) {
  const requestedName = interaction.options.getString("닉네임")?.trim();

  if (requestedName) {
    return requestedName;
  }

  assertGuildInteraction(interaction);
  const registeredPlayer = repository.getPlayer(
    interaction.guildId,
    interaction.user.id,
  );

  if (!registeredPlayer) {
    throw new UserInputError(
      "등록된 PUBG 닉네임이 없습니다. 먼저 `/등록 닉네임`을 실행하거나 닉네임을 직접 입력해 주세요.",
    );
  }

  return registeredPlayer.playerName;
}

async function handleNicknameAutocomplete(interaction, repository) {
  const supportsNicknameAutocomplete =
    interaction.commandName === statsCommand.name ||
    interaction.commandName === recentStatsCommand.name;
  const focusedOption = interaction.options.getFocused(true);

  if (
    !supportsNicknameAutocomplete ||
    focusedOption.name !== "닉네임" ||
    !interaction.guildId
  ) {
    await interaction.respond([]);
    return;
  }

  const registeredPlayer = repository.getPlayer(
    interaction.guildId,
    interaction.user.id,
  );

  if (!registeredPlayer) {
    await interaction.respond([]);
    return;
  }

  const query = String(focusedOption.value).trim().toLocaleLowerCase("en-US");
  const playerName = registeredPlayer.playerName;
  const matchesQuery =
    !query || playerName.toLocaleLowerCase("en-US").includes(query);

  await interaction.respond(
    matchesQuery
      ? [{ name: `내 닉네임 · ${playerName}`, value: playerName }]
      : [],
  );
}

async function respondWithError(interaction, error) {
  if (error instanceof InteractionAlreadyHandledError) {
    return;
  }

  const content = userFacingError(error);

  if (interaction.deferred) {
    await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
  } else if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

function userFacingError(error) {
  if (error instanceof UserInputError) {
    return error.message;
  }

  if (!(error instanceof PubgApiError)) {
    return "예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }

  const messages = {
    PLAYER_NOT_FOUND: "해당 PUBG 닉네임을 찾지 못했습니다. 철자와 플랫폼을 확인해 주세요.",
    INVALID_PLAYER_NAME: "검색할 PUBG 닉네임을 입력해 주세요.",
    AUTH_ERROR: "PUBG API 키 인증에 실패했습니다. 봇 관리자에게 알려 주세요.",
    RATE_LIMITED: "현재 전적 조회 요청이 많습니다. 1분 뒤 다시 시도해 주세요.",
    TIMEOUT: "PUBG API 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.",
    NETWORK_ERROR: "PUBG API에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  };

  return messages[error.code] ?? "PUBG 전적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

class UserInputError extends Error {}
class InteractionAlreadyHandledError extends Error {}
