import type { Metadata } from "next";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getTeamIndex } from "@/lib/data";
import PlayFinder from "@/components/plays/PlayFinder";

export const metadata: Metadata = {
  title: "Play Finder",
  description: "Search every FBS play by team, player, week, down, field position and play type, sorted by expected points added or win probability added.",
  alternates: { canonical: "/plays" },
};

export default async function PlaysPage({ searchParams }: PageProps<"/plays">) {
  const sp = await searchParams;
  const initial = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const { hub } = await getTeamIndex();
  let seasons: number[] = [];
  try {
    seasons = (await readdir(path.join(process.cwd(), "data", "plays"))).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => b - a);
  } catch { seasons = [hub.season]; }
  const teams = hub.teams.map((t) => ({ id: t.id, name: t.name, abbr: t.abbr, logo: t.logo })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">Every FBS play · {seasons.join(" & ")}</div>
        <h1 className="page-h1">Play Finder</h1>
        <p className="page-sub">
          Search every play by team, player, week, down and field position, and sort by what it was worth. EPA (expected points
          added) is how many points a play added to the offense&apos;s expected score, from our own model built on every FBS play since
          2014. WP added is how much it moved the offense&apos;s chance of winning.
        </p>
      </header>
      <PlayFinder seasons={seasons} current={hub.season} teams={teams} initial={initial} />
    </div>
  );
}
