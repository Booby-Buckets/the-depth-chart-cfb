"use client";

import { useState } from "react";
import Link from "next/link";
import { logo } from "@/lib/logo";

/* Game-by-game box-score lines (ESPN box scores), one season at a time. Columns follow what the
   player actually did that season: a QB who ran gets passing + rushing, a safety gets defense. */

export type GameLine = Record<string, Record<string, number>>;
export type GameLogRow = {
  id: string; date: string; wk: string; site: "H" | "A" | "N"; opp: string; oppName: string; oppLogo: string | null;
  oppSlug: string | null; res: "W" | "L" | null; pf: number | null; pa: number | null; line: GameLine | null;
};
export type GameLogSeason = { season: number; team: string; rows: GameLogRow[] };

type Col = { g: string; label: string; tip?: string; v: (l: GameLine) => number | null; fmt?: (v: number) => string; sum?: "sum" | "max" | ((t: GameLine) => number | null) };
const S = (c: string, k: string) => (l: GameLine) => l[c]?.[k] ?? null;
const ratio = (c: string, n: string, d: string, mult = 1) => (l: GameLine) => (l[c]?.[d] ? (l[c][n] / l[c][d]) * mult : null);
const d1 = (v: number) => v.toFixed(1);

const GROUPS: { key: string; name: string; has: (l: GameLine) => boolean; cols: Col[] }[] = [
  { key: "passing", name: "Passing", has: (l) => !!l.passing?.ATT, cols: [
    { g: "passing", label: "Cmp", v: S("passing", "COMPLETIONS") },
    { g: "passing", label: "Att", v: S("passing", "ATT") },
    { g: "passing", label: "Pct", v: ratio("passing", "COMPLETIONS", "ATT", 100), fmt: d1, sum: (t) => ratio("passing", "COMPLETIONS", "ATT", 100)(t) },
    { g: "passing", label: "Yds", v: S("passing", "YDS") },
    { g: "passing", label: "Y/A", v: ratio("passing", "YDS", "ATT"), fmt: d1, sum: (t) => ratio("passing", "YDS", "ATT")(t) },
    { g: "passing", label: "TD", v: S("passing", "TD") },
    { g: "passing", label: "INT", v: S("passing", "INT") },
  ] },
  { key: "rushing", name: "Rushing", has: (l) => !!l.rushing?.CAR, cols: [
    { g: "rushing", label: "Car", v: S("rushing", "CAR") },
    { g: "rushing", label: "Yds", v: S("rushing", "YDS") },
    { g: "rushing", label: "Y/C", v: ratio("rushing", "YDS", "CAR"), fmt: d1, sum: (t) => ratio("rushing", "YDS", "CAR")(t) },
    { g: "rushing", label: "TD", v: S("rushing", "TD") },
    { g: "rushing", label: "Long", v: S("rushing", "LONG"), sum: "max" },
  ] },
  { key: "receiving", name: "Receiving", has: (l) => !!l.receiving?.REC, cols: [
    { g: "receiving", label: "Rec", v: S("receiving", "REC") },
    { g: "receiving", label: "Yds", v: S("receiving", "YDS") },
    { g: "receiving", label: "Y/R", v: ratio("receiving", "YDS", "REC"), fmt: d1, sum: (t) => ratio("receiving", "YDS", "REC")(t) },
    { g: "receiving", label: "TD", v: S("receiving", "TD") },
    { g: "receiving", label: "Long", v: S("receiving", "LONG"), sum: "max" },
  ] },
  { key: "defensive", name: "Defense", has: (l) => !!(l.defensive?.TOT || l.defensive?.PD || l.interceptions?.INT), cols: [
    { g: "defensive", label: "Tkl", v: S("defensive", "TOT") },
    { g: "defensive", label: "Solo", v: S("defensive", "SOLO") },
    { g: "defensive", label: "TFL", v: S("defensive", "TFL") },
    { g: "defensive", label: "Sacks", v: S("defensive", "SACKS") },
    { g: "defensive", label: "Hur", tip: "QB hurries", v: S("defensive", "QB HUR") },
    { g: "defensive", label: "PD", tip: "Passes defended (broken up + intercepted)", v: S("defensive", "PD") },
    { g: "interceptions", label: "INT", v: S("interceptions", "INT") },
    { g: "defensive", label: "TD", tip: "Defensive touchdowns", v: (l) => (l.defensive?.TD ?? 0) + (l.interceptions?.TD ?? 0) || null },
  ] },
  { key: "kicking", name: "Kicking", has: (l) => !!(l.kicking?.FGA || l.kicking?.XPA), cols: [
    { g: "kicking", label: "FGM", v: S("kicking", "FGM") },
    { g: "kicking", label: "FGA", v: S("kicking", "FGA") },
    { g: "kicking", label: "Long", v: S("kicking", "LONG"), sum: "max" },
    { g: "kicking", label: "XPM", v: S("kicking", "XPM") },
    { g: "kicking", label: "XPA", v: S("kicking", "XPA") },
    { g: "kicking", label: "Pts", v: S("kicking", "PTS") },
  ] },
  { key: "punting", name: "Punting", has: (l) => !!l.punting?.NO, cols: [
    { g: "punting", label: "Punts", v: S("punting", "NO") },
    { g: "punting", label: "Yds", v: S("punting", "YDS") },
    { g: "punting", label: "Avg", v: ratio("punting", "YDS", "NO"), fmt: d1, sum: (t) => ratio("punting", "YDS", "NO")(t) },
    { g: "punting", label: "In 20", v: S("punting", "In 20") },
    { g: "punting", label: "Long", v: S("punting", "LONG"), sum: "max" },
  ] },
  { key: "returns", name: "Returns", has: (l) => !!(l.kickReturns?.NO || l.puntReturns?.NO), cols: [
    { g: "kickReturns", label: "KR", tip: "Kick returns", v: S("kickReturns", "NO") },
    { g: "kickReturns", label: "KR yds", v: S("kickReturns", "YDS") },
    { g: "puntReturns", label: "PR", tip: "Punt returns", v: S("puntReturns", "NO") },
    { g: "puntReturns", label: "PR yds", v: S("puntReturns", "YDS") },
    { g: "kickReturns", label: "TD", tip: "Return touchdowns", v: (l) => (l.kickReturns?.TD ?? 0) + (l.puntReturns?.TD ?? 0) || null },
  ] },
];

