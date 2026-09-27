"use client";

import { useState } from "react";
import { logo } from "@/lib/logo";
import s from "./live.module.css";

/* The game tracker: how a game unfolded. Line score, the lead over time (stepped at every score),
   lead changes / ties / biggest leads / time in front, every score with the drive that produced
   it and the running score, and every drive. Works for live games and any past game (2014+). */

export type FlowTeam = { id: string; home: boolean; name: string; abbr: string; score: number; logo: string; color: string | null; alt: string | null; lines: number[]; rank: number | null };
export type ScoringPlay = { team: string | null; type: string; abbr: string; text: string; q: number; clock: string; hs: number; as: number };
export type Drive = { team: string | null; res: string; n: number; yds: number; time: string; q: number; clock: string; from: string; to: string; score: boolean };

const OT = 300;                                              // each overtime drawn as 5 "minutes"
const secs = (clock: string) => { const [m, x] = (clock || "0:00").split(":").map(Number); return (m || 0) * 60 + (x || 0); };
/** Game seconds elapsed at a quarter + clock (overtimes are untimed, so they sit at their period start). */
export const elapsed = (q: number, clock: string) => (q <= 4 ? (q - 1) * 900 + (900 - secs(clock)) : 3600 + (q - 5) * OT + OT / 2);
const qName = (q: number) => (q <= 4 ? `Q${q}` : q === 5 ? "OT" : `${q - 4}OT`);
const when = (q: number, clock: string) => (q > 4 ? qName(q) : `${qName(q)} ${clock}`);
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

