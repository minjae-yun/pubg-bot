// DROPLOG API 서버
// 실행: node web/server.js  (봇 폴더 루트에서)
// 봇이 쓰는 bot.sqlite는 읽기 전용으로 열고, 웹 전용 데이터는 별도 DB에 저장합니다.
// 디스코드 ID, 서버 ID, 토큰 같은 민감한 값은 응답에 포함하지 않습니다.

import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = resolve(ROOT, process.env.DATABASE_PATH ?? "data/bot.sqlite");
const PORT = Number(process.env.WEB_PORT ?? 3000);
const HOST = process.env.WEB_HOST ?? "127.0.0.1";
const PUBLIC_DIR = join(ROOT, "web", "public");
const PATCH_FILE = join(ROOT, "web", "content", "patches.json");
const WEB_DATA_DIR = join(ROOT, "web", "data");
const HIGHLIGHT_DIR = join(PUBLIC_DIR, "uploads");
const WEB_DB_PATH = join(WEB_DATA_DIR, "droplog.sqlite");
const WEB_ADMIN_KEY = process.env.WEB_ADMIN_KEY?.trim() ?? "";
const MAX_UPLOAD_BYTES = Number(process.env.WEB_MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

const MAP_NAMES = { Savage_Main: "사녹", Tiger_Main: "태이고" };
const MAP_KEYS = { 사녹: "Savage_Main", 태이고: "Tiger_Main", sanhok: "Savage_Main", taego: "Tiger_Main" };

const WEAPONS = {
  WeapBerylM762_C: ["Beryl M762", "AR"], WeapACE32_C: ["ACE32", "AR"], WeapAUG_C: ["AUG", "AR"],
  WeapHK416_C: ["M416", "AR"], WeapAK47_C: ["AKM", "AR"], WeapQBZ95_C: ["QBZ", "AR"],
  WeapGroza_C: ["Groza", "AR"], "WeapSCAR-L_C": ["SCAR-L", "AR"], WeapG36C_C: ["G36C", "AR"],
  WeapMini14_C: ["Mini14", "DMR"], WeapFNFal_C: ["SLR", "DMR"], WeapMk14_C: ["Mk14", "DMR"],
  WeapSKS_C: ["SKS", "DMR"], WeapQBU88_C: ["QBU", "DMR"], WeapDragunov_C: ["Dragunov", "DMR"],
  WeapM24_C: ["M24", "SR"], WeapKar98k_C: ["Kar98k", "SR"], WeapAWM_C: ["AWM", "SR"],
  WeapWinchester_C: ["Win94", "SR"], WeapL6_C: ["Lynx AMR", "SR"],
  WeapMP5K_C: ["MP5K", "SMG"], WeapUMP_C: ["UMP45", "SMG"], WeapVector_C: ["Vector", "SMG"],
  WeapUZI_C: ["Micro UZI", "SMG"], WeapThompson_C: ["Tommy Gun", "SMG"], WeapBizonPP19_C: ["PP-19 Bizon", "SMG"],
  WeapSaiga12_C: ["S12K", "SG"], WeapBerreta686_C: ["S686", "SG"],
  WeapM249_C: ["M249", "LMG"], WeapRPD_C: ["RPD", "LMG"], WeapMG3_C: ["MG3", "LMG"],
  ProjGrenade_C: ["수류탄", "기타"], ProjMolotov_C: ["화염병", "기타"],
  WeapPan_C: ["프라이팬", "기타"], PanzerFaust100M_Projectile_C: ["판처파우스트", "기타"]
};

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

mkdirSync(WEB_DATA_DIR, { recursive: true });
mkdirSync(HIGHLIGHT_DIR, { recursive: true });
const webDb = new DatabaseSync(WEB_DB_PATH);
webDb.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    media_type TEXT NOT NULL CHECK (media_type IN ('link', 'video', 'image')),
    media_url TEXT NOT NULL,
    match_id TEXT,
    created_at TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0
  );
