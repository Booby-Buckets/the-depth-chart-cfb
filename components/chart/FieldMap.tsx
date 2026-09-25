"use client";

import { useId, useMemo, useState } from "react";
import type { PassChart } from "@/lib/data";
import c from "./chart.module.css";

/* The throw heat map drawn on a real field: turf stripes, yard lines, college hash marks, the line
   of scrimmage, a blurred heat layer (one warm hue, stronger = more of the throws) and an optional
   3D tilt. Filter by where the ball was snapped: own territory, opponent territory, red zone,
   inside the 10 (the field shrinks there, so windows get tighter). */

const W = 53.33, TOP = 40, BOT = -10, PX = 10;
const H = (TOP - BOT) * PX;
const y = (v: number) => (TOP - v) * PX;
const BANDS: [string, number, number][] = [["Behind", -10, 0], ["0–4", 0, 5], ["5–9", 5, 10], ["10–14", 10, 15], ["15–19", 15, 20], ["20–29", 20, 30], ["30+", 30, 40]];
const COLS: ["L" | "M" | "R", string, number, number][] = [["L", "Left", 0, W / 3], ["M", "Middle", W / 3, (2 * W) / 3], ["R", "Right", (2 * W) / 3, W]];
const ZONES: [string, string][] = [["all", "All"], ["own", "Own territory"], ["opp", "Opp. territory"], ["rz", "Red zone"], ["gl", "Inside the 10"]];
const HASH_L = 20, HASH_R = W - 20;                         // college hashes: 20 yds (60 ft) in from each sideline
const HEAT = "#ff6a2b";                                      // single warm hue on the turf
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

type View = { grid: PassChart["grid"]; att: number; comp: number; yds: number; td: number; int: number; adot: number | null; yacPer: number | null; deep: number | null; cAtt?: number };

