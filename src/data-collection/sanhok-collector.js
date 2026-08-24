import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { findTelemetryUrl } from "../pubg-api.js";

export const SANHOK_MAP_NAME = "Savage_Main";
export const DATA_PARSER_VERSION = 1;

const gzipAsync = promisify(gzip);
const KILL_EVENT_TYPES = new Set(["LogPlayerKill", "LogPlayerKillV2"]);

export function extractSanhokDataset({
  rawMatch,
  telemetry = [],
  partyMembers = [],
  platform = "steam",
}) {
  const events = orderTelemetryEvents(telemetry);
  const matchStart = events.find((event) => event?._T === "LogMatchStart");
  const attributes = rawMatch?.data?.attributes ?? {};
  const mapName = attributes.mapName ?? matchStart?.mapName;

  if (mapName !== SANHOK_MAP_NAME) {
    return null;
  }

  const matchId = rawMatch?.data?.id;
  const createdAt = validIsoDate(attributes.createdAt ?? matchStart?._D);

  if (!matchId || !createdAt) {
    throw new Error("사녹 경기의 ID 또는 시작 시각을 찾지 못했습니다.");
  }

  const partyMemberByAccountId = new Map(
    partyMembers
      .filter((member) => member.accountId)
      .map((member) => [member.accountId, member]),
  );
  const partyAccountIds = new Set(partyMemberByAccountId.keys());
  const teamByAccountId = collectTeamIds(rawMatch, events);
  const players = extractPlayers(
    rawMatch,
    partyMemberByAccountId,
    teamByAccountId,
  );
  const eventRows = extractEventRows(
    events,
    partyAccountIds,
    teamByAccountId,
    createdAt,
  );

  return {
    match: {
      matchId,
      platform,
      mapName,
      gameMode: attributes.gameMode ?? matchStart?.gameMode ?? null,
      createdAt,
      durationSeconds: integerOrZero(attributes.duration),
      telemetryUrl: findTelemetryUrl(rawMatch),
      parserVersion: DATA_PARSER_VERSION,
    },
    players,
    ...eventRows,
  };
}

export async function archiveTelemetry({
  matchId,
  telemetry,
  archiveRoot = "data/telemetry",
}) {
  if (!/^[A-Za-z0-9_-]+$/.test(matchId)) {
    throw new Error("안전하지 않은 PUBG 경기 ID입니다.");
  }

  const rawBuffer = Buffer.from(JSON.stringify(telemetry));
  const compressed = await gzipAsync(rawBuffer, { level: 9 });
  const directory = resolve(archiveRoot, SANHOK_MAP_NAME);
  const filePath = resolve(directory, `${matchId}.json.gz`);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporaryPath, compressed);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return {
    path: filePath,
    sha256: createHash("sha256").update(rawBuffer).digest("hex"),
    bytes: rawBuffer.byteLength,
  };
}

export function createSanhokDataCollector({
  repository,
  archiveRoot = "data/telemetry",
}) {
  return {
    async collectPartyMatches({
      sessionId,
      rawMatches,
      telemetries,
      partyMembers,
      platform,
    }) {
      let saved = 0;
      let skipped = 0;

      for (let index = 0; index < rawMatches.length; index += 1) {
        const rawMatch = rawMatches[index];
        const telemetry = telemetries[index] ?? [];
        const dataset = extractSanhokDataset({
          rawMatch,
          telemetry,
          partyMembers,
          platform,
        });

        if (!dataset) {
          skipped += 1;
          continue;
        }

        const archive = await archiveTelemetry({
          matchId: dataset.match.matchId,
          telemetry,
          archiveRoot,
        });
        repository.saveCollectedMatch(sessionId, dataset, archive);
        saved += 1;
      }

      return { saved, skipped };
    },
  };
}

