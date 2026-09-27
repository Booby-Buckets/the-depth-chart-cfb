import type { Metadata } from "next";
import Link from "next/link";
import { getAwards, getTeamIndex } from "@/lib/data";
import { playerHref } from "@/lib/slug";
import { logo } from "@/lib/logo";
import s from "./awards.module.css";

export const metadata: Metadata = {
  title: "Award Projections",
  description: "Heisman Trophy odds from a model trained on every winner since 2014, plus projected leaders for the Davey O'Brien, Doak Walker, Biletnikoff, Mackey, Butkus, Thorpe, Nagurski, Groza and Ray Guy awards.",
  alternates: { canonical: "/awards" },
};

export default async function AwardsPage() {
  const [A, idx] = await Promise.all([getAwards(), getTeamIndex()]);
  const logos = Object.fromEntries(idx.hub.teams.map((t) => [t.id, t.logo]));
  const max = Math.max(...A.heisman.map((x) => x.p || 0), 0.01);
  const who = (x: (typeof A.heisman)[number]) => (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo(logos[x.tid], 22)} alt="" loading="lazy" />
      <span className={s.nm}>
        <Link href={playerHref(x.name, x.id)}>{x.name}</Link>
        <small>{x.pos}{x.cls ? ` · ${x.cls}` : ""} · {idx.slugOf.get(x.tid) ? <Link href={`/teams/${idx.slugOf.get(x.tid)}`}>{x.team}</Link> : x.team} {x.rank <= 25 ? `#${x.rank} ` : ""}({x.rec})</small>
      </span>
    </>
  );
  return (
    <div className="col">
      <header className="page-head">
        <div className="page-eyebrow">{A.season} Season · {A.gamesPlayed} games in</div>
        <h1 className="page-h1">Award Projections</h1>
        <p className="page-sub">Who&apos;s on track to win college football&apos;s biggest awards, updated after every game day.</p>
      </header>

      <section className={s.hero}>
        <div className="sec-h"><h2>Heisman Trophy</h2><p>Chance to win, from our model of every Heisman vote since 2014</p></div>
        <div className={s.hlist}>
          {A.heisman.map((x, i) => (
            <div key={x.id} className={s.hrow}>
              <span className={s.rk}>{i + 1}</span>
              {who(x)}
              <span className={s.bar}><i style={{ width: `${((x.p || 0) / max) * 100}%` }} /></span>
              <b className={s.pct}>{((x.p || 0) * 100).toFixed((x.p || 0) < 0.1 ? 1 : 0)}%</b>
              <span className={s.line}>{x.line}</span>
            </div>
          ))}
        </div>
        <p className="note">
          <b>How it works.</b> A model trained on the 2014–2025 races learned what Heisman voters reward: passing and total touchdowns,
          yards, few interceptions, a full season, a winning power-conference team high in the rankings. Tested on each season it
          didn&apos;t train on, it picked the eventual winner first in 8 of 12 years and in its top three in 10 (it can&apos;t see a
          two-way season like Travis Hunter&apos;s). For this season, each contender&apos;s remaining games are simulated 1,500 times around
          his current pace, with his team&apos;s record drawn from our record odds, and the odds are spread out early in the year,
          when most of the race is still to be played.
        </p>
      </section>

      <div className={s.grid}>
        {A.awards.map((a) => (
          <section key={a.key} className={s.card}>
            <h3>{a.name}<span>{a.for}</span></h3>
            {a.list.map((x, i) => (
              <div key={x.id} className={s.row}>
                <span className={s.rk}>{i + 1}</span>
                {who(x)}
                <span className={s.mini}><i style={{ width: `${Math.max(6, (x.rel || 0) * 100)}%` }} /></span>
                <span className={s.line2}>{x.line.replace(/^\d+ G · /, "")}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="note">
        The position awards have no voting history in our data, so they rank each position&apos;s leaders by a stat composite: per-game
        production scored against everyone else at the position, plus a small bump for winning teams. The bar shows how close each
        player is to the leader.
      </p>
    </div>
  );
}
