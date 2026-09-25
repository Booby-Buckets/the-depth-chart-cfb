import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { getTeamIndex, getTeam, getPlayersFile, getOlPositions, type DepthSlot, type DepthPlayer, type PlayersFile, type OlSlots } from "@/lib/data";
import { teamColors } from "@/lib/teamColor";
import { playerHref } from "@/lib/slug";
import TeamSwitcher from "@/components/team/TeamSwitcher";
import SnapLog, { type LogGroup } from "@/components/depth/SnapLog";
import s from "./depth.module.css";
import { logo } from "@/lib/logo";

export async function generateStaticParams() {
  const { slugOf } = await getTeamIndex();
  return [...slugOf.values()].map((slug) => ({ slug }));
}
export const dynamicParams = true;

async function resolve(slug: string) {
  const idx = await getTeamIndex();
  if (/^\d+$/.test(slug) && idx.slugOf.has(slug)) permanentRedirect(`/depth/${idx.slugOf.get(slug)}`);
  const t = idx.bySlug.get(slug);
  if (!t) notFound();
  return { idx, t };
}

export async function generateMetadata({ params }: PageProps<"/depth/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { t } = await resolve(slug);
  return {
    title: `${t.name} Depth Chart`,
    description: `${t.full} depth chart built from who actually plays: estimated snap counts and snap share with likely ranges, QB snaps from play-by-play, and a game-by-game snap log.`,
    alternates: { canonical: `/depth/${slug}` },
  };
}

const UNITS: ["offense" | "defense" | "special", string, string][] = [
  ["offense", "Offense", "Season snap share: share of all the team’s offensive plays this season, with its likely range. Ordered by estimated snaps, latest game counted twice"],
  ["defense", "Defense", "Season snap share: share of all the opponents’ plays this season, with its likely range. Ordered by estimated snaps, latest game counted twice"],
  ["special", "Special Teams", "By kicks and punts"],
];
const LABEL: Record<string, string> = {
  QB: "Quarterback", RB: "Running back", WR: "Wide receivers", TE: "Tight end", OL: "Offensive line",
  DL: "Defensive line", LB: "Linebackers", CB: "Cornerbacks", S: "Safeties", K: "Kicker", P: "Punter", LS: "Long snapper",
};
const MODELED = ["RB", "WR", "TE", "DL", "LB", "CB", "S", "OL"];
const unitOf = (slot: string, n?: number) => {
  const u = ({ QB: "snap", K: "kick", P: "punt" } as Record<string, string>)[slot] || (MODELED.includes(slot) ? "est. snap" : "play");
  return n === 1 ? u : u + "s";
};
const share = (v: number, t: number) => Math.round((v / t) * 100);

