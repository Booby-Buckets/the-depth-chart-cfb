import { readFile } from "node:fs/promises";
import path from "node:path";

/* The Play Finder's search: every play of a season with our EPA and win probability added
   (scripts/build_plays.py → public/data/plays/<season>/). A team or player search reads that
   team's games; a search across every team reads the season's precomputed standout plays. */

const PLAYS = path.join(process.cwd(), "public", "data", "plays");     // kept narrow so the function only bundles these files
const HUB = path.join(process.cwd(), "public", "data", "hub.json");
const IDS = path.join(process.cwd(), "public", "data", "players", "ids.json");
const CAREERS = path.join(process.cwd(), "public", "data", "careers.json");
// [seq, q, clock, off, down, dist, yte, type, yds, epa, wpa, text, pids, roles, result]
type Row = [string, number, string | null, string, number | null, number | null, number | null, string, number, number | null, number, string, string[], string, string];
type Index = { season: number; games: Record<string, [string, string, string, string]>; teams: Record<string, string[]>; names: Record<string, [string, string]>; top: [string, ...Row][] };

const cache = new Map<string, unknown>();
async function json<T>(file: string): Promise<T> {
  if (cache.has(file)) return cache.get(file) as T;
  const v = JSON.parse(await readFile(file, "utf8")) as T;
  if (cache.size > 400) cache.clear();
  cache.set(file, v);
  return v;
}

const num = (v: string | null) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const season = Number(u.get("season") || 0);
  if (!/^\d{4}$/.test(String(season))) return Response.json({ error: "season" }, { status: 400 });
  let idx: Index;
  try { idx = await json<Index>(path.join(PLAYS, String(season), "index.json")); } catch { return Response.json({ error: "no plays for that season" }, { status: 404 }); }

  const team = u.get("team") || "", side = u.get("side") || "off", player = u.get("player") || "";
  const type = u.get("type") || "", week = u.get("week") || "", down = num(u.get("down")), q = num(u.get("q"));
  const zone = u.get("zone") || "", text = (u.get("text") || "").toLowerCase(), sort = u.get("sort") || "epa";
  const col = u.get("col") || "", op = u.get("op") || ">=", val = num(u.get("val"));

  // which plays to scan
  let pool: [string, Row][] = [];
  let tid = team;
  if (!tid && player) {       // a player without a team: find the team they played for that season
    try {
      const ids = await json<Record<string, string>>(season === (await json<{ season: number }>(HUB)).season ? IDS : CAREERS);
      const v = (ids as Record<string, unknown>)[player];
      tid = typeof v === "string" ? v : Array.isArray(v) ? ((v as [number, string][]).find(([y]) => y === season)?.[1] ?? "") : "";
    } catch { /* fall through to the season's standout plays */ }
  }
  if (tid) {
    for (const g of idx.teams[tid] || []) {
      try { for (const r of await json<Row[]>(path.join(PLAYS, String(season), "g", `${g}.json`))) pool.push([g, r]); } catch { /* missing game */ }
    }
  } else {
    pool = idx.top.map(([g, ...r]) => [g, r as unknown as Row]);
  }

  const val_ = (g: string, r: Row, c: string): number | null => {
    switch (c) {
      case "epa": return r[9]; case "wpa": return r[10]; case "yds": return r[8]; case "down": return r[4];
      case "dist": return r[5]; case "yte": return r[6]; case "q": return r[1];
      default: return null;
    }
  };
  const out = pool.filter(([g, r]) => {
    const G = idx.games[g];
    if (!G) return false;
    const def = r[3] === G[0] ? G[1] : G[0];
    if (tid && !player && (side === "off" ? r[3] !== tid : side === "def" ? def !== tid : false)) return false;
    if (player && !r[12].includes(player)) return false;
    if (type && (type === "run" ? r[7] !== "rush" : type === "dropback" ? !["pass", "sack"].includes(r[7]) : r[7] !== type)) return false;
    if (week && G[2] !== week) return false;
    if (down != null && r[4] !== down) return false;
    if (q != null && (q === 5 ? r[1] < 5 : r[1] !== q)) return false;
    if (zone === "rz" && !(r[6] != null && r[6] <= 20)) return false;
    if (zone === "gl" && !(r[6] != null && r[6] <= 10)) return false;
    if (zone === "own" && !(r[6] != null && r[6] > 50)) return false;
    if (zone === "third" && !(r[4] != null && r[4] >= 3)) return false;
    if (text && !r[11].toLowerCase().includes(text)) return false;
    if (col && val != null) {
      const v = val_(g, r, col);
      if (v == null || (op === ">=" ? v < val : op === "<=" ? v > val : v !== val)) return false;
    }
    return true;
  });
  const key: Record<string, (r: Row) => number> = {
    epa: (r) => r[9] ?? -99, "-epa": (r) => -(r[9] ?? 99), wpa: (r) => r[10], "-wpa": (r) => -r[10], yds: (r) => r[8], time: () => 0,
  };
  const k = key[sort] || key.epa;
  if (sort !== "time") out.sort((a, b) => k(b[1]) - k(a[1]));
  const n = out.length;
  const rows = out.slice(0, 150).map(([g, r]) => {
    const G = idx.games[g];
    return { g, seq: r[0], q: r[1], clock: r[2], off: r[3], def: r[3] === G[0] ? G[1] : G[0], home: G[0], wk: G[2], date: G[3],
      down: r[4], dist: r[5], yte: r[6], type: r[7], yds: r[8], epa: r[9], wpa: r[10], text: r[11], res: r[14] };
  });
  const weeks = [...new Set(Object.values(idx.games).sort((a, b) => a[3].localeCompare(b[3])).map((G) => G[2]))];
  return Response.json({ season, n, scope: tid ? "team" : "top", rows, names: idx.names, weeks },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
