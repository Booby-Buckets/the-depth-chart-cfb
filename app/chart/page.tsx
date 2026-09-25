import type { Metadata } from "next";
import { getHub } from "@/lib/data";
import ChartTool from "@/components/charttool/ChartTool";

export const metadata: Metadata = {
  title: "Charting Tool",
  description: "Owner-only play charting tool.",
  robots: { index: false, follow: false },
};

/** Tier 2 charting: owner-only (passcode), charts saved to Supabase through /api/chart/*. */
export default async function ChartPage() {
  const hub = await getHub();
  const teams = [...hub.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name, logo: t.logo }));
  return (
    <div className="col">
      <header className="page-head">
        <div className="page-eyebrow">{hub.season} · Owner tool</div>
        <h1 className="page-h1">Charting</h1>
        <p className="page-sub">
          Chart what the play-by-play can&apos;t: where the QB threw from, exactly where the ball went, pressure, play action,
          coverage, routes, run concepts and gaps. Pick a team and a game; plays load pre-filled from ESPN.
        </p>
      </header>
      <ChartTool teams={teams} />
    </div>
  );
}
