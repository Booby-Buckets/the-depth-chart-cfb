import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getTeamIndex, getTeam, getPlayersFile, getPlayerTeam, type PlayerFull, type PlayersFile } from "@/lib/data";
import { fmt, ord } from "@/lib/format";
import { playerHref, playerIdFromSlug, playerSlug } from "@/lib/slug";
import { teamColors } from "@/lib/teamColor";
import SitBars from "@/components/player/SitBars";
import s from "./player.module.css";
import { logo } from "@/lib/logo";

// 14,000+ players: none are built ahead; each renders on its first visit and is cached after that
export async function generateStaticParams() { return []; }
export const dynamicParams = true;

async function load(slug: string) {
  const pid = playerIdFromSlug(slug);
  if (!pid) notFound();
  const tid = await getPlayerTeam(pid);
  if (!tid) notFound();
  const [PL, TM, idx] = await Promise.all([getPlayersFile(tid), getTeam(tid), getTeamIndex()]);
  const P = PL.players.find((p) => p.id === pid);
  if (!P) notFound();
  if (slug !== playerSlug(P.name, pid)) permanentRedirect(playerHref(P.name, pid)); // bare id or a renamed slug -> canonical URL
  return { P, PL, TM, teamSlug: idx.slugOf.get(tid)! };
}

export async function generateMetadata({ params }: PageProps<"/players/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { P, TM } = await load(slug);
  return {
    title: `${P.name} — ${TM.meta.name} ${P.pos || ""}`.trim(),
    description: `${P.name}, ${TM.meta.full} ${P.pos || ""}: ${TM.season} stats ranked across FBS, EPA per play by situation, estimated snap share, and the position room.`,
    alternates: { canonical: playerHref(P.name, P.id) },
  };
}

const GROUPS: Record<string, string[]> = { QB: ["QB"], RB: ["RB", "FB"], "WR/TE": ["WR", "TE"] };
const CLS: Record<string, string> = { FR: "Freshman", SO: "Sophomore", JR: "Junior", SR: "Senior", GR: "Graduate" };
const n0 = (v: number | null | undefined) => (v == null ? "—" : v % 1 ? v.toFixed(1) : String(v));

