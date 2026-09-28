"use client";

import { useState } from "react";
import s from "./betting.module.css";

type T = { id: string; name: string; net: number; off: number; def: number };
const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const SD = 15.5;   // game margin sd around the spread incl. rating uncertainty (build_hub game_sd, typical)

/** Our current line for any matchup: rating gap + home field; total from each offence vs the other defence. */
export default function LineCalc({ teams, hfa, ptsAvg }: { teams: T[]; hfa: number; ptsAvg: number }) {
  const [a, setA] = useState(teams.find((t) => t.name === "Ohio State")?.id || teams[0].id);
  const [h, setH] = useState(teams.find((t) => t.name === "Michigan")?.id || teams[1].id);
  const [site, setSite] = useState<"home" | "neutral">("home");
  const A = teams.find((t) => t.id === a)!, H = teams.find((t) => t.id === h)!;
  const sp = H.net - A.net + (site === "home" ? hfa : 0);
  const tot = 2 * ptsAvg + H.off - A.def + A.off - H.def;
  const p = 0.5 * (1 + erf(sp / (SD * Math.SQRT2)));
  const fav = sp >= 0 ? H : A;
  const hs = (tot + sp) / 2, as = (tot - sp) / 2;
  const pick = (v: string, set: (x: string) => void, label: string) => (
    <label className={s.cl}>{label}<select value={v} onChange={(e) => set(e.target.value)}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  );
  return (
    <div className={s.calc}>
      <div className={s.cin}>
        {pick(a, setA, "Away / Team 1")}
        {pick(h, setH, site === "home" ? "Home" : "Team 2")}
        <label className={s.cl}>Site<select value={site} onChange={(e) => setSite(e.target.value as "home" | "neutral")}><option value="home">At the home team</option><option value="neutral">Neutral field</option></select></label>
      </div>
      <div className={s.cout}>
        <div><span>TDC line</span><b>{Math.abs(sp) < 0.25 ? "Pick" : `${fav.name} −${Math.abs(sp).toFixed(1)}`}</b></div>
        <div><span>TDC total</span><b>{tot.toFixed(1)}</b></div>
        <div><span>Projected score</span><b>{A.name} {Math.round(as)}, {H.name} {Math.round(hs)}</b></div>
        <div><span>Win probability</span><b>{(sp >= 0 ? H : A).name} {Math.round(Math.max(p, 1 - p) * 100)}%</b></div>
      </div>
    </div>
  );
}