function extractPlayers(rawMatch, partyMemberByAccountId, teamByAccountId) {
  return (rawMatch?.included ?? [])
    .filter((item) => item.type === "participant")
    .map((item) => item.attributes?.stats ?? {})
    .filter((stats) => stats.playerId)
    .map((stats) => {
      const partyMember = partyMemberByAccountId.get(stats.playerId);
      return {
        accountId: stats.playerId,
        discordUserId: partyMember?.discordUserId ?? null,
        playerName: stats.name ?? partyMember?.playerName ?? null,
        teamId: nullableNumber(stats.teamId ?? teamByAccountId.get(stats.playerId)),
        placement: integerOrZero(stats.winPlace),
        kills: integerOrZero(stats.kills),
        damage: numberOrZero(stats.damageDealt),
        assists: integerOrZero(stats.assists),
        revives: integerOrZero(stats.revives),
        headshotKills: integerOrZero(stats.headshotKills),
        longestKill: numberOrZero(stats.longestKill),
        teamKills: integerOrZero(stats.teamKills),
        deathType: stats.deathType ?? null,
        survivalSeconds: numberOrZero(stats.timeSurvived),
        isPartyMember: Boolean(partyMember),
      };
    });
}

function extractEventRows(events, partyAccountIds, teamByAccountId, createdAt) {
  const landingsByAccountId = new Map();
  const positions = [];
  const deaths = [];
  const zones = [];
  let alivePlayers = null;

  for (const event of events) {
    const eventAt = validIsoDate(event?._D);

    if (!eventAt) {
      continue;
    }

    if (event._T === "LogGameStatePeriodic") {
      const gameState = event.gameState ?? {};
      alivePlayers = nullableInteger(gameState.numAlivePlayers) ?? alivePlayers;
      const safetyZone = gameState.safetyZonePosition ?? {};
      const warningZone = gameState.poisonGasWarningPosition ?? {};
      zones.push({
        eventAt,
        elapsedSeconds: eventElapsedSeconds(event, createdAt),
        phase: nullableNumber(gameState.safetyZonePhase),
        aliveTeams: nullableInteger(gameState.numAliveTeams),
        alivePlayers,
        safetyX: nullableNumber(safetyZone.x),
        safetyY: nullableNumber(safetyZone.y),
        safetyRadius: nullableNumber(gameState.safetyZoneRadius),
        warningX: nullableNumber(warningZone.x),
        warningY: nullableNumber(warningZone.y),
        warningRadius: nullableNumber(gameState.poisonGasWarningRadius),
      });
      continue;
    }

    if (event._T === "LogParachuteLanding") {
      const character = event.character;
      const accountId = character?.accountId;
      const location = character?.location;

      if (accountId && location && !landingsByAccountId.has(accountId)) {
        landingsByAccountId.set(accountId, {
          accountId,
          teamId: nullableNumber(character.teamId ?? teamByAccountId.get(accountId)),
          eventAt,
          x: numberOrZero(location.x),
          y: numberOrZero(location.y),
          z: numberOrZero(location.z),
        });
      }
      continue;
    }

    if (event._T === "LogPlayerPosition") {
      const character = event.character;
      const accountId = character?.accountId;
      const location = character?.location;

      if (partyAccountIds.has(accountId) && location) {
        positions.push({
          accountId,
          eventAt,
          elapsedSeconds: eventElapsedSeconds(event, createdAt),
          x: numberOrZero(location.x),
          y: numberOrZero(location.y),
          z: numberOrZero(location.z),
          isInBlueZone: character.isInBlueZone === true,
          vehicleType: usableText(event.vehicle?.vehicleType),
          alivePlayers,
        });
      }
      continue;
    }

    if (KILL_EVENT_TYPES.has(event._T)) {
      const death = extractDeathEvent(event, teamByAccountId, eventAt);
      if (death) {
        deaths.push(death);
      }
    }
  }

  return {
    landings: [...landingsByAccountId.values()],
    positions,
    deaths,
    zones,
  };
}