`);
const webAll = (sql, ...params) => webDb.prepare(sql).all(...params);
const webGet = (sql, ...params) => webDb.prepare(sql).get(...params);

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

const HUMAN_KILLS_CTE = `
  human_kills AS (
    SELECT match_id AS matchId, killer_account_id AS accountId, COUNT(*) AS kills
    FROM death_events
    WHERE killer_account_id IS NOT NULL
      AND is_suicide = 0
      AND is_team_kill = 0
      AND victim_account_id NOT LIKE 'ai.%'
    GROUP BY match_id, killer_account_id
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
    WITH ${PLAYERS_CTE}, ${HUMAN_KILLS_CTE}
    SELECT p.accountId, p.displayName, p.pubgName,
      COUNT(mp.match_id) AS games,
      ROUND(AVG(mp.damage)) AS adr,
      SUM(COALESCE(hk.kills, 0)) AS kills,
      SUM(CASE WHEN mp.death_type IS NOT NULL AND mp.death_type != 'alive' THEN 1 ELSE 0 END) AS deaths
    FROM players p
    LEFT JOIN match_players mp ON mp.account_id = p.accountId
    LEFT JOIN human_kills hk ON hk.matchId = mp.match_id AND hk.accountId = mp.account_id
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

  const s = get(`WITH ${HUMAN_KILLS_CTE}
    SELECT COUNT(*) AS games,
      SUM(COALESCE(hk.kills, 0)) AS kills,
      SUM(CASE WHEN mp.death_type IS NOT NULL AND mp.death_type != 'alive' THEN 1 ELSE 0 END) AS deaths,
      AVG(mp.damage) AS adr,
      SUM(mp.placement BETWEEN 1 AND 10) AS top10,
      SUM(mp.placement = 1) AS wins,
      SUM(mp.headshot_kills) AS headshots,
      MAX(mp.longest_kill) AS longestKill,
      MIN(cm.created_at) AS firstAt, MAX(cm.created_at) AS lastAt
    FROM match_players mp
    JOIN collected_matches cm ON cm.match_id = mp.match_id
    LEFT JOIN human_kills hk ON hk.matchId = mp.match_id AND hk.accountId = mp.account_id
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

  const items = all(`WITH ${HUMAN_KILLS_CTE}
    SELECT cm.match_id AS matchId, cm.created_at AS createdAt, cm.map_name AS mapName,
      cm.game_mode AS mode, cm.duration_seconds AS duration,
      mp.placement, COALESCE(hk.kills, 0) AS kills, mp.damage, mp.assists, mp.revives, mp.survival_seconds AS survival, mp.death_type AS deathType
    FROM match_players mp
    JOIN collected_matches cm ON cm.match_id = mp.match_id
    LEFT JOIN human_kills hk ON hk.matchId = mp.match_id AND hk.accountId = mp.account_id
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
    WITH ${PLAYERS_CTE}, ${HUMAN_KILLS_CTE}
    SELECT mp.account_id AS accountId,
      COALESCE(p.displayName, mp.player_name) AS name, mp.player_name AS pubgName,
      p.accountId IS NOT NULL AS registered,
      mp.team_id AS teamId, mp.placement, COALESCE(hk.kills, 0) AS kills, mp.damage, mp.assists, mp.revives,
      mp.headshot_kills AS headshots, mp.longest_kill AS longestKill,
      mp.survival_seconds AS survival, mp.death_type AS deathType
    FROM match_players mp
    LEFT JOIN players p ON p.accountId = mp.account_id
    LEFT JOIN human_kills hk ON hk.matchId = mp.match_id AND hk.accountId = mp.account_id
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

function weekStartSql(column) {
  return `date(datetime(${column}, '+9 hours'), printf('-%d days', (CAST(strftime('%w', datetime(${column}, '+9 hours')) AS INTEGER) + 6) % 7))`;
}

function getPlayerTrend(id) {
  if (!findPlayer(id)) return null;
  const weekExpr = weekStartSql("cm.created_at");
  const rows = all(`
    WITH ${PLAYERS_CTE}, ${HUMAN_KILLS_CTE}, weekly AS (
      SELECT ${weekExpr} AS week,
        mp.account_id AS accountId,
        COUNT(*) AS games,
        AVG(mp.damage) AS adr,
        SUM(COALESCE(hk.kills, 0)) AS kills,
        SUM(CASE WHEN mp.death_type IS NOT NULL AND mp.death_type != 'alive' THEN 1 ELSE 0 END) AS deaths,
        AVG(CASE WHEN mp.placement BETWEEN 1 AND 10 THEN 100.0 ELSE 0 END) AS top10
      FROM match_players mp
      JOIN collected_matches cm ON cm.match_id = mp.match_id
      JOIN players p ON p.accountId = mp.account_id
      LEFT JOIN human_kills hk ON hk.matchId = mp.match_id AND hk.accountId = mp.account_id
      GROUP BY week, mp.account_id
    )
    SELECT week,
      MAX(CASE WHEN accountId = ? THEN games END) AS myGames,
      MAX(CASE WHEN accountId = ? THEN adr END) AS myAdr,
      MAX(CASE WHEN accountId = ? THEN 1.0 * kills / MAX(deaths, 1) END) AS myKd,
      MAX(CASE WHEN accountId = ? THEN top10 END) AS myTop10,
      ROUND(AVG(adr), 1) AS squadAdr,
      ROUND(AVG(1.0 * kills / MAX(deaths, 1)), 2) AS squadKd,
      ROUND(AVG(top10), 1) AS squadTop10
    FROM weekly
    GROUP BY week
    HAVING myGames IS NOT NULL
    ORDER BY week DESC
    LIMIT 12`, id, id, id, id).reverse();

  return {
    weeks: rows.map(r => r.week.slice(5).replace("-", ".")),
    games: rows.map(r => r.myGames),
    me: {
      adr: rows.map(r => round(r.myAdr)),
      kd: rows.map(r => round(r.myKd, 2)),
      top10: rows.map(r => round(r.myTop10, 1))
    },
    squad: {
      adr: rows.map(r => round(r.squadAdr)),
      kd: rows.map(r => round(r.squadKd, 2)),
      top10: rows.map(r => round(r.squadTop10, 1))
    }
  };
}

function getTeamKillRankings() {
  const rows = all(`
    WITH ${PLAYERS_CTE}, enemy AS (
      SELECT killer_account_id AS accountId, COUNT(*) AS enemyKills
      FROM death_events
      WHERE killer_account_id IS NOT NULL AND is_suicide = 0 AND is_team_kill = 0
        AND victim_account_id NOT LIKE 'ai.%'
      GROUP BY killer_account_id
    ), friendly AS (
      SELECT killer_account_id AS accountId, COUNT(*) AS teamKills
      FROM death_events WHERE is_team_kill = 1 GROUP BY killer_account_id
    )
    SELECT p.accountId, p.displayName AS name,
      COALESCE(e.enemyKills, 0) AS enemyKills, COALESCE(f.teamKills, 0) AS teamKills
    FROM players p
    LEFT JOIN enemy e ON e.accountId = p.accountId
    LEFT JOIN friendly f ON f.accountId = p.accountId`);
  return rows.map(r => ({
    id: r.accountId,
    name: r.name,
    enemyKills: r.enemyKills,
    teamKills: r.teamKills,
    share: r.enemyKills + r.teamKills ? round(r.teamKills / (r.enemyKills + r.teamKills) * 100, 2) : 0
  })).sort((a, b) => b.share - a.share || b.teamKills - a.teamKills);
}

function getPlayerTeamKills(id) {
  const base = getTeamKillRankings().find(row => row.id === id);
  if (!base) return null;
  const recent = get(`
    WITH ${PLAYERS_CTE}
    SELECT cm.created_at AS createdAt, cm.map_name AS mapName, de.damage_causer AS weapon,
      COALESCE(v.displayName, victim.player_name, de.victim_account_id) AS victim
    FROM death_events de
    JOIN collected_matches cm ON cm.match_id = de.match_id
    LEFT JOIN players v ON v.accountId = de.victim_account_id
    LEFT JOIN match_players victim ON victim.match_id = de.match_id AND victim.account_id = de.victim_account_id
    WHERE de.killer_account_id = ? AND de.is_team_kill = 1
    ORDER BY de.event_at DESC LIMIT 1`, id);
  const favoriteVictim = get(`
    WITH ${PLAYERS_CTE}
    SELECT COALESCE(v.displayName, victim.player_name, de.victim_account_id) AS name, COUNT(*) AS count
    FROM death_events de
    LEFT JOIN players v ON v.accountId = de.victim_account_id
    LEFT JOIN match_players victim ON victim.match_id = de.match_id AND victim.account_id = de.victim_account_id
    WHERE de.killer_account_id = ? AND de.is_team_kill = 1
    GROUP BY de.victim_account_id ORDER BY count DESC LIMIT 1`, id);
  return {
    ...base,
    recent: recent ? { date: toDate(recent.createdAt), map: mapLabel(recent.mapName), weapon: weaponLabel(recent.weapon), victim: recent.victim } : null,
    favoriteVictim: favoriteVictim ?? null
  };
}

function weaponLabel(code) {
  return WEAPONS[code]?.[0] ?? code?.replace(/^Weap/, "").replace(/_C$/, "") ?? "알 수 없음";
}

function getWeaponLeaders(limit = 24) {
  const size = Math.min(100, Math.max(1, Number(limit) || 24));
  const rows = all(`
    WITH ${PLAYERS_CTE}, weapon_kills AS (
      SELECT de.damage_causer AS code, de.killer_account_id AS accountId, COUNT(*) AS kills
      FROM death_events de
      JOIN players p ON p.accountId = de.killer_account_id
      WHERE de.killer_account_id IS NOT NULL AND de.is_suicide = 0 AND de.is_team_kill = 0
        AND de.victim_account_id NOT LIKE 'ai.%' AND de.damage_causer IS NOT NULL
      GROUP BY de.damage_causer, de.killer_account_id
    ), ranked AS (
      SELECT wk.*, p.displayName AS name,
        SUM(wk.kills) OVER (PARTITION BY wk.code) AS totalKills,
        ROW_NUMBER() OVER (PARTITION BY wk.code ORDER BY wk.kills DESC, p.displayName) AS rank
      FROM weapon_kills wk JOIN players p ON p.accountId = wk.accountId
    )
    SELECT * FROM ranked WHERE rank <= 3
    ORDER BY totalKills DESC, code, rank
    LIMIT ?`, size * 3);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.code)) {
      const [name, category] = WEAPONS[row.code] ?? [weaponLabel(row.code), "기타"];
      grouped.set(row.code, { code: row.code, name, category, kills: row.totalKills, top: [] });
    }
    grouped.get(row.code).top.push({ id: row.accountId, name: row.name, kills: row.kills });
  }
  return [...grouped.values()].slice(0, size);
}

