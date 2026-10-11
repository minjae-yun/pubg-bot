import { getKillRaceMode } from "./kill-race-config.js";
import {
  extractKillRaceTeamMatch,
  isKillRaceTeamMatch,
  newMatchIdsFromAnyMember,
} from "./kill-race-scoring.js";

export class KillRaceService {
  constructor({
    pubgApi,
    repository,
    sheets,
    sheetUrl,
    refreshIntervalMs = 20_000,
    onAutoComplete,
    now = () => new Date(),
  }) {
    this.pubgApi = pubgApi;
    this.repository = repository;
    this.sheets = sheets;
    this.sheetUrl = sheetUrl;
    this.refreshIntervalMs = refreshIntervalMs;
    this.onAutoComplete = onAutoComplete;
    this.now = now;
    this.locks = new Map();
    this.timer = undefined;
  }

  isConfigured() {
    return Boolean(this.sheets);
  }

  getSheetReference() {
    if (!this.sheets) {
      return undefined;
    }

    return {
      sheetId: this.sheets.sheetId,
      sheetUrl:
        this.sheetUrl ||
        `https://docs.google.com/spreadsheets/d/${this.sheets.sheetId}/edit`,
    };
  }

  async startSession(sessionId) {
    return this.withSessionLock(sessionId, async () => {
      const session = this.repository.getKillRaceSession(sessionId);
      if (!session || session.status !== "recruiting") {
        throw new Error("이미 출발했거나 종료된 킬내기입니다.");
      }
      if (!this.sheets) {
        throw new Error("Google 시트 연결 설정이 완료되지 않았습니다.");
      }

      const mode = getKillRaceMode(session.mode);
      const members = this.repository.getKillRaceMembers(sessionId);
      for (const teamKey of mode.teamKeys) {
        const count = members.filter((member) => member.teamKey === teamKey).length;
        if (count !== mode.playersPerTeam) {
          throw new Error(
            `TEAM ${teamKey}에 ${mode.playersPerTeam}명이 모두 참가해야 출발할 수 있습니다.`,
          );
        }
      }

      const players = await this.pubgApi.getPlayersByAccountIds(
        members.map((member) => member.accountId),
      );
      const baselineMatchIds = players.flatMap((player) => player.matchIds ?? []);
      await this.sheets.initializeRace(session, members);
      const startedSession = this.repository.startKillRaceSession(
        sessionId,
        baselineMatchIds,
        this.now(),
      );

      if (!startedSession) {
        throw new Error("이미 다른 요청에서 킬내기가 출발했습니다.");
      }

      return this.repository.getKillRaceSummary(sessionId);
    });
  }

