import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPastSeasons, getSeasonTeamIndex } from "@/lib/data";
import { fmt } from "@/lib/format";
import Rankings from "@/components/home/Rankings";
import SeasonPicker from "@/components/SeasonPicker";

export async function generateStaticParams() {
  return (await getPastSeasons()).map((y) => ({ year: String(y) }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/seasons/[year]">): Promise<Metadata> {
  const { year } = await params;
  return {
    title: `${year} FBS Power Rankings`,
    description: `Final ${year} college football power ratings for every FBS team: opponent-adjusted rating, offense and defense, record and strength of schedule.`,
    alternates: { canonical: `/seasons/${year}` },
  };
}

export default async function SeasonPage({ params }: PageProps<"/seasons/[year]">) {
  const y = Number((await params).year);
  const years = await getPastSeasons();
  if (!years.includes(y)) notFound();
  const { hub, slugOf } = await getSeasonTeamIndex(y);
  const top = hub.teams[0];
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{y} Season · Final</span><SeasonPicker years={years} current={y} basePath="/seasons" />
        </div>
        <h1 className="page-h1">{y} FBS Power Rankings</h1>
        <p className="page-sub">
          Final ratings for all {hub.teams.length} FBS teams, built with the same opponent-adjusted model as this season. #1: {top.name} ({top.w}-{top.l}, {fmt(top.net, 1, true)}).
        </p>
        <div className="meta">
          <div>FBS teams<b>{hub.teams.length}</b></div>
          <div>Games rated<b>{hub.gamesPlayed}</b></div>
          <div>Home field<b>{fmt(hub.hfa, 1)} pts</b></div>
          <div>Leaders<b><Link href={`/seasons/${y}/players`}>{y} players →</Link></b></div>
        </div>
      </header>
      <section style={{ padding: "28px 0 8px" }}>
        <div className="sec-h"><h2>Final Rankings</h2><p>Click a team for its {y} season</p></div>
        <Rankings teams={hub.teams} hasAdvanced={false} slugs={Object.fromEntries(slugOf)} teamBase={`/seasons/${y}/teams`} />
      </section>
    </div>
  );
}
