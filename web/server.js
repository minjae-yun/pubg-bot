// DROPLOG 읽기 전용 API 서버
// 실행: node web/server.js  (봇 폴더 루트에서)
// 봇이 쓰는 bot.sqlite를 읽기 전용으로 열어서 웹사이트에 필요한 데이터만 JSON으로 내보냅니다.
// 디스코드 ID, 서버 ID, 토큰 같은 민감한 값은 응답에 포함하지 않습니다.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = resolve(ROOT, process.env.DATABASE_PATH ?? "data/bot.sqlite");
const PORT = Number(process.env.WEB_PORT ?? 3000);
const HOST = process.env.WEB_HOST ?? "127.0.0.1";
const PUBLIC_DIR = join(ROOT, "web", "public");

const MAP_NAMES = { Savage_Main: "사녹", Tiger_Main: "태이고" };
const MAP_KEYS = { 사녹: "Savage_Main", 태이고: "Tiger_Main", sanhok: "Savage_Main", taego: "Tiger_Main" };

function openDatabase() {
  try {
    return new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (error) {
    // 오래된 Node 버전은 readOnly 옵션을 모를 수 있음
    if (String(error.message).includes("readOnly")) return new DatabaseSync(DB_PATH);
    throw error;
  }
}

const db = openDatabase();
const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);

// 같은 PUBG 계정이 여러 서버/디스코드 계정으로 등록된 경우가 있어서 계정 기준으로 한 줄로 합칩니다.
const PLAYERS_CTE = `
  players AS (
    SELECT
      pubg_account_id AS accountId,
      MAX(pubg_name) AS pubgName,
      COALESCE(MAX(NULLIF(display_name, '')), MAX(pubg_name)) AS displayName
    FROM registered_players
    GROUP BY pubg_account_id
  )`;

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};
const mapLabel = name => MAP_NAMES[name] ?? name;
// DB 시각은 UTC라서 한국 시간(UTC+9) 날짜로 바꿔서 보여줍니다.
const toDate = iso => {
  if (!iso) return null;
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replaceAll("-", ".");
};

/* ---------- 쿼리 ---------- */

function getSummary() {
  const totals = get(`
    SELECT COUNT(*) AS matches, MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
    FROM collected_matches`);
  const maps = all(`
    SELECT map_name AS mapName, COUNT(*) AS matches
    FROM collected_matches GROUP BY map_name ORDER BY matches DESC`);
  const chickens = get(`
    SELECT COUNT(DISTINCT match_id) AS count
    FROM match_players WHERE is_party_member = 1 AND placement = 1`);
  const players = get(`WITH ${PLAYERS_CTE} SELECT COUNT(*) AS count FROM players`);
  return {
    matches: totals.matches,
    firstRecord: toDate(totals.firstAt),
    lastRecord: toDate(totals.lastAt),
    maps: maps.map(m => ({ name: mapLabel(m.mapName), key: m.mapName, matches: m.matches })),
    squadChickens: chickens.count,
    registeredPlayers: players.count
  };
}

function listPlayers(query = "") {
  const q = query.trim().toLowerCase();
  const rows = all(`
    WITH ${PLAYERS_CTE}
    SELECT p.accountId, p.displayName, p.pubgName,
      COUNT(mp.match_id) AS games,
      ROUND(AVG(mp.damage)) AS adr,
      SUM(mp.kills) AS kills,
      SUM(CASE WHEN mp.death_type IS NOT NULL AND mp.death_type != 'alive' THEN 1 ELSE 0 END) AS deaths
    FROM players p
    LEFT JOIN match_players mp ON mp.account_id = p.accountId
    GROUP BY p.accountId
    ORDER BY games DESC`);
  return rows
    .filter(r => !q || r.displayName.toLowerCase().includes(q) || r.pubgName.toLowerCase().includes(q))
    .map(r => ({
      id: r.accountId,
      displayName: r.displayName,
      pubgName: r.pubgName,
      games: r.games,
      adr: r.adr ?? 0,
      kd: r.deaths ? round(r.kills / r.deaths, 2) : r.kills
    }));
}

function findPlayer(id) {
  return get(`WITH ${PLAYERS_CTE} SELECT * FROM players WHERE accountId = ?`, id);
}

