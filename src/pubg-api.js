const PUBG_API_BASE_URL = "https://api.pubg.com/shards";

export class PubgApiError extends Error {
  constructor(message, { code = "PUBG_API_ERROR", status, cause } = {}) {
    super(message, { cause });
    this.name = "PubgApiError";
    this.code = code;
    this.status = status;
  }
}

export class PubgApiClient {
  constructor({ apiKey, platform = "steam", cacheTtlMs = 120_000, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.platform = platform;
    this.cacheTtlMs = cacheTtlMs;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  async getPlayerByName(playerName) {
    const normalizedName = playerName.trim();

    if (!normalizedName) {
      throw new PubgApiError("닉네임이 비어 있습니다.", { code: "INVALID_PLAYER_NAME" });
    }

    const cacheKey = `player:${this.platform}:${normalizedName.toLocaleLowerCase("en-US")}`;
    const cached = this.getCache(cacheKey);

    if (cached) {
      return cached;
    }

    const response = await this.request("players", {
      "filter[playerNames]": normalizedName,
    });
    const player = response.data?.[0];

    if (!player?.id) {
      throw new PubgApiError(`플레이어 '${normalizedName}'을(를) 찾을 수 없습니다.`, {
        code: "PLAYER_NOT_FOUND",
        status: 404,
      });
    }

    const value = normalizePlayer(player);
    this.setCache(cacheKey, value);
    return value;
  }

  async getPlayersByAccountIds(accountIds) {
    const uniqueIds = [...new Set(accountIds.filter(Boolean))];

    if (uniqueIds.length === 0 || uniqueIds.length > 10) {
      throw new PubgApiError("플레이어는 한 번에 1명부터 10명까지 조회할 수 있습니다.", {
        code: "INVALID_PLAYER_BATCH",
      });
    }

    const response = await this.request("players", {
      "filter[playerIds]": uniqueIds.join(","),
    });

    return (response.data ?? []).map(normalizePlayer);
  }

  async getMatches(matchIds, concurrency = 16) {
    const ids = [...new Set(matchIds.filter(Boolean))];
    return mapWithConcurrency(ids, concurrency, (matchId) => this.getMatch(matchId));
  }

  async getTelemetries(matches, concurrency = 10) {
    return mapWithConcurrency(matches, concurrency, (match) => this.getTelemetry(match));
  }

  async getLifetimeStatsByPlayerName(playerName) {
    const normalizedName = playerName.trim();

    if (!normalizedName) {
      throw new PubgApiError("닉네임이 비어 있습니다.", { code: "INVALID_PLAYER_NAME" });
    }

    const cacheKey = `lifetime:${this.platform}:${normalizedName.toLocaleLowerCase("en-US")}`;
    const cached = this.getCache(cacheKey);

    if (cached) {
      return { ...cached, fromCache: true };
    }

    const player = await this.getPlayerByName(normalizedName);

    const statsResponse = await this.request(
      `players/${encodeURIComponent(player.accountId)}/seasons/lifetime`,
    );

    const value = {
      accountId: player.accountId,
      playerName: player.playerName,
      platform: this.platform,
      modes: statsResponse.data?.attributes?.gameModeStats ?? {},
      fromCache: false,
    };

    this.setCache(cacheKey, value);
    return value;
  }

  async getMatch(matchId) {
    const cacheKey = `match:${this.platform}:${matchId}`;
    const cached = this.getCache(cacheKey);

    if (cached) {
      return cached;
    }

    const match = await this.request(`matches/${encodeURIComponent(matchId)}`);
    this.setCache(cacheKey, match);
    return match;
  }

  async getTelemetry(match) {
    const telemetryUrl = findTelemetryUrl(match);

    if (!telemetryUrl) {
      return [];
    }

    const cacheKey = `telemetry:${telemetryUrl}`;
    const cached = this.getCache(cacheKey);

    if (cached) {
      return cached;
    }

    let response;

    try {
      response = await this.fetchImpl(telemetryUrl, {
        headers: {
          Accept: "application/vnd.api+json",
          "Accept-Encoding": "gzip",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new PubgApiError(
        isTimeout
          ? "PUBG 텔레메트리 응답 시간이 초과되었습니다."
          : "PUBG 텔레메트리에 연결할 수 없습니다.",
        { code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR", cause: error },
      );
    }

    if (!response.ok) {
      throw new PubgApiError(`PUBG 텔레메트리 요청에 실패했습니다. (${response.status})`, {
        status: response.status,
      });
    }

    const events = await response.json().catch(() => []);
    const value = Array.isArray(events) ? events : [];
    this.setCache(cacheKey, value);
    return value;
  }

  async request(path, query = {}) {
    const platform = encodeURIComponent(this.platform);
    const url = new URL(`${PUBG_API_BASE_URL}/${platform}/${path}`);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    let response;

    try {
      response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/vnd.api+json",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new PubgApiError(
        isTimeout ? "PUBG API 응답 시간이 초과되었습니다." : "PUBG API에 연결할 수 없습니다.",
        { code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR", cause: error },
      );
    }

    const body = await response.json().catch(() => null);

    if (response.ok) {
      return body;
    }

    if (response.status === 401 || response.status === 403) {
      throw new PubgApiError("PUBG API 키 인증에 실패했습니다.", {
        code: "AUTH_ERROR",
        status: response.status,
      });
    }

    if (response.status === 404) {
      throw new PubgApiError("요청한 PUBG 데이터를 찾을 수 없습니다.", {
        code: "PLAYER_NOT_FOUND",
        status: response.status,
      });
    }

    if (response.status === 429) {
      throw new PubgApiError("PUBG API의 분당 요청 제한에 도달했습니다.", {
        code: "RATE_LIMITED",
        status: response.status,
      });
    }

    const detail = body?.errors?.[0]?.detail;
    throw new PubgApiError(detail || `PUBG API 요청에 실패했습니다. (${response.status})`, {
      status: response.status,
    });
  }

  setCache(key, value) {
    if (this.cache.size >= 500) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  getCache(key) {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return cached.value;
  }
}

function normalizePlayer(player) {
  return {
    accountId: player.id,
    playerName: player.attributes?.name,
    matchIds: (player.relationships?.matches?.data ?? []).map((match) => match.id),
  };
}

export function findTelemetryUrl(match) {
  const assetIds = new Set(
    (match?.data?.relationships?.assets?.data ?? []).map((asset) => asset.id),
  );
  const asset = (match?.included ?? []).find(
    (item) =>
      item.type === "asset" &&
      (assetIds.size === 0 || assetIds.has(item.id)) &&
      item.attributes?.URL,
  );

  return asset?.attributes?.URL ?? null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
