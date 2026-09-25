import type { RushDirs } from "@/lib/data";
import c from "./chart.module.css";

const DIRS = [["L", "Left"], ["M", "Middle"], ["R", "Right"]] as const;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

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
