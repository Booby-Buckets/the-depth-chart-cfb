import Link from "next/link";
import { getPastSeasons, getSeasonTeamIndex, type HubTeam } from "@/lib/data";
import { fmt } from "@/lib/format";
import { RatingChart } from "./Charts";
import s from "./team.module.css";

type Row = { season: number; t: HubTeam; slug: string | null; n: number; current?: boolean };

/** A program's rating, rank and record for every season we've built (2014 on), newest first. */
export default async function ProgramHistory({ teamId, teamName, slug, current }: {
  teamId: string; teamName: string; slug: string; current: { season: number; row: HubTeam };
}) {
  const years = await getPastSeasons();
  if (!years.length) return null;
  const past = (await Promise.all(years.map(async (y) => {
    const idx = await getSeasonTeamIndex(y);
    const t = idx.hub.teams.find((x) => x.id === teamId);
    return t ? ({ season: y, t, slug: idx.slugOf.get(teamId) ?? null, n: idx.hub.teams.length } as Row) : null;
  }))).filter((r): r is Row => !!r);
  if (!past.length) return null;
  const rows: Row[] = [{ season: current.season, t: current.row, slug, n: 0, current: true }, ...past];
  const done = past.slice().reverse(); // oldest first for the chart
  const best = past.reduce((a, b) => (b.t.net > a.t.net ? b : a));
  const worst = past.reduce((a, b) => (b.t.net < a.t.net ? b : a));
  const heat = (net: number) => "c" + [-10, -3, 3, 10].filter((c) => net > c).length;
  return (
    <section id="history" className={s.section}>
      <div className="sec-h"><h2>Program History</h2><p>Final TDC rating, rank and record for every season since {done[0].season}</p></div>
      <div className={s.grid2}>
        <RatingChart
          title="Final rating by season" fbsTeams={130}
          history={done.map((r) => ({ wk: String(r.season), net: r.t.net, rank: r.t.rank }))}
          summary={<>Best: <b>{best.season}</b> ({fmt(best.t.net, 1, true)}, #{best.t.rank}) · worst: {worst.season} ({fmt(worst.t.net, 1, true)}, #{worst.t.rank})</>}
        />
        <div className="sheet-wrap">
          <table className="sheet dense" style={{ width: "100%" }}>
            <thead><tr><th className="l">Season</th><th className="c">Record</th><th className="c">Conf</th><th>Rank</th><th>Rating</th><th>Off</th><th>Def</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.season}>
                  <td className="l strong">
                    {r.current ? <>{r.season} <span style={{ color: "var(--text3)", fontWeight: 500 }}>so far</span></>
                      : r.slug ? <Link href={`/seasons/${r.season}/teams/${r.slug}`}>{r.season}</Link> : r.season}
                  </td>
                  <td className="c">{r.t.w}-{r.t.l}</td>
                  <td className="c dim">{r.t.confAbbr === "ind" ? "—" : `${r.t.cw}-${r.t.cl}`}</td>
                  <td>#{r.t.rank}</td>
                  <td className={`strong ${heat(r.t.net)}`}>{fmt(r.t.net, 1, true)}</td>
                  <td>{fmt(r.t.off, 1, true)}</td>
                  <td>{fmt(r.t.def, 1, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="note" style={{ marginTop: 10 }}>{teamName}&apos;s past seasons use the same rating model as this one. Click a season to see its full page.</p>
    </section>
  );
}
