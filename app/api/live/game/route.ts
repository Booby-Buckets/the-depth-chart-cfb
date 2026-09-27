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
  type Comp = { homeAway: string; score?: string; linescores?: { displayValue?: string }[]; rank?: number; curatedRank?: { current?: number };
    team: { id: string; location?: string; abbreviation?: string; color?: string; alternateColor?: string; logos?: { href: string }[] } };
  const teams = (comp?.competitors || []).map((c: Comp) => ({
    id: c.team.id, home: c.homeAway === "home", name: c.team.location, abbr: c.team.abbreviation, score: Number(c.score || 0),
    logo: c.team.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/ncaa/500/${c.team.id}.png`,
    color: c.team.color ? `#${c.team.color}` : null, alt: c.team.alternateColor ? `#${c.team.alternateColor}` : null,
    lines: (c.linescores || []).map((l) => Number(l.displayValue || 0)),
    rank: c.curatedRank?.current && c.curatedRank.current <= 25 ? c.curatedRank.current : null,
  }));
  // every scoring play (ESPN's own list: type, scorer text, running score)
  type SP = { type?: { text?: string; abbreviation?: string }; text?: string; awayScore?: number; homeScore?: number; period?: { number?: number }; clock?: { displayValue?: string }; team?: { id?: string } };
  const scoring = ((d.scoringPlays || []) as SP[]).map((p) => ({
    team: p.team?.id ?? null, type: p.type?.text ?? "", abbr: p.type?.abbreviation ?? "", text: p.text ?? "",
    q: p.period?.number ?? 0, clock: p.clock?.displayValue ?? "", hs: p.homeScore ?? 0, as: p.awayScore ?? 0,
  }));
  // drives: who had it, how it ended, how long it took
  type DR = { team?: { id?: string }; displayResult?: string; result?: string; description?: string; offensivePlays?: number; yards?: number; isScore?: boolean;
    timeElapsed?: { displayValue?: string }; start?: { period?: { number?: number }; clock?: { displayValue?: string }; text?: string }; end?: { text?: string } };
  const drives = ([...(d.drives?.previous || []), ...(d.drives?.current ? [d.drives.current] : [])] as DR[])
    .filter((x, i, a) => a.findIndex((y) => y.start?.clock?.displayValue === x.start?.clock?.displayValue && y.start?.period?.number === x.start?.period?.number && y.team?.id === x.team?.id) === i)
    .map((x) => ({
      team: x.team?.id ?? null, res: x.displayResult || x.result || "", n: x.offensivePlays ?? 0, yds: x.yards ?? 0, time: x.timeElapsed?.displayValue ?? "",
      q: x.start?.period?.number ?? 0, clock: x.start?.clock?.displayValue ?? "", from: x.start?.text ?? "", to: x.end?.text ?? "", score: !!x.isScore,
    }));
  // the closing line (ESPN's pickcenter, home-team perspective; live in-game books skipped)
  type PC = { provider?: { name?: string }; spread?: number };
  const pc = ((d.pickcenter || []) as PC[]).find((x) => x.spread != null && !/live/i.test(x.provider?.name || ""));
  const line = pc ? -Number(pc.spread) : null;
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
    teams, plays, box, scoring, drives, line, date: comp?.date ?? null, season: d.header?.season?.year ?? null,
    note: comp?.notes?.[0]?.headline ?? null, venue: d.gameInfo?.venue?.fullName ?? null,
  }, { headers: { "Cache-Control": st?.type?.state === "post" ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=15, stale-while-revalidate=30" } });
}