function getMissionLeaderboard(month = "") {
  const selectedMonth = /^\d{4}-\d{2}$/.test(month) ? month : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  const rows = all(`
    WITH names AS (
      SELECT discord_user_id AS discordId,
        MAX(COALESCE(NULLIF(display_name, ''), pubg_name)) AS name,
        MAX(pubg_account_id) AS accountId
      FROM registered_players GROUP BY discord_user_id
    )
    SELECT n.accountId, n.name, COUNT(*) AS missions, SUM(pm.reward_points) AS points
    FROM mission_completions mc
    JOIN party_missions pm ON pm.session_id = mc.session_id AND pm.mission_key = mc.mission_key
    JOIN names n ON n.discordId = mc.discord_user_id
    WHERE substr(datetime(mc.completed_at, '+9 hours'), 1, 7) = ?
    GROUP BY mc.discord_user_id
    ORDER BY points DESC, missions DESC, n.name`, selectedMonth);
  const [year, monthNumber] = selectedMonth.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 1) - 9 * 3600_000);
  const remainingMs = Math.max(0, end.getTime() - Date.now());
  return {
    month: selectedMonth,
    remainingDays: Math.ceil(remainingMs / 86_400_000),
    rows: rows.map((r, i) => ({ rank: i + 1, id: r.accountId, name: r.name, missions: r.missions, points: r.points }))
  };
}

