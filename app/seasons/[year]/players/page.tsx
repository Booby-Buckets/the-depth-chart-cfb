import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPastSeasons, getSeasonLeaders, getSeasonTeamIndex } from "@/lib/data";
import Leaderboards from "@/components/players/Leaderboards";
import SeasonPicker from "@/components/SeasonPicker";

export async function generateStaticParams() {
  return (await getPastSeasons()).map((y) => ({ year: String(y) }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/seasons/[year]/players">): Promise<Metadata> {
  const { year } = await params;
  return {
    title: `${year} FBS Player Leaders`,
    description: `${year} college football leaderboards: passing, rushing, receiving and defense for every FBS player.`,
    alternates: { canonical: `/seasons/${year}/players` },
  };
}

export default async function SeasonPlayersPage({ params }: PageProps<"/seasons/[year]/players">) {
  const y = Number((await params).year);
  const years = await getPastSeasons();
  if (!years.includes(y)) notFound();
  const [L, { hub, slugOf }] = await Promise.all([getSeasonLeaders(y), getSeasonTeamIndex(y)]);
  const teams = Object.fromEntries(hub.teams.map((t) => [t.id, { slug: slugOf.get(t.id)!, logo: t.logo, name: t.name, abbr: t.abbr, rank: t.rank }]));
  const confs = [...new Set(hub.teams.map((t) => t.conf))].sort();
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{y} Season · Final</span><SeasonPicker years={years} current={y} basePath="/seasons" suffix="/players" liveHref="/players" />
        </div>
        <h1 className="page-h1">{y} Player Leaders</h1>
        <p className="page-sub">
          Every FBS player&apos;s {y} season, summed from ESPN box scores. EPA isn&apos;t available for past seasons.
          {hub.defenseFrom === "play-by-play" ? ` ESPN’s ${y} box scores are missing most defensive stats, so the defense board is rebuilt from the play-by-play (about 10% below official totals).` : ""}
        </p>
      </header>
      <Leaderboards initialBoard="passing" initialRows={L.boards.passing} groupMin={L.groupMin} teams={teams} confs={confs}
        dataUrl={`/data/seasons/${y}/players/leaders.json`} noEpa hasChart={!!L.boards.qbchart} teamBase={`/seasons/${y}/teams`} />
    </div>
  );
}
