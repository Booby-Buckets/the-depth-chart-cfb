"use client";

import { useMemo } from "react";
import type { SchedGame } from "@/lib/data";
import { useLiveRecords } from "@/components/live/useLiveScores";

/** The team header's record, plus any game ESPN has marked final that the last data build hasn't
 *  counted yet (records update within seconds; ratings catch up on the next build). */
export default function LiveRecord({ tid, w, l, cw, cl, ind, past, schedule }: {
  tid: string; w: number; l: number; cw: number; cl: number; ind: boolean; past: boolean; schedule: SchedGame[];
}) {
  // games the build hasn't marked finished (the live feed only carries this week's, so older ones never match)
  const games = useMemo(() => past ? [] : schedule.filter((g) => !g.completed)
    .map((g) => ({ id: g.id, date: g.date, completed: false, conf: g.conf })), [schedule, past]);
  const d = useLiveRecords(games)[tid];
  const W = w + (d?.w ?? 0), L = l + (d?.l ?? 0), CW = cw + (d?.cw ?? 0), CL = cl + (d?.cl ?? 0);
  return (
    <>
      <b title={d ? "Includes a game that just went final" : undefined}>{W}-{L}{d ? <sup style={{ color: "var(--red)", fontSize: "0.4em", marginLeft: 3 }}>●</sup> : null}</b>
      <span>{ind ? (past ? "Final record" : "Overall record") : `${CW}-${CL} in conference`}</span>
    </>
  );
}
