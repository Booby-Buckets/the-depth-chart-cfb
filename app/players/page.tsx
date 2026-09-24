import type { Metadata } from "next";
import { getLeaders, getTeamIndex } from "@/lib/data";
import Leaderboards from "@/components/players/Leaderboards";
import PlayerSearch from "@/components/players/PlayerSearch";

export const metadata: Metadata = {
  title: "FBS Player Leaders",
  description: "Search every FBS player and browse national leaderboards: passing, rushing, receiving, defense and EPA per play by position.",
  alternates: { canonical: "/players" },
};

export default async function PlayersPage() {
  const [L, { hub, slugOf }] = await Promise.all([getLeaders(), getTeamIndex()]);
  const teams = Object.fromEntries(hub.teams.map((t) => [t.id, { slug: slugOf.get(t.id)!, logo: t.logo, name: t.name, abbr: t.abbr, rank: t.rank }]));
  const confs = [...new Set(hub.teams.map((t) => t.conf))].sort();
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">{L.season} Season · FBS Players</div>
        <h1 className="page-h1">Player Leaders</h1>
        <p className="page-sub">
          Search any FBS player, or browse the national leaders. EPA per play (expected points added) measures how much each snap a
          player is part of moves the team&apos;s expected score. It&apos;s ranked within position, since a receiver&apos;s catches and a
          quarterback&apos;s dropbacks aren&apos;t the same job.
        </p>
        <PlayerSearch teams={teams} />
      </header>
      {/* the passing board is rendered on the server (real HTML for search engines); the others load on demand */}
      <Leaderboards initialBoard="passing" initialRows={L.boards.passing} groupMin={L.groupMin} teams={teams} confs={confs} />
    </div>
  );
}
