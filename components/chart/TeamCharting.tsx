import type { TeamChart } from "@/lib/data";
import { PassMap, RunDir, Tile, chartStyles as c } from "./PassMap";

const p1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const pc = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");
const ord = (r: number) => r + (r % 100 >= 11 && r % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[r % 10] || "th");
const rk = (r: number | undefined, n: number) => (r ? `${ord(r)} of ${n}` : "");

/** Team page "Charting": the offense's and defense's pass maps, run direction, style numbers. */
export default function TeamCharting({ ch, n, games }: { ch: TeamChart; n: number; games: number }) {
  const O = ch.off, D = ch.def;
  if (!O.pass.att || !O.pass.gc) return null;
  const partial = O.pass.gc < games;
  return (
    <section id="charting" style={{ padding: "28px 0 8px" }}>
      <div className="sec-h">
        <h2>Charting</h2>
        <p>Where the ball goes, read from the play-by-play: air yards, yards after the catch, run direction, pressure and tempo. Ranks run highest to lowest</p>
      </div>
      {partial && (
        <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>
          <b>Partial season.</b> ESPN&apos;s play-by-play has throw and catch spots for {O.pass.gc} of this team&apos;s {games} games, so the maps and
          air-yard numbers cover those games only. Ranks compare teams on whatever each had charted.
        </p>
      )}
      <div className={c.tiles}>
        <Tile k="Avg. depth of throw" v={p1(O.adot)} sub={rk(O.adotRk, n)} />
        <Tile k="YAC per catch" v={p1(O.yacPer)} sub={rk(O.yacPerRk, n)} />
        <Tile k="Deep shots (20+)" v={pc(O.deep)} sub={rk(O.deepRk, n)} />
        <Tile k="Shotgun" v={pc(O.sg)} sub={rk(O.sgRk, n)} />
        <Tile k="No-huddle" v={pc(O.nh)} sub={rk(O.nhRk, n)} />
        <Tile k="QB pressured" v={pc(O.press)} sub={O.pressRk ? `${rk(O.pressRk, n)} (1st = most)` : ""} />
        <Tile k="Defense: pressure rate" v={pc(D.press)} sub={rk(D.pressRk, n)} />
        <Tile k="Defense: YAC allowed" v={p1(D.yacPer)} sub={D.yacPerRk ? `${rk(D.yacPerRk, n)} (1st = most)` : ""} />
      </div>
      <div className={c.wrap} style={{ marginBottom: 22 }}>
        <PassMap c={O.pass} title="Offense: where it throws" noun="throws" />
        <PassMap c={D.pass} title="Defense: where it's thrown on" noun="throws" />
      </div>
      <div className={c.wrap}>
        <RunDir r={O.rush} title="Offense: run direction" />
        <RunDir r={D.rush} title="Defense: runs faced" />
      </div>
      <p className="note" style={{ marginTop: 12 }}>
        Pressure = the QB was hurried or sacked, as the play-by-play records it (it misses some, so compare teams rather than reading it as an exact rate).
        Every snap counts, including garbage time and FCS games.
      </p>
    </section>
  );
}