/** Season totals: every category summed, LONG kept as the max. */
function totals(rows: GameLogRow[]): GameLine {
  const t: GameLine = {};
  for (const r of rows) for (const [c, st] of Object.entries(r.line || {})) {
    const o = (t[c] ||= {});
    for (const [k, v] of Object.entries(st)) o[k] = k === "LONG" ? Math.max(o[k] ?? v, v) : (o[k] ?? 0) + v;
  }
  return t;
}
const show = (v: number | null, f?: (v: number) => string) => (v == null ? "·" : f ? f(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));

function groupsFor(rows: GameLogRow[]) {
  // a group shows when it's a real part of the player's season (a WR's one carry doesn't add 5 columns)
  const t = totals(rows);
  const vol: Record<string, number> = {
    passing: t.passing?.ATT ?? 0, rushing: t.rushing?.CAR ?? 0, receiving: t.receiving?.REC ?? 0,
    defensive: (t.defensive?.TOT ?? 0) + (t.defensive?.PD ?? 0) + (t.interceptions?.INT ?? 0),
    kicking: (t.kicking?.FGA ?? 0) + (t.kicking?.XPA ?? 0), punting: t.punting?.NO ?? 0,
    returns: (t.kickReturns?.NO ?? 0) + (t.puntReturns?.NO ?? 0),
  };
  const top = Math.max(...Object.values(vol));
  const min: Record<string, number> = { passing: 5, rushing: 3, receiving: 1, defensive: 1, kicking: 1, punting: 1, returns: 2 };
  return GROUPS.filter((g) => vol[g.key] >= min[g.key] && vol[g.key] >= top * 0.08);
}

export default function GameLog({ seasons, name }: { seasons: GameLogSeason[]; name: string }) {
  const [i, setI] = useState(0);
  if (!seasons.length) return null;
  const cur = seasons[Math.min(i, seasons.length - 1)];
  const played = cur.rows.filter((r) => r.line);
  const groups = groupsFor(played);
  const cols = groups.flatMap((g) => g.cols);
  const T = totals(played);
  const colTotal = (c: Col) => (c.sum === "max" || c.sum === undefined ? c.v(T) : typeof c.sum === "function" ? c.sum(T) : c.v(T));

  return (
    <section style={{ padding: "28px 0 8px" }} id="gamelog">
      <div className="sec-h">
        <h2>Game Log</h2>
        <p>{name}&apos;s box score, game by game, from ESPN. Click a result for the full game</p>
      </div>
      {seasons.length > 1 && (
        <div role="group" aria-label="Season" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {seasons.map((s, k) => (
            <button key={s.season} className={`chip ${k === i ? "on" : ""}`} onClick={() => setI(k)} style={{ fontSize: 12, padding: "4px 10px" }}>
              {s.season} <span style={{ opacity: 0.6 }}>{s.team}</span>
            </button>
          ))}
        </div>
      )}
      {!groups.length ? (
        <div style={{ color: "var(--text3)", fontSize: 13 }}>No box-score stats in {cur.season}.</div>
      ) : (
        <div className="sheet-wrap">
          <table className="sheet dense">
            <thead>
              <tr>
                <th className="l" colSpan={3} />
                {groups.map((g) => <th key={g.key} colSpan={g.cols.length} className="c" style={{ borderBottom: "1px solid var(--border)" }}>{g.name}</th>)}
              </tr>
              <tr>
                <th className="l">Wk</th><th className="l">Opponent</th><th className="l">Result</th>
                {cols.map((c, k) => <th key={k} title={c.tip}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {cur.rows.map((r) => (
                <tr key={r.id} style={r.line ? undefined : { opacity: 0.55 }}>
                  <td className="l dim">{r.wk.replace("Week ", "")}</td>
                  <td className="l" style={{ whiteSpace: "nowrap" }}>
                    <span className="dim" style={{ display: "inline-block", width: 18 }}>{r.site === "A" ? "@" : r.site === "N" ? "vs" : ""}</span>
                    {r.oppLogo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo(r.oppLogo, 20)} alt="" width={16} height={16} style={{ verticalAlign: -3, marginRight: 6 }} />
                    )}
                    {r.oppSlug ? <Link href={`/teams/${r.oppSlug}`} style={{ color: "inherit" }}>{r.oppName}</Link> : r.oppName}
                  </td>
                  <td className="l" style={{ whiteSpace: "nowrap" }}>
                    {r.res ? <Link href={`/games/${r.id}`} style={{ color: "inherit" }}>
                      <b style={{ color: r.res === "W" ? "var(--turf)" : "var(--red)" }}>{r.res}</b> {r.pf}–{r.pa}
                    </Link> : "—"}
                  </td>
                  {r.line ? cols.map((c, k) => <td key={k}>{show(c.v(r.line!), c.fmt)}</td>)
                    : <td colSpan={cols.length} className="c dim">no stats recorded</td>}
                </tr>
              ))}
              <tr>
                <td className="l strong" colSpan={3}>{cur.season} · {played.length} game{played.length === 1 ? "" : "s"}</td>
                {cols.map((c, k) => <td key={k} className="strong">{show(colTotal(c), c.fmt)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
