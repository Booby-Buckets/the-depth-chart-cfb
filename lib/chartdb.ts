import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Tier 2 charting storage: Supabase table cfb_chart_plays (supabase/cfb_chart_plays.sql), reached
// only from the server with the service-role key. Env (Vercel → Settings → Environment Variables):
//   SUPABASE_URL                 https://izlqhnxowdhtdofkwrho.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    the project's service_role secret (never sent to the browser)
//   CHART_PASSCODE               the owner's passcode for /chart
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// local development without Supabase: charts go to .chart-dev.json and the passcode is "dev"
const DEV_FILE = process.env.NODE_ENV !== "production" && !(URL_ && KEY);
const PASS = process.env.CHART_PASSCODE || (DEV_FILE ? "dev" : undefined);

export const chartConfigured = () => !!(PASS && (DEV_FILE || (URL_ && KEY)));

const h = (s: string) => createHash("sha256").update(s).digest();
/** Constant-time passcode check against the x-chart-pass header. */
export function chartAuthed(req: Request): boolean {
  const got = req.headers.get("x-chart-pass");
  if (!PASS || !got) return false;
  return timingSafeEqual(h(got), h(PASS));
}

export async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  if (!URL_ || !KEY) throw new Error("charting storage not configured");
  return fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

export type ChartRow = {
  game_id: string; seq: string; season: number; off_tid: string | null; def_tid: string | null;
  kind: string | null; data: Record<string, unknown>; updated_at?: string;
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// ---- storage: Supabase in production, a local JSON file in development ----
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const devPath = path.join(process.cwd(), ".chart-dev.json");
async function devRows(): Promise<ChartRow[]> {
  try { return JSON.parse(await readFile(devPath, "utf8")); } catch { return []; }
}

export async function gameRows(gameId: string): Promise<ChartRow[]> {
  if (DEV_FILE) return (await devRows()).filter((r) => r.game_id === gameId);
  const r = await sb(`cfb_chart_plays?game_id=eq.${gameId}&select=game_id,seq,kind,data,updated_at`);
  return r.ok ? r.json() : [];
}

export async function upsertRow(row: ChartRow): Promise<string | null> {
  if (DEV_FILE) {
    const rows = (await devRows()).filter((r) => !(r.game_id === row.game_id && r.seq === row.seq));
    await writeFile(devPath, JSON.stringify([...rows, row]));
    return null;
  }
  const r = await sb("cfb_chart_plays?on_conflict=game_id,seq", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row),
  });
  return r.ok ? null : await r.text();
}

export async function deleteRow(gameId: string, seq: string): Promise<string | null> {
  if (DEV_FILE) {
    await writeFile(devPath, JSON.stringify((await devRows()).filter((r) => !(r.game_id === gameId && r.seq === seq))));
    return null;
  }
  const r = await sb(`cfb_chart_plays?game_id=eq.${gameId}&seq=eq.${seq}`, { method: "DELETE" });
  return r.ok ? null : await r.text();
}

export async function seasonRows(season: number): Promise<ChartRow[] | string> {
  if (DEV_FILE) return (await devRows()).filter((r) => r.season === season);
  const rows: ChartRow[] = [];
  for (let from = 0; ; from += 1000) {   // PostgREST pages at 1000; stable order so pages don't skip rows
    const r = await sb(`cfb_chart_plays?season=eq.${season}&select=game_id,seq,season,off_tid,def_tid,kind,data&order=game_id,seq`, {
      headers: { Range: `${from}-${from + 999}` },
    });
    if (!r.ok) return await r.text();
    const page = (await r.json()) as ChartRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}
