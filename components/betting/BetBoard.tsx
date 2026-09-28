"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BetBoardRow } from "@/lib/data";
import { logo } from "@/lib/logo";
import s from "./betting.module.css";

type TeamInfo = { name: string; abbr: string; logo: string; slug: string | null; conf: string };

/** "UGA −7.5" from a home-perspective spread (positive = home favoured). */
function favLine(sp: number | null, home: string, away: string) {
  if (sp == null) return "—";
  if (Math.abs(sp) < 0.25) return "Pick";
  return sp > 0 ? `${home} −${sp.toFixed(1)}` : `${away} −${Math.abs(sp).toFixed(1)}`;
}
/** The side the model prefers at the market number. */
function lean(r: BetBoardRow, home: string, away: string) {
  if (r.edge == null || r.line == null || Math.abs(r.edge) < 0.5) return null;
  const n = r.edge > 0 ? -r.line : r.line;            // the spread for the side the model likes
  return `${r.edge > 0 ? home : away} ${n > 0 ? "+" : n < 0 ? "−" : ""}${n === 0 ? "PK" : Math.abs(n).toFixed(1)}`;
}

export default function BetBoard({ rows, teams, totBias }: { rows: BetBoardRow[]; teams: Record<string, TeamInfo>; totBias: number }) {
  const [sort, setSort] = useState<"gap" | "time" | "tgap">("gap");
  const [minGap, setMinGap] = useState(0);
  const ab = (id: string, name: string) => teams[id]?.abbr || name;
  const shown = useMemo(() => {
    const r = rows.filter((x) => x.line != null && Math.abs(x.edge ?? 0) >= minGap);
    return r.sort((a, b) => sort === "time" ? a.date.localeCompare(b.date) : sort === "gap" ? Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) : Math.abs(b.tedge ?? 0) - Math.abs(a.tedge ?? 0));
  }, [rows, sort, minGap]);
  const noLine = rows.filter((x) => x.line == null).length;
  if (!rows.length) return <div className="note">No games left on this week&apos;s slate. The next week&apos;s board appears after the weekend&apos;s games.</div>;
  const when = (d: string) => new Date(d).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const side = (t: TeamInfo | undefined, id: string, name: string) => (
    <span className={s.tm}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo(t?.logo || `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`, 20)} alt="" width={18} height={18} loading="lazy" />
      {t?.slug ? <Link href={`/teams/${t.slug}`}>{t.name}</Link> : name}
    </span>
  );
  return (
    <>
      <div className="controls">
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {([["gap", "Biggest spread gap"], ["tgap", "Biggest total gap"], ["time", "Kickoff"]] as const).map(([k, l]) => (
            <button key={k} className={`chip ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{l}</button>
          ))}
        </span>
        <select className="filter-select" value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} aria-label="Minimum gap">
          <option value={0}>Every game</option><option value={2}>Gap 2+ pts</option><option value={4}>Gap 4+ pts</option><option value={7}>Gap 7+ pts</option>
        </select>
        <span className="count"><strong>{shown.length}</strong> games{noLine ? ` · ${noLine} without a line yet` : ""}</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense">
          <thead>
            <tr>
              <th className="l">Kickoff (ET)</th><th className="l">Matchup</th>
              <th className="l">Market</th><th className="l">TDC line</th><th title="TDC line minus the market line, in points">Gap</th><th className="l">TDC side at the market number</th>
              <th title="How often the model has covered at this size of gap, 2015 on">Model at this gap</th>
              <th>Total</th><th>TDC total</th><th className="l">Lean</th><th>TDC win %</th><th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const H = ab(r.home, r.homeName), A = ab(r.away, r.awayName);
              const g = r.edge ?? 0, tg = r.tedge ?? 0;
              return (
                <tr key={r.id}>
                  <td className="l dim">{when(r.date)}</td>
                  <td className="l">{side(teams[r.away], r.away, r.awayName)} <span className="dim">{r.neutral ? "vs" : "@"}</span> {side(teams[r.home], r.home, r.homeName)}</td>
                  <td className="l strong">{favLine(r.line, H, A)}</td>
                  <td className="l">{favLine(r.model, H, A)}</td>
                  <td className={`strong ${Math.abs(g) >= 7 ? s.big : Math.abs(g) >= 3 ? s.mid : ""}`}>{g > 0 ? "+" : ""}{g.toFixed(1)}</td>
                  <td className="l">{lean(r, H, A) ?? <span className="dim">agrees</span>}</td>
                  <td className="dim">{r.hist != null ? (r.hist * 100).toFixed(0) + "%" : "—"}</td>
                  <td>{r.ltot ?? "—"}</td><td>{r.mtot.toFixed(1)}</td>
                  <td className="l">{r.ltot != null && Math.abs(tg) >= 1.5 ? (tg > 0 ? `Over ${r.ltot}` : `Under ${r.ltot}`) : <span className="dim">—</span>}</td>
                  <td>{Math.round(Math.max(r.homeWin, 1 - r.homeWin) * 100)}% <span className="dim">{r.homeWin >= 0.5 ? H : A}</span></td>
                  <td><Link href={`/games/${r.id}`} className={s.go}>Game →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Gap = our line minus the market&apos;s (positive: we rate the home side higher). &ldquo;Model at this gap&rdquo; is how often the model&apos;s side
        has covered when it disagreed with the closing line by that much since 2015; anything under 52.4% loses money at −110.
        Our totals have run {Math.abs(totBias).toFixed(1)} points {totBias >= 0 ? "above" : "below"} the market this season, so the total lean is
        called only when the gap is 1.5+ points beyond that. Lines move all week; the market column is the latest consensus when the site last rebuilt.
      </p>
    </>
  );
}
