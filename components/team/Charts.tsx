"use client";

import { useRef, useState } from "react";
import type { HistoryPoint, TeamFile } from "@/lib/data";
import { fmt, pct } from "@/lib/format";
import c from "./charts.module.css";

/* A tooltip positioned inside its card, shared by both charts. */
function useTip() {
  const card = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);
  const show = (e: React.MouseEvent, html: React.ReactNode) => {
    const b = card.current!.getBoundingClientRect();
    setTip({ x: e.clientX - b.left, y: e.clientY - b.top, html });
  };
  const el = tip && <div className={c.tip} style={{ left: tip.x, top: tip.y }}>{tip.html}</div>;
  return { card, show, hide: () => setTip(null), el };
}

/* ---------- rating after every week (single series, team colour) ---------- */
export function RatingChart({ history: h, fbsTeams, title = "Rating by week", summary }: {
  history: HistoryPoint[]; fbsTeams: number; title?: string; summary?: React.ReactNode;
}) {
  const { card, show, hide, el } = useTip();
  const W = 560, H = 210, pl = 34, pr = 70, pt = 14, pb = 26;
  const vals = h.map((p) => p.net), lo = Math.min(0, ...vals) - 3, hi = Math.max(0, ...vals) + 3;
  const x = (i: number) => pl + (h.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (h.length - 1));
  const y = (v: number) => pt + ((hi - v) * (H - pt - pb)) / (hi - lo);
  const step = hi - lo > 24 ? 10 : 5, ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const first = h[0], last = h[h.length - 1];
  const moved = first.rank - last.rank;
  return (
    <div className={`${c.card} ${c.chart}`} ref={card}>
      <h3>{title}</h3>
      <div className={c.big}>
        {summary ?? <>
          <b>{fmt(last.net, 1, true)}</b> now, {fmt(first.net, 1, true)} preseason ·{" "}
          {moved === 0 ? "rank unchanged" : `${moved > 0 ? "up" : "down"} ${Math.abs(moved)} spot${Math.abs(moved) === 1 ? "" : "s"} since preseason`}
        </>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="TDC rating by week" onMouseLeave={hide}>
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? c.zero : c.grid} x1={pl} x2={W - pr + 10} y1={y(v)} y2={y(v)} />
            <text className={c.ax} x={pl - 6} y={y(v) + 3} textAnchor="end">{v > 0 ? "+" : ""}{v}</text>
          </g>
        ))}
        <text className={c.ax} x={W - pr + 14} y={y(0) + 3}>FBS avg</text>
        {h.map((p, i) => (
          <text key={p.wk} className={c.ax} x={x(i)} y={H - 6} textAnchor="middle">{p.wk === "Preseason" ? "Pre" : p.wk.replace("Week ", "Wk ")}</text>
        ))}
        <path d={h.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.net).toFixed(1)}`).join(" ")} fill="none" stroke="var(--tc-text)" strokeWidth={2} strokeLinejoin="round" />
        {h.map((p, i) => <circle key={p.wk} cx={x(i)} cy={y(p.net)} r={4.5} fill="var(--tc-text)" stroke="var(--bg)" strokeWidth={2} />)}
        <text className={c.dl} x={x(h.length - 1) + 10} y={y(last.net) + 4}>#{last.rank}</text>
        {h.map((p, i) => (
          <rect key={p.wk} x={x(i) - 22} y={pt} width={44} height={H - pt - pb} fill="transparent"
            onMouseMove={(e) => show(e, <><b>{p.wk}</b> · {fmt(p.net, 1, true)} · #{p.rank} of {fbsTeams}</>)} />
        ))}
      </svg>
      {el}
    </div>
  );
}

/* ---------- chance of each final record (overall / conference) ---------- */
export function RecordOdds({ outlook: o, showConf }: { outlook: TeamFile["outlook"]; showConf: boolean }) {
  const { card, show, hide, el } = useTip();
  const [mode, setMode] = useState<"all" | "conf">("all");
  const full = mode === "conf" ? o.confDist : o.dist;
  // drop the near-impossible tails (<0.5%) so the bars that matter get the width
  const a0 = full.findIndex((r) => r.p >= 0.005);
  const a1 = full.length - 1 - [...full].reverse().findIndex((r) => r.p >= 0.005);
  const d = a0 < 0 ? full : full.slice(a0, a1 + 1);
  const W = 560, H = 210, pl = 8, pr = 8, pt = 22, pb = 26;
  const maxP = Math.max(...d.map((r) => r.p)), bw = (W - pl - pr) / d.length, gap = Math.min(10, bw * 0.25);
  const y = (p: number) => pt + (1 - p / maxP) * (H - pt - pb);
  const best = d.reduce((m, r) => (r.p > m.p ? r : m), d[0]);
  const [ew, el2] = mode === "conf" ? [o.confExpW, o.confExpL] : [o.expW, o.expL];
  return (
    <div className={`${c.card} ${c.chart}`} ref={card}>
      <h3>
        <span>Final record odds</span>
        {showConf && (
          <span className={c.mini}>
            {(["all", "conf"] as const).map((k) => (
              <button key={k} className={`chip ${k === mode ? "on" : ""}`} onClick={() => setMode(k)}>{k === "all" ? "Overall" : "Conference"}</button>
            ))}
          </span>
        )}
      </h3>
      <div className={c.big}>
        {d.length === 1 ? <><b>{d[0].w}-{d[0].l}</b> final</> :
          <><b>{ew.toFixed(1)}-{el2.toFixed(1)}</b> expected{mode === "conf" ? " in conference" : ""} · most likely {best.w}-{best.l} ({pct(best.p)})</>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chance of each final record" onMouseLeave={hide}>
        <line className={c.grid} x1={pl} x2={W - pr} y1={H - pb} y2={H - pb} />
        {d.map((r, i) => {
          const bx = pl + i * bw + gap / 2, bh = Math.max(0, H - pb - y(r.p)), top = H - pb - bh, rr = Math.min(4, bh);
          return (
            <g key={`${r.w}-${r.l}`}>
              <path d={`M${bx} ${H - pb} V${top + rr} Q${bx} ${top} ${bx + rr} ${top} H${bx + bw - gap - rr} Q${bx + bw - gap} ${top} ${bx + bw - gap} ${top + rr} V${H - pb} Z`}
                fill="var(--tc-text)" opacity={r === best ? 1 : 0.55} />
              {r.p >= 0.05 && <text className={c.dl} x={bx + (bw - gap) / 2} y={top - 6} textAnchor="middle" style={{ fontSize: 10 }}>{Math.round(r.p * 100)}%</text>}
              <text className={c.ax} x={bx + (bw - gap) / 2} y={H - 8} textAnchor="middle">{r.w}-{r.l}</text>
              <rect x={pl + i * bw} y={pt - 18} width={bw} height={H - pt - pb + 18} fill="transparent"
                onMouseMove={(e) => show(e, <><b>{r.w}-{r.l}</b> · {pct(r.p)}</>)} />
            </g>
          );
        })}
      </svg>
      {el}
    </div>
  );
}