function extractDeathEvent(event, teamByAccountId, eventAt) {
  const victim = event.victim;
  const victimAccountId = victim?.accountId;

  if (!victimAccountId) {
    return null;
  }

  const killer = event.killer ?? event.finisher ?? event.dBNOMaker;
  const killerAccountId = killer?.accountId ?? null;
  const damageInfo = resolveDamageInfo(event, killerAccountId);
  const location = victim.location ?? event.victimGameResult?.location ?? {};
  const victimTeamId = nullableNumber(
    victim.teamId ?? event.victimGameResult?.teamId ?? teamByAccountId.get(victimAccountId),
  );
  const killerTeamId = nullableNumber(
    killer?.teamId ?? teamByAccountId.get(killerAccountId),
  );
  const teamKillerIds = event.victimGameResult?.teamKillers_AccountId ?? [];

  return {
    victimAccountId,
    killerAccountId,
    victimTeamId,
    killerTeamId,
    eventAt,
    x: nullableNumber(location.x),
    y: nullableNumber(location.y),
    z: nullableNumber(location.z),
    damageType: usableText(
      damageInfo?.damageTypeCategory ?? event.damageTypeCategory,
    ),
    damageCauser: usableText(
      damageInfo?.damageCauserName ?? event.damageCauserName,
    ),
    distance: nullableNumber(damageInfo?.distance ?? event.distance),
    isSuicide:
      Boolean(killerAccountId && killerAccountId === victimAccountId) ||
      /suicide/i.test(damageInfo?.damageTypeCategory ?? event.damageTypeCategory ?? ""),
    isTeamKill:
      Boolean(
        killerAccountId &&
          killerAccountId !== victimAccountId &&
          victimTeamId !== null &&
          killerTeamId !== null &&
          victimTeamId === killerTeamId,
      ) || teamKillerIds.includes(killerAccountId),
  };
}

function resolveDamageInfo(event, killerAccountId) {
  if (event._T === "LogPlayerKill") {
    return event;
  }

  const candidates = [];
  if (event.killer?.accountId === killerAccountId) {
    candidates.push(event.killerDamageInfo);
  }
  if (event.finisher?.accountId === killerAccountId) {
    candidates.push(event.finishDamageInfo);
  }
  if (event.dBNOMaker?.accountId === killerAccountId) {
    candidates.push(event.dBNODamageInfo);
  }
  return candidates.find(Boolean) ?? event.killerDamageInfo ?? event.finishDamageInfo;
}

function collectTeamIds(rawMatch, events) {
  const participantByResourceId = new Map(
    (rawMatch?.included ?? [])
      .filter((item) => item.type === "participant")
      .map((item) => [item.id, item.attributes?.stats?.playerId]),
  );
  const teamByAccountId = new Map();

  for (const roster of rawMatch?.included ?? []) {
    if (roster.type !== "roster") {
      continue;
    }
    const teamId = nullableNumber(roster.attributes?.stats?.teamId);
    for (const participant of roster.relationships?.participants?.data ?? []) {
      const accountId = participantByResourceId.get(participant.id);
      if (accountId && teamId !== null) {
        teamByAccountId.set(accountId, teamId);
      }
    }
  }

  for (const event of events) {
    const characters = [
      event.character,
      event.attacker,
      event.victim,
      event.killer,
      event.finisher,
      event.dBNOMaker,
      ...(event.characters ?? []),
    ];
    for (const character of characters) {
      const accountId = character?.accountId;
      const teamId = nullableNumber(character?.teamId);
      if (accountId && teamId !== null) {
        teamByAccountId.set(accountId, teamId);
      }
    }
  }

  return teamByAccountId;
}

function eventElapsedSeconds(event, createdAt) {
  const isGame = nullableNumber(event.common?.isGame);
  if (isGame !== null && isGame >= 0) {
    return isGame;
  }

  const elapsedMilliseconds = Date.parse(event._D) - Date.parse(createdAt);
  return Number.isFinite(elapsedMilliseconds)
    ? Math.max(0, elapsedMilliseconds / 1_000)
    : null;
}

function orderTelemetryEvents(events) {
  return [...(events ?? [])]
    .map((event, index) => ({ event, index, time: Date.parse(event?._D ?? "") }))
    .sort((left, right) => {
      if (Number.isFinite(left.time) && Number.isFinite(right.time)) {
        return left.time - right.time || left.index - right.index;
      }
      return left.index - right.index;
    })
    .map(({ event }) => event);
}

function validIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableInteger(value) {
  const number = nullableNumber(value);
  return number === null ? null : Math.trunc(number);
}

function numberOrZero(value) {
  return nullableNumber(value) ?? 0;
}

function integerOrZero(value) {
  return nullableInteger(value) ?? 0;
}

function usableText(value) {
  return value && value !== "None" ? value : null;
}
