"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LeaderRow } from "@/lib/data";
import { fmt } from "@/lib/format";
import { playerHref } from "@/lib/slug";
import { logo } from "@/lib/logo";

type TeamInfo = { slug: string; logo: string; name: string };
type Fmt = (v: number | null | undefined) => string;
type Col = [key: string, label: string, f: Fmt, invert?: boolean];

const pc: Fmt = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
const n0: Fmt = (v) => (v == null ? "—" : v % 1 ? v.toFixed(1) : String(v));
const e2: Fmt = (v) => (v == null ? "—" : fmt(v, 2, true));
const share: Fmt = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
const d1: Fmt = (v) => (v == null ? "—" : v.toFixed(1));

const BOARDS: Record<string, { l: string; sort: string; cols: Col[] }> = {
  passing: { l: "Passing", sort: "yds", cols: [["att", "Att", n0], ["cmp", "Cmp", n0], ["pct", "Cmp %", pc], ["yds", "Yards", n0], ["td", "TD", n0], ["int", "INT", n0, true], ["ypa", "Y/A", n0], ["epa", "EPA/dropback", e2]] },
  rushing: { l: "Rushing", sort: "yds", cols: [["car", "Car", n0], ["yds", "Yards", n0], ["ypc", "Y/C", n0], ["td", "TD", n0], ["long", "Long", n0], ["epa", "EPA/rush", e2]] },
  receiving: { l: "Receiving", sort: "yds", cols: [["rec", "Rec", n0], ["yds", "Yards", n0], ["ypr", "Y/R", n0], ["td", "TD", n0], ["long", "Long", n0], ["use", "Target share", share]] },
  defense: { l: "Defense", sort: "tot", cols: [["tot", "Tackles", n0], ["solo", "Solo", n0], ["tfl", "TFL", n0], ["sacks", "Sacks", n0], ["int", "INT", n0], ["pd", "PD", n0], ["qbh", "QB hurries", n0]] },
  epa: { l: "EPA per play", sort: "epa", cols: [["plays", "Plays", n0], ["epa", "EPA/play", e2], ["epaPass", "Pass", e2], ["epaRush", "Rush", e2], ["use", "Usage", share]] },
  qbchart: { l: "QB charting", sort: "adot", cols: [["att", "Att", n0], ["pct", "Cmp %", pc], ["adot", "aDOT", d1], ["deep", "Deep %", share], ["airYds", "Air yds", n0], ["yacPer", "YAC/cmp", d1], ["press", "Pressured", share, true], ["sacks", "Sacks", n0, true]] },
  rcvchart: { l: "Receiver charting", sort: "yacPer", cols: [["tgt", "Tgt", n0], ["rec", "Rec", n0], ["pct", "Catch %", pc], ["adot", "aDOT", d1], ["deep", "Deep tgt %", share], ["airYds", "Air yds", n0], ["yac", "YAC", n0], ["yacPer", "YAC/rec", d1]] },
};
const CHART_BOARDS = ["qbchart", "rcvchart"];
const GROUPS = ["QB", "RB", "WR/TE"];
const VIEW_KEY = "cfb_players_view";