export default async function DepthPage({ params }: PageProps<"/depth/[slug]">) {
  const { slug } = await params;
  const { idx, t } = await resolve(slug);
  const [PL, TM, OLP] = await Promise.all([getPlayersFile(t.id), getTeam(t.id), getOlPositions().then((o) => o[t.id])]);
  const M = TM.meta, G = PL.games;
  // O-line spots from the school's own game notes: the latest game's starters, else its listed depth chart
  let ol: OlSpots | null = null;
  if (OLP?.kind === "starters") {
    const last = [...G].reverse().find((g) => OLP.games[g.id]);
    if (last) ol = { slots: OLP.games[last.id], source: OLP.source, caption: `Spots as ${M.name}’s game notes list them for ${last.wk} vs ${last.oppName}.` };
  } else if (OLP?.kind === "depth") {
    ol = { slots: OLP.depth, source: OLP.source, caption: `Spots from ${M.name}’s listed depth chart${OLP.asOf ? ` (${OLP.asOf})` : ""}.` };
  }
  const through = G.length ? G[G.length - 1].wk : "preseason";
  const teamOptions = [...idx.hub.teams].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ slug: idx.slugOf.get(x.id)!, name: x.name }));

  return (
    <div className={`col ${s.scope}`} style={teamColors(M.color)}>
      <div className={s.head}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo(M.logo, 56)} alt="" />
        <div className={s.t}>
          <div className={s.e}>{M.conf} · Through {through}</div>
          <h1><Link href={`/teams/${slug}`}>{M.name} {M.mascot || ""}</Link> Depth Chart</h1>
        </div>
        <TeamSwitcher current={slug} options={teamOptions} className={s.switch} basePath="/depth" />
      </div>

      {UNITS.map(([k, label, sub]) => (
        <section key={k} className={s.unit}>
          <div className="sec-h"><h2>{label}</h2><p>{sub}</p></div>
          <div className={s.slots}>
            {(PL.depth[k] || []).map((u) => <SlotCard key={u.slot} u={u} hasGames={G.length > 0} ol={u.slot === "OL" ? ol : null}
              seasonPlays={G.reduce((a, g) => a + ((k === "defense" ? g.otp : g.tp) || 0), 0)} />)}
          </div>
        </section>
      ))}

      <section className={s.section}>
        <SnapLog games={G} groups={logGroups(PL)} />
      </section>

      <p className="note">
        <b>How the snap estimates work.</b> No free source publishes college snap counts, so these are estimates. Quarterbacks:
        every offensive play is credited to the QB running the offense, which is close to exact. Everyone else: a model trained on
        real NFL snap counts (nflverse, 2023–24) turns each player&apos;s share of their position group&apos;s involvement that game
        (carries and targets on offense, tackles, sacks and breakups on defense) into a share of the team&apos;s plays. Tested on a
        season it never saw, it&apos;s typically within 5 snaps a game for running backs and 9–10 for other positions, and within
        about 10–15% over a season. The ranges shown are where the real number landed 80% of the time in that test. They narrow as
        the season goes on, and are widest for part-time players in a single game. Blocking tight ends and receivers who rarely see
        the ball get underestimated. Offensive linemen leave no trace in the play-by-play, so the line comes from each game&apos;s
        starting lineup. Where a school&apos;s game notes list its starters by spot, and its website allows automated access, the
        line shows who played left tackle through right tackle.
      </p>
    </div>
  );
}

type OlSpots = { slots: OlSlots; source: string; caption: string };
const SPOTS = ["LT", "LG", "C", "RG", "RT"] as const;

function SlotCard({ u, hasGames, ol, seasonPlays }: { u: DepthSlot; hasGames: boolean; ol?: OlSpots | null; seasonPlays: number }) {
  if (ol) return <OlCard u={u} hasGames={hasGames} ol={ol} seasonPlays={seasonPlays} />;
  const ps = u.players.filter((p, i) => u.basis === "roster" || p.val > 0 || i < u.starters);
  const note =
    u.slot === "OL" && u.basis === "starts" ? "From each game’s starting lineup. Starting linemen play nearly every snap (NFL median: 100%), so a start counts as about 97% of the team’s plays." :
    u.slot === "OL" ? "No starting lineups posted yet, so this is roster order (class, then weight)." :
    u.basis === "roster" ? "No plays recorded yet, so this is roster order." : "";
  const subtitle = u.basis === "roster" ? "roster order" : u.basis === "starts" ? "starts · snap share" : MODELED.includes(u.slot) || u.slot === "QB" ? "season snap share" : `by ${unitOf(u.slot)}`;
  return (
    <div className={s.slot}>
      <h3>{LABEL[u.slot] || u.slot}<span>{subtitle}</span></h3>
      {ps.length ? ps.map((p, i) => <SlotRow key={p.id} p={p} i={i} u={u} hasGames={hasGames} seasonPlays={seasonPlays} />) : <div className={s.caveat}>Nobody listed.</div>}
      {note && <div className={s.caveat}>{note}</div>}
    </div>
  );
}

/** The line by spot (LT, LG, C, RG, RT), then everyone else who has started. */
function OlCard({ u, hasGames, ol, seasonPlays }: { u: DepthSlot; hasGames: boolean; ol: OlSpots; seasonPlays: number }) {
  const byId = new Map(u.players.map((p) => [p.id, p]));
  const taken = new Set(Object.values(ol.slots));
  const rest = u.players.filter((p) => !taken.has(p.id) && p.val > 0);
  return (
    <div className={s.slot}>
      <h3>{LABEL.OL}<span>by spot · starts · snap share</span></h3>
      {SPOTS.map((sp) => {
        const id = ol.slots[sp];
        const p = byId.get(id);
        return p ? <SlotRow key={sp} p={p} i={0} u={u} hasGames={hasGames} spot={sp} seasonPlays={seasonPlays} /> : (
          <div key={sp} className={`${s.dp} ${s.start}`}>
            <span className={s.r}>{sp}</span>
            <span className={s.n}>{id.replace(/^\?/, "")}<small>not on ESPN’s roster</small></span>
            <span className={s.v} />
          </div>
        );
      })}
      {rest.map((p, i) => <SlotRow key={p.id} p={p} i={u.starters + i} u={u} hasGames={hasGames} seasonPlays={seasonPlays} />)}
      <div className={s.caveat}>
        {ol.caption} <a href={ol.source} target="_blank" rel="noopener noreferrer">Source PDF</a>. Snap share: a start counts as about 97% of the team’s plays.
      </div>
    </div>
  );
}

