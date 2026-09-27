"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import s from "./plays.module.css";

/* Play Finder: search every play (our EPA + win probability added) by team, player, week, down,
   field position, play type, any numeric column and the play text. State lives in the URL so a
   search can be shared. */

type TeamOpt = { id: string; name: string; abbr: string; logo: string };
type Row = { g: string; seq: string; q: number; clock: string | null; off: string; def: string; home: string; wk: string; date: string;
  down: number | null; dist: number | null; yte: number | null; type: string; yds: number; epa: number | null; wpa: number; text: string; res: string };
type Resp = { n: number; scope: "team" | "top"; rows: Row[]; names: Record<string, [string, string]>; weeks: string[]; error?: string };

const TYPES: [string, string][] = [["", "Any"], ["pass", "Pass"], ["run", "Run"], ["sack", "Sack"], ["dropback", "Dropback"], ["punt", "Punt"], ["fg", "Field goal"], ["pen", "Penalty"]];
const SORTS: [string, string][] = [["epa", "EPA high"], ["-epa", "EPA low"], ["wpa", "WP added high"], ["-wpa", "WP added low"], ["yds", "Yards"], ["time", "Game order"]];
const COLS: [string, string][] = [["", "Any column"], ["epa", "EPA"], ["wpa", "WP added"], ["yds", "Yards gained"], ["down", "Down"], ["dist", "Yards to go"], ["yte", "Yards to end zone"], ["q", "Quarter"]];
const ZONES: [string, string][] = [["", "Anywhere"], ["own", "Own territory"], ["rz", "Red zone"], ["gl", "Inside the 10"], ["third", "3rd / 4th down"]];
const KEYS = ["season", "week", "team", "side", "player", "type", "sort", "down", "q", "zone", "col", "op", "val", "text"] as const;
type F = Record<(typeof KEYS)[number], string>;

const query = (q: F) => new URLSearchParams(Object.entries(q).filter(([k, v]) => v && !(k === "side" && v === "off") && !(k === "op" && v === ">=")) as [string, string][]);
const ord = (n: number) => ["", "1st", "2nd", "3rd", "4th"][n] || `${n}th`;
const sign = (v: number, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d);