function getPlayer(id) {
  const player = findPlayer(id);
  if (!player) return null;

  const s = get(`
    SELECT COUNT(*) AS games,
      SUM(mp.kills) AS kills,
      SUM(CASE WHEN mp.death_type IS NOT NULL AND mp.death_type != 'alive' THEN 1 ELSE 0 END) AS deaths,
      AVG(mp.damage) AS adr,
      SUM(mp.placement BETWEEN 1 AND 10) AS top10,
      SUM(mp.placement = 1) AS wins,
      SUM(mp.headshot_kills) AS headshots,
      MAX(mp.longest_kill) AS longestKill,
      MIN(cm.created_at) AS firstAt, MAX(cm.created_at) AS lastAt
    FROM match_players mp
    JOIN collected_matches cm ON cm.match_id = mp.match_id
    WHERE mp.account_id = ?`, id);

  const maps = all(`
    SELECT cm.map_name AS mapName, COUNT(*) AS games,
      SUM(mp.placement = 1) AS wins,
      AVG(mp.damage) AS adr,
      AVG(mp.survival_seconds) AS survival
    FROM match_players mp
    JOIN collected_matches cm ON cm.match_id = mp.match_id
    WHERE mp.account_id = ?
    GROUP BY cm.map_name ORDER BY games DESC`, id);

  const games = s.games || 0;
  return {
    id: player.accountId,
    displayName: player.displayName,
    pubgName: player.pubgName,
    games,
    first: toDate(s.firstAt),
    last: toDate(s.lastAt),
    kills: s.kills ?? 0,
    kd: s.deaths ? round(s.kills / s.deaths, 2) : (s.kills ?? 0),
    adr: round(s.adr),
    top10: games ? round((s.top10 / games) * 100, 1) : 0,
    top10Count: s.top10 ?? 0,
    wins: s.wins ?? 0,
    winRate: games ? round((s.wins / games) * 100, 1) : 0,
    headshotRate: s.kills ? round((s.headshots / s.kills) * 100, 1) : 0,
    longestKill: round(s.longestKill, 1),
    maps: maps.map(m => ({
      name: mapLabel(m.mapName),
      key: m.mapName,
      games: m.games,
      winRate: round((m.wins / m.games) * 100, 1),
      adr: round(m.adr),
      survivalSeconds: round(m.survival)
    }))
  };
}

function getPlayerMatches(id, { map, page = 1, limit = 5 }) {
  if (!findPlayer(id)) return null;
  const mapKey = map && map !== "all" ? (MAP_KEYS[map] ?? map) : null;
  const size = Math.min(50, Math.max(1, Number(limit) || 5));
  const where = `mp.account_id = ? ${mapKey ? "AND cm.map_name = ?" : ""}`;
  const params = mapKey ? [id, mapKey] : [id];

  const total = get(`
    SELECT COUNT(*) AS count FROM match_players mp
    JOIN collected_matches cm ON cm.match_id = mp.match_id WHERE ${where}`, ...params).count;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Number(page) || 1));

  const items = all(`
    SELECT cm.match_id AS matchId, cm.created_at AS createdAt, cm.map_name AS mapName,
      cm.game_mode AS mode, cm.duration_seconds AS duration,
      mp.placement, mp.kills, mp.damage, mp.assists, mp.revives, mp.survival_seconds AS survival, mp.death_type AS deathType
    FROM match_players mp
    JOIN collected_matches cm ON cm.match_id = mp.match_id
    WHERE ${where}
    ORDER BY cm.created_at DESC
    LIMIT ? OFFSET ?`, ...params, size, (current - 1) * size);

  return {
    total, page: current, pages, limit: size,
    items: items.map(m => ({
      matchId: m.matchId,
      date: toDate(m.createdAt),
      createdAt: m.createdAt,
      map: mapLabel(m.mapName),
      mode: m.mode,
      durationSeconds: m.duration,
      placement: m.placement,
      kills: m.kills,
      damage: round(m.damage),
      assists: m.assists,
      revives: m.revives,
      survivalSeconds: round(m.survival),
      died: m.deathType !== "alive"
    }))
  };
}

function teamRows(matchId) {
  return all(`
    WITH ${PLAYERS_CTE}
    SELECT mp.account_id AS accountId,
      COALESCE(p.displayName, mp.player_name) AS name, mp.player_name AS pubgName,
      p.accountId IS NOT NULL AS registered,
      mp.team_id AS teamId, mp.placement, mp.kills, mp.damage, mp.assists, mp.revives,
      mp.headshot_kills AS headshots, mp.longest_kill AS longestKill,
      mp.survival_seconds AS survival, mp.death_type AS deathType
    FROM match_players mp
    LEFT JOIN players p ON p.accountId = mp.account_id
    WHERE mp.match_id = ? AND mp.is_party_member = 1
    ORDER BY mp.damage DESC`, matchId);
}