function SlotRow({ p, i, u, hasGames, spot, seasonPlays }: { p: DepthPlayer; i: number; u: DepthSlot; hasGames: boolean; spot?: string; seasonPlays: number }) {
  // share of ALL the team's plays this season, so a backup who played one game isn't shown
  // as if he played a third of every game
  const tot = seasonPlays || p.tp;
  const start = spot != null || i < u.starters;
  const label = spot ?? (start ? (u.starters > 1 ? `${u.slot}${i + 1}` : `${u.slot}1`) : u.starters > 1 ? "—" : `${u.slot}${i + 1}`);
  let right: React.ReactNode;
  if (u.basis === "roster") right = <span className={s.v}><small>{p.cls || ""}</small></span>;
  else if ((MODELED.includes(u.slot) || u.slot === "QB") && p.tp && p.val)
    right = (
      <span className={s.v}>
        {share(p.val, tot)}%
        <small>
          {p.lo != null && p.hi != null ? `${share(p.lo, tot)}–${share(p.hi, tot)}% · ` : ""}
          {u.slot === "QB" ? `${p.val} snaps` : `~${p.val} est.`}
        </small>
      </span>
    );
  else right = <span className={s.v}>{p.val}<small>{unitOf(u.slot, p.val)}{hasGames && p.last ? ` · ${p.last} last` : ""}</small></span>;
  return (
    <Link className={`${s.dp} ${start ? s.start : s.bench}`} href={playerHref(p.name, p.id)}>
      <span className={s.r}>{label}</span>
      <span className={s.n}>
        {p.no != null ? `#${p.no} ` : ""}{p.name}
        <small>{[p.pos, p.cls].filter(Boolean).join(" · ")}{p.g ? ` · ${p.g} G` : ""}{p.gs ? ` · ${p.gs} GS` : ""}</small>
      </span>
      {right}
    </Link>
  );
}

/* The game-by-game table's rows, computed here so the client only gets what it shows. */
function logGroups(PL: PlayersFile): LogGroup[] {
  const defs: [string, (pos: string) => boolean, "qb" | "off" | "def" | "gs"][] = [
    ["Quarterbacks", (p) => p === "QB", "qb"],
    ["Running backs", (p) => ["RB", "FB"].includes(p), "off"],
    ["Receivers & tight ends", (p) => ["WR", "TE"].includes(p), "off"],
    ["Defensive line", (p) => ["DL", "DE", "DT", "NT", "EDGE"].includes(p), "def"],
    ["Linebackers", (p) => ["LB", "OLB", "ILB", "MLB"].includes(p), "def"],
    ["Secondary", (p) => ["CB", "S", "DB", "FS", "SS"].includes(p), "def"],
    ["Offensive line", (p) => ["OL", "OT", "OG", "G", "T", "C", "IOL"].includes(p), "gs"],
  ];
  return defs.map(([label, test, rawKey]) => ({
    label, rawKey,
    players: PL.players
      .filter((p) => p.pos && test(p.pos) && p.pi && ((p.pi.es || 0) > 0 || (p.pi[rawKey] || 0) > 0))
      .map((p) => {
        const byGame = new Map(p.pi!.log.map((r) => [r.id, r]));
        return {
          id: p.id, name: p.name, pos: p.pos!,
          es: PL.games.map((g) => { const r = byGame.get(g.id); return r?.es ?? 0; }),
          esRange: PL.games.map((g) => { const r = byGame.get(g.id); return r?.esLo != null ? [r.esLo, r.esHi!] as [number, number] : null; }),
          raw: PL.games.map((g) => byGame.get(g.id)?.[rawKey] ?? 0),
          esTotal: p.pi!.es || 0,
          rawTotal: p.pi![rawKey] || 0,
        };
      }),
  })).filter((g) => g.players.length);
}