function getMissionHallOfFame() {
  return all(`
    WITH names AS (
      SELECT discord_user_id AS discordId, MAX(COALESCE(NULLIF(display_name, ''), pubg_name)) AS name,
        MAX(pubg_account_id) AS accountId FROM registered_players GROUP BY discord_user_id
    ), monthly AS (
      SELECT substr(datetime(mc.completed_at, '+9 hours'), 1, 7) AS month, n.name, n.accountId,
        COUNT(*) AS missions, SUM(pm.reward_points) AS points
      FROM mission_completions mc
      JOIN party_missions pm ON pm.session_id = mc.session_id AND pm.mission_key = mc.mission_key
      JOIN names n ON n.discordId = mc.discord_user_id
      GROUP BY month, mc.discord_user_id
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY month ORDER BY points DESC, missions DESC, name) AS rank FROM monthly
    )
    SELECT month, name, accountId, missions, points FROM ranked WHERE rank = 1 ORDER BY month DESC`);
}

function getPlayerInsights(id) {
  const player = findPlayer(id);
  if (!player) return null;
  const leaderboard = getMissionLeaderboard();
  const mission = leaderboard.rows.find(row => row.id === id) ?? { points: 0, missions: 0, rank: null };
  const weapons = getWeaponLeaders(100)
    .map(w => ({ ...w, playerKills: w.top.find(t => t.id === id)?.kills ?? 0 }))
    .filter(w => w.playerKills > 0)
    .sort((a, b) => b.playerKills - a.playerKills)
    .slice(0, 4);
  return { trend: getPlayerTrend(id), teamKills: getPlayerTeamKills(id), mission, weapons };
}

