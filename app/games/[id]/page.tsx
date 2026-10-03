import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHub, getTeamIndex } from "@/lib/data";
import LiveGameView, { type LiveGame } from "@/components/live/LiveGameView";
import { loadGame } from "@/lib/livegame";

export const dynamicParams = true;
export async function generateStaticParams() { return []; }   // any game id renders on demand

export async function generateMetadata({ params }: PageProps<"/games/[id]">): Promise<Metadata> {
  const { id } = await params;
  const hub = await getHub();
  const g = hub.slate.find((x) => x.id === id);
  let title = g ? `${g.awayName} at ${g.homeName}` : "Game tracker";
  if (!g && /^\d{6,12}$/.test(id)) {
    const G = await loadGame(id, 60).catch(() => null);   // same cached fetch the page uses
    const h = G?.teams.find((t: { home: boolean }) => t.home), a = G?.teams.find((t: { home: boolean }) => !t.home);
    if (h && a) title = G!.state === "post" ? `${a.name} ${a.score}, ${h.name} ${h.score} (Final)` : `${a.name} at ${h.name}`;
  }
  return {
    title: `${title} · Game tracker`,
    description: "Game tracker: live situation and field, current drive, player box score, line score, the lead over time, every score and drive, win probability from the TDC model, team stats and play-by-play.",
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
  // first paint from the server (no blank "Loading" while the browser fetches); the page then polls
  const initial = (await loadGame(id, 10).catch(() => null)) as LiveGame | null;
  return (
    <div className="col">
      <LiveGameView id={id} slateSpread={g ? g.spread : null} neutral={g?.neutral ?? false} nets={nets} hfa={hub.hfa} slugs={slugs} season={hub.season} initial={initial} />
    </div>
  );
}