export default function FieldMap({ c: ch, title, noun }: { c: PassChart; title: string; noun: string }) {
  const [zone, setZone] = useState("all");
  const [tilt, setTilt] = useState(true);
  const [table, setTable] = useState(false);
  const uid = useId().replace(/:/g, "");
  const views: Record<string, View> = useMemo(() => ({ all: { ...ch, cAtt: ch.cAtt }, ...(ch.zones || {}) }), [ch]);
  const v = views[zone] || views.all;
  const cells = COLS.flatMap(([d, dn, x0, x1]) => BANDS.map(([bn, y0, y1], b) => ({ d, dn, x0, x1, bn, y0, y1, v: v.grid[d][b] })));
  const total = cells.reduce((a, k) => a + k.v[0], 0);
  const max = Math.max(1, ...cells.map((k) => k.v[0]));
  const nLabel = (z: string) => (z === "all" ? ch.cAtt ?? total : (ch.zones as Record<string, View> | undefined)?.[z]?.cAtt ?? 0);

  return (
    <div className={c.card}>
      <h3>{title}<span>{total} {noun} charted</span></h3>
      {ch.zones && (
        <div className={c.zchips} role="group" aria-label="Where the ball was snapped">
          {ZONES.map(([k, l]) => {
            const n = nLabel(k);
            return (
              <button key={k} className={`chip ${zone === k ? "on" : ""}`} disabled={!n} onClick={() => setZone(k)}
                style={{ fontSize: 11, padding: "4px 9px", opacity: n ? 1 : 0.4 }}>{l} <span style={{ opacity: 0.6 }}>{n}</span></button>
            );
          })}
        </div>
      )}
      <div className={c.zstats}>
        <span><b>{pct(v.comp, v.att)}%</b> comp</span>
        <span><b>{f1(v.adot)}</b> avg. depth</span>
        <span><b>{f1(v.yacPer)}</b> YAC/catch</span>
        <span><b>{v.deep == null ? "—" : Math.round(v.deep * 100) + "%"}</b> 20+ air yds</span>
        <span><b>{v.td}–{v.int}</b> TD–INT</span>
      </div>

      <div className={c.fieldWrap} style={{ perspective: tilt ? "1100px" : undefined, marginTop: tilt ? "-15%" : undefined }}>
        <svg viewBox={`0 0 ${W * PX} ${H}`} className={c.fieldSvg} role="img"
          style={{ transform: tilt ? "rotateX(34deg)" : undefined }}
          aria-label={`${title}: ${total} ${noun} by direction and air yards${zone !== "all" ? `, ${ZONES.find((z) => z[0] === zone)?.[1]}` : ""}`}>
          <defs>
            <radialGradient id={`h${uid}`}>
              <stop offset="0%" stopColor={HEAT} stopOpacity={1} />
              <stop offset="55%" stopColor={HEAT} stopOpacity={0.85} />
              <stop offset="100%" stopColor={HEAT} stopOpacity={0} />
            </radialGradient>
            <filter id={`b${uid}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" /></filter>
          </defs>
          {/* turf: 5-yard mowing stripes */}
          {Array.from({ length: (TOP - BOT) / 5 }, (_, k) => (
            <rect key={k} x={0} y={k * 50} width={W * PX} height={50} fill={k % 2 ? "#2d7a3e" : "#337f43"} />
          ))}
          {/* yard lines, every 5 (heavier every 10) */}
          {Array.from({ length: (TOP - BOT) / 5 + 1 }, (_, k) => BOT + k * 5).map((yd) => (
            <line key={yd} x1={0} x2={W * PX} y1={y(yd)} y2={y(yd)} stroke="#fff" strokeOpacity={yd % 10 === 0 ? 0.85 : 0.55} strokeWidth={yd % 10 === 0 ? 2.2 : 1.4} />
          ))}
          {/* hash marks + sideline ticks every yard */}
          {Array.from({ length: TOP - BOT + 1 }, (_, k) => BOT + k).filter((yd) => yd % 5 !== 0).map((yd) => (
            <g key={yd} stroke="#fff" strokeOpacity={0.7} strokeWidth={1.4}>
              <line x1={HASH_L * PX - 5} x2={HASH_L * PX + 5} y1={y(yd)} y2={y(yd)} />
              <line x1={HASH_R * PX - 5} x2={HASH_R * PX + 5} y1={y(yd)} y2={y(yd)} />
              <line x1={2} x2={10} y1={y(yd)} y2={y(yd)} />
              <line x1={W * PX - 10} x2={W * PX - 2} y1={y(yd)} y2={y(yd)} />
            </g>
          ))}
          {/* yard numbers, relative to the line of scrimmage, painted like field numbers */}
          {[10, 20, 30].map((yd) => (
            <g key={yd} fill="#fff" fillOpacity={0.75} fontSize={20} fontWeight={700} fontFamily="var(--font-serif), Georgia, serif">
              <text x={3.2 * PX} y={y(yd)} textAnchor="middle" dominantBaseline="middle" transform={`rotate(90 ${3.2 * PX} ${y(yd)})`}>{yd}</text>
              <text x={(W - 3.2) * PX} y={y(yd)} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90 ${(W - 3.2) * PX} ${y(yd)})`}>{yd}</text>
            </g>
          ))}
          <rect x={1} y={1} width={W * PX - 2} height={H - 2} fill="none" stroke="#fff" strokeWidth={3} />
          {/* heat */}
          <g filter={`url(#b${uid})`}>
            {cells.filter((k) => k.v[0]).map((k) => (
              <ellipse key={k.d + k.bn} cx={((k.x0 + k.x1) / 2) * PX} cy={y((k.y0 + k.y1) / 2)}
                rx={((k.x1 - k.x0) / 2) * PX * 1.05} ry={((k.y1 - k.y0) / 2) * PX * 1.25}
                fill={`url(#h${uid})`} opacity={0.15 + 0.85 * Math.sqrt(k.v[0] / max)} />
            ))}
          </g>
          {/* line of scrimmage */}
          <line x1={0} x2={W * PX} y1={y(0)} y2={y(0)} stroke="#3b82f6" strokeWidth={4} />
          <text x={W * PX - 14} y={y(0) + 14} textAnchor="end" fontSize={11} fontWeight={800} fill="#dbeafe">LOS</text>
          {/* labels + hover targets */}
          {cells.map((k) => {
            const [att, comp, yds] = k.v;
            const tip = att
              ? `${k.dn}, ${k.bn} air yards: ${att} ${noun} (${pct(att, total)}%), ${comp} caught (${pct(comp, att)}%), ${yds} yds, ${(yds / att).toFixed(1)} per ${noun.replace(/s$/, "")}`
              : `${k.dn}, ${k.bn} air yards: none`;
            const cx = ((k.x0 + k.x1) / 2) * PX, cy = y((k.y0 + k.y1) / 2);
            return (
              <g key={`l${k.d}${k.bn}`} className={c.hit}>
                <rect x={k.x0 * PX} y={y(k.y1)} width={(k.x1 - k.x0) * PX} height={(k.y1 - k.y0) * PX} fill="transparent" />
                <title>{tip}</title>
                {att > 0 && (
                  <text x={cx} y={cy} textAnchor="middle" fill="#fff" stroke="#0b2512" strokeWidth={3.5} paintOrder="stroke" fontWeight={800}>
                    <tspan x={cx} fontSize={18}>{att}</tspan>
                    <tspan x={cx} dy={15} fontSize={11} fontWeight={700}>{pct(comp, att)}% · {yds}y</tspan>
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className={c.fieldFoot}>
        <span className={c.legend}>fewer <i /> more {noun}</span>
        <button className="chip" style={{ fontSize: 11, padding: "3px 9px" }} onClick={() => setTilt(!tilt)}>{tilt ? "Flat view" : "3D view"}</button>
        <button className="chip" style={{ fontSize: 11, padding: "3px 9px" }} onClick={() => setTable(!table)}>{table ? "Hide table" : "Table"}</button>
      </div>
      {table && (
        <table className="sheet dense" style={{ width: "100%", marginTop: 8 }}>
          <thead><tr><th className="l">Air yards</th>{COLS.map(([d, dn]) => <th key={d}>{dn}</th>)}</tr></thead>
          <tbody>
            {[...BANDS].reverse().map(([bn], ri) => {
              const b = BANDS.length - 1 - ri;
              return (
                <tr key={bn}><td className="l">{bn}</td>
                  {COLS.map(([d]) => { const [a, cp, yd] = v.grid[d][b]; return <td key={d}>{a ? `${a} · ${pct(cp, a)}% · ${yd}y` : "—"}</td>; })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className={c.foot}>
        Direction and air yards come from the play-by-play (left / middle / right thirds of the field), so each glow sits in its
        zone rather than on an exact spot. Hover a zone for detail.{zone === "rz" || zone === "gl" ? " Near the goal line the end zone caps how deep a throw can go." : ""}
      </div>
    </div>
  );
}
