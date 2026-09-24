"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ClassRow } from "@/lib/data";
import { logo } from "@/lib/logo";

type TeamInfo = { slug: string; name: string; logo: string; conf: string };
type Col = { k: keyof ClassRow; l: string; tip?: string; f: (r: ClassRow) => React.ReactNode; heat?: boolean };

const COLS: Col[] = [
  { k: "score", l: "Class score", heat: true, tip: "TDC class score: Gaussian-weighted sum of signee ratings", f: (r) => r.score.toFixed(1) },
  { k: "signees", l: "Signees", f: (r) => r.signees },
  { k: "five", l: "5★", heat: true, f: (r) => r.five || "·" },
  { k: "four", l: "4★", heat: true, f: (r) => r.four || "·" },
  { k: "three", l: "3★", f: (r) => r.three || "·" },
  { k: "avg", l: "Avg rating", heat: true, f: (r) => (r.avg == null ? "—" : r.avg.toFixed(4)) },
  { k: "played", l: "Played", heat: true, tip: "Freshmen from this class who have played this season", f: (r) => r.played || "·" },
  { k: "started", l: "Started", heat: true, tip: "Freshmen who have started at least one game", f: (r) => r.started || "·" },
  { k: "snaps", l: "Est. snaps", heat: true, tip: "The class's estimated snaps this season, all freshmen combined", f: (r) => (r.snaps ? r.snaps.toLocaleString() : "·") },
];

export default function ClassRankings({ rows, teams, confs }: { rows: ClassRow[]; teams: Record<string, TeamInfo>; confs: string[] }) {
  const [conf, setConf] = useState("");
  const [sortK, setSortK] = useState<keyof ClassRow>("score");
  const [dir, setDir] = useState(-1);
  const shown = useMemo(() => rows.filter((r) => !conf || teams[r.tid]?.conf === conf)
    .slice().sort((a, b) => (((a[sortK] as number) ?? -1) - ((b[sortK] as number) ?? -1)) * dir || a.rank - b.rank), [rows, conf, sortK, dir, teams]);
  const heat = useMemo(() => {
    const out: Record<string, (v: number) => string> = {};
    for (const c of COLS.filter((c) => c.heat)) {
      const v = rows.map((r) => r[c.k] as number).filter((x) => x != null).sort((a, b) => a - b);
      const q = [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
      out[c.k] = (x) => "c" + q.filter((t) => x > t).length;
    }
    return out;
  }, [rows]);
  return (
    <>
      <div className="controls">
        <select className="filter-select" value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Conference">
          <option value="">All conferences</option>
          {confs.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="count"><strong>{shown.length}</strong> classes</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense freeze2" style={{ ["--c1" as string]: "44px", ["--c2" as string]: "180px" }}>
          <thead>
            <tr>
              <th className="rk">RK</th><th className="l">Team</th>
              {COLS.map((c) => (
                <th key={c.k} className={`sort ${c.k === sortK ? "on" : ""}`} title={c.tip}
                  onClick={() => { if (c.k === sortK) setDir(-dir); else { setSortK(c.k); setDir(-1); } }}>
                  {c.l}{c.k === sortK && <span className="ar">{dir < 0 ? "▼" : "▲"}</span>}
                </th>
              ))}
              <th className="l">Top signee</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.tid}>
                <td className="rk">{r.rank}</td>
                <td className="l nm">
                  <Link href={`/teams/${teams[r.tid]?.slug}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo(teams[r.tid]?.logo, 20)} alt="" loading="lazy" />{teams[r.tid]?.name}
                  </Link>
                </td>
                {COLS.map((c) => <td key={c.k} className={`${c.k === sortK ? "strong " : ""}${c.heat ? heat[c.k](r[c.k] as number) : ""}`}>{c.f(r)}</td>)}
                <td className="l dim">{r.top}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