function hex(c: string) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function dist(a: string, b: string) { const x = hex(a), y = hex(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
/** Two colours that can be told apart: the home colour, and the away colour (or its alternate if they clash). */
function teamColors(home: FlowTeam, away: FlowTeam): [string, string] {
  const h = home.color || "#2d7a3e";
  let a = away.color || "#b45309";
  if (dist(h, a) < 110 && away.alt && dist(h, away.alt) > dist(h, a)) a = away.alt;
  if (dist(h, a) < 60) a = "#9ca3af";
  return [h, a];
}

export function LineScore({ home, away, live }: { home: FlowTeam; away: FlowTeam; live: boolean }) {
  const n = Math.max(4, home.lines.length, away.lines.length);
  if (!home.lines.length && !away.lines.length) return null;
  return (
    <div className="sheet-wrap">
      <table className="sheet dense" style={{ width: "100%" }}>
        <thead><tr><th className="l">Team</th>{Array.from({ length: n }, (_, i) => <th key={i}>{i < 4 ? i + 1 : qName(i + 1)}</th>)}<th>{live ? "Now" : "Final"}</th></tr></thead>
        <tbody>
          {[away, home].map((t) => (
            <tr key={t.id}>
              <td className="l strong">{t.rank ? <span className="dim">{t.rank} </span> : null}{t.name}</td>
              {Array.from({ length: n }, (_, i) => <td key={i}>{t.lines[i] ?? "–"}</td>)}
              <td className="strong">{t.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GameFlow({ home, away, scoring, drives, state, period, clock }: {
  home: FlowTeam; away: FlowTeam; scoring: ScoringPlay[]; drives: Drive[]; state: "pre" | "in" | "post"; period: number; clock: string;
}) {
  const [allDrives, setAllDrives] = useState(false);
  if (state === "pre") return null;
  const [hc, ac] = teamColors(home, away);
  const colorOf = (id: string | null) => (id === home.id ? hc : ac);
  const abbrOf = (id: string | null) => (id === home.id ? home.abbr : away.abbr);
  const logoOf = (id: string | null) => (id === home.id ? home.logo : away.logo);

  // where the game is now (or ended): the lead line runs to here
  const lastQ = Math.max(4, period || 4, ...scoring.map((p) => p.q));
  const end = state === "post" ? (lastQ <= 4 ? 3600 : 3600 + (lastQ - 4) * OT) : Math.max(1, elapsed(period || 1, clock || "15:00"));
  const span = Math.max(3600, lastQ > 4 ? 3600 + (lastQ - 4) * OT : 3600, end);

  // events, in order, with the margin (home − away) after each
  // (entries that don't change the score, like ESPN's "end of game" marker, are dropped; overtime
  // scores are spread evenly across their period since OT has no clock)
  const real = scoring.filter((p, i) => p.hs + p.as > (i ? scoring[i - 1].hs + scoring[i - 1].as : 0));
  const ev = real.map((p) => {
    if (p.q <= 4) return { ...p, t: Math.min(end, elapsed(p.q, p.clock)), m: p.hs - p.as };
    const inQ = real.filter((x) => x.q === p.q), k = inQ.indexOf(p);
    return { ...p, t: 3600 + (p.q - 5) * OT + (OT * (k + 1)) / (inQ.length + 1), m: p.hs - p.as };
  });
  let lead = 0, changes = 0, ties = 0, bigH = { m: 0, e: null as (typeof ev)[number] | null }, bigA = { m: 0, e: null as (typeof ev)[number] | null };
  const lead_t = { h: 0, a: 0, tie: 0 };
  let prevT = 0, prevM = 0;
  for (const e of ev) {
    const dt = e.t - prevT;
    if (prevM > 0) lead_t.h += dt; else if (prevM < 0) lead_t.a += dt; else lead_t.tie += dt;
    const side = Math.sign(e.m);
    if (side && lead && side !== lead) changes++;
    if (side) lead = side;
    if (!side && prevM) ties++;
    if (e.m > bigH.m) bigH = { m: e.m, e };
    if (-e.m > bigA.m) bigA = { m: -e.m, e };
    prevT = e.t; prevM = e.m;
  }
  const dtEnd = end - prevT;
  if (prevM > 0) lead_t.h += dtEnd; else if (prevM < 0) lead_t.a += dtEnd; else lead_t.tie += dtEnd;

  // chart
  const W = 720, H = 240, PADL = 34, PADT = 12, PADB = 26;
  const maxM = Math.max(7, ...ev.map((e) => Math.abs(e.m)));
  const top = Math.ceil(maxM / 7) * 7;
  const X = (t: number) => PADL + (t / span) * (W - PADL - 6), Y = (m: number) => PADT + ((top - m) / (2 * top)) * H;
  let d = `M${X(0)},${Y(0)}`;
  let pm = 0;
  for (const e of ev) { d += `L${X(e.t).toFixed(1)},${Y(pm).toFixed(1)}L${X(e.t).toFixed(1)},${Y(e.m).toFixed(1)}`; pm = e.m; }
  d += `L${X(end).toFixed(1)},${Y(pm).toFixed(1)}`;
  const area = `${d}L${X(end).toFixed(1)},${Y(0)}Z`;
  const uid = `gf${home.id}${away.id}`;
  const ticks = [-top, -top / 2, 0, top / 2, top].filter((v, i, a) => a.indexOf(v) === i);
  const periods = Array.from({ length: lastQ }, (_, i) => i + 1);
  const pStart = (q: number) => (q <= 4 ? (q - 1) * 900 : 3600 + (q - 5) * OT);
  const pEnd = (q: number) => (q <= 4 ? q * 900 : 3600 + (q - 4) * OT);

  // match each score to the drive that produced it: the scoring team's drive that ended at that
  // moment (start + time elapsed). Defensive and return scores have no drive of their own.
  const driveEnd = (dr: Drive) => elapsed(dr.q, dr.clock) + secs(dr.time);
  const driveFor = (p: ScoringPlay & { t: number }) => {
    if (/return|interception|fumble|safety|blocked/i.test(p.type)) return null;
    let best: Drive | null = null, bd = 90;
    for (const dr of drives) {
      if (dr.team !== p.team || !dr.score || /interception|fumble|return|safety/i.test(dr.res) || dr.q > p.q) continue;
      const dd = Math.abs(driveEnd(dr) - p.t);
      if (dd < bd || (p.q > 4 && dr.q === p.q && !best)) { best = dr; bd = dd; }
    }
    return best;
  };
  const withDrive = ev.map((e) => ({ ...e, dr: driveFor(e) }));
  const final = state === "post";
  const winner = home.score > away.score ? home : away.score > home.score ? away : null;

  const tile = (k: string, v: React.ReactNode, sub?: React.ReactNode) => (
    <div className={s.ftile}><div className={s.fk}>{k}</div><div className={s.fv}>{v}</div>{sub && <div className={s.fs}>{sub}</div>}</div>
  );
  const pctLead = (x: number) => Math.round((x / Math.max(1, end)) * 100);
  const resCls = (r: string) => (/touchdown|td/i.test(r) ? s.rTD : /field goal|fg/i.test(r) && !/miss|block/i.test(r) ? s.rFG : /int|fumble|downs|safety|miss|block/i.test(r) ? s.rTO : "");

  return (
    <>
      <section className={s.card}>
        <div className={s.wph}>
          <h2>Game flow</h2>
          <span>{final ? (winner ? `${winner.name} won by ${Math.abs(home.score - away.score)}` : "Tied") : "Live"} · {ev.length} scores</span>
        </div>
        <div className={s.ftiles}>
          {tile("Lead changes", changes, `${ties} time${ties === 1 ? "" : "s"} tied`)}
          {tile(`${home.abbr} biggest lead`, bigH.m ? `+${bigH.m}` : "—", bigH.e ? when(bigH.e.q, bigH.e.clock) : "never led")}
          {tile(`${away.abbr} biggest lead`, bigA.m ? `+${bigA.m}` : "—", bigA.e ? when(bigA.e.q, bigA.e.clock) : "never led")}
          {tile("Time in front", <span><b style={{ color: hc }}>{home.abbr} {pctLead(lead_t.h)}%</b> · <b style={{ color: ac }}>{away.abbr} {pctLead(lead_t.a)}%</b></span>,
            `tied ${pctLead(lead_t.tie)}% · ${mmss(lead_t.h)} vs ${mmss(lead_t.a)} of game clock`)}
        </div>
        <svg viewBox={`0 0 ${W} ${PADT + H + PADB}`} className={s.chart} role="img"
          aria-label={`Score margin over the game: ${changes} lead changes, largest leads ${home.abbr} ${bigH.m}, ${away.abbr} ${bigA.m}`}>
          <defs>
            <clipPath id={`${uid}u`}><rect x={0} y={0} width={W} height={Y(0)} /></clipPath>
            <clipPath id={`${uid}d`}><rect x={0} y={Y(0)} width={W} height={H + PADT} /></clipPath>
          </defs>
          {periods.map((q) => q % 2 === 0 && <rect key={`b${q}`} x={X(pStart(q))} y={PADT} width={X(pEnd(q)) - X(pStart(q))} height={H} fill="var(--text)" opacity={0.03} />)}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PADL} x2={W - 6} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? "var(--text3)" : "var(--border)"} strokeDasharray={v === 0 ? undefined : "3 4"} />
              <text x={PADL - 6} y={Y(v) + 4} textAnchor="end" fontSize={10.5} fill="var(--text3)">{v === 0 ? "Tie" : `+${Math.abs(v)}`}</text>
            </g>
          ))}
          {periods.map((q) => (
            <g key={q}>
              {q > 1 && <line x1={X(pStart(q))} x2={X(pStart(q))} y1={PADT} y2={PADT + H} stroke={q === 3 || q === 5 ? "var(--text3)" : "var(--border)"} strokeDasharray={q === 3 ? "5 4" : undefined} />}
              <text x={X((pStart(q) + pEnd(q)) / 2)} y={PADT + H + 17} textAnchor="middle" fontSize={11} fill="var(--text3)">{qName(q)}</text>
            </g>
          ))}
          <text x={PADL + 6} y={PADT + 14} fontSize={11.5} fontWeight={800} fill={hc} stroke="var(--bg)" strokeWidth={3} paintOrder="stroke">▲ {home.name} ahead</text>
          <text x={PADL + 6} y={PADT + H - 6} fontSize={11.5} fontWeight={800} fill={ac} stroke="var(--bg)" strokeWidth={3} paintOrder="stroke">▼ {away.name} ahead</text>
          <path d={area} fill={hc} opacity={0.32} clipPath={`url(#${uid}u)`} />
          <path d={area} fill={ac} opacity={0.32} clipPath={`url(#${uid}d)`} />
          <path d={d} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
          {ev.map((e, i) => (
            <g key={i}>
              <circle cx={X(e.t)} cy={Y(e.m)} r={5.5} fill={colorOf(e.team)} stroke="var(--bg)" strokeWidth={2}>
                <title>{`${when(e.q, e.clock)} · ${abbrOf(e.team)} ${e.type}: ${e.text} (${away.abbr} ${e.as}, ${home.abbr} ${e.hs})`}</title>
              </circle>
            </g>
          ))}
          {state === "in" && <circle cx={X(end)} cy={Y(pm)} r={4} fill="var(--red)" />}
        </svg>
        <p className="note" style={{ marginTop: 6 }}>
          The lead after every score: above the line {home.name} is ahead, below it {away.name}. Each dot is a score in the scoring team&apos;s colour; hover one.
          {lastQ > 4 ? " Overtime periods are untimed, so each is drawn the same width." : ""}
        </p>
      </section>

      <section className={s.card}>
        <h2>Scoring summary</h2>
        {!withDrive.length && <div className="note">No scores yet.</div>}
        {periods.map((q) => {
          const rows = withDrive.filter((e) => e.q === q);
          if (!rows.length) return null;
          return (
            <div key={q}>
              <div className={s.qhead}>{q <= 4 ? ["1st", "2nd", "3rd", "4th"][q - 1] + " quarter" : qName(q)}</div>
              {rows.map((e, i) => {
                const hl = e.hs > e.as, al = e.as > e.hs;
                return (
                  <div key={i} className={s.srow} style={{ borderLeftColor: colorOf(e.team) }}>
                    <span className={s.sclock}>{e.q > 4 ? "" : e.clock}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo(logoOf(e.team), 28)} alt={abbrOf(e.team)} width={22} height={22} />
                    <div className={s.stext}>
                      <b>{e.abbr || e.type}</b> <span>{e.text}</span>
                      {e.dr && <small>{e.dr.n} play{e.dr.n === 1 ? "" : "s"}, {e.dr.yds} yds{e.q > 4 ? "" : `, ${e.dr.time}`}{e.dr.from ? ` · from ${e.dr.from}` : ""}</small>}
                    </div>
                    <span className={s.srun}>
                      <span style={al ? { fontWeight: 800, color: "var(--text)" } : undefined}>{away.abbr} {e.as}</span>
                      <span className={s.dash}>–</span>
                      <span style={hl ? { fontWeight: 800, color: "var(--text)" } : undefined}>{e.hs} {home.abbr}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      {drives.length > 0 && (
        <section className={s.card}>
          <div className={s.wph}>
            <h2>Drives</h2>
            <span>
              {[home, away].map((t) => {
                const mine = drives.filter((x) => x.team === t.id);
                const pts = mine.filter((x) => x.score).length;
                return <span key={t.id} style={{ marginLeft: 10 }}><b style={{ color: colorOf(t.id) }}>{t.abbr}</b> {pts}/{mine.length} scored</span>;
              })}
            </span>
          </div>
          <div className="sheet-wrap">
            <table className="sheet dense" style={{ width: "100%" }}>
              <thead><tr><th className="l">Q</th><th className="l">Start</th><th className="l">Team</th><th className="l">From</th><th>Plays</th><th>Yds</th><th>Time</th><th className="l">Result</th></tr></thead>
              <tbody>
                {(allDrives ? drives : drives.slice(0, 12)).map((x, i) => (
                  <tr key={i}>
                    <td className="l dim">{qName(x.q)}</td><td className="l dim">{x.clock}</td>
                    <td className="l"><span className={s.dot} style={{ background: colorOf(x.team) }} />{abbrOf(x.team)}</td>
                    <td className="l dim">{x.from}</td><td>{x.n}</td><td>{x.yds}</td><td>{x.time}</td>
                    <td className={`l ${resCls(x.res)}`}>{x.res}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {drives.length > 12 && <button className="chip" onClick={() => setAllDrives(!allDrives)} style={{ marginTop: 10 }}>{allDrives ? "Show first 12" : `Show all ${drives.length} drives`}</button>}
        </section>
      )}
    </>
  );
}
