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
/** The side the model prefers at a given market number (home-perspective line, gap = model − line). */
function side(gap: number | null, line: number | null, home: string, away: string) {
  if (gap == null || line == null || Math.abs(gap) < 0.5) return null;
  const n = gap > 0 ? -line : line;
  return `${gap > 0 ? home : away} ${n > 0 ? "+" : n < 0 ? "−" : ""}${n === 0 ? "PK" : Math.abs(n).toFixed(1)}`;
}
const sg = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);

export default function BetBoard({ rows, teams, totBias }: { rows: BetBoardRow[]; teams: Record<string, TeamInfo>; totBias: number }) {
  const [sort, setSort] = useState<"ogap" | "gap" | "tgap" | "time">("ogap");
  const [minGap, setMinGap] = useState(0);
  const ab = (id: string, name: string) => teams[id]?.abbr || name;
  const key = (x: BetBoardRow) => x.ogap ?? x.edge ?? 0;
  const shown = useMemo(() => {
    const r = rows.filter((x) => (x.open ?? x.line) != null && Math.abs(key(x)) >= minGap);
    return r.sort((a, b) => sort === "time" ? a.date.localeCompare(b.date) : sort === "ogap" ? Math.abs(key(b)) - Math.abs(key(a))
      : sort === "gap" ? Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) : Math.abs(b.otgap ?? b.tedge ?? 0) - Math.abs(a.otgap ?? a.tedge ?? 0));
  }, [rows, sort, minGap]);
  const noLine = rows.filter((x) => x.line == null && x.open == null).length;
  if (!rows.length) return <div className="note">No games left on this week&apos;s slate. The next week&apos;s board appears after the weekend&apos;s games.</div>;
  const when = (d: string) => new Date(d).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const team = (t: TeamInfo | undefined, id: string, name: string) => (
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
          {([["ogap", "Gap vs. opener"], ["gap", "Gap vs. current line"], ["tgap", "Total gap"], ["time", "Kickoff"]] as const).map(([k, l]) => (
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
              <th className="l">Opened</th><th className="l">Now</th><th className="l">TDC line</th>
              <th title="TDC line minus the opening line. 4+ points has been the model's winning zone since 2023">Gap vs. open</th>
              <th className="l">TDC side at the opener</th>
              <th className="l" title="Has the line moved toward our number since it opened?">Market since open</th>
              <th title="TDC line minus the current line">Gap now</th>
              <th>Open total</th><th>TDC total</th><th className="l">Total lean</th><th>TDC win %</th><th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const H = ab(r.home, r.homeName), A = ab(r.away, r.awayName);
              const og = r.ogap, g = r.edge;
              const move = r.open != null && r.line != null ? r.line - r.open : null;
              const toward = move != null && og != null && move !== 0 ? (move > 0) === (og > 0) : null;
              const zone = og != null && Math.abs(og) >= 4 && !r.bowl;
              const tg = r.otgap ?? r.tedge, tl = r.otgap != null ? r.otot : r.ltot;
              return (
                <tr key={r.id} className={zone ? s.zone : undefined}>
                  <td className="l dim">{when(r.date)}</td>
                  <td className="l">{team(teams[r.away], r.away, r.awayName)} <span className="dim">{r.neutral ? "vs" : "@"}</span> {team(teams[r.home], r.home, r.homeName)}</td>
                  <td className="l">{favLine(r.open, H, A)}</td>
                  <td className="l strong">{favLine(r.line, H, A)}</td>
                  <td className="l">{favLine(r.model, H, A)}</td>
                  <td className={`strong ${og != null && Math.abs(og) >= 7 ? s.big : og != null && Math.abs(og) >= 4 ? s.mid : ""}`}>{og != null ? sg(og) : "—"}</td>
                  <td className="l">{side(og, r.open, H, A) ?? <span className="dim">agrees</span>}</td>
                  <td className="l">{move == null || move === 0 ? <span className="dim">no move</span>
                    : <span className={toward ? s.up : s.down}>{toward ? "▲ toward us" : "▼ away"} {Math.abs(move).toFixed(1)}</span>}</td>
                  <td className="dim">{g != null ? sg(g) : "—"}</td>
                  <td>{r.otot ?? r.ltot ?? "—"}</td><td>{r.mtot.toFixed(1)}</td>
                  <td className="l">{tl != null && tg != null && Math.abs(tg) >= 1.5 ? (tg > 0 ? `Over ${tl}` : `Under ${tl}`) : <span className="dim">—</span>}</td>
                  <td>{Math.round(Math.max(r.homeWin, 1 - r.homeWin) * 100)}% <span className="dim">{r.homeWin >= 0.5 ? H : A}</span></td>
                  <td><Link href={`/games/${r.id}`} className={s.go}>Game →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Highlighted rows: our line is 4+ points off the opener (regular season), the zone where the model has won since 2023. Once the line
        moves to our number the value is gone, so &ldquo;Gap now&rdquo; matters too. Total leans are against the opening total and net of our totals
        running {Math.abs(totBias).toFixed(1)} points {totBias >= 0 ? "high" : "low"} this season. Lines update with every site rebuild (daily, more on Saturdays).
      </p>
    </>
  );
}