function listHighlights(limit = 50, accountId = "") {
  const size = Math.min(100, Math.max(1, Number(limit) || 50));
  const rows = webAll(`SELECT * FROM highlights ${accountId ? "WHERE account_id = ?" : ""} ORDER BY created_at DESC LIMIT ?`, ...(accountId ? [accountId, size] : [size]));
  return rows.map(row => {
    const player = findPlayer(row.account_id);
    const match = row.match_id ? get(`SELECT map_name AS mapName, created_at AS createdAt FROM collected_matches WHERE match_id = ?`, row.match_id) : null;
    return {
      id: row.id, accountId: row.account_id, name: player?.displayName ?? "알 수 없는 대원",
      title: row.title, description: row.description, mediaType: row.media_type, mediaUrl: row.media_url,
      matchId: row.match_id, map: match ? mapLabel(match.mapName) : null,
      matchDate: match ? toDate(match.createdAt) : null, createdAt: row.created_at, likes: row.likes
    };
  });
}

async function getPatches(limit = 8) {
  const size = Math.min(20, Math.max(1, Number(limit) || 8));
  const document = JSON.parse(await readFile(PATCH_FILE, "utf8"));
  const allowedTags = new Set(["buff", "nerf", "change", "return", "new"]);
  const items = Array.isArray(document) ? document : document.items;
  if (!Array.isArray(items)) throw new Error("web/content/patches.json의 items가 배열이 아니에요");
  return items.slice(0, size).map((item, index) => ({
    id: String(item.id ?? `patch-${index + 1}`),
    version: String(item.version ?? "UPDATE"),
    date: item.date ? String(item.date) : null,
    title: String(item.title ?? "제목 없음"),
    summary: String(item.summary ?? ""),
    tags: Array.isArray(item.tags) ? item.tags.filter(tag => allowedTags.has(tag)) : [],
    impact: item.impact ? String(item.impact) : "",
    url: item.sourceUrl ? String(item.sourceUrl) : "https://pubg.com/ko/news?category=patch_notes",
    weapons: Array.isArray(item.weapons) ? item.weapons : [],
    returns: Array.isArray(item.returns) ? item.returns : []
  }));
}

/* ---------- HTTP ---------- */

