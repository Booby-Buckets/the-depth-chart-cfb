import type { PlayerChart } from "@/lib/data";
import { PassMap, RunDir, Tile, chartStyles as c } from "./PassMap";

const p1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const pc = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");

/** Player page "Charting": where he throws / is targeted / runs, from the play-by-play text. */
export default function PlayerCharting({ ch, name, season }: { ch: PlayerChart; name: string; season?: number }) {
  const qb = ch.pass && ch.pass.att >= 10 ? ch.pass : null;
  const rc = ch.recv && ch.recv.att >= 5 ? ch.recv : null;
  const rs = ch.rush && Object.values(ch.rush).reduce((a, x) => a + x[0], 0) >= 10 ? ch.rush : null;
  if (!qb && !rc && !rs) return null;
  return (
    <section style={{ padding: season ? "8px 0" : "28px 0 8px" }} id={season ? `charting-${season}` : "charting"}>
      {season ? (
        <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>
          {season} season. ESPN&apos;s play-by-play only has throw and catch spots for part of {season}
          {(qb?.gc ?? rc?.gc) ? ` (${qb?.gc ?? rc?.gc} of ${name.split(" ").slice(-1)[0]}’s games here)` : ""}, so treat the maps as a sample.
        </p>
      ) : (
        <div className="sec-h">
          <h2>Charting</h2>
          <p>Where {name.split(" ").slice(-1)[0]}&apos;s plays went: throw and catch spots, air yards and yards after the catch, read from the play-by-play</p>
        </div>
      )}
      {qb && (
        <>
          <div className={c.tiles}>
            <Tile k="Avg. depth of throw" v={p1(qb.adot)} sub="air yards per attempt" />
            <Tile k="Deep shots" v={pc(qb.deep)} sub="throws 20+ air yards" />
            <Tile k="YAC per completion" v={p1(qb.yacPer)} sub={`${qb.yac} yds after the catch`} />
            <Tile k="Air yards" v={qb.airYds} sub={`of ${qb.cYds ?? qb.yds} yds on charted throws`} />
            <Tile k="Pressured" v={pc(qb.press)} sub={`hurried or sacked · ${qb.sacks ?? 0} sack${qb.sacks === 1 ? "" : "s"}`} />
          </div>
          <div className={c.wrap} style={{ marginBottom: 22 }}>
            <PassMap c={qb} title="Where he throws" noun="throws" note="Interceptions count where they were picked." />
          </div>
        </>
      )}
      {rc && (
        <>
          <div className={c.tiles}>
            <Tile k={season ? "Charted targets" : "Targets"} v={season ? rc.cAtt ?? rc.att : rc.att}
              sub={season && rc.cAtt ? `${rc.cComp} caught (${Math.round(((rc.cComp ?? 0) / rc.cAtt) * 100)}%)` : `${rc.comp} caught (${Math.round((rc.comp / rc.att) * 100)}%)`} />
            <Tile k="Avg. depth of target" v={p1(rc.adot)} sub="air yards per target" />
            <Tile k="YAC per catch" v={p1(rc.yacPer)} sub={`${rc.yac} yds after the catch`} />
            <Tile k="Air yards caught" v={rc.airYds} sub={`of ${rc.cYds ?? rc.yds} yds on charted catches`} />
            <Tile k="Deep targets" v={pc(rc.deep)} sub="20+ air yards" />
          </div>
          <div className={c.wrap} style={{ marginBottom: 22 }}>
            <PassMap c={rc} title="Where he's targeted" noun="targets" />
          </div>
        </>
      )}
      {rs && <div className={c.wrap}><RunDir r={rs} title="Run direction" /></div>}
    </section>
  );
}