  async syncSession(sessionId) {
    return this.withSessionLock(sessionId, async () => {
      const session = this.repository.getKillRaceSession(sessionId);
      if (!session || session.status !== "active") {
        return {
          addedMatches: 0,
          summary: session
            ? this.repository.getKillRaceSummary(sessionId)
            : undefined,
        };
      }

      const now = this.now();
      const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined;
      const autoComplete =
        session.ruleType === "timed" &&
        expiresAt &&
        !Number.isNaN(expiresAt.getTime()) &&
        now >= expiresAt;
      const matchCutoff = autoComplete ? expiresAt : now;

      await this.flushPendingRows(session);
      const mode = getKillRaceMode(session.mode);
      const members = this.repository.getKillRaceMembers(sessionId);
      const players = await this.pubgApi.getPlayersByAccountIds(
        members.map((member) => member.accountId),
      );
      const baseline = this.repository.getKillRaceBaselineMatchIds(sessionId);
      const teamCandidates = new Map();
      const candidateIds = new Set();

      for (const teamKey of mode.teamKeys) {
        const teamMembers = members.filter((member) => member.teamKey === teamKey);
        const recorded = this.repository.getKillRaceRecordedMatchIds(
          sessionId,
          teamKey,
        );
        const candidates = newMatchIdsFromAnyMember(players, teamMembers, [
          ...baseline,
          ...recorded,
        ]);
        teamCandidates.set(teamKey, new Set(candidates));
        candidates.forEach((matchId) => candidateIds.add(matchId));
      }

      const rawMatches = await this.pubgApi.getMatches([...candidateIds]);
      const orderedMatches = rawMatches
        .filter((match) => {
          const createdAt = new Date(match?.data?.attributes?.createdAt);
          return (
            !Number.isNaN(createdAt.getTime()) &&
            createdAt >= new Date(session.startedAt) &&
            createdAt <= matchCutoff
          );
        })
        .sort((left, right) =>
          left.data.attributes.createdAt.localeCompare(right.data.attributes.createdAt),
        );
      const matchJobs = orderedMatches
        .map((match) => ({
          match,
          interestedTeams: mode.teamKeys.filter((teamKey) =>
            teamCandidates.get(teamKey).has(match.data?.id) &&
            isKillRaceTeamMatch({
              match,
              members: members.filter((member) => member.teamKey === teamKey),
              startedAt: session.startedAt,
              endedAt: matchCutoff,
            }),
          ),
        }))
        .filter(({ interestedTeams }) => interestedTeams.length > 0);
      const telemetries =
        matchJobs.length > 0
          ? await this.pubgApi.getTelemetries(
              matchJobs.map(({ match }) => match),
              4,
            )
          : [];
      let addedMatches = 0;

      for (let index = 0; index < matchJobs.length; index += 1) {
        const { match, interestedTeams } = matchJobs[index];
        const telemetry = telemetries[index];
        for (const teamKey of interestedTeams) {
          const result = extractKillRaceTeamMatch({
            match,
            telemetry,
            members: members.filter((member) => member.teamKey === teamKey),
            startedAt: session.startedAt,
            endedAt: matchCutoff,
          });
          if (!result) {
            continue;
          }

          const inserted = this.repository.addKillRaceTeamMatch({
            sessionId,
            teamKey,
            ...result,
          });
          if (inserted.created) {
            addedMatches += 1;
          }
        }
      }

      await this.flushPendingRows(session);
      this.repository.touchKillRaceSync(sessionId);
      if (autoComplete) {
        this.repository.completeKillRaceSession(sessionId);
      }
      return {
        addedMatches,
        autoCompleted: Boolean(autoComplete),
        summary: this.repository.getKillRaceSummary(sessionId),
      };
    });
  }

  async flushPendingRows(session) {
    if (!this.sheets) {
      throw new Error("Google 시트 연결 설정이 완료되지 않았습니다.");
    }

    const pendingRows = this.repository.getPendingKillRaceSheetRows(session.id);
    for (const row of pendingRows) {
      await this.sheets.writeTeamMatch(session, row);
      this.repository.markKillRaceSheetRowSynced(
        session.id,
        row.teamKey,
        row.matchId,
      );
    }
  }

  async syncAllActiveSessions() {
    for (const session of this.repository.getActiveKillRaceSessions()) {
      if (this.locks.has(session.id)) {
        continue;
      }

      try {
        const result = await this.syncSession(session.id);
        if (result.autoCompleted && this.onAutoComplete) {
          try {
            await this.onAutoComplete(result);
          } catch (error) {
            console.error(
              `킬내기 #${session.id} 자동 종료 알림 실패:`,
              error?.message || error,
            );
          }
        }
      } catch (error) {
        console.error(
          `킬내기 #${session.id} 자동 갱신 실패:`,
          error?.message || error,
        );
      }
    }
  }

  startPolling() {
    if (!this.sheets || this.timer) {
      return;
    }

    this.timer = setInterval(
      () => void this.syncAllActiveSessions(),
      this.refreshIntervalMs,
    );
    this.timer.unref?.();
    void this.syncAllActiveSessions();
  }

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async withSessionLock(sessionId, operation) {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.locks.set(sessionId, current);

    try {
      return await current;
    } finally {
      if (this.locks.get(sessionId) === current) {
        this.locks.delete(sessionId);
      }
    }
  }
}
