import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPastSeasons, getSeasonTeamIndex, getSeasonTeam, getSeasonPlayers } from "@/lib/data";
import TeamView from "@/components/team/TeamView";

export async function generateStaticParams() {
  const years = await getPastSeasons();
  const out: { year: string; slug: string }[] = [];
  for (const y of years) {
    const { slugOf } = await getSeasonTeamIndex(y);
    for (const slug of slugOf.values()) out.push({ year: String(y), slug });
  }
  return out;
}
export const dynamicParams = false;

async function resolve(yearStr: string, slug: string) {
  const y = Number(yearStr);
  if (!(await getPastSeasons()).includes(y)) notFound();
  const idx = await getSeasonTeamIndex(y);
  const t = idx.bySlug.get(slug);
  if (!t) notFound();
  return { y, idx, t };
}

export async function generateMetadata({ params }: PageProps<"/seasons/[year]/teams/[slug]">): Promise<Metadata> {
  const { year, slug } = await params;
  const { t } = await resolve(year, slug);
  return {
    title: `${year} ${t.full}`,
    description: `${t.full} in ${year}: ${t.w}-${t.l}, final TDC rank #${t.rank}, results with game scores, rating by week, team stats and every player's season.`,
    alternates: { canonical: `/seasons/${year}/teams/${slug}` },
  };
}

export default async function PastTeamPage({ params }: PageProps<"/seasons/[year]/teams/[slug]">) {
  const { year, slug } = await params;
  const { y, idx, t } = await resolve(year, slug);
  const [D, PL] = await Promise.all([getSeasonTeam(y, t.id), getSeasonPlayers(y, t.id).catch(() => null)]);
  return <TeamView D={D} players={PL?.players ?? null} hubTeams={idx.hub.teams} hubBuilt={idx.hub.built} slugOf={idx.slugOf} slug={slug} season={y}
    pbpDefense={idx.hub.defenseFrom === "play-by-play"} />;
}
