"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLiveScores } from "@/components/live/useLiveScores";
import { liveWinProb, secsLeft, ytgFrom, type LiveGame } from "@/lib/livewp";
import type { SlateGame } from "@/lib/data";
import { etDay, etTime } from "@/lib/format";
import styles from "./Slate.module.css";
import { logo } from "@/lib/logo";

/* This week's games, split by status (Live / Upcoming / Final, counts update as games start and
   end) and filtered by Top 25 / Toss-ups / All. Each card reads like a scoreboard:
   [logo] Away 21 – 20 Home [logo], with the live situation or our pregame line underneath. */

type Status = "in" | "pre" | "post";
type Mode = "top" | "close" | "all";
const MODES: [Mode, string][] = [["top", "Top 25"], ["close", "Toss-ups"], ["all", "All games"]];
const TABS: [Status, string][] = [["in", "Live"], ["pre", "Upcoming"], ["post", "Final"]];
const CAP = 12;

const isTop = (g: SlateGame) => (!!g.homeRank && g.homeRank <= 25) || (!!g.awayRank && g.awayRank <= 25);
const isClose = (g: SlateGame) => Math.abs(g.spread) <= 7;
const topRank = (g: SlateGame) => Math.min(g.homeRank || 999, g.awayRank || 999);

export default function Slate({ games, logos, slugs, abbrs }: { games: SlateGame[]; logos: Record<string, string>; slugs: Record<string, string>; abbrs: Record<string, string> }) {
  const starts = useMemo(() => games.map((g) => g.date), [games]);
  const live = useLiveScores(starts);
  const statusOf = (g: SlateGame): Status => live[g.id]?.state ?? (g.completed ? "post" : "pre");
  const counts = { in: 0, pre: 0, post: 0 } as Record<Status, number>;
  for (const g of games) counts[statusOf(g)]++;

  const [tab, setTab] = useState<Status | null>(null);          // null = pick for the reader
  const [mode, setMode] = useState<Mode>("all");
  const [showAll, setShowAll] = useState(false);
  const cur: Status = tab ?? (counts.in ? "in" : counts.pre ? "pre" : "post");

  let list = games.filter((g) => statusOf(g) === cur && (mode === "all" || (mode === "top" ? isTop(g) : isClose(g))));
  list = [...list].sort((a, b) =>
    cur === "post" ? b.date.localeCompare(a.date) || topRank(a) - topRank(b)
      : cur === "in" ? topRank(a) - topRank(b) || a.date.localeCompare(b.date)
      : a.date.localeCompare(b.date) || topRank(a) - topRank(b));
  const shown = showAll ? list : list.slice(0, CAP);

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.tabs} role="tablist" aria-label="Game status">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={k === cur} className={`${styles.tab} ${k === cur ? styles.on : ""} ${k === "in" && counts.in ? styles.hot : ""}`}
              onClick={() => { setTab(k); setShowAll(false); }} disabled={!counts[k]}>
              {k === "in" && counts.in ? <i className={styles.pulse} aria-hidden /> : null}{l} <span>{counts[k]}</span>
            </button>
          ))}
        </span>
        <span className={styles.modes}>
          {MODES.map(([k, l]) => (
            <button key={k} className={`chip ${k === mode ? "on" : ""}`} onClick={() => { setMode(k); setShowAll(false); }} style={{ fontSize: 11, padding: "4px 10px" }}>{l}</button>
          ))}
        </span>
      </div>
      {list.length === 0 ? (
        <div className={styles.empty}>No {cur === "in" ? "live" : cur === "pre" ? "upcoming" : "finished"} games in this view.</div>
      ) : (
        <div className={styles.grid}>
          {shown.map((g) => <GameCard key={g.id} g={g} logos={logos} slugs={slugs} abbrs={abbrs} live={live[g.id]} />)}
        </div>
      )}
      {list.length > CAP && (
        <div className={styles.more}>
          <button className="chip" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${list.length} games`}</button>
        </div>
      )}
    </>
  );
}

function GameCard({ g, logos, slugs, abbrs, live }: { g: SlateGame; logos: Record<string, string>; slugs: Record<string, string>; abbrs: Record<string, string>; live?: LiveGame }) {
  const isLive = live?.state === "in";
  const isFinal = g.completed || live?.state === "post";
  const hs = live && live.state !== "pre" ? live.hs : g.hs, as = live && live.state !== "pre" ? live.as : g.as;
  const offAbbr = live?.poss === live?.home ? live?.homeAbbr : live?.awayAbbr;
  const wpLive = isLive && live ? liveWinProb({
    spread: g.spread, margin: live.hs - live.as, secsLeft: secsLeft(live.period, live.clock), ot: live.period >= 5,
    possHome: live.poss ? live.poss === live.home : null, ytg: ytgFrom(live.possText ?? undefined, offAbbr),
  }) : null;
  const pHome = Math.round((wpLive ?? g.homeWin) * 100);
  const ab = (id: string, name: string) => abbrs[id] || name;
  const favId = g.spread >= 0 ? g.home : g.away, favName = g.spread >= 0 ? g.homeName : g.awayName;

  const side = (s: "home" | "away") => {
    const id = g[s], rk = s === "home" ? g.homeRank : g.awayRank, name = s === "home" ? g.homeName : g.awayName;
    const sc = s === "home" ? hs : as, other = s === "home" ? as : hs;
    const lose = isFinal && sc != null && other != null && sc < other;
    const pct = s === "home" ? pHome : 100 - pHome;
    return (
      <div className={`${styles.side} ${s === "home" ? styles.homeSide : ""} ${lose ? styles.lose : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo(logos[id] || `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`, 28)} alt="" loading="lazy" />
        <span className={styles.nm}>
          {rk && rk <= 25 ? <span className={styles.rk}>{rk}</span> : null}
          {(() => { const label = <><span className={styles.full}>{name}</span><span className={styles.short}>{ab(id, name)}</span></>;
            return slugs[id] ? <Link className={styles.tl} href={`/teams/${slugs[id]}`} title={name}>{label}</Link> : <span title={name}>{label}</span>; })()}
          {isLive && live?.poss === id && <span className={styles.poss} title="Has the ball">●</span>}
        </span>
        <span className={isFinal || isLive ? styles.sc : styles.pct}>{isFinal || isLive ? sc : `${pct}%`}</span>
      </div>
    );
  };

  return (
    <div className={`${styles.game} ${isLive ? styles.liveGame : ""}`}>
      <Link href={`/games/${g.id}`} className={styles.cover} aria-label={`${g.awayName} at ${g.homeName}: ${isLive ? "watch live" : isFinal ? "game recap" : "game preview"}`} />
      <div className={styles.top}>
        <span>
          {isLive ? <b className={styles.live}>● LIVE · {live!.detail}</b> : isFinal ? <b>{live?.detail || "Final"}</b> : `${etDay(g.date)} ${etTime(g.date)} ET`}
          {g.neutral ? " · Neutral" : ""}
        </span>
        <span>{g.tv || ""}</span>
      </div>
      <div className={styles.board}>
        {side("away")}
        <span className={styles.dash} aria-hidden>{isFinal || isLive ? "–" : "vs"}</span>
        {side("home")}
      </div>
      {isLive && (live?.dd || live?.lastPlay) ? (
        <div className={styles.sit}>{live?.dd ? <b>{live.dd}{live.possText ? ` at ${live.possText}` : ""}{live.redZone ? " · red zone" : ""}</b> : null}{live?.lastPlay ? <span> {live.lastPlay}</span> : null}</div>
      ) : null}
      <div className={styles.pbar} title={isLive ? `Live win probability: ${g.awayName} ${100 - pHome}%, ${g.homeName} ${pHome}%` : `Win probability: ${g.awayName} ${100 - pHome}%, ${g.homeName} ${pHome}%`}>
        <i style={{ width: `${100 - pHome}%` }} className={styles.pa} />
        <i style={{ width: `${pHome}%` }} />
      </div>
      <div className={styles.foot}>
        {isLive ? (
          <span>Win prob <b>{ab(pHome >= 50 ? g.home : g.away, pHome >= 50 ? g.homeName : g.awayName)} {Math.max(pHome, 100 - pHome)}%</b></span>
        ) : isFinal ? (
          <span>TDC had <b>{ab(favId, favName)} −{Math.abs(g.spread).toFixed(1)}</b></span>
        ) : (
          <span>TDC <b>{ab(favId, favName)} −{Math.abs(g.spread).toFixed(1)}</b> · O/U {g.total.toFixed(1)}</span>
        )}
        {isLive ? <span className={styles.watch}>Watch live →</span> : isFinal ? <span className={styles.go}>Recap →</span> : <span className={styles.go}>Preview →</span>}
      </div>
    </div>
  );
}
