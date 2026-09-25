import type { Metadata } from "next";
import Link from "next/link";
import { getHub, getPastSeasons, getSeasonHub } from "@/lib/data";
import { fmt } from "@/lib/format";
import { logo } from "@/lib/logo";
import s from "./seasons.module.css";

export const metadata: Metadata = {
  title: "Past Seasons",
  description: "College football power rankings, team pages and player leaderboards for every season since 2014, built with the same model as this season.",
  alternates: { canonical: "/seasons" },
};

export default async function SeasonsPage() {
  const [years, cur] = await Promise.all([getPastSeasons(), getHub()]);
  const hubs = await Promise.all(years.map((y) => getSeasonHub(y)));
  return (
    <div className="col">
      <header className="page-header">
        <div className="page-eyebrow">History</div>
        <h1 className="page-h1">Past Seasons</h1>
        <p className="page-sub">Every season since {years[years.length - 1] ?? "2014"}, rated with the same model as this one: final power rankings, every team&apos;s season, and the player leaderboards.</p>
      </header>
      <section style={{ paddingTop: 22 }}>
        <div className={s.grid}>
          <Link href="/" className={s.card}>
            <div className={s.year}>{cur.season}</div>
            <div className={s.lbl}>This season · {cur.slateLabel || "in progress"}</div>
            <Top3 teams={cur.teams} />
          </Link>
          {hubs.map((h) => (
            <Link key={h.season} href={`/seasons/${h.season}`} className={s.card}>
              <div className={s.year}>{h.season}</div>
              <div className={s.lbl}>Final · {h.teams.length} FBS teams</div>
              <Top3 teams={h.teams} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Top3({ teams }: { teams: { id: string; name: string; logo: string; net: number; w: number; l: number }[] }) {
  return (
    <ol className={s.top}>
      {teams.slice(0, 3).map((t) => (
        <li key={t.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo(t.logo, 20)} alt="" loading="lazy" />{t.name}<span>{t.w}-{t.l} · {fmt(t.net, 1, true)}</span>
        </li>
      ))}
    </ol>
  );
}
