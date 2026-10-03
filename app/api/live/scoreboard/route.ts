import type { LiveGame } from "@/lib/livewp";

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

type Comp = {
  id: string; status: { period: number; displayClock: string; type: { state: "pre" | "in" | "post"; shortDetail: string } };
  competitors: { homeAway: string; score?: string; team: { id: string; abbreviation?: string } }[];
  situation?: { possession?: string; shortDownDistanceText?: string; possessionText?: string; isRedZone?: boolean; lastPlay?: { text?: string } };
};

/** Every FBS game this week, live: score, clock, possession, down & distance. Cached at the
 *  edge for 15s, so all viewers share one ESPN request. */
export async function GET() {
  const r = await fetch(`${ESPN}?groups=80&limit=400`, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return Response.json({ error: `espn ${r.status}` }, { status: 502 });
  const d = await r.json();
  const games: LiveGame[] = (d.events || []).map((e: { id: string; competitions: Comp[] }) => {
    const c = e.competitions[0];
    const side = Object.fromEntries(c.competitors.map((x) => [x.homeAway, x]));
    const s = c.situation || {};
    return {
      id: e.id, state: c.status.type.state, detail: c.status.type.shortDetail, period: c.status.period, clock: c.status.displayClock,
      home: side.home.team.id, away: side.away.team.id, hs: Number(side.home.score || 0), as: Number(side.away.score || 0),
      homeAbbr: side.home.team.abbreviation, awayAbbr: side.away.team.abbreviation,
      poss: s.possession ?? null, dd: s.shortDownDistanceText ?? null, possText: s.possessionText ?? null,
      redZone: !!s.isRedZone, lastPlay: s.lastPlay?.text ?? null,
    };
  });
  return Response.json({ at: new Date().toISOString(), games }, {
    headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15" },
  });
}
