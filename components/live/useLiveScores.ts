"use client";

import { useEffect, useState } from "react";
import type { LiveGame } from "@/lib/livewp";

/* One shared poller of /api/live/scoreboard for every component on the page (the slate, the
   rankings table, a team page's record): every 15s while any game is live, every 5 min otherwise,
   only while a game is within 5 hours of kickoff, and never while the tab is hidden. */

type Map_ = Record<string, LiveGame>;
let data: Map_ = {};
const subs = new Set<(m: Map_) => void>();
const starts = new Set<number>();
let timer: ReturnType<typeof setTimeout> | undefined, running = false;

const soon = () => [...starts].some((t) => Math.abs(t - Date.now()) < 5 * 3600e3);
async function tick() {
  clearTimeout(timer);
  let active = false;
  if (typeof document !== "undefined" && document.visibilityState === "visible" && soon()) {
    try {
      const d = await fetch("/api/live/scoreboard").then((r) => r.json());
      const m: Map_ = {};
      for (const g of d.games as LiveGame[]) m[g.id] = g;
      active = Object.values(m).some((g) => g.state === "in");
      data = m;
      subs.forEach((f) => f(data));
    } catch { /* keep the last good data */ }
  }
  if (subs.size) timer = setTimeout(tick, active ? 15000 : 300000);
  else running = false;
}
function onVis() { if (document.visibilityState === "visible" && subs.size) tick(); }

export function useLiveScores(startTimes: string[]): Map_ {
  const [live, setLive] = useState<Map_>(data);
  useEffect(() => {
    startTimes.forEach((t) => starts.add(Date.parse(t)));
    subs.add(setLive);
    if (!running) { running = true; document.addEventListener("visibilitychange", onVis); tick(); }
    return () => {
      subs.delete(setLive);
      if (!subs.size) { clearTimeout(timer); running = false; document.removeEventListener("visibilitychange", onVis); }
    };
  }, [startTimes]);
  return live;
}

/** Games ESPN has marked final that our last data build hasn't counted yet: the W/L (and conference
 *  W/L) to add to each team's record, so records update within seconds of the final whistle. */
export type RecordDelta = { w: number; l: number; cw: number; cl: number };
export function liveRecordDeltas(games: { id: string; completed: boolean; conf?: boolean }[], live: Map_) {
  const out: Record<string, RecordDelta> = {};
  const add = (t: string, win: boolean, conf: boolean) => {
    const d = (out[t] ||= { w: 0, l: 0, cw: 0, cl: 0 });
    if (win) { d.w++; if (conf) d.cw++; } else { d.l++; if (conf) d.cl++; }
  };
  for (const g of games) {
    const L = live[g.id];
    if (g.completed || !L || L.state !== "post" || L.hs === L.as) continue;
    add(L.home, L.hs > L.as, !!g.conf);           // ESPN's own home/away ids (neutral sites can't flip a win)
    add(L.away, L.as > L.hs, !!g.conf);
  }
  return out;
}

export function useLiveRecords(games: { id: string; date: string; completed: boolean; conf?: boolean }[]) {
  const live = useLiveScores(useStarts(games));
  return liveRecordDeltas(games, live);
}
const _startCache = new WeakMap<object, string[]>();
function useStarts(games: { date: string }[]) {
  let s = _startCache.get(games);
  if (!s) { s = games.map((g) => g.date); _startCache.set(games, s); }
  return s;
}