export default function Leaderboards({ initialBoard, initialRows, groupMin, teams, confs, dataUrl = "/data/players/leaders.json", noEpa = false, teamBase = "/teams" }: {
  initialBoard: string; initialRows: LeaderRow[]; groupMin: Record<string, number>; teams: Record<string, TeamInfo>; confs: string[];
  dataUrl?: string; noEpa?: boolean; teamBase?: string;
}) {
  const [boards, setBoards] = useState<Record<string, LeaderRow[]>>({ [initialBoard]: initialRows });
  const [board, setBoard] = useState(initialBoard);
  const [grp, setGrp] = useState("QB");
  const [conf, setConf] = useState("");
  const [sortK, setSortK] = useState(BOARDS[initialBoard].sort);
  const [dir, setDir] = useState(-1);

  // the other boards come from the same static file the build writes, fetched once when needed
  async function loadAll() {
    if (Object.keys(boards).length > 1) return boards;
    const all = (await (await fetch(dataUrl)).json()).boards as Record<string, LeaderRow[]>;
    setBoards(all);
    return all;
  }
  function pick(b: string) {
    setBoard(b); setSortK(BOARDS[b].sort); setDir(-1);
    if (!boards[b]) loadAll();
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ board: b, grp })); } catch {}
  }
  // come back to the board the reader last used (state is set when the fetch resolves)
  useEffect(() => {
    let saved: { board?: string; grp?: string } = {};
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch {}
    const b = saved.board;
    if (!b || b === initialBoard || !BOARDS[b] || (noEpa && (b === "epa" || CHART_BOARDS.includes(b)))) return;
    let live = true;
    fetch(dataUrl).then((r) => r.json()).then((d) => {
      if (!live) return;
      setBoards(d.boards);
      setBoard(b);
      setSortK(BOARDS[b].sort);
      if (saved.grp && GROUPS.includes(saved.grp)) setGrp(saved.grp);
    }).catch(() => {});
    return () => { live = false; };
  }, [initialBoard, dataUrl, noEpa]);

  const B = BOARDS[board];
  const loaded = boards[board];
  const rows = useMemo(() => {
    if (!loaded) return [];
    const col = B.cols.find((c) => c[0] === sortK);
    const inv = col?.[3] ? -1 : 1;
    return loaded
      .filter((r) => (!conf || r.conf === conf) && (board !== "epa" || r.group === grp))
      .slice()
      .sort((a, b) => (((a[sortK] as number) ?? -1e9) - ((b[sortK] as number) ?? -1e9)) * dir * inv || ((b[B.sort] as number) ?? 0) - ((a[B.sort] as number) ?? 0));
  }, [loaded, conf, board, grp, sortK, dir, B]);

  // heat: quintiles within the rows shown
  const heat = useMemo(() => {
    const out: Record<string, (v: number | null | undefined) => string> = {};
    for (const [k, , , inv] of B.cols) {
      const v = rows.map((r) => r[k] as number).filter((x) => x != null).sort((a, b) => a - b);
      if (v.length <= 4) continue;
      const q = [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
      out[k] = (x) => { if (x == null) return ""; let b = q.filter((c) => x > c).length; if (inv) b = 4 - b; return "c" + b; };
    }
    return out;
  }, [rows, B]);

  return (
    <section style={{ padding: "28px 0 8px" }}>
      <div className="controls">
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(BOARDS).filter(([k]) => !(noEpa && (k === "epa" || CHART_BOARDS.includes(k)))).map(([k, b]) => <button key={k} className={`chip ${k === board ? "on" : ""}`} onClick={() => pick(k)}>{b.l}</button>)}
        </span>
        {board === "epa" && (
          <span style={{ display: "flex", gap: 6 }}>
            {GROUPS.map((g) => (
              <button key={g} className={`chip ${g === grp ? "on" : ""}`} style={{ fontSize: 10, padding: "4px 9px" }}
                onClick={() => { setGrp(g); try { localStorage.setItem(VIEW_KEY, JSON.stringify({ board, grp: g })); } catch {} }}>{g}</button>
            ))}
          </span>
        )}
        <select className="filter-select" value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Conference">
          <option value="">All conferences</option>
          {confs.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="count">{loaded ? <><strong>{Math.min(100, rows.length)}</strong> of {rows.length} shown</> : "Loading…"}</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense freeze2" style={{ ["--c1" as string]: "44px", ["--c2" as string]: "190px" }}>
          <thead>
            <tr>
              <th className="rk">RK</th><th className="l">Player</th><th className="l">Team</th><th className="c">Pos</th><th className="c">Class</th>
              {B.cols.map(([k, l]) => (
                <th key={k} className={`sort ${k === sortK ? "on" : ""}`} onClick={() => { if (k === sortK) setDir(-dir); else { setSortK(k); setDir(-1); } }}>
                  {l}{k === sortK && <span className="ar">{dir < 0 ? "▼" : "▲"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r, i) => (
              <tr key={`${r.id}-${r.group ?? ""}`}>
                <td className="rk">{i + 1}</td>
                <td className="l nm">
                  <Link href={playerHref(r.name, r.id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo(teams[r.tid]?.logo, 20)} alt="" loading="lazy" />{r.name}
                  </Link>
                </td>
                <td className="l dim">{teams[r.tid] ? <Link href={`${teamBase}/${teams[r.tid].slug}`} style={{ color: "inherit", textDecoration: "none" }}>{r.team}</Link> : r.team}</td>
                <td className="c">{r.pos || ""}</td>
                <td className="c dim">{r.cls || ""}</td>
                {B.cols.map(([k, , f]) => (
                  <td key={k} className={`${k === sortK ? "strong " : ""}${heat[k] ? heat[k](r[k] as number) : ""}`}>{f(r[k] as number)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {board === "epa"
          ? `EPA per play among ${grp}s with ${groupMin[grp]}+ plays per team game. Early in the season a handful of big plays can top this list, so check the play count.`
          : board === "qbchart"
          ? "Charted from the play-by-play: where each throw was caught or thrown to. aDOT = average air yards per attempt; Deep % = throws 20+ air yards; YAC/cmp = yards after the catch per completion; Pressured = dropbacks where the QB was hurried or sacked (as the play-by-play records it). QBs with 10+ charted throws per team game."
          : board === "rcvchart"
          ? "Charted from the play-by-play. aDOT = average air yards per target; Deep tgt % = targets 20+ air yards; YAC = yards after the catch. Players with 4+ targets per team game."
          : `The top 300 FBS players by ${B.l.toLowerCase()} ${B.sort === "tot" ? "tackles" : "yards"}. Click a column to re-sort them. EPA columns are per play.`}
      </p>
    </section>
  );
}
