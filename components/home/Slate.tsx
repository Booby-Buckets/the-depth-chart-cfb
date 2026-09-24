"use client";

import Link from "next/link";
import { useState } from "react";
import type { SlateGame } from "@/lib/data";
import { etDay, etTime } from "@/lib/format";
import styles from "./Slate.module.css";
import { logo } from "@/lib/logo";

type Mode = "top" | "close" | "all";
const MODES: [Mode, string][] = [["top", "Top 25"], ["close", "Toss-ups"], ["all", "All games"]];
const CAP = 12;

const isTop = (g: SlateGame) => (!!g.homeRank && g.homeRank <= 25) || (!!g.awayRank && g.awayRank <= 25);
const isClose = (g: SlateGame) => Math.abs(g.spread) <= 7 && !!g.homeRank && !!g.awayRank;

export default function Slate({ games, logos, slugs }: { games: SlateGame[]; logos: Record<string, string>; slugs: Record<string, string> }) {
  const [mode, setMode] = useState<Mode>(games.some(isTop) ? "top" : "all");
  const [showAll, setShowAll] = useState(false);

  let list = games.filter((g) => mode === "all" || (mode === "top" ? isTop(g) : isClose(g)));
  if (mode === "top") list = [...list].sort((a, b) => Math.min(a.homeRank || 999, a.awayRank || 999) - Math.min(b.homeRank || 999, b.awayRank || 999));
  if (mode === "close") list = [...list].sort((a, b) => Math.abs(a.spread) - Math.abs(b.spread));
  const shown = showAll ? list : list.slice(0, CAP);

  return (
    <>
      <div className={styles.bar}>
        {MODES.map(([k, l]) => (
          <button key={k} className={`chip ${k === mode ? "on" : ""}`} onClick={() => { setMode(k); setShowAll(false); }}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="loading">No games in this view.</div>
      ) : (
        <div className={styles.grid}>
          {shown.map((g) => <GameCard key={g.id} g={g} logos={logos} slugs={slugs} />)}
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

function GameCard({ g, logos, slugs }: { g: SlateGame; logos: Record<string, string>; slugs: Record<string, string> }) {
  const pHome = Math.round(g.homeWin * 100);
  const favName = g.spread >= 0 ? g.homeName : g.awayName;
  const row = (side: "home" | "away") => {
    const id = g[side], rk = side === "home" ? g.homeRank : g.awayRank, name = side === "home" ? g.homeName : g.awayName;
    const sc = side === "home" ? g.hs : g.as, other = side === "home" ? g.as : g.hs;
    return (
      <div key={side} className={`${styles.tm} ${g.completed && sc != null && other != null && sc < other ? styles.lose : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo(logos[id] || `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`, 22)} alt="" loading="lazy" />
        <div>
          {rk && rk <= 25 ? <span className={styles.rk}>{rk}</span> : null}
          {slugs[id] ? <Link className={styles.tl} href={`/teams/${slugs[id]}`}>{name}</Link> : name}
        </div>
        <span className={styles.sc}>{g.completed ? sc : `${side === "home" ? pHome : 100 - pHome}%`}</span>
      </div>
    );
  };
  return (
    <div className={styles.game}>
      <div className={styles.top}>
        <span>{g.completed ? "Final" : `${etDay(g.date)} ${etTime(g.date)} ET`}{g.neutral ? " · Neutral" : ""}</span>
        <span>{g.tv || ""}</span>
      </div>
      {row("away")}
      {row("home")}
      <div className={styles.pbar} title="Away / home win probability">
        <i style={{ width: `${100 - pHome}%`, opacity: 0.35 }} />
        <i style={{ width: `${pHome}%` }} />
      </div>
      <div className={styles.foot}>
        <span>TDC line: <b>{favName} −{Math.abs(g.spread).toFixed(1)}</b></span>
        <span>Total {g.total.toFixed(1)}</span>
      </div>
    </div>
  );
}
