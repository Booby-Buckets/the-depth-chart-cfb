import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./slug";

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
export type TeamStat = { k: string; l: string; hi: boolean; adv?: boolean; grp?: "pbp"; tip?: string; off: number | null; offRk: number | null; def: number | null; defRk: number | null };
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

/* ---------- URL slugs (lib/slug.ts): /teams/notre-dame ---------- */
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

/* ---------- depth charts + snap estimates (the per-team player file) ---------- */
export type DepthPlayer = {
  id: string; name: string; no: string | null; pos: string | null; cls: string | null;
  val: number; g: number; last: number; tp: number; lo?: number | null; hi?: number | null; inv?: number;
  gs?: number; startedLast?: boolean;
};
export type DepthSlot = { slot: string; starters: number; basis: "production" | "starts" | "roster"; players: DepthPlayer[] };
export type PlayLogRow = {
  id: string; date: string; wk: string; opp: string; oppName: string; tp: number;
  off: number; qb: number; def: number; st: number; pen: number; es?: number; esTP?: number; esLo?: number; esHi?: number;
  gs?: number; gsPos?: string;
};
export type PPA = { all: number | null; pass: number | null; rush: number | null; firstDown: number | null; secondDown: number | null; thirdDown: number | null; standardDowns: number | null; passingDowns: number | null };
export type Usage = { overall: number | null; pass: number | null; rush: number | null; firstDown: number | null; secondDown: number | null; thirdDown: number | null; standardDowns: number | null; passingDowns: number | null };
type Rk = { rk?: Record<string, [number, number]> };
export type PlayerAdv = {
  rush?: { car: number; sr: number | null; expl: number | null; stuff: number | null; fd: number; rz: number; gl: number } & Rk;
  recv?: { tgt: number; catch: number | null; sr: number | null; expl: number | null; deep: number | null; ypt: number | null; share: number | null; third: number; rz: number } & Rk;
  pass?: { db: number; sr: number | null; expl: number | null; sackRate: number | null; deep: number | null; intRate: number | null; third: number | null } & Rk;
  def?: { tkl: number; tfl: number; sacks: number; pd: number; ints: number; ff: number; stops: number; havoc: number } & Rk;
};
export type PlayerFull = PlayerLite & {
  adv?: PlayerAdv;
  onRoster?: boolean; unit?: string; ht?: string | null; wt?: string | null; home?: string | null;
  ppa?: { avg: PPA; tot: number; plays: number };
  use?: Usage;
  recruit?: { year: number; stars: number | null; rating: number | null; ranking: number | null; school: string | null; city: string | null; stateProvince: string | null; position: string | null };
  pi?: { off: number; qb: number; def: number; st: number; pen: number; g: number; gs?: number; log: PlayLogRow[]; es?: number; esTP?: number; esLo?: number; esHi?: number };
};
export type TeamGame = { id: string; date: string; wk: string; opp: string; oppName: string; site: "H" | "A" | "N"; tp: number; otp?: number };
export type PlayersFile = {
  season: number; tid: string; games: TeamGame[];
  groupAvg: Record<string, { ppa: PPA; use: Usage; n: number; minPerGame: number }>;
  depth: Record<"offense" | "defense" | "special", DepthSlot[]>;
  players: PlayerFull[];
};
export const getPlayersFile = (id: string) => readJson<PlayersFile>(`players/${id}.json`);

/** Which team a player is on (every FBS player, from the build's ids.json). */
export async function getPlayerTeam(pid: string): Promise<string | null> {
  const ids = await readJson<Record<string, string>>("players/ids.json");
  return ids[pid] ?? null;
}

/* ---------- national leaderboards ---------- */
export type LeaderRow = { id: string; name: string; tid: string; team: string; conf: string; pos: string | null; cls: string | null; group?: string } & Record<string, number | string | null | undefined>;
export type Leaders = { season: number; groupMin: Record<string, number>; boards: Record<string, LeaderRow[]> };
export const getLeaders = () => readJson<Leaders>("players/leaders.json");

/* ---------- recruiting (the signing class, joined to this season's production) ---------- */
export type RecruitRow = {
  id: string | null; name: string; pos: string | null; stars: number | null; rating: number | null; rank: number | null;
  hs: string | null; home: string; tid: string; onFile: boolean; name2: string | null;
  g: number; gs: number; es: number | null; esTP: number | null; line: string;
};
export type ClassRow = {
  tid: string; rank: number; signees: number; five: number; four: number; three: number; avg: number | null; score: number;
  played: number; started: number; starts: number; snaps: number; top: string;
};
export type Recruiting = {
  season: number; classYear: number; source: string;
  counts: { signees: number; onFile: number; played: number; started: number };
  teams: ClassRow[]; recruits: RecruitRow[];
};
export const getRecruiting = () => readJson<Recruiting>("recruiting.json");

/* ---------- past seasons (scripts/build_history.py → public/data/seasons/<year>/) ---------- */

/** Built past seasons, newest first (the current season is not in this list). */
export async function getPastSeasons(): Promise<number[]> {
  try {
    return (await readdir(path.join(DATA, "seasons"))).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => b - a);
  } catch { return []; }
}
export const getSeasonHub = (y: number) => readJson<Hub & { final?: boolean; defenseFrom?: string | null }>(`seasons/${y}/hub.json`);
export const getSeasonTeam = (y: number, id: string) => readJson<TeamFile>(`seasons/${y}/teams/${id}.json`);
export const getSeasonLeaders = (y: number) => readJson<Leaders>(`seasons/${y}/players/leaders.json`);

/** A past season's player file: season totals, advanced, estimated snaps (no per-game logs). */
export type SeasonPlayer = PlayerLite & { tid: string; g: number; es?: number | null; esTP?: number | null; adv?: PlayerAdv };
export const getSeasonPlayers = (y: number, tid: string) => readJson<{ season: number; tid: string; players: SeasonPlayer[] }>(`seasons/${y}/players/${tid}.json`);

/** {player id: [[season, team id], ...]} across every built season plus the current one. */
export const getCareers = () => readJson<Record<string, [number, string][]>>("careers.json").catch(() => ({} as Record<string, [number, string][]>));

/** The team index (slugs) for a past season: same slug rule, that season's FBS teams. */
export async function getSeasonTeamIndex(y: number) {
  const hub = await getSeasonHub(y);
  const bySlug = new Map<string, HubTeam>(), slugOf = new Map<string, string>();
  for (const t of hub.teams) {
    let s = slugify(t.name);
    if (bySlug.has(s)) s = `${s}-${t.id}`;
    bySlug.set(s, t);
    slugOf.set(t.id, s);
  }
  return { hub, bySlug, slugOf };
}
