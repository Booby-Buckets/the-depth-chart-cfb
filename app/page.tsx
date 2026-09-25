import type { Metadata } from "next";
import { getPastSeasons, getTeamIndex } from "@/lib/data";
import SeasonPicker from "@/components/SeasonPicker";
import { fmt, etStamp } from "@/lib/format";
import Slate from "@/components/home/Slate";
import Rankings from "@/components/home/Rankings";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: { absolute: "FBS Power Rankings — The Depth Chart CFB" },
  description: "Opponent-adjusted college football power ratings for all 138 FBS teams, offense and defense splits, and projected spreads for every game this week.",
  alternates: { canonical: "/" },
};

export default async function Home() {
  const [{ hub, slugOf }, years] = await Promise.all([getTeamIndex(), getPastSeasons()]);
  const logos = Object.fromEntries(hub.teams.map((t) => [t.id, t.logo]));
  const slugs = Object.fromEntries(slugOf);
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{hub.season} Season · {hub.slateLabel || "Final"}</span>
          {years.length > 0 && <SeasonPicker years={years} current={null} basePath="/seasons" />}
        </div>
        <h1 className="page-h1">FBS Power Rankings</h1>
        <p className="page-sub">
          Every FBS team rated in points: how much it would beat an average FBS team by on a neutral field. The rating
          adjusts for opponent, reads the play-by-play as well as the score, and starts from a preseason projection that
          fades with every game played.
        </p>
        <div className="meta">
          <div>FBS teams<b>{hub.teams.length}</b></div>
          <div>Games rated<b>{hub.gamesPlayed}</b></div>
          <div>Home field<b>{fmt(hub.hfa, 1)} pts</b></div>
          <div>Updated<b>{etStamp(hub.built)}</b></div>
        </div>
      </header>

      <section id="slate" className={styles.section}>
        <div className="sec-h">
          <h2>{hub.slateLabel ? `This Week · ${hub.slateLabel}` : "This Week"}</h2>
          <p>Projected spread and win probability from the TDC Rating</p>
        </div>
        <Slate games={hub.slate} logos={logos} slugs={slugs} />
      </section>

      <section id="rankings" className={styles.section}>
        <div className="sec-h"><h2>Rankings</h2><p>Click a column to sort</p></div>
        <Rankings teams={hub.teams} hasAdvanced={hub.hasAdvanced} slugs={slugs} />
        <p className="note">
          <b>How the rating works.</b> Each game&apos;s points are modelled as offense against the opposing defense, with{" "}
          {fmt(hub.hfa, 1)} points of home field solved from the data. A game counts 70% on the final score and 30% on the
          score its play-by-play says it should have been (success rate, yards per play, explosive plays, turnovers; garbage
          time dropped), which takes some of the luck out. Every FCS opponent gets its own rating from its own games. The
          preseason rating projects each team from its last two seasons, how much production returns (the quarterback
          most of all) and what transfers bring in, and it fades as games are played. Tested week by week on every game
          since 2019, predicting each week from only the games before it, the spread misses the final margin by 12.6
          points on average. The closing betting line misses by 12.2.
        </p>
      </section>
    </div>
  );
}
