"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { liveWinProb, secsLeft } from "@/lib/livewp";
import { logo } from "@/lib/logo";
import s from "./live.module.css";
import GameFlow, { LineScore, teamColors, type FlowTeam, type ScoringPlay, type Drive } from "./GameFlow";
import { LiveSituation, CurrentDriveCard, BoxScore, type Situation, type CurrentDrive, type PlayerBox } from "./LivePanel";

type Team = FlowTeam;
type Play = { seq: string; type?: string; text?: string; q: number; clock?: string; hs: number; as: number; score: boolean; off: string | null; ytg: number | null; dd: string | null; yds: number };
type Game = { id: string; state: "pre" | "in" | "post"; detail: string; period: number; clock: string; teams: Team[]; plays: Play[]; box: { id: string; stats: [string, string][] }[]; venue: string | null;
  scoring: ScoringPlay[]; drives: Drive[]; line: number | null; date: string | null; season: number | null; note: string | null;
  situation?: Situation | null; currentDrive?: CurrentDrive | null; players?: PlayerBox; fetched?: string };
export type { Game as LiveGame };

export default function LiveGameView({ id, slateSpread, neutral, nets, hfa, slugs, season, initial }: {
  id: string; slateSpread: number | null; season: number; neutral: boolean; nets: Record<string, number>; hfa: number; slugs: Record<string, string>;
  initial?: Game | null;
}) {
  const [g, setG] = useState<Game | null>(initial ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);

  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      let again = 300000;
      try {
        const d = (await fetch(`/api/live/game?id=${id}`).then((r) => r.json())) as Game & { error?: string };
        if (d.error) throw new Error(d.error);
        if (!stop) { setG(d); setErr(""); }
        again = d.state === "in" ? 10000 : d.state === "pre" ? 60000 : 0;
      } catch { if (!stop) setErr("Couldn't reach the live feed; retrying."); again = 15000; }
      if (again && !stop) timer = setTimeout(tick, again);
    }
    // the server already rendered the first copy: poll only while the game isn't over
    const first = initial?.state;
    if (first === "post") return;
    if (first) timer = setTimeout(tick, first === "in" ? 10000 : 60000); else tick();
    // pause while the tab is hidden, catch up the moment it's visible again
    const vis = () => { if (document.visibilityState === "visible" && !stop) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [id, initial?.state]);
  // "updated 8s ago" ticker while live
  useEffect(() => {
    if (g?.state !== "in") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [g?.state]);

  const home = g?.teams.find((t) => t.home), away = g?.teams.find((t) => !t.home);
  const pastNoLine = slateSpread == null && g?.line == null && g?.season != null && g.season !== season;   // current ratings would be wrong for an old game
  const spread = slateSpread ?? g?.line ?? (pastNoLine ? 0 : null) ?? (home && away && nets[home.id] != null && nets[away.id] != null ? nets[home.id] - nets[away.id] + (neutral ? 0 : hfa) : 0);

  // win probability after every play
  const series = useMemo(() => {
    if (!g || !home) return [];
    const pts = [{ t: 0, wp: liveWinProb({ spread, margin: 0, secsLeft: 3600 }), p: null as Play | null }];
    for (const p of g.plays) {
      if (!p.q) continue;
      const left = secsLeft(p.q, p.clock);
      const wp = liveWinProb({ spread, margin: p.hs - p.as, secsLeft: left, ot: p.q >= 5, possHome: p.off ? p.off === home.id : null, ytg: p.ytg });
      pts.push({ t: p.q >= 5 ? 3600 + (p.q - 4) * 60 : 3600 - left, wp, p });
    }
    if (g.state === "post") pts.push({ t: pts[pts.length - 1].t + 1, wp: home.score > (away?.score ?? 0) ? 1 : 0, p: null });
    return pts;
  }, [g, home, away, spread]);

  if (!g) return <div className="loading" style={{ padding: 40 }}>{err || "Loading the game…"}</div>;
  const wpNow = series.length ? series[series.length - 1].wp : 0.5;
  const colors = home && away ? teamColors(home, away) : (["#2d7a3e", "#b45309"] as [string, string]);
  const ago = g.fetched ? Math.max(0, Math.round((now - new Date(g.fetched).getTime()) / 1000)) : null;
  const updated = ago == null ? "just now" : ago < 5 ? "just now" : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`;
  const live = g.state === "in";
  const swings = series.slice(1).map((x, i) => ({ ...x, d: x.wp - series[i].wp })).filter((x) => x.p).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
  const feed = [...g.plays].reverse();
  const T = Math.max(3600, series.length ? series[series.length - 1].t : 3600);
  const W = 720, H = 220, TOP = 18, X = (t: number) => (t / T) * W, Y = (p: number) => TOP + H - p * H;
  const path = series.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.wp).toFixed(1)}`).join("");
  const teamLink = (t?: Team) => (t && slugs[t.id] ? <Link href={`/teams/${slugs[t.id]}`}>{t.name}</Link> : t?.name);

  return (
    <div className={s.wrap}>
      <div className={s.board}>
        {[away, home].map((t) => t && (
          <div key={t.id} className={s.team}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo(t.logo, 56)} alt="" />
            <div className={s.tn}>{teamLink(t)}<small>{t.home ? (neutral ? "Neutral" : "Home") : "Away"}</small></div>
            <div className={s.score}>{g.state === "pre" ? "–" : t.score}</div>
          </div>
        ))}
        <div className={s.status}>
          {g.state === "in" ? <b className={s.live}>LIVE · {g.detail}</b> : <b>{g.detail}</b>}
          <span>{[g.note, g.date ? new Date(g.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : null, g.venue].filter(Boolean).join(" · ")}</span>
        </div>
      </div>

      {live && home && away && <LiveSituation sit={g.situation ?? null} drive={g.currentDrive ?? null} home={home} away={away} colors={colors} wpHome={wpNow} updated={updated} />}
      {live && <CurrentDriveCard drive={g.currentDrive ?? null} teams={g.teams} colors={colors} />}
      {home && away && <LineScore home={home} away={away} live={live} />}
      {!live && home && away && <GameFlow home={home} away={away} scoring={g.scoring || []} drives={g.drives || []} state={g.state} period={g.period} clock={g.clock} />}

      <section className={s.card}>
        <div className={s.wph}>
          <h2>Win probability</h2>
          <span><b>{wpNow >= 0.5 ? home?.name : away?.name} {Math.round(Math.max(wpNow, 1 - wpNow) * 100)}%</b> · {pastNoLine ? "no pregame line on file, so it starts at 50–50" : <>pregame line {spread >= 0 ? home?.name : away?.name} −{Math.abs(spread).toFixed(1)}{slateSpread == null && g.line != null ? " (closing line)" : ""}</>}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${TOP + H + 40}`} className={s.chart} role="img" aria-label={`Win probability chart; ${home?.name} now ${Math.round(wpNow * 100)}%`}>
          {[0.25, 0.5, 0.75].map((p) => <line key={p} x1={0} x2={W} y1={Y(p)} y2={Y(p)} stroke="var(--border)" strokeDasharray={p === 0.5 ? "0" : "3 4"} />)}
          {[900, 1800, 2700].map((t) => <line key={t} x1={X(t)} x2={X(t)} y1={TOP} y2={TOP + H} stroke="var(--border)" />)}
          {["Q1", "Q2", "Q3", "Q4"].map((q, i) => <text key={q} x={X(i * 900 + 450)} y={TOP + H + 15} textAnchor="middle" fontSize={11} fill="var(--text3)">{q}</text>)}
          <text x={0} y={12} fontSize={11} fontWeight={700} fill="var(--text2)">▲ {home?.name}</text>
          <text x={0} y={TOP + H + 34} fontSize={11} fontWeight={700} fill="var(--text2)">▼ {away?.name}</text>
          <path d={path} fill="none" stroke="var(--turf)" strokeWidth={2.5} strokeLinejoin="round" />
          {series.length > 0 && <circle cx={X(series[series.length - 1].t)} cy={Y(wpNow)} r={5} fill="var(--turf)" stroke="var(--bg)" strokeWidth={2} />}
          {swings.map((x) => (
            <circle key={x.p!.seq} cx={X(x.t)} cy={Y(x.wp)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={1.5}>
              <title>{`${x.d > 0 ? home?.name : away?.name} +${Math.abs(Math.round(x.d * 100))}% win probability: ${x.p!.text || ""}`}</title>
            </circle>
          ))}
        </svg>
        <p className="note" style={{ marginTop: 6 }}>
          The pregame line (TDC&apos;s for this week&apos;s games, the closing betting line for past ones), blended with the score, clock and field position (calibrated on every 2024–25 FBS play). Gold dots mark the biggest swings; hover one.
        </p>
      </section>

      {g.players && g.players.length > 0 && <BoxScore box={g.players} teams={g.teams} colors={colors} />}
      {live && home && away && <GameFlow home={home} away={away} scoring={g.scoring || []} drives={g.drives || []} state={g.state} period={g.period} clock={g.clock} />}

      <div className={s.cols}>
        <section className={s.card}>
          <h2>Biggest plays</h2>
          {swings.length ? swings.map((x) => (
            <div key={x.p!.seq} className={s.play}><b>{x.d > 0 ? home?.abbr : away?.abbr} +{Math.abs(Math.round(x.d * 100))}%</b> <span>Q{x.p!.q} {x.p!.clock}</span> {x.p!.text}</div>
          )) : <div className="note">Nothing yet.</div>}
        </section>
        <section className={s.card}>
          <h2>Team stats</h2>
          {g.box.length === 2 ? (
            <table className="sheet dense" style={{ width: "100%" }}>
              <thead><tr><th className="l">Stat</th><th>{g.teams.find((t) => t.id === g.box[0].id)?.abbr}</th><th>{g.teams.find((t) => t.id === g.box[1].id)?.abbr}</th></tr></thead>
              <tbody>{g.box[0].stats.map(([l, v], i) => <tr key={l}><td className="l">{l}</td><td>{v}</td><td>{g.box[1].stats[i]?.[1]}</td></tr>)}</tbody>
            </table>
          ) : <div className="note">Stats appear once the game starts.</div>}
        </section>
      </div>

      <section className={s.card}>
        <h2>Play by play</h2>
        {(all ? feed : feed.slice(0, 25)).map((p) => (
          <div key={p.seq} className={`${s.play} ${p.score ? s.scored : ""}`}>
            <span>Q{p.q} {p.clock}</span>{p.dd ? <i> {p.dd}</i> : null} {p.text}
          </div>
        ))}
        {feed.length > 25 && <button className="chip" onClick={() => setAll(!all)} style={{ marginTop: 10 }}>{all ? "Show latest 25" : `Show all ${feed.length} plays`}</button>}
      </section>
    </div>
  );
}
