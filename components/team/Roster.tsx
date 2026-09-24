"use client";

import { useState } from "react";
import type { RosterPlayer } from "@/lib/data";

const UNITS: [string, string][] = [["all", "All"], ["offense", "Offense"], ["defense", "Defense"], ["specialTeam", "Special teams"]];
const POS = ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "C", "DL", "DE", "DT", "NT", "LB", "OLB", "ILB", "MLB", "DB", "CB", "S", "FS", "SS", "PK", "K", "P", "LS", "ATH"];
const CLS: Record<string, number> = { FR: 1, SO: 2, JR: 3, SR: 4, GR: 5 };
const posIx = (p: string | null) => { const i = POS.indexOf(p || ""); return i < 0 ? 99 : i; };
const inches = (s: string | null) => { const m = (s || "").match(/(\d+)'\s*(\d+)/); return m ? +m[1] * 12 + +m[2] : null; };

type Col = { k: string; l: string; cls?: string; str?: boolean; f: (p: RosterPlayer) => React.ReactNode; sv: (p: RosterPlayer) => number | string | null };

export default function Roster({ roster, teamId }: { roster: RosterPlayer[]; teamId: string }) {
  const [unit, setUnit] = useState("all");
  const [q, setQ] = useState("");
  const [sortK, setSortK] = useState("pos");
  const [dir, setDir] = useState(1);

  const cols: Col[] = [
    { k: "no", l: "#", f: (p) => p.no ?? "", sv: (p) => (p.no == null ? 999 : +p.no) },
    { k: "name", l: "Player", cls: "l nm", str: true, f: (p) => <a href={`/player.html?id=${p.id}&t=${teamId}`}>{p.name}</a>, sv: (p) => p.name },
    { k: "pos", l: "Pos", cls: "c", f: (p) => p.pos || "", sv: (p) => posIx(p.pos) },
    { k: "cls", l: "Class", cls: "c", f: (p) => p.cls || "", sv: (p) => CLS[p.cls || ""] || 9 },
    { k: "ht", l: "Ht", f: (p) => p.ht || "", sv: (p) => inches(p.ht) },
    { k: "wt", l: "Wt", f: (p) => (p.wt || "").replace(" lbs", ""), sv: (p) => parseInt(p.wt || "") || null },
    { k: "home", l: "Hometown", cls: "l dim", str: true, f: (p) => p.home || "", sv: (p) => p.home },
  ];
  const units = UNITS.filter(([k]) => k === "all" || roster.some((p) => p.unit === k));
  const col = cols.find((c) => c.k === sortK)!;
  const needle = q.trim().toLowerCase();
  const list = roster
    .filter((p) => (unit === "all" || p.unit === unit) && (!needle || `${p.name} ${p.pos || ""} ${p.home || ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const x = col.sv(a), y = col.sv(b);
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      const d = col.str ? String(x).localeCompare(String(y)) : (x as number) - (y as number);
      return d * dir || (+(a.no ?? 999)) - (+(b.no ?? 999));
    });

  return (
    <>
      <div className="controls">
        <span style={{ display: "flex", gap: 4 }}>
          {units.map(([k, l]) => (
            <button key={k} className={`chip ${k === unit ? "on" : ""}`} style={{ padding: "3px 9px", fontSize: 10 }} onClick={() => setUnit(k)}>{l}</button>
          ))}
        </span>
        <input className="search-box" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search player" />
        <span className="count"><strong>{list.length}</strong> players</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} className={`sort ${c.cls?.includes("l") ? "l" : c.cls === "c" ? "c" : ""} ${c.k === sortK ? "on" : ""}`}
                  onClick={() => { if (c.k === sortK) setDir(-dir); else { setSortK(c.k); setDir(1); } }}>
                  {c.l}{c.k === sortK && <span className="ar">{dir > 0 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>{cols.map((c) => <td key={c.k} className={c.cls || ""}>{c.f(p)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
