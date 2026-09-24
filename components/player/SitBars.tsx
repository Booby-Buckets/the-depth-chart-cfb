"use client";

import { useRef, useState } from "react";
import type { PPA, Usage } from "@/lib/data";
import { fmt } from "@/lib/format";
import c from "./sitbars.module.css";

type Row = { l: string; v: number; avg: number | null };
const SIT: [keyof PPA, string][] = [["all", "All plays"], ["pass", "Passing"], ["rush", "Rushing"], ["firstDown", "1st down"], ["secondDown", "2nd down"], ["thirdDown", "3rd down"], ["standardDowns", "Standard downs"], ["passingDowns", "Passing downs"]];
const USE: [keyof Usage, string][] = [["overall", "All plays"], ["pass", "Pass plays"], ["rush", "Run plays"], ["firstDown", "1st down"], ["secondDown", "2nd down"], ["thirdDown", "3rd down"], ["standardDowns", "Standard downs"], ["passingDowns", "Passing downs"]];

/* Bars = the player; the tick on each bar = the position-group average. */
function Bars({ title, sub, rows, lo, hi, fmtV, name, group }: { title: string; sub: React.ReactNode; rows: Row[]; lo: number; hi: number; fmtV: (v: number) => string; name: string; group: string }) {
  const card = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; r: Row } | null>(null);
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className={c.card} ref={card}>
      <h3>{title}</h3>
      <div className={c.sub}>{sub}</div>
      {rows.map((r) => {
        const a = Math.min(x(0), x(r.v)), w = Math.abs(x(r.v) - x(0));
        return (
          <div key={r.l} className={c.sit}
            onMouseMove={(e) => { const b = card.current!.getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, r }); }}
            onMouseLeave={() => setTip(null)}>
            <span className={c.l}>{r.l}</span>
            <span className={c.track}>
              <span className={c.zero} style={{ left: `${x(0)}%` }} />
              <span className={c.bar} style={{ left: `${a}%`, width: `${Math.max(w, 0.6)}%` }} />
              {r.avg != null && <span className={c.avg} style={{ left: `${x(r.avg)}%` }} />}
            </span>
            <span className={c.v}>{fmtV(r.v)}</span>
          </div>
        );
      })}
      <div className={c.legend}><span><i className={c.lb} />{name}</span><span><i className={c.lt} />{group} average</span></div>
      {tip && <div className={c.tip} style={{ left: tip.x, top: tip.y }}><b>{tip.r.l}</b> · {fmtV(tip.r.v)} · {group} avg {tip.r.avg == null ? "—" : fmtV(tip.r.avg)}</div>}
    </div>
  );
}

export default function SitBars({ name, group, ppa, ppaAvg, use, useAvg, summary }: {
  name: string; group: string; ppa: PPA; ppaAvg: PPA; use: Usage | null; useAvg: Usage; summary: React.ReactNode;
}) {
  const eRows: Row[] = SIT.map(([k, l]) => ({ l, v: ppa[k] as number, avg: ppaAvg[k] })).filter((r) => r.v != null);
  const eVals = eRows.flatMap((r) => [r.v, r.avg]).filter((v): v is number => v != null);
  const uRows: Row[] = use ? USE.map(([k, l]) => ({ l, v: use[k] as number, avg: useAvg[k] })).filter((r) => r.v != null) : [];
  return (
    <div className={c.grid2}>
      <Bars title="EPA per play by situation" sub={summary} rows={eRows}
        lo={Math.min(0, ...eVals) - 0.1} hi={Math.max(0, ...eVals) + 0.1} fmtV={(v) => fmt(v, 2, true)} name={name} group={group} />
      {uRows.length > 0 && (
        <Bars title="Share of team plays" sub="How often the offense runs through this player. Pass = targets or dropbacks, rush = carries" rows={uRows}
          lo={0} hi={Math.max(0.2, ...uRows.flatMap((r) => [r.v, r.avg || 0])) * 1.08} fmtV={(v) => Math.round(v * 100) + "%"} name={name} group={group} />
      )}
    </div>
  );
}