function summarizeMatch(meta, team) {
  const placement = team.length ? Math.min(...team.map(t => t.placement || 99)) : null;
  return {
    matchId: meta.matchId,
    date: toDate(meta.createdAt),
    createdAt: meta.createdAt,
    map: mapLabel(meta.mapName),
    mode: meta.mode,
    durationSeconds: meta.duration,
    placement,
    kills: team.reduce((s, t) => s + t.kills, 0),
    damage: round(team.reduce((s, t) => s + t.damage, 0))
  };
}

function getRecentMatches(limit = 3) {
  const size = Math.min(20, Math.max(1, Number(limit) || 3));
  const metas = all(`
    SELECT match_id AS matchId, created_at AS createdAt, map_name AS mapName,
      game_mode AS mode, duration_seconds AS duration
    FROM collected_matches ORDER BY created_at DESC LIMIT ?`, size);
  return metas.map(meta => summarizeMatch(meta, teamRows(meta.matchId)));
}

function getMatch(matchId) {
  const meta = get(`
    SELECT match_id AS matchId, created_at AS createdAt, map_name AS mapName,
      game_mode AS mode, duration_seconds AS duration
    FROM collected_matches WHERE match_id = ?`, matchId);
  if (!meta) return null;

  const team = teamRows(matchId);
  const totalDamage = team.reduce((s, t) => s + t.damage, 0);
  const neighbors = get(`
    SELECT
      (SELECT match_id FROM collected_matches WHERE created_at < ? ORDER BY created_at DESC LIMIT 1) AS olderId,
      (SELECT match_id FROM collected_matches WHERE created_at > ? ORDER BY created_at ASC LIMIT 1) AS newerId`,
    meta.createdAt, meta.createdAt);

  return {
    ...summarizeMatch(meta, team),
    olderMatchId: neighbors.olderId,
    newerMatchId: neighbors.newerId,
    team: team.map(t => ({
      id: t.registered ? t.accountId : null,
      name: t.name,
      pubgName: t.pubgName,
      kills: t.kills,
      damage: round(t.damage),
      damageShare: totalDamage ? round((t.damage / totalDamage) * 100, 1) : 0,
      assists: t.assists,
      revives: t.revives,
      headshots: t.headshots,
      longestKill: round(t.longestKill, 1),
      survivalSeconds: round(t.survival),
      died: t.deathType !== "alive",
      deathType: t.deathType
    }))
  };
}

/* ---------- HTTP ---------- */

const routes = [
  [/^\/api\/summary$/, () => getSummary()],
  [/^\/api\/players$/, (_, url) => listPlayers(url.searchParams.get("q") ?? "")],
  [/^\/api\/players\/([^/]+)$/, ([, id]) => getPlayer(decodeURIComponent(id))],
  [/^\/api\/players\/([^/]+)\/matches$/, ([, id], url) => getPlayerMatches(decodeURIComponent(id), {
    map: url.searchParams.get("map"),
    page: url.searchParams.get("page"),
    limit: url.searchParams.get("limit")
  })],
  [/^\/api\/matches\/recent$/, (_, url) => getRecentMatches(url.searchParams.get("limit"))],
  [/^\/api\/matches\/([^/]+)$/, ([, id]) => getMatch(decodeURIComponent(id))]
];

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

async function serveStatic(pathname, res) {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (file.includes("..")) return send(res, 400, { error: "잘못된 경로" });
  try {
    const body = await readFile(join(PUBLIC_DIR, file));
    send(res, 200, body, STATIC_TYPES[extname(file)] ?? "application/octet-stream");
  } catch {
    send(res, 404, { error: "페이지를 찾을 수 없어요" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method !== "GET") return send(res, 405, { error: "GET 요청만 지원해요" });

  if (url.pathname.startsWith("/api/")) {
    for (const [pattern, handler] of routes) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      try {
        const data = handler(match, url);
        return data === null ? send(res, 404, { error: "데이터를 찾을 수 없어요" }) : send(res, 200, data);
      } catch (error) {
        console.error(error);
        return send(res, 500, { error: "서버 오류" });
      }
    }
    return send(res, 404, { error: "없는 API 주소예요" });
  }
  return serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`DROPLOG API 준비 완료 → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`DB: ${DB_PATH} (읽기 전용)`);
});

process.on("SIGINT", () => { db.close(); server.close(() => process.exit(0)); });
