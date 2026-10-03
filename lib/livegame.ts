/* One game from ESPN, normalised for the game page: status, teams (colours, line scores), every
   play, scoring plays, drives, the closing line, the live situation (down & distance, ball spot,
   possession, timeouts, last play), the current drive and each team's player box score.
   Shared by /api/live/game (client polling) and the game page's first server render. */
import { readFile } from "node:fs/promises";
import path from "node:path";

const SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary";
const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

type P = {
  id: string; sequenceNumber: string; type?: { text?: string }; text?: string; period?: { number?: number }; clock?: { displayValue?: string };
  homeScore?: number; awayScore?: number; scoringPlay?: boolean; statYardage?: number;
  start?: { yardsToEndzone?: number; downDistanceText?: string; team?: { id?: string } };
  end?: { yardsToEndzone?: number; downDistanceText?: string; team?: { id?: string } };
  teamParticipants?: { id: string; type: string }[];
};

let _ids: Set<string> | null = null;
async function fbsIds() {           // players with a page on the site (every FBS roster)
  if (!_ids) {
    try { _ids = new Set(Object.keys(JSON.parse(await readFile(path.join(process.cwd(), "public", "data", "players", "ids.json"), "utf8")))); }
    catch { _ids = new Set(); }
  }
  return _ids;
}

export async function loadGame(id: string, revalidate = 0) {
  const opts = revalidate ? { next: { revalidate }, headers: { "User-Agent": "Mozilla/5.0" } } : { cache: "no-store" as const, headers: { "User-Agent": "Mozilla/5.0" } };
  const [r, sb] = await Promise.all([fetch(`${SUMMARY}?event=${id}`, opts), fetch(`${SCOREBOARD}/${id}`, opts).catch(() => null)]);
  if (!r.ok) throw new Error(`espn ${r.status}`);
  const d = await r.json();
  const ev = sb && sb.ok ? await sb.json().catch(() => null) : null;
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
  // live situation (single-event scoreboard): down & distance, ball spot, possession, timeouts, last play
  const sit = ev?.competitions?.[0]?.situation;
  const situation = sit ? {
    down: sit.down ?? null, distance: sit.distance ?? null,
    text: sit.downDistanceText ?? null, short: sit.shortDownDistanceText ?? null, spot: sit.possessionText ?? null,
    poss: sit.possession ?? null, redZone: !!sit.isRedZone, homeTO: sit.homeTimeouts ?? null, awayTO: sit.awayTimeouts ?? null,
    lastPlay: sit.lastPlay?.text ?? null, lastTeam: sit.lastPlay?.team?.id ?? null,
    lastDrive: sit.lastPlay?.drive?.description ?? null,
  } : null;
  // the drive in progress, newest play first
  type DP = P & { end?: { yardsToEndzone?: number } };
  const cd = d.drives?.current;
  const currentDrive = cd ? {
    team: cd.team?.id ?? null, desc: cd.description ?? "", start: cd.start?.text ?? "", startYte: cd.start?.yardLine ?? null,
    plays: ((cd.plays || []) as DP[]).slice().reverse().slice(0, 15).map((p) => ({
      seq: p.sequenceNumber, text: p.text ?? "", dd: p.start?.downDistanceText ?? null, yds: p.statYardage ?? 0, type: p.type?.text ?? "",
      endYte: p.end?.yardsToEndzone ?? null, q: p.period?.number ?? 0, clock: p.clock?.displayValue ?? "",
    })),
  } : null;
  // ball position for the field graphic: yards to the possessing team's end zone after the latest play
  const lastWithSpot = [...(plays as { off: string | null; ytg: number | null }[])].reverse().find((p) => p.ytg != null);
  const ball = situation && situation.poss ? { team: String(situation.poss), yte: currentDrive?.plays?.[0]?.endYte ?? lastWithSpot?.ytg ?? null } : null;
  // player box score: passing / rushing / receiving / defense / kicking by team
  const ids = await fbsIds();
  type BS = { team: { id: string }; statistics: { name: string; labels: string[]; athletes: { athlete: { id: string; displayName: string; jersey?: string; position?: { abbreviation?: string } }; stats: string[] }[] }[] };
  const players = ((d.boxscore?.players || []) as BS[]).map((t) => ({
    team: t.team.id,
    cats: t.statistics.filter((c) => ["passing", "rushing", "receiving", "defensive", "interceptions", "kicking", "punting"].includes(c.name)).map((c) => ({
      name: c.name, labels: c.labels,
      rows: c.athletes.map((a) => ({ id: a.athlete.id, name: a.athlete.displayName, pos: a.athlete.position?.abbreviation ?? null, page: ids.has(String(a.athlete.id)), stats: a.stats })),
    })),
  }));
  return {
    id, state: st?.type?.state, detail: st?.type?.shortDetail, period: st?.period, clock: st?.displayClock,
    teams, plays, box, scoring, drives, line, date: comp?.date ?? null, season: d.header?.season?.year ?? null,
    situation, currentDrive, ball, players, fetched: new Date().toISOString(),
    note: comp?.notes?.[0]?.headline ?? null, venue: d.gameInfo?.venue?.fullName ?? null,
  };
}
