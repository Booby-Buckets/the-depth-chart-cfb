import type { Metadata } from "next";
import Link from "next/link";
import { getProps, getTeamIndex } from "@/lib/data";
import PropBoard from "@/components/betting/PropBoard";
import s from "@/components/betting/betting.module.css";

export const metadata: Metadata = {
  title: "Player Props: Projections",
  description: "Projections for this week's FBS player props (passing, rushing and receiving yards, receptions, passing TDs, anytime TD) with over/under chances at any line and each player's hit rate.",
  alternates: { canonical: "/betting/props" },
};

export default async function PropsPage() {
  const [P, { hub }] = await Promise.all([getProps(), getTeamIndex()]);
  const teams = Object.fromEntries(hub.teams.map((t) => [t.id, { name: t.name, abbr: t.abbr, logo: t.logo }]));
  for (const g of P.games) for (const [id, n] of [[g.home, g.homeName], [g.away, g.awayName]]) teams[id] ??= { name: n, abbr: n, logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` };
  const nLines = Object.keys(P.lines).length;
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">{P.season} Season{P.slateLabel ? ` · ${P.slateLabel}` : ""}</div>
        <h1 className="page-h1">Player Props</h1>
        <div className={s.tabs}><Link className="chip" href="/betting">Game lines</Link><span className="chip on">Player props</span></div>
        <p className="page-sub">
          Our projection for every player with a real role in this week&apos;s games: a recency-weighted average of this season&apos;s games
          (pulled toward last season early on), adjusted for what the opponent&apos;s defense has allowed and for our game-script numbers
          (implied team points from the spread and total). Set any line with − / + to see the chance of the over and how often the player
          has cleared it this season. {nLines ? `${nLines} sportsbook lines are shown where available.` : "Sportsbook prop lines aren't connected yet, so each row starts at a line near our projection."}
        </p>
      </header>
      <PropBoard data={P} teams={teams} />
      <p className="note">
        Tested on every 2025 game, projecting each from only the games before it. Our projections missed by less than a plain season
        average, and the over/under chances were checked against how often players actually went over. Injuries and depth-chart
        changes aren&apos;t in the numbers, so check who&apos;s playing. For information and entertainment; bet responsibly
        (<a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">1-800-GAMBLER</a>).
      </p>
    </div>
  );
}
