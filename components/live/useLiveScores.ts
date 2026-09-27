"use client";

import { useEffect, useState } from "react";
import type { LiveGame } from "@/lib/livewp";

/** Polls /api/live/scoreboard: every 20s while any game is live or about to start, every 5 min
 *  otherwise, and not at all while the tab is hidden. Returns {gameId: LiveGame}. */
export function useLiveScores(startTimes: string[]): Record<string, LiveGame> {
  const [live, setLive] = useState<Record<string, LiveGame>>({});
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => startTimes.some((t) => Math.abs(Date.parse(t) - Date.now()) < 5 * 3600e3);
    async function tick() {
      if (stop) return;
      let active = false;
      if (document.visibilityState === "visible" && soon()) {
        try {
          const d = await fetch("/api/live/scoreboard").then((r) => r.json());
          const map: Record<string, LiveGame> = {};
          for (const g of d.games as LiveGame[]) map[g.id] = g;
          active = Object.values(map).some((g) => g.state === "in");
          if (!stop) setLive(map);
        } catch { /* keep the last good data */ }
      }
      timer = setTimeout(tick, active ? 20000 : 300000);
    }
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
    tick();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [startTimes]);
  return live;
}
