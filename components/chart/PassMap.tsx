import type { PassChart, RushDirs } from "@/lib/data";
import c from "./chart.module.css";

const BANDS = ["Behind", "0–4", "5–9", "10–14", "15–19", "20–29", "30+"];
const DIRS = [["L", "Left"], ["M", "Middle"], ["R", "Right"]] as const;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Pass heat map: where the throws went, by direction and air yards (deepest band on top). */
export function PassMap({ c: ch, title, noun, note }: { c: PassChart; title: string; noun: string; note?: string }) {
  const total = DIRS.reduce((a, [d]) => a + ch.grid[d].reduce((b, x) => b + x[0], 0), 0);
  const max = Math.max(1, ...DIRS.flatMap(([d]) => ch.grid[d].map((x) => x[0])));
  const row = (b: number) => (
    <div key={b} style={{ display: "contents" }}>
      <div className={c.rowh}>{BANDS[b]}</div>
      {DIRS.map(([d, dn]) => {
        const [att, comp, yds] = ch.grid[d][b];
        const share = (att / max).toFixed(3);               // 0..1 intensity, relative to the busiest cell
        const tip = att
          ? `${dn}, ${BANDS[b]} air yards: ${att} ${noun} (${pct(att, total)}% of all), ${comp} caught (${pct(comp, att)}%), ${yds} yds, ${(yds / att).toFixed(1)} per ${noun.replace(/s$/, "")}`
          : `${dn}, ${BANDS[b]} air yards: none`;
        return (
          <div key={d} title={tip} aria-label={tip}
            className={`${c.cell} ${!att ? c.empty : ""}`}
            style={{ background: att ? `color-mix(in oklab, var(--turf) calc(var(--heat-lo) + ${share} * (var(--heat-hi) - var(--heat-lo))), var(--bg))` : "var(--bg2)" }}>
            {att ? <><b>{att}</b><small>{pct(comp, att)}% · {yds}y</small></> : "·"}
          </div>
        );
      })}
    </div>
  );
  return (
    <div className={c.card}>
      <h3>{title}<span>{total} {noun} charted</span></h3>
      <div className={c.field}>
        <div />{DIRS.map(([d, dn]) => <div key={d} className={c.colh}>{dn}</div>)}
        {[6, 5, 4, 3, 2, 1].map(row)}
        <div className={c.losl}>LOS</div><div className={c.los} />
        {row(0)}
      </div>
      <div className={c.foot}>
        Rows are air yards past the line of scrimmage. Each cell: {noun}, catch rate, yards. Darker = more of the {noun}. Hover a cell for detail.
        {note ? ` ${note}` : ""}
      </div>
    </div>
  );
}

/** Run direction: carries left / middle / right with yards per carry and success rate. */
export function RunDir({ r, title }: { r: RushDirs; title: string }) {
  const total = DIRS.reduce((a, [d]) => a + r[d][0], 0);
  return (
    <div className={c.card}>
      <h3>{title}<span>{total} carries</span></h3>
      <div className={c.dirs}>
        {DIRS.map(([d, dn]) => {
          const [att, yds, succ] = r[d];
          return (
            <div key={d} className={c.dir} title={`${dn}: ${att} carries, ${yds} yds, ${att ? (yds / att).toFixed(1) : "—"} per carry, ${pct(succ, att)}% successful`}>
              <div className={c.lbl}>{dn}</div>
              <div className={c.bar}><i style={{ width: `${pct(att, total)}%` }} /></div>
              <div className={c.v}>{pct(att, total)}%</div>
              <small>{att ? (yds / att).toFixed(1) : "—"} YPC · {pct(succ, att)}% succ.</small>
            </div>
          );
        })}
      </div>
      <div className={c.foot}>Share of carries by direction, as the play-by-play calls it. Success: 5+ yards on 1st/2nd down, 3+ on 3rd/4th, or a touchdown. QB scrambles excluded.</div>
    </div>
  );
}

export function Tile({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return <div className={c.tile}><div className={c.k}>{k}</div><div className={c.v}>{v}</div>{sub && <small>{sub}</small>}</div>;
}
export { c as chartStyles };
