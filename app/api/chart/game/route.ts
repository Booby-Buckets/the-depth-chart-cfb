import { chartAuthed, chartConfigured, gameRows, json, type ChartRow } from "@/lib/chartdb";

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football";
const SCRIMMAGE = /^(Rush|Rushing Touchdown|Pass|Pass Reception|Pass Incompletion|Passing Touchdown|Sack|Interception|Pass Interception Return|Interception Return Touchdown|Fumble Recovery \(Own\)|Fumble Recovery \(Opponent\)|Safety)$/;

type EspnPlay = {
  id: string; sequenceNumber: string; type?: { text?: string }; text?: string; period?: { number?: number };
  clock?: { displayValue?: string }; wallclock?: string; statYardage?: number;
  teamParticipants?: { id: string; type: string }[];
  start?: { down?: number; distance?: number; yardsToEndzone?: number; downDistanceText?: string };
};

/** One game's scrimmage plays (from ESPN's summary) with whatever has been charted for them. */
export async function GET(req: Request) {
  if (!chartConfigured()) return json({ error: "not configured" }, 503);
  if (!chartAuthed(req)) return json({ error: "passcode" }, 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\d{6,12}$/.test(id)) return json({ error: "bad id" }, 400);

  const [sum, saved] = await Promise.all([
    fetch(`${ESPN}/summary?event=${id}`, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()),
    gameRows(id),
  ]);
  const comp = sum?.header?.competitions?.[0];
  const teams = (comp?.competitors || []).map((c: { homeAway: string; team: { id: string; location?: string; displayName?: string; abbreviation?: string; logos?: { href: string }[]; logo?: string } }) => ({
    id: c.team.id, home: c.homeAway === "home", name: c.team.location || c.team.displayName, abbr: c.team.abbreviation,
    logo: c.team.logos?.[0]?.href || c.team.logo || `https://a.espncdn.com/i/teamlogos/ncaa/500/${c.team.id}.png`,
  }));
  const plays: unknown[] = [];
  for (const d of sum?.drives?.previous || []) {
    for (const p of (d.plays || []) as EspnPlay[]) {
      const t = p.type?.text || "";
      if (!SCRIMMAGE.test(t) || (p.text || "").includes("NO PLAY")) continue;
      const side = Object.fromEntries((p.teamParticipants || []).map((x) => [x.type, x.id]));
      plays.push({
        seq: p.sequenceNumber, type: t, text: p.text, q: p.period?.number, clock: p.clock?.displayValue, wall: p.wallclock,
        down: p.start?.down, dist: p.start?.distance, ytg: p.start?.yardsToEndzone, dd: p.start?.downDistanceText,
        yds: p.statYardage ?? 0, off: side.offense ?? null, def: side.defense ?? null,
      });
    }
  }
  const season = Number(sum?.header?.season?.year) || new Date().getFullYear();
  return json({ id, season, status: comp?.status?.type?.shortDetail, teams, plays, saved: Object.fromEntries((saved as ChartRow[]).map((r) => [r.seq, r])) });
}
