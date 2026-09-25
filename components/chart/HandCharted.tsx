import type { HandPass, HandRush, PlayerHand, TeamHand, Split } from "@/lib/data";
import { Tile, chartStyles as c } from "./PassMap";

/* Hand-charted plays (the owner's /chart tool): where the QB threw from, exactly where the ball
   went, pressure / play-action splits, routes, coverage, run concepts. Built only from the plays
   that have been charted, so every block says how many. */

const W = 53.33, Y0 = -15, Y1 = 45, PX = 10;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) + "%" : "—");
const ypa = (s: Split) => (s[0] ? (s[2] / s[0]).toFixed(1) : "—");
const top = (r: Record<string, number>, k = 4) => Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, k);
const RES: Record<string, string> = { C: "Complete", X: "Incomplete", I: "Intercepted", S: "Sack", R: "Scramble" };

function Scatter({ pts, title }: { pts: HandPass["pts"]; title: string }) {
  const y = (v: number) => (Y1 - v) * PX;
  return (
    <div className={c.card}>
      <h3>{title}<span>{pts.length} plays</span></h3>
      <svg viewBox={`0 0 ${W * PX} ${(Y1 - Y0) * PX}`} style={{ width: "100%", height: "auto", borderRadius: 8, display: "block" }}
        role="img" aria-label={`${title}: throw and target spots for ${pts.length} charted plays`}>
        <rect width={W * PX} height={(Y1 - Y0) * PX} fill="var(--bg2)" />
        {Array.from({ length: 13 }, (_, k) => -15 + k * 5).map((v) => (
          <g key={v}>
            <line x1={0} x2={W * PX} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            {v !== 0 && <text x={6} y={y(v) - 3} fontSize={11} fill="var(--text3)">{v > 0 ? `+${v}` : v}</text>}
          </g>
        ))}
        <line x1={0} x2={W * PX} y1={y(0)} y2={y(0)} stroke="var(--text3)" strokeWidth={2} strokeDasharray="8 5" />
        {pts.map(([lx, ly, , , r], i) => lx != null && ly != null && (
          <circle key={`l${i}`} cx={lx * PX} cy={y(ly)} r={5} fill="var(--accent)" fillOpacity={0.75}>
            <title>{`Threw from ${ly} yds, ${Math.abs(lx - W / 2).toFixed(1)} yds ${lx < W / 2 ? "left" : "right"} of center (${RES[r] || r})`}</title>
          </circle>
        ))}
        {pts.map(([, , tx, ty, r], i) => {
          if (tx == null || ty == null) return null;
          const cx = tx * PX, cy = y(ty), tip = <title>{`${RES[r] || r} · ${ty} air yds, ${tx < 17.8 ? "left" : tx > 35.5 ? "right" : "middle"} third`}</title>;
          return r === "C" ? <circle key={`t${i}`} cx={cx} cy={cy} r={7} fill="var(--turf)" stroke="var(--bg)" strokeWidth={2}>{tip}</circle>
            : r === "I" ? <g key={`t${i}`}><path d={`M${cx - 7} ${cy - 7}L${cx + 7} ${cy + 7}M${cx + 7} ${cy - 7}L${cx - 7} ${cy + 7}`} stroke="var(--red)" strokeWidth={3} />{tip}</g>
            : <circle key={`t${i}`} cx={cx} cy={cy} r={6} fill="none" stroke="var(--text2)" strokeWidth={2}>{tip}</circle>;
        })}
      </svg>
      <div className={c.foot}>
        <span style={{ color: "var(--accent)" }}>●</span> where the QB threw from · <span style={{ color: "var(--turf)" }}>●</span> completed ·
        {" "}○ incomplete · <span style={{ color: "var(--red)" }}>✕</span> intercepted. Dashed line = line of scrimmage; offense moves up. Hover a mark for detail.
      </div>
    </div>
  );
}

