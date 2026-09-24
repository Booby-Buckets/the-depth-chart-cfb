import type { Metadata } from "next";
import { getTeamIndex } from "@/lib/data";
import TeamDirectory from "@/components/team/TeamDirectory";

export const metadata: Metadata = {
  title: "FBS Teams",
  description: "All 138 FBS programs grouped by conference and ordered by TDC power rating.",
  alternates: { canonical: "/teams" },
};

export default async function TeamsPage() {
  const { hub, slugOf } = await getTeamIndex();
  const byConf = new Map<string, typeof hub.teams>();
  for (const t of hub.teams) byConf.set(t.conf, [...(byConf.get(t.conf) || []), t]);
  const avg = (c: string) => byConf.get(c)!.reduce((s, t) => s + t.net, 0) / byConf.get(c)!.length;
  const confs = [...byConf.keys()].sort((a, b) => avg(b) - avg(a)).map((c) => ({
    conf: c,
    teams: byConf.get(c)!.sort((a, b) => a.rank - b.rank).map((t) => ({
      slug: slugOf.get(t.id)!, name: t.name, full: t.full, abbr: t.abbr, logo: t.logo, rank: t.rank, w: t.w, l: t.l, net: t.net,
    })),
  }));
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">{hub.season} Season</div>
        <h1 className="page-h1">FBS Teams</h1>
        <p className="page-sub">
          All {hub.teams.length} FBS programs, grouped by conference and ordered by TDC Rating. Conferences run strongest to weakest by average rating.
        </p>
      </header>
      <TeamDirectory confs={confs} />
    </div>
  );
}
