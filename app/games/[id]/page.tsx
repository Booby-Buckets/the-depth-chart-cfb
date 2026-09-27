import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHub, getTeamIndex } from "@/lib/data";
import LiveGameView from "@/components/live/LiveGameView";

export const dynamicParams = true;
export async function generateStaticParams() { return []; }   // any game id renders on demand

export async function generateMetadata({ params }: PageProps<"/games/[id]">): Promise<Metadata> {
  const { id } = await params;
  const hub = await getHub();
  const g = hub.slate.find((x) => x.id === id);
  return {
    title: g ? `${g.awayName} at ${g.homeName} · Live` : "Live game",
    description: "Live score, win probability from the TDC model, play-by-play, scoring plays and team stats.",
    alternates: { canonical: `/games/${id}` },
  };
}

/** A live (or finished) game: the page shell is static, everything live is polled client-side. */
export default async function GamePage({ params }: PageProps<"/games/[id]">) {
  const { id } = await params;
  if (!/^\d{6,12}$/.test(id)) notFound();
  const [hub, idx] = await Promise.all([getHub(), getTeamIndex()]);
  const g = hub.slate.find((x) => x.id === id);
  // pregame spread: this week's slate line, else rating gap + home field (neutral sites unknown here)
  const nets = Object.fromEntries(hub.teams.map((t) => [t.id, t.net]));
  const slugs = Object.fromEntries([...idx.slugOf.entries()]);
  return (
    <div className="col">
      <LiveGameView id={id} slateSpread={g ? g.spread : null} neutral={g?.neutral ?? false} nets={nets} hfa={hub.hfa} slugs={slugs} />
    </div>
  );
}
