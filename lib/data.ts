import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The Python build (scripts/build_hub.py) writes public/data/*.json. Server components read
// the files directly; the same files stay public at /data/* for the legacy pages.
const DATA = path.join(process.cwd(), "public", "data");

async function readJson<T>(rel: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA, rel), "utf8")) as T;
}

export type HubTeam = {
  id: string; name: string; full: string; abbr: string; conf: string; confAbbr: string; logo: string;
  rank: number; net: number; off: number; def: number; sos: number | null; prior: number | null;
  w: number; l: number; cw: number; cl: number;
  oEPA?: number; dEPA?: number; oSR?: number; dSR?: number; oExpl?: number; dExpl?: number;
};
export type SlateGame = {
  id: string; date: string; neutral: boolean; completed: boolean; detail: string; tv: string | null;
  home: string; away: string; homeName: string; awayName: string; homeRank?: number; awayRank?: number;
  hs: number | null; as: number | null; spread: number; homeWin: number; total: number;
};
export type Hub = {
  season: number; built: string; gamesPlayed: number; hfa: number; ptsAvg: number; hasAdvanced: boolean;
  slateLabel: string | null; teams: HubTeam[]; slate: SlateGame[];
};

export const getHub = () => readJson<Hub>("hub.json");

/* ---------- teams ---------- */
export type HistoryPoint = { wk: string; net: number; rank: number };
export type SchedGame = {
  id: string; date: string; week: string; site: "H" | "A" | "N"; conf: boolean; tv: string | null;
  opp: string; oppName: string; oppFbs: boolean; oppRank: number | null; oppLogo: string; completed: boolean;
  pf?: number; pa?: number; res?: "W" | "L"; score?: number;
  line?: number; win?: number; total?: number; detail?: string;
};
export type RecordRow = { w: number; l: number; p: number };
export type TeamStat = { k: string; l: string; hi: boolean; adv?: boolean; off: number | null; offRk: number | null; def: number | null; defRk: number | null };
export type RosterPlayer = { id: string; name: string; no: string | null; pos: string | null; unit: string; cls: string | null; ht: string | null; wt: string | null; home: string | null };
export type TeamFile = {
  season: number; fbsTeams: number; hfa: number;
  meta: HubTeam & { mascot: string | null; color: string | null; alt: string | null; coach: string | null; venue: string | null };
  rating: { rank: number; net: number; off: number; def: number; sos: number | null; prior: number | null; w: number; l: number; cw: number; cl: number; offRk: number; defRk: number; sosRk: number | null };
  history: HistoryPoint[];
  schedule: SchedGame[];
  outlook: { remaining: number; expW: number; expL: number; dist: RecordRow[]; confExpW: number; confExpL: number; confDist: RecordRow[]; bowlP: number };
  stats: TeamStat[];
  roster: RosterPlayer[];
};
export const getTeam = (id: string) => readJson<TeamFile>(`teams/${id}.json`);

/* ---------- players (the per-team player file) ---------- */
export type PlayerLite = {
  id: string; name: string; no: string | null; pos: string | null; cls: string | null;
  stats: Record<string, Record<string, number>>; rk?: Record<string, [number, number]>;
};
export const getTeamPlayers = (id: string) => readJson<{ players: PlayerLite[] }>(`players/${id}.json`);

/* ---------- URL slugs: /teams/notre-dame, /teams/miami-oh ---------- */
export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[&'’ʻ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function getTeamIndex() {
  const hub = await getHub();
  const bySlug = new Map<string, HubTeam>(), slugOf = new Map<string, string>();
  for (const t of hub.teams) {
    let s = slugify(t.name);
    if (bySlug.has(s)) s = `${s}-${t.id}`; // no two FBS names collide today (checked); ids keep it stable if one ever does
    bySlug.set(s, t);
    slugOf.set(t.id, s);
  }
  return { hub, bySlug, slugOf };
}