export default async function PlayerPage({ params }: PageProps<"/players/[slug]">) {
  const { slug } = await params;
  const { P, PL, TM, teamSlug } = await load(slug);
  const M = TM.meta, R = TM.rating;
  const group = Object.keys(GROUPS).find((g) => GROUPS[g].includes(P.pos || ""));
  const st = (c: string, k: string) => P.stats[c]?.[k];
  const rk = (key: string) => P.rk?.[key];
  const rkSub = (key: string) => { const r = rk(key); return r ? <><b>{ord(r[0])}</b> of {r[1]} in FBS</> : null; };

  /* ---------- tiles, by role ---------- */
  type T = { k: string; v: string; s: React.ReactNode };
  const T = (k: string, v: string, key?: string | null, sub?: React.ReactNode): T => ({ k, v, s: sub ?? (key ? rkSub(key) : null) });
  const epaTile = () => P.ppa ? T("EPA / play", fmt(P.ppa.avg.all, 2, true), null,
    rk("ppa.all") ? <><b>{ord(rk("ppa.all")![0])}</b> of {rk("ppa.all")![1]} {group}s</> : `${P.ppa.plays} plays`) : null;
  const shareTile = (k: "overall" | "pass") => P.use && P.use[k] != null
    ? T(k === "pass" ? "Target share" : "Usage", Math.round(P.use[k]! * 100) + "%", null, k === "pass" ? "of team pass plays" : "of team plays involved in") : null;
  let tiles: (T | null)[] = [];
  if ((st("passing", "ATT") ?? 0) >= 10) tiles = [T("Pass yards", n0(st("passing", "YDS")), "passing.YDS"), T("TD – INT", `${n0(st("passing", "TD"))}–${n0(st("passing", "INT"))}`), T("Yards / att.", fmt(st("passing", "YPA"), 1), "passing.YPA"), T("Completion", fmt((st("passing", "PCT") ?? 0) * 100, 1) + "%", "passing.PCT"), epaTile(), shareTile("overall")];
  else if ((st("rushing", "CAR") ?? 0) >= 8) tiles = [T("Rush yards", n0(st("rushing", "YDS")), "rushing.YDS"), T("Yards / carry", fmt(st("rushing", "YPC"), 1), "rushing.YPC"), T("Rush TD", n0(st("rushing", "TD")), "rushing.TD"), T("Receptions", n0(st("receiving", "REC") || 0), "receiving.REC"), epaTile(), shareTile("overall")];
  else if ((st("receiving", "REC") ?? 0) >= 2) tiles = [T("Receptions", n0(st("receiving", "REC")), "receiving.REC"), T("Rec. yards", n0(st("receiving", "YDS")), "receiving.YDS"), T("Yards / catch", fmt(st("receiving", "YPR"), 1), "receiving.YPR"), T("Rec. TD", n0(st("receiving", "TD")), "receiving.TD"), epaTile(), shareTile("pass")];
  else if (st("defensive", "TOT")) tiles = [T("Tackles", n0(st("defensive", "TOT")), "defensive.TOT"), T("Solo", n0(st("defensive", "SOLO"))), T("Tackles for loss", n0(st("defensive", "TFL")), "defensive.TFL"), T("Sacks", n0(st("defensive", "SACKS")), "defensive.SACKS"), T("Interceptions", n0(st("interceptions", "INT") || 0), "interceptions.INT"), T("Passes defended", n0(st("defensive", "PD")), "defensive.PD")];
  else if (st("kicking", "FGA")) tiles = [T("Field goals", `${n0(st("kicking", "FGM"))}/${n0(st("kicking", "FGA"))}`, "kicking.FGM"), T("FG %", fmt((st("kicking", "PCT") ?? 0) * 100, 1) + "%", "kicking.PCT"), T("Long", n0(st("kicking", "LONG"))), T("Extra points", `${n0(st("kicking", "XPM"))}/${n0(st("kicking", "XPA"))}`), T("Points", n0(st("kicking", "PTS")))];
  else if (st("punting", "NO")) tiles = [T("Punts", n0(st("punting", "NO"))), T("Avg", fmt(st("punting", "YPP"), 1)), T("Inside 20", n0(st("punting", "In 20"))), T("Long", n0(st("punting", "LONG")))];
  let shownTiles = tiles.filter((t): t is T => !!t);
  const pi = P.pi;
  if (pi?.es && pi.esTP) {
    const sp = (v: number) => Math.round((v / pi.esTP!) * 100);
    const starts = pi.gs ? `${pi.gs} of ${pi.g} started · ` : "";
    shownTiles = [T("Snap share", sp(pi.es) + "%", null,
      pi.esLo != null ? <>{starts}likely <b>{sp(pi.esLo)}–{sp(pi.esHi!)}%</b></> : P.pos === "QB" ? `${starts}${pi.es} of ${pi.esTP} snaps` : `${starts}estimated`), ...shownTiles].slice(0, 6);
  }
  const bio = [P.pos, CLS[P.cls || ""] || P.cls, [P.ht, P.wt].filter(Boolean).join(", "), P.home].filter(Boolean) as string[];
  const G = group ? PL.groupAvg[group] : null;

  return (
    <div className={`col ${s.scope}`} style={teamColors(M.color)}>
      <div className={s.hero}>
        <div className={s.band}>
          {P.no != null && <div className={s.num}>#{P.no}</div>}
          <div className={s.id}>
            <div className={s.eyebrow}><Link href={`/teams/${teamSlug}`}>{M.name}</Link> · {PL.season}</div>
            <h1 className={s.name}>{P.name}</h1>
            <div className={s.sub}>
              {bio.map((b) => <span key={b}>{b}</span>)}
              {P.recruit && (
                <span className={s.badge}>
                  {"★".repeat(P.recruit.stars || 0)} {P.recruit.year} recruit{P.recruit.ranking ? ` · #${P.recruit.ranking} nationally` : ""}
                </span>
              )}
            </div>
          </div>
          <Link className={s.team} href={`/teams/${teamSlug}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo(M.logo, 40)} alt="" />
            <div><b>{M.name} {M.mascot || ""}</b><span>{R.w}-{R.l} · TDC #{R.rank}</span></div>
          </Link>
        </div>
        {shownTiles.length > 0 && (
          <div className={s.tiles} style={{ "--n": Math.min(6, shownTiles.length) } as React.CSSProperties}>
            {shownTiles.map((t) => <div key={t.k} className={s.tile}><div className={s.k}>{t.k}</div><div className={s.v}>{t.v}</div><div className={s.s}>{t.s ?? " "}</div></div>)}
          </div>
        )}
      </div>

      {P.ppa && group && G && (
        <section className={s.section}>
          <div className="sec-h"><h2>Efficiency &amp; Role</h2><p>EPA = expected points added per play. Compared with every FBS {group} who qualifies</p></div>
          <SitBars
            name={P.name.split(" ").slice(-1)[0]} group={group}
            ppa={P.ppa.avg} ppaAvg={G.ppa} use={P.use ?? null} useAvg={G.use}
            summary={<>{P.ppa.plays} plays · {fmt(P.ppa.tot, 1, true)} total EPA{rk("ppa.all") ? <> · <b>{ord(rk("ppa.all")![0])}</b> of {rk("ppa.all")![1]} qualifying {group}s</> : " · not enough plays to rank yet"}</>}
          />
        </section>
      )}

      <section className={s.section}>
        <div className="sec-h"><h2>{PL.season} Season Stats</h2><p>FBS rank among qualifying players</p></div>
        <StatTables P={P} season={PL.season} />
      </section>

      {pi && pi.log.length > 0 && <SnapsTable P={P} teamSlug={teamSlug} />}

      <PositionRoom P={P} PL={PL} teamName={M.name} />

      <p className="note">
        Stats, EPA and usage come from CollegeFootballData.com and refresh daily. FBS ranks only count players with enough volume
        for the stat to mean something. Qualifying for EPA takes {G?.minPerGame ?? "—"}+ plays per team game.{" "}
        <Link href={`/depth/${teamSlug}`}>{M.name} depth chart →</Link>
      </p>
    </div>
  );
}

/* ---------- every season stat table the player has ---------- */
const CATS: [string, string, [string, string][]][] = [
  ["passing", "Passing", [["COMPLETIONS", "Completions"], ["ATT", "Attempts"], ["PCT", "Completion %"], ["YDS", "Yards"], ["YPA", "Yards / att."], ["TD", "Touchdowns"], ["INT", "Interceptions"]]],
  ["rushing", "Rushing", [["CAR", "Carries"], ["YDS", "Yards"], ["YPC", "Yards / carry"], ["TD", "Touchdowns"], ["LONG", "Long"]]],
  ["receiving", "Receiving", [["REC", "Receptions"], ["YDS", "Yards"], ["YPR", "Yards / catch"], ["TD", "Touchdowns"], ["LONG", "Long"]]],
  ["defensive", "Defense", [["TOT", "Tackles"], ["SOLO", "Solo"], ["TFL", "Tackles for loss"], ["SACKS", "Sacks"], ["QB HUR", "QB hurries"], ["PD", "Passes defended"], ["TD", "Defensive TD"]]],
  ["interceptions", "Interceptions", [["INT", "Interceptions"], ["YDS", "Return yards"], ["TD", "Pick-sixes"]]],
  ["fumbles", "Fumbles", [["FUM", "Fumbles"], ["LOST", "Lost"], ["REC", "Recovered"]]],
  ["kicking", "Kicking", [["FGM", "FG made"], ["FGA", "FG attempts"], ["PCT", "FG %"], ["LONG", "Long"], ["XPM", "XP made"], ["XPA", "XP attempts"], ["PTS", "Points"]]],
  ["punting", "Punting", [["NO", "Punts"], ["YDS", "Yards"], ["YPP", "Average"], ["In 20", "Inside 20"], ["TB", "Touchbacks"], ["LONG", "Long"]]],
  ["kickReturns", "Kick returns", [["NO", "Returns"], ["YDS", "Yards"], ["AVG", "Average"], ["TD", "Touchdowns"], ["LONG", "Long"]]],
  ["puntReturns", "Punt returns", [["NO", "Returns"], ["YDS", "Yards"], ["AVG", "Average"], ["TD", "Touchdowns"], ["LONG", "Long"]]],
];
const heat = (r?: [number, number]) => { if (!r) return ""; const q = (r[0] - 1) / r[1]; return "c" + (q < 0.1 ? 4 : q < 0.25 ? 3 : q < 0.5 ? 2 : q < 0.75 ? 1 : 0); };
const sv = (k: string, v: number | null | undefined) => (v == null ? "—" : k === "PCT" ? (v * 100).toFixed(1) + "%" : n0(v));

function StatTables({ P, season }: { P: PlayerFull; season: number }) {
  const cats = CATS.filter(([c]) => P.stats[c] && Object.values(P.stats[c]).some((v) => v));
  if (!cats.length) return <div className={s.empty}>{P.name} hasn&apos;t recorded any stats yet this season.</div>;
  return (
    <div className={s.statgrid}>
      {cats.map(([c, label, rows]) => (
        <div key={c} className="sheet-wrap">
          <table className="sheet dense" style={{ width: "100%" }}>
            <thead><tr><th className="l">{label}</th><th>{season}</th><th>FBS rank</th></tr></thead>
            <tbody>
              {rows.filter(([k]) => P.stats[c][k] != null).map(([k, l]) => {
                const r = P.rk?.[`${c}.${k}`];
                return (
                  <tr key={k}>
                    <td className="l">{l}</td>
                    <td className="strong">{sv(k, P.stats[c][k])}</td>
                    <td className={heat(r)}>{r ? <>{ord(r[0])} <span className={s.muted}>/ {r[1]}</span></> : <span className={s.muted}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ---------- snaps by game (ESPN play-by-play + the snap model) ---------- */
function SnapsTable({ P, teamSlug }: { P: PlayerFull; teamSlug: string }) {
  const pi = P.pi!;
  const isQB = P.pos === "QB" && pi.qb > 0;
  const hasEs = (pi.es ?? 0) > 0;
  const cols = ([hasEs ? ["es", "Est. snaps"] : null, ["off", "Plays involved"], ["def", "Plays made"], ["st", "Special teams"], ["pen", "Penalties"]] as ([string, string] | null)[])
    .filter((c): c is [string, string] => !!c && ((pi as unknown as Record<string, number>)[c[0]] ?? 0) > 0);
  const base = (g: { esTP?: number; tp: number }) => g.esTP || g.tp; // defense: the opponent's offensive plays
  const seasonBase = pi.esTP || pi.log.reduce((a, g) => a + g.tp, 0);
  const range = (lo?: number, hi?: number) => (lo != null ? <span className={s.muted}> ({lo}–{hi})</span> : null);
  const anyStarts = pi.log.some((g) => g.gs);
  return (
    <section className={s.section}>
      <div className="sec-h">
        <h2>Snaps by Game</h2>
        <p>
          {["OL", "OT", "OG", "G", "T", "C", "IOL"].includes(P.pos || "") ? "Starts come from each game’s starting lineup. Starting linemen play nearly every snap (NFL median: 100%), so a start counts as about 97% of the team’s plays"
            : isQB ? "Estimated snaps: every offensive play credited to the QB running the offense. Close to a true snap count"
            : hasEs ? <>Estimated snaps from a model trained on real NFL snap counts. Ranges in brackets are where the real number lands 80% of the time: wide for a single game, tighter over the season. <Link href={`/depth/${teamSlug}`} style={{ color: "inherit" }}>How it works</Link></>
            : "Plays the player shows up in the play-by-play. Not snap counts"}
        </p>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense">
          <thead>
            <tr>
              <th className="l">Game</th>{anyStarts && <th className="c">Start</th>}<th>{pi.def > pi.off ? "Opp. plays" : "Team plays"}</th>
              {cols.map((c) => <th key={c[0]}>{c[1]}</th>)}
              {hasEs && <th>Snap share</th>}
            </tr>
          </thead>
          <tbody>
            {pi.log.map((g) => (
              <tr key={g.id}>
                <td className="l">{g.wk.replace("Week ", "Wk ")} · {g.oppName}</td>
                {anyStarts && <td className="c">{g.gs ? <b title="Started (ESPN lineup)">✓ {g.gsPos || ""}</b> : <span className={s.muted}>—</span>}</td>}
                <td className="dim">{base(g) || "—"}</td>
                {cols.map(([k]) => {
                  const v = (g as unknown as Record<string, number>)[k];
                  return <td key={k} className={k === "es" ? "strong" : ""}>{k === "es" && g.es != null && !isQB ? "~" : ""}{v || "·"}{k === "es" && range(g.esLo, g.esHi)}</td>;
                })}
                {hasEs && <td>{g.es != null && base(g) ? Math.round((g.es / base(g)) * 100) + "%" : "—"}</td>}
              </tr>
            ))}
            <tr>
              <td className="l strong">Season</td>{anyStarts && <td className="c strong">{pi.gs} GS</td>}<td className="strong">{seasonBase}</td>
              {cols.map(([k]) => <td key={k} className="strong">{(pi as unknown as Record<string, number>)[k]}{k === "es" && range(pi.esLo, pi.esHi)}</td>)}
              {hasEs && <td className="strong">{Math.round((pi.es! / Math.max(1, seasonBase)) * 100)}%</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- position room: the depth chart around the player ---------- */
const FAM: [string, string[]][] = [["QB", ["QB"]], ["RB", ["RB", "FB"]], ["WR", ["WR"]], ["TE", ["TE"]], ["OL", ["OL", "OT", "OG", "G", "T", "C", "IOL"]], ["DL", ["DL", "DE", "DT", "NT", "EDGE"]], ["LB", ["LB", "OLB", "ILB", "MLB"]], ["DB", ["DB", "CB", "S", "FS", "SS", "SAF"]], ["ST", ["PK", "K", "P", "LS"]]];
type RoomCol = [string, (p: PlayerFull) => number | string | null | undefined];
function roomCols(kind: string): RoomCol[] {
  const S = (p: PlayerFull, c: string, k: string) => p.stats[c]?.[k];
  const epa = (p: PlayerFull) => (p.ppa ? fmt(p.ppa.avg.all, 2, true) : null);
  switch (kind) {
    case "QB": return [["Att", (p) => S(p, "passing", "ATT")], ["Yds", (p) => S(p, "passing", "YDS")], ["TD", (p) => S(p, "passing", "TD")], ["INT", (p) => S(p, "passing", "INT")], ["EPA/play", epa]];
    case "RB": return [["Car", (p) => S(p, "rushing", "CAR")], ["Yds", (p) => S(p, "rushing", "YDS")], ["YPC", (p) => S(p, "rushing", "YPC")], ["TD", (p) => S(p, "rushing", "TD")], ["Rec", (p) => S(p, "receiving", "REC")], ["EPA/play", epa]];
    case "WR": return [["Rec", (p) => S(p, "receiving", "REC")], ["Yds", (p) => S(p, "receiving", "YDS")], ["TD", (p) => S(p, "receiving", "TD")], ["Tgt share", (p) => (p.use?.pass != null ? Math.round(p.use.pass * 100) + "%" : null)], ["EPA/play", epa]];
    case "DEF": return [["Tkl", (p) => S(p, "defensive", "TOT")], ["TFL", (p) => S(p, "defensive", "TFL")], ["Sacks", (p) => S(p, "defensive", "SACKS")], ["INT", (p) => S(p, "interceptions", "INT")], ["PD", (p) => S(p, "defensive", "PD")]];
    case "ST": return [["FG", (p) => (S(p, "kicking", "FGA") ? `${S(p, "kicking", "FGM")}/${S(p, "kicking", "FGA")}` : null)], ["Punts", (p) => S(p, "punting", "NO")], ["Avg", (p) => S(p, "punting", "YPP")]];
    default: return [];
  }
}
function PositionRoom({ P, PL, teamName }: { P: PlayerFull; PL: PlayersFile; teamName: string }) {
  const fam = FAM.find(([, ps]) => ps.includes(P.pos || "")) || [P.pos || "", [P.pos || ""]];
  const kind = ({ QB: "QB", RB: "RB", WR: "WR", TE: "WR", OL: "OL", DL: "DEF", LB: "DEF", DB: "DEF", ST: "ST" } as Record<string, string>)[fam[0]] || "OL";
  const cols = roomCols(kind);
  const volume = (p: PlayerFull) => (cols[0] ? +(String(cols[0][1](p) ?? "").split("/")[0]) || 0 : 0);
  const room = PL.players.filter((p) => fam[1].includes(p.pos || "")).sort((a, b) => volume(b) - volume(a) || (+(a.no ?? 999)) - (+(b.no ?? 999)));
  return (
    <section className={s.section}>
      <div className="sec-h">
        <h2>Position Room</h2>
        <p>{room.length} {fam[0] === "ST" ? "specialists" : `${fam[0]}s`} on the {teamName} roster{cols.length ? `, ordered by ${cols[0][0].toLowerCase()}` : ""}</p>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense">
          <thead><tr><th>#</th><th className="l">Player</th><th className="c">Pos</th><th className="c">Class</th>{cols.map((c) => <th key={c[0]}>{c[0]}</th>)}</tr></thead>
          <tbody>
            {room.map((p) => (
              <tr key={p.id} className={p.id === P.id ? s.me : undefined}>
                <td className="rk">{p.no ?? ""}</td>
                <td className="l nm"><Link href={playerHref(p.name, p.id)}>{p.name}</Link></td>
                <td className="c">{p.pos || ""}</td>
                <td className="c">{p.cls || ""}</td>
                {cols.map(([k, f]) => { const v = f(p); return <td key={k}>{v == null || v === "" ? <span className={s.muted}>—</span> : v}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
