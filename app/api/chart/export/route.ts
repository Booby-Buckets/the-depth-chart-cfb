import { chartConfigured, json, seasonRows } from "@/lib/chartdb";

/** Public, read-only: every charted play of a season. The site build (scripts/build_handchart.py)
 *  folds it into the player and team pages. */
export async function GET(req: Request) {
  if (!chartConfigured()) return json({ plays: [], configured: false });
  const season = Number(new URL(req.url).searchParams.get("season")) || new Date().getFullYear();
  const rows = await seasonRows(season);
  if (typeof rows === "string") return json({ error: rows }, 502);
  return json({ season, plays: rows }, 200, { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" });
}
