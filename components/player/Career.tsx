import Link from "next/link";
import type { HubTeam, SeasonPlayer } from "@/lib/data";
import { logo } from "@/lib/logo";

export type CareerRow = { season: number; current: boolean; team: HubTeam | null; teamSlug: string | null; p: SeasonPlayer; pbpDefense?: boolean };

const S = (p: SeasonPlayer, c: string, k: string) => p.stats?.[c]?.[k];
const n0 = (v: number | null | undefined) => (v == null ? "—" : v % 1 ? v.toFixed(1) : String(v));
const d1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1)); // rates always show one decimal

type Col = [label: string, f: (p: SeasonPlayer) => React.ReactNode, tip?: string];
function columns(rows: CareerRow[]): Col[] {
  const tot = (c: string, k: string) => rows.reduce((a, r) => a + (S(r.p, c, k) || 0), 0);
  const cols: Col[] = [];
  if (tot("passing", "ATT") >= 20)
    cols.push(["Cmp/Att", (p) => (S(p, "passing", "ATT") ? `${n0(S(p, "passing", "COMPLETIONS"))}/${n0(S(p, "passing", "ATT"))}` : "—")],
      ["Pass yds", (p) => n0(S(p, "passing", "YDS"))], ["TD–INT", (p) => (S(p, "passing", "ATT") ? `${n0(S(p, "passing", "TD") ?? 0)}–${n0(S(p, "passing", "INT") ?? 0)}` : "—")],
      ["Y/A", (p) => d1(S(p, "passing", "YPA"))], ["Dropback SR", (p) => pctOrDash(p.adv?.pass?.sr), "Dropback success rate (play-by-play)"]);
  if (tot("rushing", "CAR") >= 20)
    cols.push(["Car", (p) => n0(S(p, "rushing", "CAR"))], ["Rush yds", (p) => n0(S(p, "rushing", "YDS"))], ["Y/C", (p) => d1(S(p, "rushing", "YPC"))],
      ["Rush TD", (p) => n0(S(p, "rushing", "TD"))], ["Rush SR", (p) => pctOrDash(p.adv?.rush?.sr), "Rushing success rate (play-by-play)"]);
  if (tot("receiving", "REC") >= 10)
    cols.push(["Rec", (p) => n0(S(p, "receiving", "REC"))], ["Rec yds", (p) => n0(S(p, "receiving", "YDS"))], ["Rec TD", (p) => n0(S(p, "receiving", "TD"))],
      ["Tgt share", (p) => pctOrDash(p.adv?.recv?.share), "Share of the team's pass attempts (play-by-play)"]);
  if (tot("defensive", "TOT") >= 10)
    cols.push(["Tkl", (p) => n0(S(p, "defensive", "TOT"))], ["TFL", (p) => n0(S(p, "defensive", "TFL"))], ["Sacks", (p) => n0(S(p, "defensive", "SACKS"))],
      ["INT", (p) => n0(S(p, "interceptions", "INT") ?? 0)], ["PD", (p) => n0(S(p, "defensive", "PD"))], ["Havoc", (p) => n0(p.adv?.def?.havoc), "Havoc plays (play-by-play)"]);
  if (tot("kicking", "FGA") >= 3)
    cols.push(["FG", (p) => (S(p, "kicking", "FGA") ? `${n0(S(p, "kicking", "FGM"))}/${n0(S(p, "kicking", "FGA"))}` : "—")], ["FG long", (p) => n0(S(p, "kicking", "LONG"))]);
  if (tot("punting", "NO") >= 5)
    cols.push(["Punts", (p) => n0(S(p, "punting", "NO"))], ["Avg", (p) => d1(S(p, "punting", "YPP"))]);
  return cols;
}
function pctOrDash(v: number | null | undefined) { return v == null ? "—" : (v * 100).toFixed(1) + "%"; }

/** Season-by-season table: every season we have for this player, including other schools. */
export default function Career({ rows, name }: { rows: CareerRow[]; name: string }) {
  if (rows.length < 1) return null;
  const cols = columns(rows);
  const schools = new Set(rows.map((r) => r.team?.id).filter(Boolean)).size;
  return (
    <section style={{ padding: "28px 0 8px", scrollMarginTop: 90 }} id="career">
      <div className="sec-h">
        <h2>Career</h2>
        <p>{rows.length} season{rows.length === 1 ? "" : "s"}{schools > 1 ? ` at ${schools} schools` : ""} since 2014 · box-score totals, snap share estimated from play-by-play</p>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense">
          <thead>
            <tr>
              <th className="l">Season</th><th className="l">Team</th><th>G</th><th title="Estimated share of the team's snaps">Snaps</th>
              {cols.map(([l, , tip]) => <th key={l} title={tip}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = r.teamSlug ? (r.current ? `/teams/${r.teamSlug}` : `/seasons/${r.season}/teams/${r.teamSlug}`) : null;
              return (
                <tr key={`${r.season}-${r.team?.id}`}>
                  <td className="l strong">{r.season}{r.current ? <span style={{ color: "var(--text3)", fontWeight: 500 }}> so far</span> : ""}{r.pbpDefense && r.p.stats?.defensive ? <sup title="Defense rebuilt from play-by-play"> *</sup> : ""}</td>
                  <td className="l nm">
                    {r.team && href ? (
                      <Link href={href} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", textDecoration: "none" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo(r.team.logo, 20)} alt="" loading="lazy" style={{ width: 20, height: 20, objectFit: "contain" }} />
                        {r.team.name}
                        <span style={{ color: "var(--text3)", fontWeight: 500 }}>#{r.team.rank} · {r.team.w}-{r.team.l}</span>
                      </Link>
                    ) : r.team?.name ?? "—"}
                  </td>
                  <td>{r.p.g || "—"}</td>
                  <td>{r.p.es && r.p.esTP ? `${Math.round((r.p.es / r.p.esTP) * 100)}%` : "—"}</td>
                  {cols.map(([l, f]) => <td key={l}>{f(r.p)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Past seasons are summed from ESPN box scores; success rates and snap shares come from the play-by-play. {name}&apos;s team rank is that
        season&apos;s final TDC rank. A dash means the stat wasn&apos;t recorded.
        {rows.some((r) => r.pbpDefense && r.p.stats?.defensive) ? " * Defense rebuilt from the play-by-play (ESPN's box scores that season are missing it); about 10% below official totals." : ""}
      </p>
    </section>
  );
}

