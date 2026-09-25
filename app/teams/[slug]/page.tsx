import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTeamIndex, getTeam, getTeamPlayers } from "@/lib/data";
import TeamView from "@/components/team/TeamView";
import ProgramHistory from "@/components/team/ProgramHistory";

// every FBS team is prerendered at build time
export async function generateStaticParams() {
  const { slugOf } = await getTeamIndex();
  return [...slugOf.values()].map((slug) => ({ slug }));
}
export const dynamicParams = true; // unknown slugs fall through to the checks below (numeric ids redirect, the rest 404)

async function resolve(slug: string) {
  const idx = await getTeamIndex();
  if (/^\d+$/.test(slug) && idx.slugOf.has(slug)) permanentRedirect(`/teams/${idx.slugOf.get(slug)}`); // /teams/87 -> /teams/notre-dame
  const t = idx.bySlug.get(slug);
  if (!t) notFound();
  return { idx, t };
}

export async function generateMetadata({ params }: PageProps<"/teams/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { t } = await resolve(slug);
  return {
    title: t.full,
    description: `${t.full}: TDC power rating (#${t.rank} of FBS), ${t.w}-${t.l} record, schedule with projected lines, record odds, team stats ranked across FBS, roster and program history.`,
    alternates: { canonical: `/teams/${slug}` },
  };
}

export default async function TeamPage({ params }: PageProps<"/teams/[slug]">) {
  const { slug } = await params;
  const { idx, t } = await resolve(slug);
  const [D, PL] = await Promise.all([getTeam(t.id), getTeamPlayers(t.id).catch(() => null)]);
  return (
    <TeamView D={D} players={PL?.players ?? null} hubTeams={idx.hub.teams} hubBuilt={idx.hub.built} slugOf={idx.slugOf} slug={slug} season={null}>
      <ProgramHistory teamId={t.id} teamName={t.name} slug={slug} current={{ season: idx.hub.season, row: t }} />
    </TeamView>
  );
}
