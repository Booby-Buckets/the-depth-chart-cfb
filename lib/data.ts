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
