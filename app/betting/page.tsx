import type { Metadata } from "next";
import Link from "next/link";
import { getBetting, getTeamIndex, type WL } from "@/lib/data";
import BetBoard from "@/components/betting/BetBoard";
import TeamAtsTable from "@/components/betting/TeamAtsTable";
import LineCalc from "@/components/betting/LineCalc";
import s from "@/components/betting/betting.module.css";

export const metadata: Metadata = {
  title: "Betting: Model vs. the Line",
  description: "This week's FBS games with our model's spread and total next to the betting line, the model's full record against the spread since 2015, and every team's ATS and over/under record.",
  alternates: { canonical: "/betting" },
};

const pct = (w: WL) => (w[2] == null ? "—" : (w[2] * 100).toFixed(1) + "%");
const rec = (w: WL) => `${w[0].toLocaleString()}–${w[1].toLocaleString()}`;
const BREAK_EVEN = 0.524;   // win rate needed to profit at standard -110 odds

export default async function BettingPage() {
  const [B, { hub, slugOf }] = await Promise.all([getBetting(), getTeamIndex()]);
  const R = B.record, O = B.open;
  const seasons = Object.keys(R.seasons).map(Number).sort((a, b) => b - a);
  const cur = R.seasons[B.season];
  const teams = Object.fromEntries(hub.teams.map((t) => [t.id, { name: t.name, abbr: t.abbr, logo: t.logo, slug: slugOf.get(t.id) ?? null, conf: t.conf }]));
  const calcTeams = hub.teams.map((t) => ({ id: t.id, name: t.name, net: t.net, off: t.off, def: t.def })).sort((a, b) => a.name.localeCompare(b.name));
  const heat = (w: WL) => (w[2] == null ? "" : w[2] >= BREAK_EVEN ? "c4" : w[2] >= 0.5 ? "c2" : "c0");

  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">{B.season} Season{B.slateLabel ? ` · ${B.slateLabel}` : ""}</div>
        <h1 className="page-h1">Betting: Model vs. the Line</h1>
        <div className={s.tabs}><span className="chip on">Game lines</span><Link className="chip" href="/betting/props">Player props</Link></div>
        <p className="page-sub">
          Our power-rating model&apos;s spread and total for every game next to the market&apos;s, graded honestly. The short version:
          against the <b>closing</b> line (the number at kickoff) the model is a coin flip, but against the <b>opening</b> line it has won when it
          disagrees by 4+ points, and the market has tended to move toward our number during the week. Timing is the edge: by
          kickoff the market has usually caught up.
        </p>
      </header>

      <div className={s.tiles}>
        {O.ats4[0] + O.ats4[1] > 0 && <div className={`${s.tile} ${s.hi}`}><div className={s.k}>Vs. the opener, 4+ pt gap</div><div className={s.v}>{pct(O.ats4)}</div><div className={s.sub}>{rec(O.ats4)} regular season since {O.since}</div></div>}
        {O.clv[2] != null && <div className={s.tile}><div className={s.k}>Line moved toward us</div><div className={s.v}>{pct(O.clv)}</div><div className={s.sub}>{rec(O.clv)} games where it moved after opening</div></div>}
        <div className={s.tile}><div className={s.k}>Vs. the close, since {seasons[seasons.length - 1]}</div><div className={s.v}>{pct(R.all.ats)}</div><div className={s.sub}>{rec(R.all.ats)}: no edge once the market settles</div></div>
        {cur && <div className={s.tile}><div className={s.k}>{B.season} vs. opener, 4+ gap</div><div className={s.v}>{O.plus4[B.season] ? pct(O.plus4[B.season]) : "—"}</div><div className={s.sub}>{O.plus4[B.season] ? rec(O.plus4[B.season]) : ""} · vs. close {pct(cur.ats)} overall</div></div>}
        <div className={s.tile}><div className={s.k}>Break-even</div><div className={s.v}>52.4%</div><div className={s.sub}>what it takes to profit at standard −110 odds</div></div>
      </div>

      <section className={s.section} id="board">
        <div className="sec-h"><h2>This Week&apos;s Board</h2><p>Our line vs. the market&apos;s opening and current consensus (median across sportsbooks, from ESPN), sorted by the gap to the opener</p></div>
        <BetBoard rows={B.board} teams={teams} totBias={B.totBias ?? 0} />
      </section>

      <section className={s.section} id="record">
        <div className="sec-h"><h2>Model Track Record</h2><p>Every FBS-vs-FBS game, graded against the final score. Each model line is what the model said that week, using only games already played</p></div>
        <h3 className={s.h3}>Against the opening line (regular season, {O.since} on)</h3>
        <div className={s.two}>
          <div className="sheet-wrap">
            <table className="sheet dense" style={{ width: "100%" }}>
              <thead><tr><th className="l">Model vs. opener gap</th><th>ATS</th><th>Cover %</th><th>O/U (total gap)</th><th>Hit %</th></tr></thead>
              <tbody>
                {O.buckets.map((b) => (
                  <tr key={b.lo}>
                    <td className="l strong">{b.hi > 50 ? `${b.lo}+ pts` : `${b.lo}–${b.hi} pts`}</td>
                    <td>{rec(b.ats)}</td><td className={heat(b.ats)}>{pct(b.ats)}</td>
                    <td>{rec(b.ou)}</td><td className={heat(b.ou)}>{pct(b.ou)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Here bigger disagreements <b>do</b> win more often. Totals are graded net of the model&apos;s average total gap the season before.</p>
          </div>
          <div className="sheet-wrap">
            <table className="sheet dense" style={{ width: "100%" }}>
              <thead><tr><th className="l">Season</th><th>4+ pt gap vs. opener</th><th>Cover %</th></tr></thead>
              <tbody>
                {Object.entries(O.plus4).sort((a, b) => Number(b[0]) - Number(a[0])).map(([y, w]) => (
                  <tr key={y}><td className="l strong">{y}{Number(y) === B.season ? " (so far)" : ""}</td><td>{rec(w)}</td><td className={heat(w)}>{pct(w)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              Three-plus seasons is a real but small sample ({O.n.toLocaleString()} games; ESPN only keeps opening lines from {O.since}). Treat it as
              promising, not proven. The model&apos;s settings were tuned on 2021–2025 games, so {B.season} is the cleanest test.
            </p>
          </div>
        </div>

        <h3 className={s.h3}>Against the closing line (since {seasons[seasons.length - 1]})</h3>
        <div className={s.two}>
          <div className="sheet-wrap">
            <table className="sheet dense" style={{ width: "100%" }}>
              <thead><tr><th className="l">Model vs. line gap</th><th>ATS</th><th>Cover %</th><th>O/U (total gap)</th><th>Hit %</th></tr></thead>
              <tbody>
                {R.buckets.map((b) => (
                  <tr key={b.lo}>
                    <td className="l strong">{b.hi > 50 ? `${b.lo}+ pts` : `${b.lo}–${b.hi} pts`}</td>
                    <td>{rec(b.ats)}</td><td className={heat(b.ats)}>{pct(b.ats)}</td>
                    <td>{rec(b.ou)}</td><td className={heat(b.ou)}>{pct(b.ou)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Bigger gaps have <b>not</b> covered more often. When the model and the market disagree by a touchdown, the market has usually been right.</p>
          </div>
          <div className="sheet-wrap">
            <table className="sheet dense" style={{ width: "100%" }}>
              <thead><tr><th className="l">Season</th><th>ATS</th><th>Cover %</th><th title="Games where the model and the line differed by 3+ points">3+ pt gaps</th><th>O/U %</th><th title="Average miss on the final margin: our model vs. the closing line">Miss: model / line</th></tr></thead>
              <tbody>
                {seasons.map((y) => {
                  const x = R.seasons[y];
                  return (
                    <tr key={y}>
                      <td className="l strong">{y}{y === B.season ? " (so far)" : ""}</td>
                      <td>{rec(x.ats)}</td><td className={heat(x.ats)}>{pct(x.ats)}</td><td className={heat(x.ats3)}>{pct(x.ats3)}</td>
                      <td className={heat(x.ou)}>{pct(x.ou)}</td><td>{x.mae.toFixed(1)} / {x.maeLine?.toFixed(1) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">The line misses the final margin by less than our model every season. That&apos;s the market&apos;s edge: it prices in news the ratings can&apos;t see.</p>
          </div>
        </div>
      </section>

      <section className={s.section} id="teams">
        <div className="sec-h"><h2>Team ATS &amp; Over/Under</h2><p>Every FBS team&apos;s record against the closing spread and total. Pushes shown after the dash</p></div>
        <TeamAtsTable data={B.teams} teams={teams} seasons={Object.keys(B.teams).map(Number).sort((a, b) => b - a)} />
      </section>

      <section className={s.section} id="calc">
        <div className="sec-h"><h2>Line Calculator</h2><p>Any two FBS teams, at either site or neutral: our current spread, total and win probability</p></div>
        <LineCalc teams={calcTeams} hfa={hub.hfa} ptsAvg={hub.ptsAvg} />
      </section>

      <p className="note">
        For information and entertainment. Nothing here is a recommendation to bet. If you do, bet only what you can afford to lose.
        Problem gambling help: <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">1-800-GAMBLER</a>.
        Model details: <Link href="/">power rankings</Link> and each game&apos;s <Link href="/#slate">tracker</Link>.
      </p>
    </div>
  );
}
