import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getTeamIndex, getTeam, getTeamPlayers, type TeamFile, type PlayerLite, type SchedGame } from "@/lib/data";
import { fmt, pct, ord, etStamp } from "@/lib/format";
import { teamColors } from "@/lib/teamColor";
import { playerHref } from "@/lib/slug";
import TeamSwitcher from "@/components/team/TeamSwitcher";
import { RatingChart, RecordOdds } from "@/components/team/Charts";
import Roster from "@/components/team/Roster";
import s from "./team.module.css";

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
    description: `${t.full}: TDC power rating (#${t.rank} of FBS), ${t.w}-${t.l} record, schedule with projected lines, record odds, team stats ranked across FBS, and roster.`,
    alternates: { canonical: `/teams/${slug}` },
  };
}

export default async function TeamPage({ params }: PageProps<"/teams/[slug]">) {
  const { slug } = await params;
  const { idx, t } = await resolve(slug);
  const [D, PL] = await Promise.all([getTeam(t.id), getTeamPlayers(t.id).catch(() => null)]);
  const { meta: M, rating: R, outlook: o } = D;
  const N = D.fbsTeams;

  // heat for game scores: quintiles of the FBS rating distribution
  const nets = idx.hub.teams.map((x) => x.net).sort((a, b) => a - b);
  const netCuts = [0.2, 0.4, 0.6, 0.8].map((p) => nets[Math.floor(p * (nets.length - 1))]);
  const netHeat = (v?: number) => (v == null ? "" : "c" + netCuts.filter((c) => v > c).length);
  const rankHeat = (r: number | null) => (r == null ? "" : "c" + Math.max(0, Math.min(4, 4 - Math.floor((r - 1) / (N / 5)))));
  const teamOptions = [...idx.hub.teams].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ slug: idx.slugOf.get(x.id)!, name: x.name }));

  return (
    <div className={`col ${s.scope}`} style={teamColors(M.color)}>
      <div className={s.hero}>
        <div className={s.band}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.logo} src={M.logo} alt={`${M.name} logo`} />
          <div className={s.id}>
            <div className={s.eyebrow}>{M.conf} · {D.season}</div>
            <h1 className={s.name}>{M.name} {M.mascot || ""}</h1>
            <div className={s.sub}>{[M.coach ? `Head coach ${M.coach}` : null, M.venue].filter(Boolean).join(" · ")}</div>
          </div>
          <div className={s.rec}>
            <b>{R.w}-{R.l}</b>
            <span>{M.confAbbr === "ind" ? "Overall record" : `${R.cw}-${R.cl} in conference`}</span>
            <div><TeamSwitcher current={slug} options={teamOptions} className={s.switch} /></div>
          </div>
        </div>
        <div className={s.tiles}>
          <Tile k="TDC Rank" v={`#${R.rank}`} sub={<>of {N} FBS teams</>} />
          <Tile k="Rating" v={fmt(R.net, 1, true)} sub={<>pts vs avg FBS team</>} />
          <Tile k="Offense" v={fmt(R.off, 1, true)} sub={<><b>{ord(R.offRk)}</b> in FBS</>} />
          <Tile k="Defense" v={fmt(R.def, 1, true)} sub={<><b>{ord(R.defRk)}</b> in FBS</>} />
          <Tile k="Schedule so far" v={fmt(R.sos, 1, true)} sub={R.sosRk ? <><b>{ord(R.sosRk)}</b> toughest</> : <>—</>} />
          <Tile k="Projected" v={`${o.expW.toFixed(1)}-${o.expL.toFixed(1)}`} sub={<>bowl-eligible <b>{pct(o.bowlP)}</b></>} />
        </div>
      </div>
      <nav className={s.jump} aria-label="On this page">
        <a className="chip" href="#outlook">Outlook</a>
        {PL && <a className="chip" href="#leaders">Leaders</a>}
        <a className="chip" href="#schedule">Schedule</a>
        <a className="chip" href="#stats">Team stats</a>
        <a className="chip" href="#roster">Roster</a>
        <Link className="chip" href={`/depth/${slug}`}>Depth chart →</Link>
      </nav>

      <section id="outlook" className={s.section}>
        <div className="sec-h"><h2>Season Outlook</h2><p>From the TDC Rating, updated after every game</p></div>
        <div className={s.grid2}>
          <RatingChart history={D.history} fbsTeams={N} />
          <RecordOdds outlook={o} showConf={M.confAbbr !== "ind" && o.confDist.length > 1} />
        </div>
      </section>

      {PL && <Leaders players={PL.players} />}

      <section id="schedule" className={s.section}>
        <div className="sec-h"><h2>Schedule</h2><p>Game score = the rating that one result implies, after adjusting for opponent and venue</p></div>
        <Schedule D={D} slugOf={idx.slugOf} netHeat={netHeat} />
      </section>

      <section id="stats" className={s.section}>
        <div className="sec-h"><h2>Team Stats</h2><p>Hover an advanced stat for what it means. Box-score totals include FCS games and aren&apos;t opponent-adjusted</p></div>
        <Stats D={D} rankHeat={rankHeat} />
      </section>

      <section id="roster" className={s.section}>
        <div className="sec-h"><h2>Roster</h2><p>{D.roster.length} players{M.coach ? ` · Head coach ${M.coach}` : ""}</p></div>
        {D.roster.length ? <Roster roster={D.roster} /> : <p className="note">ESPN hasn&apos;t published this roster yet.</p>}
      </section>

      <p className="note">
        Updated {etStamp(idx.hub.built)}. Ratings are in points on a neutral field. Projected lines include {fmt(D.hfa, 1)} points of
        home field. Win chances and record odds allow for the ratings themselves being uncertain, most of all early in the season.{" "}
        <Link href="/">All FBS power rankings →</Link>
      </p>
    </div>
  );
}

