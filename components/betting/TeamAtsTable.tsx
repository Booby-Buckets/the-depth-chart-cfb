"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TeamAts } from "@/lib/data";
import { logo } from "@/lib/logo";

type TeamInfo = { name: string; abbr: string; logo: string; slug: string | null; conf: string };
type Rec = [number, number, number];
const r3 = (x: Rec) => `${x[0]}–${x[1]}${x[2] ? `–${x[2]}` : ""}`;
const rate = (x: Rec) => (x[0] + x[1] ? x[0] / (x[0] + x[1]) : null);
const COLS: [string, string, (t: TeamAts) => number | null][] = [
  ["ats", "ATS", (t) => rate(t.ats)], ["avgCover", "Avg cover", (t) => t.avgCover], ["fav", "As favorite", (t) => rate(t.fav)],
  ["dog", "As underdog", (t) => rate(t.dog)], ["home", "Home", (t) => rate(t.home)], ["away", "Away", (t) => rate(t.away)], ["ou", "Over / under", (t) => rate(t.ou)],
];

export default function TeamAtsTable({ data, teams, seasons }: { data: Record<string, Record<string, TeamAts>>; teams: Record<string, TeamInfo>; seasons: number[] }) {
  const [y, setY] = useState(seasons[0]);
  const [sortK, setSortK] = useState("ats");
  const [conf, setConf] = useState("");
  const confs = useMemo(() => [...new Set(Object.values(teams).map((t) => t.conf))].sort(), [teams]);
  const rows = useMemo(() => {
    const col = COLS.find((c) => c[0] === sortK)!;
    return Object.entries(data[y] || {}).filter(([id]) => teams[id] && (!conf || teams[id].conf === conf))
      .sort((a, b) => (col[2](b[1]) ?? -99) - (col[2](a[1]) ?? -99));
  }, [data, y, sortK, conf, teams]);
  const heat = (v: number | null) => (v == null ? "" : v >= 0.65 ? "c4" : v >= 0.55 ? "c3" : v >= 0.45 ? "c2" : v >= 0.35 ? "c1" : "c0");
  return (
    <>
      <div className="controls">
        <span style={{ display: "flex", gap: 6 }}>{seasons.map((s) => <button key={s} className={`chip ${s === y ? "on" : ""}`} onClick={() => setY(s)}>{s}</button>)}</span>
        <select className="filter-select" value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Conference">
          <option value="">All conferences</option>{confs.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="count"><strong>{rows.length}</strong> teams</span>
      </div>
      <div className="sheet-wrap" style={{ maxHeight: 640 }}>
        <table className="sheet dense">
          <thead>
            <tr>
              <th className="l">Team</th><th>Games</th>
              {COLS.map(([k, l]) => <th key={k} className={`sort ${k === sortK ? "on" : ""}`} onClick={() => setSortK(k)}>{l}{k === sortK && <span className="ar">▼</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, t]) => (
              <tr key={id}>
                <td className="l nm">
                  {teams[id].slug ? <Link href={`/teams/${teams[id].slug}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo(teams[id].logo, 20)} alt="" loading="lazy" />{teams[id].name}</Link> : teams[id].name}
                </td>
                <td className="dim">{t.n}</td>
                <td className={`strong ${heat(rate(t.ats))}`}>{r3(t.ats)}</td>
                <td>{t.avgCover > 0 ? "+" : ""}{t.avgCover.toFixed(1)}</td>
                <td className={heat(rate(t.fav))}>{r3(t.fav)}</td><td className={heat(rate(t.dog))}>{r3(t.dog)}</td>
                <td className={heat(rate(t.home))}>{r3(t.home)}</td><td className={heat(rate(t.away))}>{r3(t.away)}</td>
                <td className={heat(rate(t.ou))}>{r3(t.ou)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Avg cover = average points the team beat (+) or missed (−) the spread by. Over / under is overs–unders. Small samples swing a lot: a 4–1 ATS start says little.</p>
    </>
  );
}