const routes = [
  [/^\/api\/summary$/, () => getSummary()],
  [/^\/api\/players$/, (_, url) => listPlayers(url.searchParams.get("q") ?? "")],
  [/^\/api\/players\/([^/]+)\/insights$/, ([, id]) => getPlayerInsights(decodeURIComponent(id))],
  [/^\/api\/players\/([^/]+)\/trend$/, ([, id]) => getPlayerTrend(decodeURIComponent(id))],
  [/^\/api\/players\/([^/]+)$/, ([, id]) => getPlayer(decodeURIComponent(id))],
  [/^\/api\/players\/([^/]+)\/matches$/, ([, id], url) => getPlayerMatches(decodeURIComponent(id), {
    map: url.searchParams.get("map"),
    page: url.searchParams.get("page"),
    limit: url.searchParams.get("limit")
  })],
  [/^\/api\/matches\/recent$/, (_, url) => getRecentMatches(url.searchParams.get("limit"))],
  [/^\/api\/matches\/([^/]+)$/, ([, id]) => getMatch(decodeURIComponent(id))],
  [/^\/api\/teamkills$/, () => getTeamKillRankings()],
  [/^\/api\/weapons$/, (_, url) => getWeaponLeaders(url.searchParams.get("limit"))],
  [/^\/api\/missions\/leaderboard$/, (_, url) => getMissionLeaderboard(url.searchParams.get("month") ?? "")],
  [/^\/api\/missions\/hall-of-fame$/, () => getMissionHallOfFame()],
  [/^\/api\/highlights\/config$/, () => ({ uploadEnabled: Boolean(WEB_ADMIN_KEY), maxUploadMb: Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024) })],
  [/^\/api\/highlights$/, (_, url) => listHighlights(url.searchParams.get("limit"), url.searchParams.get("player") ?? "")],
  [/^\/api\/patches$/, (_, url) => getPatches(url.searchParams.get("limit"))]
];

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-Account-Id, X-Title, X-Match-Id, X-Description",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm"
};

