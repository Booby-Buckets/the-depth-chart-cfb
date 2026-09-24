"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RecruitRow } from "@/lib/data";
import { logo } from "@/lib/logo";
import { playerHref } from "@/lib/slug";

type TeamInfo = { slug: string; name: string; logo: string; conf: string };
const POS_GROUPS: [string, string[]][] = [
  ["QB", ["QB", "DUAL", "PRO"]], ["RB", ["RB", "APB"]], ["WR", ["WR"]], ["TE", ["TE"]], ["OL", ["OT", "IOL", "OL", "OG", "C"]],
  ["DL", ["DL", "EDGE", "DE", "DT", "SDE", "WDE"]], ["LB", ["LB", "ILB", "OLB"]], ["DB", ["CB", "S", "DB"]], ["ATH", ["ATH"]], ["K/P", ["K", "P", "LS"]],
];

export default function RecruitList({ initial, total, teams, confs }: { initial: RecruitRow[]; total: number; teams: Record<string, TeamInfo>; confs: string[] }) {
  const [all, setAll] = useState<RecruitRow[] | null>(null);
  const [conf, setConf] = useState("");
  const [pos, setPos] = useState("");
  const [stars, setStars] = useState(0);
  const [onlyPlaying, setOnlyPlaying] = useState(false);
  const [limit, setLimit] = useState(100);

  // the first 100 ship with the page; the rest of the list loads the first time it's filtered or expanded
  async function ensureAll() {
    if (all) return;
    try { setAll((await (await fetch("/data/recruiting.json")).json()).recruits); } catch { /* keep the first 100 */ }
  }
  const source = all || initial;
  const shown = useMemo(() => source.filter((r) =>
    (!conf || teams[r.tid]?.conf === conf) &&
    (!pos || (POS_GROUPS.find((g) => g[0] === pos)?.[1] || []).includes(r.pos || "")) &&
    (!stars || (r.stars || 0) === stars) &&
    (!onlyPlaying || r.g > 0)), [source, conf, pos, stars, onlyPlaying, teams]);
  const filtered = !!(conf || pos || stars || onlyPlaying);

  return (
    <>
      <div className="controls">
        <select className="filter-select" value={pos} aria-label="Position" onChange={(e) => { setPos(e.target.value); ensureAll(); }}>
          <option value="">All positions</option>{POS_GROUPS.map(([g]) => <option key={g}>{g}</option>)}
        </select>
        <select className="filter-select" value={stars} aria-label="Stars" onChange={(e) => { setStars(+e.target.value); ensureAll(); }}>
          <option value={0}>All stars</option><option value={5}>5★</option><option value={4}>4★</option><option value={3}>3★</option>
        </select>
        <select className="filter-select" value={conf} aria-label="Conference" onChange={(e) => { setConf(e.target.value); ensureAll(); }}>
          <option value="">All conferences</option>{confs.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className={`chip ${onlyPlaying ? "on" : ""}`} onClick={() => { setOnlyPlaying(!onlyPlaying); ensureAll(); }}>Played this season</button>
        <span className="count"><strong>{Math.min(limit, shown.length)}</strong> of {all || filtered ? shown.length : total} shown</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense freeze2" style={{ ["--c1" as string]: "52px", ["--c2" as string]: "190px" }}>
          <thead>
            <tr>
              <th className="rk">Natl</th><th className="l">Recruit</th><th className="c">Pos</th><th className="c">Stars</th><th>Rating</th>
              <th className="l">Signed with</th><th className="l">Hometown</th><th>G</th><th>GS</th><th>Snap share</th><th className="l">2026 so far</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={`${r.id ?? r.name}-${r.tid}`}>
                <td className="rk">{r.rank ?? "—"}</td>
                <td className="l nm">{r.onFile && r.id ? <Link href={playerHref(r.name2 || r.name, r.id)}>{r.name}</Link> : r.name}</td>
                <td className="c">{r.pos || ""}</td>
                <td className="c" style={{ color: "var(--accent)", letterSpacing: 1 }}>{"★".repeat(r.stars || 0)}</td>
                <td>{r.rating ? r.rating.toFixed(4) : "—"}</td>
                <td className="l nm">
                  <Link href={`/teams/${teams[r.tid]?.slug}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo(teams[r.tid]?.logo, 20)} alt="" loading="lazy" />{teams[r.tid]?.name}
                  </Link>
                </td>
                <td className="l dim">{r.home}</td>
                <td className={r.g ? "" : "dim"}>{r.g || "·"}</td>
                <td className={r.gs ? "strong c4" : "dim"}>{r.gs || "·"}</td>
                <td>{r.es && r.esTP ? `${Math.round((r.es / r.esTP) * 100)}%` : <span style={{ color: "var(--text3)" }}>—</span>}</td>
                <td className="l dim">{r.line || (r.onFile ? "" : "not on a roster yet")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit || (!all && !filtered && total > initial.length) ? (
        <p style={{ marginTop: 10 }}><button className="chip" onClick={() => { ensureAll(); setLimit(limit + 200); }}>Show more</button></p>
      ) : null}
    </>
  );
}
