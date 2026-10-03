"use client";

import Link from "next/link";
import { useState } from "react";
import { logo } from "@/lib/logo";
import { playerHref } from "@/lib/slug";
import type { FlowTeam } from "./GameFlow";
import s from "./live.module.css";

/* The live part of the game page: who has the ball and where (down & distance, a field with the
   drive drawn on it, red zone, timeouts), the drive in progress, the last play, and each team's
   player box score (which also shows for finished games). */

export type Situation = { down: number | null; distance: number | null; text: string | null; short: string | null; spot: string | null; poss: string | null;
  redZone: boolean; homeTO: number | null; awayTO: number | null; lastPlay: string | null; lastTeam: string | null; lastDrive: string | null };
export type CurrentDrive = { team: string | null; desc: string; start: string; startYte: number | null;
  plays: { seq: string; text: string; dd: string | null; yds: number; type: string; endYte: number | null; q: number; clock: string }[] };
export type BoxCat = { name: string; labels: string[]; rows: { id: string; name: string; pos: string | null; page: boolean; stats: string[] }[] };
export type PlayerBox = { team: string; cats: BoxCat[] }[];

/** A 100-yard field, the possessing team driving toward the right. Ball spot, line to gain, drive start. */
function Field({ off, def, offColor, defColor, yte, startYte, toGo }: { off: FlowTeam; def: FlowTeam; offColor: string; defColor: string; yte: number | null; startYte: number | null; toGo: number | null }) {
  const W = 720, H = 92, EZ = 50, PX = (W - 2 * EZ) / 100;
  const X = (y: number) => EZ + (100 - y) * PX;                    // y = yards to the end zone on the right
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.field} role="img"
      aria-label={`${off.name} ball${yte != null ? `, ${yte} yards from the end zone` : ""}${toGo ? `, ${toGo} to go` : ""}`}>
      <rect x={0} y={0} width={W} height={H} rx={8} fill="#2f7d40" />
      <rect x={0} y={0} width={EZ} height={H} rx={8} fill={offColor} opacity={0.85} />
      <rect x={W - EZ} y={0} width={EZ} height={H} rx={8} fill={defColor} opacity={0.85} />
      <text x={EZ / 2} y={H / 2} fill="#fff" fontSize={13} fontWeight={800} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90 ${EZ / 2} ${H / 2})`}>{off.abbr}</text>
      <text x={W - EZ / 2} y={H / 2} fill="#fff" fontSize={13} fontWeight={800} textAnchor="middle" dominantBaseline="middle" transform={`rotate(90 ${W - EZ / 2} ${H / 2})`}>{def.abbr}</text>
      {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((y) => (
        <line key={y} x1={X(y)} x2={X(y)} y1={4} y2={H - 4} stroke="#fff" strokeOpacity={y % 10 === 0 ? 0.55 : 0.25} strokeWidth={y === 50 ? 2 : 1} />
      ))}
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
        <text key={y} x={X(y)} y={H - 8} fill="#fff" fillOpacity={0.7} fontSize={10} fontWeight={700} textAnchor="middle">{y > 50 ? 100 - y : y}</text>
      ))}
      {startYte != null && yte != null && startYte > yte && (
        <rect x={X(startYte)} y={H / 2 - 7} width={X(yte) - X(startYte)} height={14} rx={3} fill={offColor} opacity={0.9} stroke="#fff" strokeOpacity={0.6} />
      )}
      {yte != null && toGo != null && toGo > 0 && yte - toGo > 0 && (
        <line x1={X(yte - toGo)} x2={X(yte - toGo)} y1={4} y2={H - 4} stroke="#facc15" strokeWidth={3} />
      )}
      {yte != null && (
        <g>
          <line x1={X(yte)} x2={X(yte)} y1={4} y2={H - 4} stroke="#60a5fa" strokeWidth={3} />
          <ellipse cx={X(yte)} cy={H / 2} rx={9} ry={6} fill="#8b4513" stroke="#fff" strokeWidth={1.5} />
        </g>
      )}
    </svg>
  );
}

function Timeouts({ n }: { n: number | null }) {
  if (n == null) return null;
  return <span className={s.tos} aria-label={`${n} timeouts left`}>{[0, 1, 2].map((i) => <i key={i} className={i < n ? s.on : ""} />)}</span>;
}

export function LiveSituation({ sit, drive, home, away, colors, wpHome, updated }: {
  sit: Situation | null; drive: CurrentDrive | null; home: FlowTeam; away: FlowTeam; colors: [string, string]; wpHome: number; updated: string;
}) {
  const poss = sit?.poss ? String(sit.poss) : drive?.team ?? null;
  const off = poss === home.id ? home : poss === away.id ? away : null;
  const def = off ? (off.id === home.id ? away : home) : null;
  const oc = off?.id === home.id ? colors[0] : colors[1], dc = off?.id === home.id ? colors[1] : colors[0];
  const yte = drive?.plays?.[0]?.endYte ?? null;
  const fav = wpHome >= 0.5 ? home : away;
  return (
    <section className={`${s.card} ${s.liveCard}`}>
      <div className={s.sitRow}>
        <div className={s.sitMain}>
          {off ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo(off.logo, 40)} alt="" width={28} height={28} />
              <div>
                <b className={s.dd}>{sit?.text || sit?.short || "Ball in play"}</b>
                <span>{off.name} ball{sit?.redZone ? <em className={s.rz}>RED ZONE</em> : null}</span>
              </div>
            </>
          ) : <div><b className={s.dd}>{sit?.lastPlay ? "Between plays" : "Waiting for the next snap"}</b></div>}
        </div>
        <div className={s.sitSide}>
          <div><span>{away.abbr}</span><Timeouts n={sit?.awayTO ?? null} /></div>
          <div><span>{home.abbr}</span><Timeouts n={sit?.homeTO ?? null} /></div>
        </div>
        <div className={s.sitWp}>
          <span>Win probability</span>
          <b>{fav.abbr} {Math.round(Math.max(wpHome, 1 - wpHome) * 100)}%</b>
          <div className={s.wpBar}><i style={{ width: `${(1 - wpHome) * 100}%`, background: colors[1] }} /><i style={{ width: `${wpHome * 100}%`, background: colors[0] }} /></div>
        </div>
      </div>
      {off && def && <Field off={off} def={def} offColor={oc} defColor={dc} yte={yte} startYte={drive?.startYte ?? null} toGo={sit?.distance ?? null} />}
      {sit?.lastPlay && <div className={s.lastPlay}><span>Last play</span> {sit.lastPlay}</div>}
      <div className={s.updated}>Updated {updated} · refreshes every 10 seconds</div>
    </section>
  );
}

export function CurrentDriveCard({ drive, teams, colors }: { drive: CurrentDrive | null; teams: FlowTeam[]; colors: [string, string] }) {
  if (!drive || !drive.plays.length) return null;
  const t = teams.find((x) => x.id === drive.team);
  const c = t?.home ? colors[0] : colors[1];
  return (
    <section className={s.card}>
      <div className={s.wph}><h2>Current drive{t ? `: ${t.name}` : ""}</h2><span>{drive.desc}{drive.start ? ` · started at ${drive.start}` : ""}</span></div>
      {drive.plays.map((p, i) => (
        <div key={`${p.seq}-${i}`} className={`${s.dplay} ${i === 0 ? s.latest : ""}`} style={{ borderLeftColor: c }}>
          <span className={s.ddsm}>{p.dd || p.type}</span>
          <span className={s.dtext}>{p.text}</span>
          <b className={p.yds > 0 ? s.gain : p.yds < 0 ? s.loss : ""}>{p.yds > 0 ? "+" : ""}{p.yds}</b>
        </div>
      ))}
    </section>
  );
}

const CAT_LABEL: Record<string, string> = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", interceptions: "Interceptions", kicking: "Kicking", punting: "Punting" };
const DEF_KEEP = ["TOT", "SOLO", "SACKS", "TFL", "PD", "QB HUR"];

export function BoxScore({ box, teams, colors }: { box: PlayerBox; teams: FlowTeam[]; colors: [string, string] }) {
  const order = [teams.find((t) => !t.home), teams.find((t) => t.home)].filter(Boolean) as FlowTeam[];
  const [tid, setTid] = useState(order[0]?.id);
  if (!box?.length) return null;
  const T = box.find((b) => b.team === tid) || box[0];
  return (
    <section className={s.card}>
      <div className={s.wph}>
        <h2>Box score</h2>
        <span style={{ display: "flex", gap: 6 }}>
          {order.map((t) => (
            <button key={t.id} className={`chip ${t.id === T.team ? "on" : ""}`} onClick={() => setTid(t.id)} style={{ fontSize: 12 }}>
              <span className={s.dot} style={{ background: t.home ? colors[0] : colors[1] }} />{t.name}
            </button>
          ))}
        </span>
      </div>
      <div className={s.boxGrid}>
        {T.cats.filter((c) => c.rows.length).map((c) => {
          const keep = c.name === "defensive" ? c.labels.map((l, i) => (DEF_KEEP.includes(l) ? i : -1)).filter((i) => i >= 0) : c.labels.map((_, i) => i);
          const rows = c.name === "defensive" ? c.rows.slice(0, 8) : c.rows;
          return (
            <div key={c.name} className="sheet-wrap">
              <table className="sheet dense" style={{ width: "100%" }}>
                <thead><tr><th className="l">{CAT_LABEL[c.name] || c.name}</th>{keep.map((i) => <th key={i}>{c.labels[i]}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id + c.name}>
                      <td className="l">{r.page ? <Link href={playerHref(r.name, r.id)} className={s.plink}>{r.name}</Link> : r.name}{r.pos ? <span className="dim"> {r.pos}</span> : null}</td>
                      {keep.map((i) => <td key={i}>{r.stats[i]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}