async function readBody(req, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error("파일이 너무 커요"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function assertUploadKey(req) {
  if (!WEB_ADMIN_KEY) throw Object.assign(new Error("업로드 기능이 아직 활성화되지 않았어요"), { status: 503 });
  if (req.headers["x-admin-key"] !== WEB_ADMIN_KEY) throw Object.assign(new Error("업로드 키가 올바르지 않아요"), { status: 401 });
}

function safeHeader(req, name, fallback = "") {
  const raw = String(req.headers[name] ?? fallback);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function createHighlight(req) {
  assertUploadKey(req);
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
  let accountId;
  let title;
  let description = "";
  let matchId = null;
  let mediaType;
  let mediaUrl;

  if (contentType === "application/json") {
    const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8"));
    accountId = String(body.accountId ?? "");
    title = String(body.title ?? "").trim();
    description = String(body.description ?? "").trim();
    matchId = body.matchId ? String(body.matchId) : null;
    const link = new URL(String(body.mediaUrl ?? ""));
    if (link.protocol !== "https:") throw Object.assign(new Error("HTTPS 영상 링크만 등록할 수 있어요"), { status: 400 });
    mediaType = "link";
    mediaUrl = link.toString();
  } else {
    accountId = safeHeader(req, "x-account-id");
    title = safeHeader(req, "x-title").trim();
    description = safeHeader(req, "x-description").trim();
    matchId = safeHeader(req, "x-match-id") || null;
    const allowed = { "video/mp4": ["video", ".mp4"], "video/webm": ["video", ".webm"], "image/jpeg": ["image", ".jpg"], "image/png": ["image", ".png"], "image/webp": ["image", ".webp"] };
    const fileInfo = allowed[contentType];
    if (!fileInfo) throw Object.assign(new Error("MP4, WebM, JPG, PNG, WebP 파일만 올릴 수 있어요"), { status: 415 });
    validateHighlightMetadata({ accountId, title, description, matchId });
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (!body.length) throw Object.assign(new Error("파일이 비어 있어요"), { status: 400 });
    const filename = `${Date.now()}-${randomUUID()}${fileInfo[1]}`;
    await writeFile(join(HIGHLIGHT_DIR, basename(filename)), body, { flag: "wx" });
    mediaType = fileInfo[0];
    mediaUrl = `/uploads/${filename}`;
  }

  validateHighlightMetadata({ accountId, title, description, matchId });

  const result = webDb.prepare(`
    INSERT INTO highlights (account_id, title, description, media_type, media_url, match_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, title, description, mediaType, mediaUrl, matchId, new Date().toISOString());
  return listHighlights(1).find(item => item.id === Number(result.lastInsertRowid)) ?? { id: Number(result.lastInsertRowid) };
}

function validateHighlightMetadata({ accountId, title, description, matchId }) {
  if (!findPlayer(accountId)) throw Object.assign(new Error("등록 대원만 하이라이트를 올릴 수 있어요"), { status: 400 });
  if (!title || title.length > 80) throw Object.assign(new Error("제목은 1~80자로 입력해 주세요"), { status: 400 });
  if (description.length > 500) throw Object.assign(new Error("설명은 500자 이하여야 해요"), { status: 400 });
  if (matchId && !get(`SELECT 1 AS ok FROM collected_matches WHERE match_id = ?`, matchId)) {
    throw Object.assign(new Error("연결할 경기 기록을 찾지 못했어요"), { status: 400 });
  }
}

function sendUploadRangeError(res, size) {
  res.writeHead(416, {
    "Content-Range": `bytes */${size}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400"
  });
  res.end();
}

function pipeFile(res, filePath, options) {
  const stream = createReadStream(filePath, options);
  stream.on("error", error => res.destroy(error));
  stream.pipe(res);
}

async function serveUpload(pathname, req, res) {
  let filename;
  try {
    filename = decodeURIComponent(pathname.slice("/uploads/".length));
  } catch {
    return send(res, 400, { error: "잘못된 파일 경로" });
  }

  if (!filename || basename(filename) !== filename) return send(res, 400, { error: "잘못된 파일 경로" });

  const filePath = join(HIGHLIGHT_DIR, filename);
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("not a file");
  } catch {
    return send(res, 404, { error: "파일을 찾을 수 없어요" });
  }

  const size = fileInfo.size;
  const headers = {
    "Content-Type": STATIC_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*"
  };
  const range = String(req.headers.range ?? "").trim();

  if (!range) {
    res.writeHead(200, { ...headers, "Content-Length": size });
    return pipeFile(res, filePath);
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || size === 0) return sendUploadRangeError(res, size);

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return sendUploadRangeError(res, size);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return sendUploadRangeError(res, size);
    end = Math.min(end, size - 1);
  }

  if (start < 0 || start >= size || end < start) return sendUploadRangeError(res, size);

  res.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": end - start + 1
  });
  return pipeFile(res, filePath, { start, end });
}

async function serveStatic(pathname, req, res) {
  if (pathname.startsWith("/uploads/")) return serveUpload(pathname, req, res);

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
  if (req.method === "POST" && url.pathname === "/api/highlights") {
    try {
      return send(res, 201, await createHighlight(req));
    } catch (error) {
      if (!error.status) console.error(error);
      return send(res, error.status ?? 500, { error: error.status ? error.message : "업로드 중 서버 오류가 발생했어요" });
    }
  }
  if (req.method !== "GET") return send(res, 405, { error: "지원하지 않는 요청이에요" });

  if (url.pathname.startsWith("/api/")) {
    for (const [pattern, handler] of routes) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      try {
        const data = await handler(match, url);
        return data === null ? send(res, 404, { error: "데이터를 찾을 수 없어요" }) : send(res, 200, data);
      } catch (error) {
        console.error(error);
        return send(res, 500, { error: "서버 오류" });
      }
    }
    return send(res, 404, { error: "없는 API 주소예요" });
  }
  return serveStatic(url.pathname, req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`DROPLOG API 준비 완료 → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`DB: ${DB_PATH} (읽기 전용)`);
});

process.on("SIGINT", () => { db.close(); webDb.close(); server.close(() => process.exit(0)); });