export default function PlayFinder({ seasons, current, teams, initial }: { seasons: number[]; current: number; teams: TeamOpt[]; initial: Partial<F> }) {
  const blank: F = { season: String(current), week: "", team: "", side: "off", player: "", type: "", sort: "epa", down: "", q: "", zone: "", col: "", op: ">=", val: "", text: "" };
  const [f, setF] = useState<F>(() => ({ ...blank, ...Object.fromEntries(Object.entries(initial).filter(([k, v]) => (KEYS as readonly string[]).includes(k) && typeof v === "string")) }));
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [players, setPlayers] = useState<{ id: string; name: string; pos: string | null }[]>([]);

  const run = useCallback(async (q: F) => {
    setBusy(true);
    const qs = query(q);
    try { window.history.replaceState(null, "", `/plays?${qs}`); } catch {}
    try { setData(await fetch(`/api/plays?${qs}`).then((r) => r.json())); } catch { setData(null); }
    setBusy(false);
  }, []);

  // first load (a shared search arrives in the URL and is already in the state)
  useEffect(() => {
    let live = true;
    fetch(`/api/plays?${query(f)}`).then((r) => r.json()).then((d: Resp) => { if (live) setData(d); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the chosen team's players, for the player picker
  useEffect(() => {
    if (!f.team) return;
    let live = true;
    const url = Number(f.season) === current ? `/data/players/${f.team}.json` : `/data/seasons/${f.season}/players/${f.team}.json`;
    fetch(url).then((r) => r.json()).then((d: { players: { id: string; name: string; pos: string | null; stats?: Record<string, unknown>; gl?: unknown }[] }) => {
      if (live) setPlayers(d.players.filter((p) => p.gl || (p.stats && Object.keys(p.stats).length)).map((p) => ({ id: p.id, name: p.name, pos: p.pos })).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => { if (live) setPlayers([]); });
    return () => { live = false; };
  }, [f.team, f.season, current]);

  const set = (k: keyof F, v: string, go = true) => {
    const n = { ...f, [k]: v, ...(k === "team" ? { player: "" } : {}), ...(k === "season" ? { week: "", player: "" } : {}) };
    setF(n);
    if (go) run(n);
  };
  const names = data?.names || {};
  const ab = (id: string) => names[id]?.[1] || teams.find((t) => t.id === id)?.abbr || id;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name || names[id]?.[0] || id;
  const fieldSpot = (r: Row) => (r.yte == null ? "" : r.yte === 50 ? "50" : r.yte > 50 ? `${ab(r.off)} ${100 - r.yte}` : `${ab(r.def)} ${r.yte}`);

  const chips: string[] = [];
  if (f.team) chips.push(`${f.side === "def" ? "Defense" : f.side === "any" ? "Team" : "Offense"} = ${ab(f.team)}`);
  if (f.player) chips.push(`Player = ${players.find((p) => p.id === f.player)?.name || f.player}`);
  if (f.week) chips.push(f.week);
  if (f.type) chips.push(`Play = ${TYPES.find((t) => t[0] === f.type)?.[1]}`);
  if (f.down) chips.push(`${ord(Number(f.down))} down`);
  if (f.q) chips.push(f.q === "5" ? "Overtime" : `Q${f.q}`);
  if (f.zone) chips.push(ZONES.find((z) => z[0] === f.zone)![1]);
  if (f.col && f.val) chips.push(`${COLS.find((c) => c[0] === f.col)?.[1]} ${f.op === ">=" ? "≥" : f.op === "<=" ? "≤" : "="} ${f.val}`);
  if (f.text) chips.push(`Text “${f.text}”`);

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <b>PLAY FINDER</b>
        <span>{f.season} · {data ? (data.scope === "top" ? "standout plays, every team" : `${data.n.toLocaleString()} matching plays`) : "…"}</span>
      </div>

      <div className={s.grid}>
        <label>Season<select value={f.season} onChange={(e) => set("season", e.target.value)}>{seasons.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label>Week<select value={f.week} onChange={(e) => set("week", e.target.value)}><option value="">Any</option>{(data?.weeks || []).map((w) => <option key={w}>{w}</option>)}</select></label>
        <label>Team<select value={f.team} onChange={(e) => set("team", e.target.value)}><option value="">Any team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Side<select value={f.side} onChange={(e) => set("side", e.target.value)} disabled={!f.team}><option value="off">Offense</option><option value="def">Defense</option><option value="any">Either</option></select></label>
        <label>Player<select value={f.player} onChange={(e) => set("player", e.target.value)} disabled={!f.team}><option value="">{f.team ? "Any" : "Pick a team first"}</option>{players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.pos ? ` · ${p.pos}` : ""}</option>)}</select></label>
        <label>Play type<select value={f.type} onChange={(e) => set("type", e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Down<select value={f.down} onChange={(e) => set("down", e.target.value)}><option value="">Any</option>{[1, 2, 3, 4].map((d) => <option key={d} value={d}>{ord(d)}</option>)}</select></label>
        <label>Quarter<select value={f.q} onChange={(e) => set("q", e.target.value)}><option value="">Any</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}<option value="5">OT</option></select></label>
        <label>Field<select value={f.zone} onChange={(e) => set("zone", e.target.value)}>{ZONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Sort<select value={f.sort} onChange={(e) => set("sort", e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>

      <form className={s.row2} onSubmit={(e) => { e.preventDefault(); run(f); }}>
        <select value={f.col} onChange={(e) => set("col", e.target.value, false)} aria-label="Column">{COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.op} onChange={(e) => set("op", e.target.value, false)} aria-label="Comparison" className={s.op}><option value=">=">≥</option><option value="<=">≤</option><option value="=">=</option></select>
        <input value={f.val} onChange={(e) => set("val", e.target.value, false)} placeholder="Value" inputMode="decimal" aria-label="Value" className={s.val} />
        <input value={f.text} onChange={(e) => set("text", e.target.value, false)} placeholder="Text in the play description" aria-label="Text" className={s.text} />
        <button type="submit" className={s.go}>{busy ? "…" : "Search"}</button>
        {chips.length > 0 && <button type="button" className={s.clear} onClick={() => { setF(blank); run(blank); }}>Clear</button>}
      </form>

      <div className={s.filters}>
        <span>Filters</span>
        {chips.length ? <><em>INCLUDE</em> {chips.map((c, i) => <b key={i}>{c}</b>)}</> : <i>none: the season&apos;s standout plays, every team</i>}
      </div>

      <div className={s.results} aria-busy={busy}>
        {data && !data.error && !data.rows.length && <div className={s.empty}>No plays match. Loosen a filter.</div>}
        {data?.error && <div className={s.empty}>{data.error}</div>}
        {data?.rows.map((r) => {
          const away = r.home === r.off ? r.def : r.off;
          return (
            <Link key={`${r.g}-${r.seq}`} href={`/games/${r.g}`} className={s.play}>
              <div className={s.desc}>{r.clock ? <span className={s.clock}>({r.clock})</span> : null} {r.text}</div>
              <div className={s.meta}>
                <span>{ab(r.off)} {r.off === away ? "@" : "vs"} {ab(r.def)}</span>
                <span>{r.wk.replace("Week ", "wk ")}</span>
                <span>{r.q > 4 ? "OT" : `Q${r.q}`}{r.clock ? ` ${r.clock}` : ""}</span>
                {r.down ? <span>{r.down}&amp;{r.yte != null && r.dist != null && r.dist >= r.yte ? "Goal" : r.dist}{fieldSpot(r) ? ` at ${fieldSpot(r)}` : ""}</span> : null}
                {r.epa != null && <span className={r.epa >= 0 ? s.pos : s.neg}>EPA {sign(r.epa)}</span>}
                <span className={s.wpa}>WP added {sign(r.wpa * 100, 1)}%</span>
              </div>
            </Link>
          );
        })}
        {data && data.n > data.rows.length && <div className={s.more}>Showing the top {data.rows.length} of {data.n.toLocaleString()}. Add a filter to narrow it.</div>}
      </div>
      <p className={s.foot}>
        {f.team ? `${teamName(f.team)}'s games, every play.` : "With no team picked, this searches the season's ~1,500 standout plays (the biggest EPA, WP and yardage plays across FBS); pick a team to search all of its plays."}
        {" "}Click a play for the full game. Older seasons&apos; play text has no game clock, so those show the quarter only.
      </p>
    </div>
  );
}
