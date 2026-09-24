import type { Metadata } from "next";
import Link from "next/link";
import { getTeamIndex } from "@/lib/data";
import s from "@/components/team/directory.module.css";

export const metadata: Metadata = {
  title: "Depth Charts",
  description: "Every FBS depth chart, built from who actually plays: estimated snap counts, snap share and QB snaps from play-by-play.",
  alternates: { canonical: "/depth" },
};

export default async function DepthIndex() {
  const { hub, slugOf } = await getTeamIndex();
  const byConf = new Map<string, typeof hub.teams>();
  for (const t of hub.teams) byConf.set(t.conf, [...(byConf.get(t.conf) || []), t]);
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">{hub.season} Season</div>
        <h1 className="page-h1">Depth Charts</h1>
        <p className="page-sub">
          Every FBS depth chart, built from who actually plays. Each position is ordered by estimated snaps (QB snaps come
          straight from the play-by-play), with season snap share and its likely range. No guesswork from a preseason list.
        </p>
      </header>
      <section style={{ paddingTop: 18 }}>
        <div className={s.dir}>
          {[...byConf.keys()].sort().map((c) => (
            <div key={c} className={s.conf}>
              <h3>{c}</h3>
              {byConf.get(c)!.sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
                <Link key={t.id} href={`/depth/${slugOf.get(t.id)}`} style={{ gridTemplateColumns: "22px 1fr" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.logo} alt="" loading="lazy" />
                  <span>{t.name}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