function Tile({ k, v, sub }: { k: string; v: string; sub: React.ReactNode }) {
  return <div className={s.tile}><div className={s.k}>{k}</div><div className={s.v}>{v}</div><div className={s.s}>{sub}</div></div>;
}

/* ---------- team leaders (from the player build) ---------- */
function Leaders({ players }: { players: PlayerLite[] }) {
  const st = (p: PlayerLite, c: string, k: string) => p.stats[c]?.[k];
  const top = (c: string, k: string) => players.filter((p) => (st(p, c, k) ?? 0) > 0).sort((a, b) => st(b, c, k)! - st(a, c, k)!)[0];
  const cards: [string, PlayerLite | undefined, (p: PlayerLite) => [number, string, string], string][] = [
    ["Passing", top("passing", "YDS"), (p) => [st(p, "passing", "YDS")!, "yds", `${st(p, "passing", "TD") ?? 0} TD · ${st(p, "passing", "INT") ?? 0} INT`], "passing.YDS"],
    ["Rushing", top("rushing", "YDS"), (p) => [st(p, "rushing", "YDS")!, "yds", `${st(p, "rushing", "CAR") ?? 0} car · ${st(p, "rushing", "TD") ?? 0} TD`], "rushing.YDS"],
    ["Receiving", top("receiving", "YDS"), (p) => [st(p, "receiving", "YDS")!, "yds", `${st(p, "receiving", "REC") ?? 0} rec · ${st(p, "receiving", "TD") ?? 0} TD`], "receiving.YDS"],
    ["Tackles", top("defensive", "TOT"), (p) => [st(p, "defensive", "TOT")!, "tkl", `${st(p, "defensive", "TFL") ?? 0} TFL`], "defensive.TOT"],
    ["Sacks", top("defensive", "SACKS"), (p) => [st(p, "defensive", "SACKS")!, "sacks", `${st(p, "defensive", "QB HUR") ?? 0} hurries`], "defensive.SACKS"],
    ["Interceptions", top("interceptions", "INT"), (p) => [st(p, "interceptions", "INT")!, "INT", `${st(p, "defensive", "PD") ?? 0} PD`], "interceptions.INT"],
  ];
  const shown = cards.filter((c) => c[1]);
  if (!shown.length) return null;
  return (
    <section id="leaders" className={s.section}>
      <div className="sec-h"><h2>Team Leaders</h2><p><Link href="/players" style={{ color: "inherit" }}>National leaderboards →</Link></p></div>
      <div className={s.leaders}>
        {shown.map(([k, p, f, rkKey]) => {
          const [v, unit, sub] = f(p!);
          const rk = p!.rk?.[rkKey];
          return (
            <Link key={k} className={s.lead} href={playerHref(p!.name, p!.id)}>
              <div className={s.k}>{k}</div>
              <div className={s.n}>{p!.name}</div>
              <div className={s.p}>{p!.pos || ""}{p!.cls ? ` · ${p!.cls}` : ""}{rk ? ` · ${ord(rk[0])} in FBS` : ""}</div>
              <div className={s.v}>{v % 1 ? v.toFixed(1) : v}<small>{unit}</small></div>
              <div className={s.p}>{sub}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- schedule, with bye weeks filled in ---------- */
function Schedule({ D, slugOf, netHeat }: { D: TeamFile; slugOf: Map<string, string>; netHeat: (v?: number) => string }) {
  const rows: (SchedGame | { bye: number })[] = [];
  let prevWk: number | null = null;
  for (const g of D.schedule) {
    const wk = Number((g.week.match(/\d+/) || [0])[0]);
    const isWeek = /^Week/.test(g.week);
    if (prevWk && isWeek && wk > prevWk + 1) for (let b = prevWk + 1; b < wk; b++) rows.push({ bye: b });
    if (isWeek) prevWk = wk;
    rows.push(g);
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  return (
    <div className="sheet-wrap">
      <table className="sheet dense">
        <thead>
          <tr>
            <th className="l">Wk</th><th className="l">Date</th><th className="l">Opponent</th><th className="l">Result / TDC line</th>
            <th title="Opponent- and venue-adjusted margin: the rating this single game implies">Game score</th>
            <th className="l">Win chance</th><th className="l">TV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            if ("bye" in g) return <tr key={`bye${g.bye}`} className={s.bye}><td className="l dim">{g.bye}</td><td className="l">—</td><td className="l">Bye</td><td /><td /><td /><td /></tr>;
            const oppSlug = slugOf.get(g.opp);
            const opp = (
              <td className={`l ${s.opp}`}>
                <span className={s.at}>{g.site === "A" ? "@" : "vs"}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.oppLogo} alt="" loading="lazy" />
                {g.oppRank ? <span className={s.orank}>{g.oppRank}</span> : null}
                {g.oppFbs && oppSlug ? <Link href={`/teams/${oppSlug}`}>{g.oppName}</Link> : <>{g.oppName} <span className={s.tag}>FCS</span></>}
                {g.conf && <span className={s.tag}>CONF</span>}
                {g.site === "N" && <span className={s.tag} title="Neutral site">NEUTRAL</span>}
              </td>
            );
            const wk = g.week.replace("Week ", "");
            if (g.completed)
              return (
                <tr key={g.id}>
                  <td className="l dim">{wk}</td><td className="l dim">{date(g.date)}</td>{opp}
                  <td className="l"><span className={g.res === "W" ? s.W : s.L}>{g.res}</span> {g.pf}–{g.pa}</td>
                  <td className={`strong ${netHeat(g.score)}`}>{fmt(g.score, 1, true)}</td>
                  <td className="l dim">—</td><td className="l dim">{g.tv || ""}</td>
                </tr>
              );
            return (
              <tr key={g.id}>
                <td className="l dim">{wk}</td><td className="l dim">{date(g.date)}</td>{opp}
                <td className="l">{(g.line ?? 0) >= 0 ? D.meta.name : g.oppName} −{Math.abs(g.line ?? 0).toFixed(1)} <span className={s.muted}>· o/u {fmt(g.total)}</span></td>
                <td className="dim">—</td>
                <td className="l"><span className={s.wp}><i><s style={{ width: `${Math.round((g.win ?? 0) * 100)}%` }} /></i>{pct(g.win)}</span></td>
                <td className="l dim">{g.tv || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- team stats: offense vs defense, ranked across FBS ---------- */
const ADV_TIP: Record<string, string> = {
  epa: "Expected points added per play: how much each snap moves the expected score. Defense is what it allows (lower is better).",
  sr: "Share of plays that keep the offense on schedule: 50% of the yards needed on 1st down, 70% on 2nd, all of it on 3rd/4th.",
  expl: "Average EPA of successful plays: how big the good plays are.",
};
function sfmt(k: string, v: number | null) {
  if (v == null) return "—";
  if (k === "sr") return (v * 100).toFixed(1) + "%";
  if (k === "epa" || k === "expl") return (k === "epa" && v > 0 ? "+" : "") + v.toFixed(3);
  if (k === "cmp" || k === "third") return v.toFixed(1) + "%";
  if (k === "ppg" || /ypg$/.test(k) || k === "pen") return v.toFixed(1);
  return v.toFixed(2);
}
function Stats({ D, rankHeat }: { D: TeamFile; rankHeat: (r: number | null) => string }) {
  const label = (k: string, l: string) =>
    k === "sk" ? <>Sacks / game <span className={s.muted}>(allowed · made)</span></> :
    k === "to" ? <>Turnovers / game <span className={s.muted}>(lost · forced)</span></> : l;
  return (
    <div className="sheet-wrap" style={{ maxWidth: 760 }}>
      <table className="sheet dense">
        <thead><tr><th className="l">Stat</th><th>Offense</th><th>FBS rank</th><th>Defense (allowed)</th><th>FBS rank</th></tr></thead>
        <tbody>
          {D.stats.map((x, i) => {
            const prev = D.stats[i - 1];
            return [
              x.adv && i === 0 ? <tr key="h-adv" className={s.groupRow}><td className="l" colSpan={5}>Advanced · per play, garbage time excluded</td></tr> : null,
              !x.adv && prev?.adv ? <tr key="h-box" className={s.groupRow}><td className="l" colSpan={5}>Box score · season totals</td></tr> : null,
              <tr key={x.k}>
                <td className="l strong" title={x.adv ? ADV_TIP[x.k] : undefined}>{label(x.k, x.l)}</td>
                <td>{sfmt(x.k, x.off)}</td><td className={rankHeat(x.offRk)}>{x.offRk ? ord(x.offRk) : "—"}</td>
                <td>{sfmt(x.k, x.def)}</td><td className={rankHeat(x.defRk)}>{x.defRk ? ord(x.defRk) : "—"}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