function PassBlock({ h, who }: { h: HandPass; who: "qb" | "recv" | "off" | "def" }) {
  const S = h.split;
  const pressured = S.pressured[0], thrown = S.clean[0] + S.pressured[0];
  const noun = who === "recv" ? "targets" : "throws";
  const list = (label: string, r: Record<string, number>) => Object.keys(r).length > 0 && (
    <div><b style={{ fontSize: 12 }}>{label}:</b> <span style={{ fontSize: 12.5, color: "var(--text2)" }}>{top(r).map(([k, v]) => `${k} ${v}`).join(" · ")}</span></div>
  );
  return (
    <>
      <div className={c.tiles}>
        <Tile k="Plays charted" v={h.n} sub={`${h.comp}/${h.att} · ${h.yds} yds`} />
        <Tile k={who === "def" ? "Clean pocket allowed" : "From a clean pocket"} v={pct(S.clean[1], S.clean[0])} sub={`${ypa(S.clean)} yds per ${noun.slice(0, -1)} · ${S.clean[0]} ${noun}`} />
        <Tile k={who === "def" ? "When it got pressure" : "Under pressure"} v={pct(S.pressured[1], S.pressured[0])} sub={`${ypa(S.pressured)} per ${noun.slice(0, -1)} · pressured on ${pct(pressured, thrown)}`} />
        <Tile k="Play action" v={pct(h.pa, h.n)} sub={`${ypa(S.pa)} yds per throw (vs ${ypa(S.nopa)} without)`} />
        {(who === "qb" || who === "recv") && <Tile k="Drops" v={h.drop} sub={who === "recv" ? `${h.contested} contested catches · ${h.bt} broken tackles` : `${h.throwaway} throwaways`} />}
      </div>
      <div className={c.wrap} style={{ marginBottom: 14 }}>
        {h.pts.length > 0 && <Scatter pts={h.pts} title={who === "recv" ? "Where he's targeted (exact spots)" : who === "def" ? "Throws against this defense" : "Throw and target spots"} />}
        <div className={c.card} style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <h3>Tags<span>from {h.n} charted plays</span></h3>
          {list("QB platform", h.platform)}
          {list("Pressure", h.pressure)}
          {list("Pressure came from", h.pSrc)}
          {list("Throw window", h.window || {})}
          {list("Routes", h.route)}
          {list(who === "def" ? "Coverage played" : "Coverage faced", h.cov)}
          <div style={{ fontSize: 12.5, color: "var(--text2)" }}>RPO {h.rpo} · screens {h.screen} · motion at the snap {h.motion}</div>
        </div>
      </div>
    </>
  );
}

function RushBlock({ h }: { h: HandRush }) {
  const rows = Object.entries(h.concept).sort((a, b) => b[1][0] - a[1][0]);
  const gaps = Object.entries(h.gap).sort((a, b) => b[1][0] - a[1][0]);
  return (
    <>
      <div className={c.tiles}>
        <Tile k="Runs charted" v={h.n} sub={`${(h.yds / h.n).toFixed(1)} yds per carry`} />
        <Tile k="Before contact" v={h.ybcAvg != null ? h.ybcAvg.toFixed(1) : "—"} sub="yds per carry, from the first-contact spot" />
        {h.yac != null && <Tile k="After contact" v={h.yac.toFixed(1)} sub="yds per carry" />}
        <Tile k="Broken tackles" v={h.bt} />
      </div>
      <div className={c.wrap} style={{ marginBottom: 14 }}>
        {rows.length > 0 && (
          <div className={c.card}>
            <h3>Run concepts<span>carries · yds per carry</span></h3>
            <table className="sheet dense" style={{ width: "100%" }}>
              <tbody>{rows.map(([k, [n, y]]) => <tr key={k}><td className="l">{k}</td><td>{n}</td><td>{(y / n).toFixed(1)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {gaps.length > 0 && (
          <div className={c.card}>
            <h3>Gaps<span>carries · yds per carry</span></h3>
            <table className="sheet dense" style={{ width: "100%" }}>
              <tbody>{gaps.map(([k, [n, y]]) => <tr key={k}><td className="l">{k.replace("-L", " left").replace("-R", " right")} gap</td><td>{n}</td><td>{(y / n).toFixed(1)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const Head = ({ sub }: { sub: string }) => (
  <div className="sec-h"><h2>Hand-Charted</h2><p>{sub}</p></div>
);

export function PlayerHandCharted({ h }: { h: PlayerHand }) {
  if (!h.pass && !h.recv && !h.rush) return null;
  return (
    <section id="hand" style={{ padding: "28px 0 8px" }}>
      <Head sub="Charted by hand from the game film: exact spots, pressure, play action, routes and coverage. Only the plays charted so far count" />
      {h.pass && <PassBlock h={h.pass} who="qb" />}
      {h.recv && <PassBlock h={h.recv} who="recv" />}
      {h.rush && <RushBlock h={h.rush} />}
    </section>
  );
}

export function TeamHandCharted({ h }: { h: TeamHand }) {
  const O = h.off, D = h.def;
  if (!O.pass && !O.rush && !D.pass && !D.rush) return null;
  return (
    <section id="hand" style={{ padding: "28px 0 8px" }}>
      <Head sub="Charted by hand from the game film. Only the plays charted so far count" />
      {O.pass && <><h3 style={{ margin: "6px 0 10px" }}>Offense · passing</h3><PassBlock h={O.pass} who="off" /></>}
      {O.rush && <><h3 style={{ margin: "6px 0 10px" }}>Offense · running</h3><RushBlock h={O.rush} /></>}
      {D.pass && <><h3 style={{ margin: "6px 0 10px" }}>Defense · pass defense</h3><PassBlock h={D.pass} who="def" /></>}
      {D.rush && <><h3 style={{ margin: "6px 0 10px" }}>Defense · run defense</h3><RushBlock h={D.rush} /></>}
    </section>
  );
}
