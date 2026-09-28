"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Props, PropPlayer } from "@/lib/data";
import { playerHref } from "@/lib/slug";
import { logo } from "@/lib/logo";
import s from "./betting.module.css";

type TeamInfo = { name: string; abbr: string; logo: string };

const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x: number) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
/** P(stat > line), as validated in build_props.p_over_m: normal for passing/rushing, normal+gamma mix for receiving. */
function pOver(line: number, mean: number, sd: number, m: string) {
  const n = 1 - phi((line - mean) / sd);
  return m === "recYds" || m === "rec" ? 0.5 * n + 0.5 * pGamma(line, mean, sd) : n;
}
function pGamma(line: number, mean: number, sd: number) {
  if (mean <= 0) return 0;
  const k = (mean / sd) ** 2, th = (sd * sd) / mean, x = Math.max(line, 1e-9) / th;
  const z = (Math.cbrt(x / k) - (1 - 1 / (9 * k))) / Math.sqrt(1 / (9 * k));
  return 1 - phi(z);
}
const defLine = (m: string, proj: number) => (m === "passTD" ? (proj >= 1.9 ? 1.5 : 0.5) : m === "rec" ? Math.floor(proj) + 0.5 : Math.round(proj) - 0.5);
const step = (m: string) => (m === "passTD" || m === "rec" ? 1 : m === "passYds" ? 5 : 2.5);
const pc = (v: number) => Math.round(v * 100) + "%";

