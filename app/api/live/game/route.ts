const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary";

type P = {
  id: string; sequenceNumber: string; type?: { text?: string }; text?: string; period?: { number?: number }; clock?: { displayValue?: string };
  homeScore?: number; awayScore?: number; scoringPlay?: boolean; statYardage?: number;
  start?: { yardsToEndzone?: number; downDistanceText?: string; team?: { id?: string } };
  teamParticipants?: { id: string; type: string }[];
};

/** One game, live: status, teams, every play (score, clock, possession, field position) for the
 *  win-probability chart, and the team box score. Edge-cached 15s. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\d{6,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const r = await fetch(`${ESPN}?event=${id}`, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return Response.json({ error: `espn ${r.status}` }, { status: 502 });
  const d = await r.json();
  const comp = d.header?.competitions?.[0];
  const teams = (comp?.competitors || []).map((c: { homeAway: string; score?: string; team: { id: string; location?: string; abbreviation?: string; logos?: { href: string }[] } }) => ({
    id: c.team.id, home: c.homeAway === "home", name: c.team.location, abbr: c.team.abbreviation, score: Number(c.score || 0),
    logo: c.team.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/ncaa/500/${c.team.id}.png`,
  }));
  const plays: unknown[] = [];
  const seen = new Set<string>();
  for (const dr of [...(d.drives?.previous || []), ...(d.drives?.current ? [d.drives.current] : [])]) {
    for (const p of (dr.plays || []) as P[]) {
      if (seen.has(p.sequenceNumber)) continue;   // the current drive can repeat the last previous one
      seen.add(p.sequenceNumber);
      const side = Object.fromEntries((p.teamParticipants || []).map((x) => [x.type, x.id]));
      plays.push({
        seq: p.sequenceNumber, type: p.type?.text, text: p.text, q: p.period?.number, clock: p.clock?.displayValue,
        hs: p.homeScore ?? 0, as: p.awayScore ?? 0, score: !!p.scoringPlay, off: side.offense ?? p.start?.team?.id ?? null,
        ytg: p.start?.yardsToEndzone ?? null, dd: p.start?.downDistanceText ?? null, yds: p.statYardage ?? 0,
      });
    }
  }
  const box = (d.boxscore?.teams || []).map((t: { team: { id: string }; statistics: { label: string; displayValue: string; name: string }[] }) => ({
    id: t.team.id, stats: t.statistics.map((s) => [s.label, s.displayValue]),
  }));
  const st = comp?.status;
  return Response.json({
    id, state: st?.type?.state, detail: st?.type?.shortDetail, period: st?.period, clock: st?.displayClock,
    teams, plays, box, venue: d.gameInfo?.venue?.fullName ?? null,
  }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
}
