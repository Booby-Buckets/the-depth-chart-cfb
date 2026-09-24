import type { Metadata } from "next";
import Link from "next/link";
import { getRecruiting, getTeamIndex, type RecruitRow } from "@/lib/data";
import { logo } from "@/lib/logo";
import { playerHref } from "@/lib/slug";
import ClassRankings from "@/components/recruiting/ClassRankings";
import RecruitList from "@/components/recruiting/RecruitList";
import s from "./recruiting.module.css";

export const metadata: Metadata = {
  title: "2026 Recruiting Class",
  description: "Every FBS team's 2026 recruiting class ranked, and what the freshmen are actually doing: games played, starts, estimated snaps and stats, next to their recruiting rank.",
  alternates: { canonical: "/recruiting" },
};

export default async function RecruitingPage() {
  const [R, { hub, slugOf }] = await Promise.all([getRecruiting(), getTeamIndex()]);
  const teams = Object.fromEntries(hub.teams.map((t) => [t.id, { slug: slugOf.get(t.id)!, name: t.name, logo: t.logo, conf: t.conf }]));
  const confs = [...new Set(hub.teams.map((t) => t.conf))].sort();
  const C = R.counts;
  // freshmen getting real work: estimated snaps, starts break ties
  const impact = R.recruits.filter((r) => r.es && r.esTP).sort((a, b) => (b.es! - a.es!) || (b.gs - a.gs)).slice(0, 24);
  const pctOf = (r: RecruitRow) => Math.round((r.es! / r.esTP!) * 100);
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">Class of {R.classYear} · Signed and playing</div>
        <h1 className="page-h1">{R.classYear} Recruiting Class</h1>
        <p className="page-sub">
          Every FBS team&apos;s {R.classYear} class, ranked from the 247Sports composite ratings, next to what the freshmen are
          doing on the field: games, starts and estimated snaps from every play of the season.
        </p>
        <div className="meta">
          <div>FBS signees<b>{C.signees.toLocaleString()}</b></div>
          <div>On a roster<b>{C.onFile.toLocaleString()}</b></div>
          <div>Have played<b>{C.played}</b></div>
          <div>Have started<b>{C.started}</b></div>
        </div>
      </header>

      <section className={s.section}>
        <div className="sec-h"><h2>Freshmen Making an Impact</h2><p>{R.classYear} signees with the most estimated snaps this season</p></div>
        <div className={s.impact}>
          {impact.map((r) => (
            <Link key={r.id} href={playerHref(r.name2 || r.name, r.id!)} className={s.card}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo(teams[r.tid]?.logo, 28)} alt="" />
              <div>
                <b>{r.name2 || r.name}</b>
                <span>{r.pos} · {teams[r.tid]?.name} · {"★".repeat(r.stars || 0)}{r.rank ? ` #${r.rank}` : ""}</span>
                <span>{r.line}</span>
              </div>
              <div className={s.v}>
                {pctOf(r)}%<small>{r.gs ? `${r.gs} GS · ` : ""}~{r.es} snaps</small>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <div className="sec-h"><h2>Class Rankings</h2><p>TDC class score: a Gaussian-weighted sum of signee ratings, so the best signees count most. Click a column to sort</p></div>
        <ClassRankings rows={R.teams} teams={teams} confs={confs} />
      </section>

      <section className={s.section}>
        <div className="sec-h"><h2>Top Recruits</h2><p>National rank, then what each is doing this season</p></div>
        <RecruitList initial={R.recruits.slice(0, 100)} total={R.recruits.length} teams={teams} confs={confs} />
      </section>

      <p className="note">
        Recruiting ranks, stars and ratings are the 247Sports composite via CollegeFootballData.com (high-school signees). Games,
        starts and snaps come from ESPN play-by-play and starting lineups; snaps for non-quarterbacks are estimates (see any depth
        chart for how they work). A signee not on an ESPN or CFBD roster yet (redshirting, or listed under a different name)
        shows no production.
      </p>
    </div>
  );
}