export default function PropBoard({ data, teams }: { data: Props; teams: Record<string, TeamInfo> }) {
  const mkeys = Object.keys(data.markets);
  const [market, setMarket] = useState("recYds");
  const [game, setGame] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"proj" | "over" | "under" | "edge">("proj");
  const [lines, setLines] = useState<Record<string, number>>({});
  const ab = (id: string) => teams[id]?.abbr || id;
  const td = market === "anyTD";

  const rows = useMemo(() => {
    const out: { p: PropPlayer; proj: number; sd: number; line: number | null; book: boolean; over: number | null; hit: [number, number] | null; log: number[] }[] = [];
    for (const p of data.players) {
      const m = p.m[market];
      if (!m || (game && p.game !== game) || (q && !p.name.toLowerCase().includes(q.toLowerCase()))) continue;
      const key = `${p.id}|${market}`, bk = data.lines[key];
      if (td) { out.push({ p, proj: m.proj, sd: 0, line: null, book: false, over: m.proj, hit: [m.log.filter((x) => x > 0).length, m.log.length], log: m.log }); continue; }
      const line = lines[key] ?? bk?.line ?? defLine(market, m.proj);
      out.push({ p, proj: m.proj, sd: m.sd || 1, line, book: !!bk && lines[key] == null, over: pOver(line, m.proj, m.sd || 1, market),
        hit: [m.log.filter((x) => x > line).length, m.log.length], log: m.log });
    }
    const k = { proj: (r: (typeof out)[0]) => r.proj, over: (r: (typeof out)[0]) => r.over ?? 0, under: (r: (typeof out)[0]) => 1 - (r.over ?? 1),
      edge: (r: (typeof out)[0]) => Math.abs((r.over ?? 0.5) - 0.5) }[sort];
    return out.sort((a, b) => k(b) - k(a));
  }, [data, market, game, q, sort, lines, td]);

  const games = data.games.slice().sort((a, b) => a.date.localeCompare(b.date));
  const bump = (key: string, cur: number, d: number) => setLines((L) => ({ ...L, [key]: Math.max(0.5, cur + d) }));
  const maxLog = Math.max(1, ...rows.flatMap((r) => r.log));
  return (
    <>
      <div className="controls">
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {mkeys.map((m) => <button key={m} className={`chip ${m === market ? "on" : ""}`} onClick={() => setMarket(m)}>{data.markets[m]}</button>)}
        </span>
      </div>
      <div className="controls">
        <select className="filter-select" value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game">
          <option value="">All {games.length} games</option>
          {games.map((g) => <option key={g.id} value={g.id}>{ab(g.away) || g.awayName} @ {ab(g.home) || g.homeName}</option>)}
        </select>
        <input className="filter-select" placeholder="Search a player" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Player" />
        {!td && <span style={{ display: "flex", gap: 6 }}>
          {([["proj", "Projection"], ["over", "Best over"], ["under", "Best under"], ["edge", "Strongest lean"]] as const).map(([k, l]) =>
            <button key={k} className={`chip ${sort === k ? "on" : ""}`} onClick={() => setSort(k)} style={{ fontSize: 11 }}>{l}</button>)}
        </span>}
        <span className="count"><strong>{Math.min(150, rows.length)}</strong> of {rows.length} players</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense">
          <thead>
            <tr>
              <th className="l">Player</th><th className="l">Game</th>
              <th title="Our projection for this game">{td ? "TD chance" : "TDC proj."}</th>
              {!td && <><th className="c">Line</th><th>Over</th><th>Under</th></>}
              <th title={td ? "Games with a rushing or receiving TD" : "Games this season over the line"}>{td ? "Scored in" : "Hit rate"}</th>
              <th className="l">Recent games (oldest → newest)</th><th>Season avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 150).map((r) => {
              const key = `${r.p.id}|${market}`;
              const heat = r.over == null ? "" : r.over >= 0.62 ? "c4" : r.over >= 0.55 ? "c3" : r.over <= 0.38 ? "c0" : r.over <= 0.45 ? "c1" : "";
              const uheat = r.over == null ? "" : 1 - r.over >= 0.62 ? "c4" : 1 - r.over >= 0.55 ? "c3" : "";
              return (
                <tr key={key}>
                  <td className="l nm">
                    <Link href={playerHref(r.p.name, r.p.id)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logo(teams[r.p.tid]?.logo || `https://a.espncdn.com/i/teamlogos/ncaa/500/${r.p.tid}.png`, 20)} alt="" loading="lazy" />
                      {r.p.name}
                    </Link> <span className="dim">{r.p.pos}</span>
                  </td>
                  <td className="l dim">{r.p.home ? "vs" : "@"} {ab(r.p.opp)}</td>
                  <td className="strong">{td ? pc(r.proj) : r.proj.toFixed(market === "passTD" || market === "rec" ? 1 : 0)}</td>
                  {!td && r.line != null && <>
                    <td className="c" style={{ whiteSpace: "nowrap" }}>
                      <button className={s.stepb} onClick={() => bump(key, r.line!, -step(market))} aria-label="Lower the line">−</button>
                      <b style={{ margin: "0 6px" }}>{r.line}</b>
                      <button className={s.stepb} onClick={() => bump(key, r.line!, step(market))} aria-label="Raise the line">+</button>
                      {r.book && <span className={s.bk} title="Sportsbook line">book</span>}
                    </td>
                    <td className={heat}>{pc(r.over!)}</td><td className={uheat}>{pc(1 - r.over!)}</td>
                  </>}
                  <td>{r.hit ? `${r.hit[0]}/${r.hit[1]}` : "—"}</td>
                  <td className="l">
                    <span className={s.spark} aria-label={`Last games: ${r.log.join(", ")}`}>
                      {r.log.map((v, i) => (
                        <i key={i} title={String(v)} style={{ height: `${Math.max(2, (v / (td ? Math.max(1, ...r.log) : maxLog === 1 ? 1 : Math.max(...r.log, r.line ?? 0, 1))) * 22)}px`,
                          background: r.line != null ? (v > r.line ? "var(--turf, #1a8c3a)" : "var(--red, #c0392b)") : v > 0 ? "var(--turf, #1a8c3a)" : "var(--border2)" }} />
                      ))}
                    </span>
                  </td>
                  <td className="dim">{td ? (r.log.reduce((a, b) => a + b, 0) / Math.max(1, r.log.length)).toFixed(2) + " TD/g" : (r.p.m[market].avg ?? 0).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
