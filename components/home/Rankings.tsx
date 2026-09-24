"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HubTeam } from "@/lib/data";
import { fmt } from "@/lib/format";
import { logo } from "@/lib/logo";

type Col = {
  k: keyof HubTeam | "delta"; l: string; cls?: string; tip?: string;
  f: (t: Row) => React.ReactNode; sv?: (t: Row) => number | string | null;
  heat?: boolean; inv?: boolean; str?: boolean;
};
type Row = HubTeam & { delta: number | null };

const pctCell = (v?: number) => (v == null ? "—" : (v * 100).toFixed(1) + "%");

function columns(hasAdvanced: boolean, slugs: Record<string, string>): Col[] {
  const cols: Col[] = [
    { k: "rank", l: "RK", cls: "rk", f: (t) => t.rank },
    { k: "name", l: "Team", cls: "l nm", str: true, sv: (t) => t.name,
      // eslint-disable-next-line @next/next/no-img-element
      f: (t) => <Link href={`/teams/${slugs[t.id]}`}><img src={logo(t.logo, 20)} alt="" loading="lazy" />{t.name}</Link> },
    { k: "conf", l: "Conf", cls: "l dim", str: true, f: (t) => t.conf },
    { k: "w", l: "W-L", cls: "c", f: (t) => `${t.w}-${t.l}`, sv: (t) => t.w - t.l + t.w * 0.01 },
    { k: "cw", l: "Conf", cls: "c dim", f: (t) => (t.confAbbr === "ind" ? "—" : `${t.cw}-${t.cl}`), sv: (t) => t.cw - t.cl },
    { k: "net", l: "Rating", cls: "big", heat: true, tip: "Points better than an average FBS team, neutral field", f: (t) => fmt(t.net, 1, true) },
    { k: "off", l: "Off", heat: true, tip: "Points scored above average vs average defense", f: (t) => fmt(t.off, 1, true) },
    { k: "def", l: "Def", heat: true, tip: "Points allowed below average vs average offense", f: (t) => fmt(t.def, 1, true) },
    { k: "sos", l: "SOS", heat: true, tip: "Average rating of opponents played", f: (t) => fmt(t.sos, 1, true) },
    { k: "prior", l: "Preseason", cls: "dim", tip: "Last season’s final rating, regressed 40% to average", f: (t) => fmt(t.prior, 1, true) },
    { k: "delta", l: "Δ", tip: "Rating change since the preseason",
      f: (t) => t.delta == null ? "—" : <span className={t.delta > 0 ? "up" : t.delta < 0 ? "dn" : ""}>{fmt(t.delta, 1, true)}</span> },
  ];
  if (hasAdvanced) cols.push(
    { k: "oEPA", l: "Off EPA", heat: true, tip: "Offensive expected points added per play", f: (t) => fmt(t.oEPA, 3) },
    { k: "dEPA", l: "Def EPA", heat: true, inv: true, tip: "Defensive EPA per play allowed (lower is better)", f: (t) => fmt(t.dEPA, 3) },
    { k: "oSR", l: "Off SR", heat: true, tip: "Offensive success rate", f: (t) => pctCell(t.oSR) },
    { k: "dSR", l: "Def SR", heat: true, inv: true, tip: "Defensive success rate allowed (lower is better)", f: (t) => pctCell(t.dSR) },
  );
  return cols;
}

export default function Rankings({ teams, hasAdvanced, slugs }: { teams: HubTeam[]; hasAdvanced: boolean; slugs: Record<string, string> }) {
  const rows: Row[] = useMemo(() => teams.map((t) => ({ ...t, delta: t.prior == null ? null : +(t.net - t.prior).toFixed(1) })), [teams]);
  const cols = useMemo(() => columns(hasAdvanced, slugs), [hasAdvanced, slugs]);
  const confs = useMemo(() => [...new Set(teams.map((t) => t.conf))].sort(), [teams]);
  const [conf, setConf] = useState("");
  const [q, setQ] = useState("");
  const [sortK, setSortK] = useState<Col["k"]>("rank");
  const [dir, setDir] = useState(1);

  // heat buckets: quintiles over the whole FBS field (higher is better unless inverted)
  const heat = useMemo(() => {
    const out: Record<string, (v: number | null | undefined) => string> = {};
    for (const c of cols.filter((c) => c.heat)) {
      const vals = rows.map((r) => r[c.k] as number).filter((v) => v != null).sort((a, b) => a - b);
      if (!vals.length) continue;
      const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => vals[Math.floor(p * (vals.length - 1))]);
      out[c.k] = (v) => { if (v == null) return ""; let b = cuts.filter((x) => v > x).length; if (c.inv) b = 4 - b; return "c" + b; };
    }
    return out;
  }, [cols, rows]);

  const col = cols.find((c) => c.k === sortK)!;
  const sv = col.sv || ((t: Row) => t[col.k] as number | string | null);
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((t) => (!conf || t.conf === conf) && (!needle || `${t.name} ${t.full} ${t.abbr}`.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const x = sv(a), y = sv(b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (col.str ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * dir;
    });

  function sortBy(c: Col) {
    if (c.k === sortK) setDir(-dir);
    else { setSortK(c.k); setDir(c.str || c.k === "rank" || c.inv ? 1 : -1); }
  }

  return (
    <>
      <div className="controls">
        <select className="filter-select" value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Conference">
          <option value="">All conferences</option>
          {confs.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className="search-box" placeholder="Search team…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search team" />
        <span className="count"><strong>{shown.length}</strong> teams</span>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense freeze2">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} className={`sort ${c.cls?.includes("l") ? "l" : ""} ${c.k === sortK ? "on" : ""}`} title={c.tip} onClick={() => sortBy(c)}>
                  {c.l}{c.k === sortK && <span className="ar">{dir > 0 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                {cols.map((c) => (
                  <td key={c.k} className={`${c.cls || ""} ${c.heat && heat[c.k] ? heat[c.k](t[c.k] as number) : ""}`}>{c.f(t)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
