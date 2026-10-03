"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLiveScores } from "./useLiveScores";
import { logo } from "@/lib/logo";
import { playerHref } from "@/lib/slug";
import type { SchedGame } from "@/lib/data";
import s from "./live.module.css";

/* Live stat lines outside the game page, while the team is playing (or just finished and the data
   build hasn't caught up): the player page's "Live now" line and the team page's live banner. Uses the
   shared live scoreboard, then the game feed (/api/live/game, edge-cached 5s) for the box score. */

type Cat = { name: string; labels: string[]; rows: { id: string; name: string; pos: string | null; page: boolean; stats: string[] }[] };
type Box = { team: string; cats: Cat[] }[];
type GameFeed = { state: "pre" | "in" | "post"; detail: string; teams: { id: string; home: boolean; abbr: string; name: string; score: number; logo: string }[];
  players?: Box; situation?: { text: string | null; spot: string | null; redZone: boolean; lastPlay: string | null } | null };

/** The team's game that's live now (or went final since the last build), and its feed, refreshed while live. */
function useTeamGame(schedule: SchedGame[]) {
  const open = useMemo(() => schedule.filter((g) => !g.completed), [schedule]);
  const starts = useMemo(() => open.map((g) => g.date), [open]);
  const live = useLiveScores(starts);
  const g = open.find((x) => live[x.id] && live[x.id].state !== "pre");
  const id = g?.id ?? null, state = g ? live[g.id].state : null;
  const [feed, setFeed] = useState<GameFeed | null>(null);
  useEffect(() => {
    if (!id) return;
    let stop = false, t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try { const d = (await fetch(`/api/live/game?id=${id}`).then((r) => r.json())) as GameFeed; if (!stop) setFeed(d); } catch { /* keep last */ }
      if (!stop && state === "in") t = setTimeout(tick, 15000);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [id, state]);
  return id && feed ? { id, feed } : null;
}

function Header({ id, f }: { id: string; f: GameFeed }) {
  const H = f.teams.find((t) => t.home), A = f.teams.find((t) => !t.home);
  const live = f.state === "in";
  return (
    <>
      <div className={s.llH}>
        <span className={live ? s.llLive : ""}>{live ? <><i />LIVE · </> : null}{f.detail}</span>
        <Link href={`/games/${id}`}>{live ? "Watch live →" : "Box score →"}</Link>
      </div>
      {A && H && (
        <div className={s.llSc}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo(A.logo, 28)} alt="" /><span>{A.abbr}</span><b>{A.score}</b><span className="dim">–</span><b>{H.score}</b><span>{H.abbr}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo(H.logo, 28)} alt="" />
        </div>
      )}
      {live && f.situation?.text && <div className={s.llSit}><b>{f.situation.text}</b>{f.situation.redZone ? " · red zone" : ""}</div>}
    </>
  );
}

const SHOW: Record<string, string[]> = {
  passing: ["C/ATT", "YDS", "TD", "INT"], rushing: ["CAR", "YDS", "TD", "LONG"], receiving: ["REC", "YDS", "TD", "LONG"],
  defensive: ["TOT", "SOLO", "SACKS", "TFL", "PD"], interceptions: ["INT", "YDS", "TD"], kicking: ["FG", "XP", "PTS"], punting: ["NO", "AVG"],
};
const LABEL: Record<string, string> = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", interceptions: "Interceptions", kicking: "Kicking", punting: "Punting" };

/** Player page: the player's line in today's game, by category. */
export function LivePlayerLine({ pid, schedule }: { pid: string; schedule: SchedGame[] }) {
  const tg = useTeamGame(schedule);
  if (!tg) return null;
  const lines = (tg.feed.players || []).flatMap((t) => t.cats.flatMap((c) => {
    const r = c.rows.find((x) => String(x.id) === String(pid));
    return r && SHOW[c.name] ? [{ cat: c.name, cells: SHOW[c.name].map((k) => [k, r.stats[c.labels.indexOf(k)]] as [string, string]).filter(([, v]) => v != null) }] : [];
  }));
  return (
    <div className={`${s.ll} ${tg.feed.state === "in" ? s.llOn : ""}`}>
      <Header id={tg.id} f={tg.feed} />
      {lines.length ? (
        <div className={s.llLines}>
          {lines.map((l) => (
            <div key={l.cat}><span className={s.llCat}>{LABEL[l.cat]}</span>{l.cells.map(([k, v]) => <span key={k} className={s.llStat}><b>{v}</b> {k === "C/ATT" ? "C/ATT" : k}</span>)}</div>
          ))}
        </div>
      ) : <div className={s.llNote}>No stats in this game yet.</div>}
      {tg.feed.state === "in" && <div className={s.llNote}>Updates every 15 seconds.</div>}
    </div>
  );
}

/** Team page: the live score + each side's leading passer, rusher and receiver. */
export function LiveTeamBanner({ schedule }: { schedule: SchedGame[] }) {
  const tg = useTeamGame(schedule);
  if (!tg) return null;
  const f = tg.feed;
  const lead = (team: string, cat: string, fmt: (r: Cat["rows"][number], c: Cat) => string) => {
    const c = f.players?.find((t) => t.team === team)?.cats.find((x) => x.name === cat);
    const r = c?.rows[0];
    return r && c ? { r, txt: fmt(r, c) } : null;
  };
  const v = (r: Cat["rows"][number], c: Cat, k: string) => r.stats[c.labels.indexOf(k)];
  const order = [f.teams.find((t) => !t.home), f.teams.find((t) => t.home)].filter(Boolean) as GameFeed["teams"];
  return (
    <div className={`${s.ll} ${f.state === "in" ? s.llOn : ""}`}>
      <Header id={tg.id} f={f} />
      <div className={s.llTops}>
        {order.map((t) => (
          <div key={t.id}>
            <h4>{t.name}</h4>
            {[lead(t.id, "passing", (r, c) => `${v(r, c, "C/ATT")}, ${v(r, c, "YDS")} yds, ${v(r, c, "TD")} TD, ${v(r, c, "INT")} INT`),
              lead(t.id, "rushing", (r, c) => `${v(r, c, "CAR")} car, ${v(r, c, "YDS")} yds, ${v(r, c, "TD")} TD`),
              lead(t.id, "receiving", (r, c) => `${v(r, c, "REC")} rec, ${v(r, c, "YDS")} yds, ${v(r, c, "TD")} TD`)]
              .filter(Boolean).map((x) => (
                <div key={x!.r.id + x!.txt}>{x!.r.page ? <Link href={playerHref(x!.r.name, x!.r.id)}><b>{x!.r.name}</b></Link> : <b>{x!.r.name}</b>} · {x!.txt}</div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
