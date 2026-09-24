import type { Metadata } from "next";
import { getHub } from "@/lib/data";
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
  const hub = await getHub();
  const logos = Object.fromEntries(hub.teams.map((t) => [t.id, t.logo]));
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">{hub.season} Season · {hub.slateLabel || "Final"}</div>
        <h1 className="page-h1">FBS Power Rankings</h1>
        <p className="page-sub">
          Every FBS team rated in points: how much it would beat an average FBS team by on a neutral field. The rating
          adjusts for opponent, dampens blowouts, and leans on last season early on. That lean fades with every game played.
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
        <Slate games={hub.slate} logos={logos} />
      </section>

      <section id="rankings" className={styles.section}>
        <div className="sec-h"><h2>Rankings</h2><p>Click a column to sort</p></div>
        <Rankings teams={hub.teams} hasAdvanced={hub.hasAdvanced} />
        <p className="note">
          <b>How the rating works.</b> Each game&apos;s points are modelled as offense against the opposing defense, with{" "}
          {fmt(hub.hfa, 1)} points of home field solved from the data. Margins past 24 count only 35%, so a 63–7 cupcake win
          can&apos;t set a ranking. FCS opponents are pooled into one team. Until a team has played a few games, its rating stays
          close to its preseason number (last season&apos;s final rating, pulled 40% toward average).
        </p>
      </section>
    </div>
  );
}
