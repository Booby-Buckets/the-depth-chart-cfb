"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import t from "./tool.module.css";

/* Tier 2 charting tool: the owner watches a game and charts what the play-by-play can't say —
   where the QB threw from, exactly where the ball went, pressure, play action, coverage, route,
   run concept and gap. Plays come pre-filled from ESPN; everything is optional; Enter saves and
   moves on. Saved to Supabase through /api/chart/* (passcode in the x-chart-pass header). */

type TeamOpt = { id: string; name: string; logo: string };
type Play = {
  seq: string; type: string; text: string; q: number; clock: string; wall?: string; down?: number; dist?: number;
  ytg?: number; dd?: string; yds: number; off: string | null; def: string | null;
};
type Saved = { seq: string; kind: string | null; data: ChartData; updated_at?: string };
type Pt = { x: number; y: number };
export type ChartData = {
  launch?: Pt; target?: Pt; platform?: string; pressure?: string; pSrc?: string; pa?: boolean; rpo?: boolean;
  screen?: boolean; motion?: boolean; route?: string; cov?: string; drop?: boolean; contested?: boolean;
  throwaway?: boolean; batted?: boolean; bt?: number; poa?: Pt; contact?: Pt; concept?: string; gap?: string;
  box?: string; window?: string; notes?: string;
};
type Game = { id: string; season: number; status?: string; teams: { id: string; name: string; abbr: string; logo: string; home: boolean }[]; plays: Play[]; saved: Record<string, Saved> };
type SchedRow = { id: string; date: string; week: string; oppName: string; site: string; completed: boolean; res?: string; pf?: number; pa?: number };

const PASS_KEY = "tdc_chart_pass";
const W = 53.33, Y0 = -15, Y1 = 45, PX = 10;              // field window: 15 yds behind the LOS to 45 past it
const toPx = (p: Pt) => ({ cx: p.x * PX, cy: (Y1 - p.y) * PX });
const r1 = (v: number) => Math.round(v * 2) / 2;          // half-yard precision is plenty

const kindOf = (p: Play) =>
  /Sack/.test(p.type) ? "sack" : /Rush/.test(p.type) ? (/scramble/i.test(p.text) ? "pass" : "run") : /Pass|Interception/.test(p.type) ? "pass" : "other";

const OPTS = {
  platform: ["Pocket", "Moved in pocket", "Roll left", "Roll right", "Scramble"],
  pressure: ["None", "Hurried", "Hit", "Sacked"],
  pSrc: ["Left edge", "Interior", "Right edge", "Blitz", "Unblocked", "Coverage sack"],
  route: ["Screen", "Flat", "Slant", "Hitch/Curl", "Out", "Dig/In", "Crosser", "Comeback", "Corner", "Post", "Seam", "Go", "Wheel", "Back-shoulder", "Other"],
  cov: ["Man", "Zone", "Cover 0", "Cover 1", "Cover 2", "Cover 3", "Cover 4", "Cover 6", "Can't tell"],
  concept: ["Inside zone", "Outside zone", "Duo", "Power", "Counter", "Trap", "Draw", "Sweep/Jet", "Option", "QB design", "QB scramble", "Other"],
  gap: ["D-L", "C-L", "B-L", "A-L", "A-R", "B-R", "C-R", "D-R"],
  box: ["5", "6", "7", "8+"],
  window: ["Tight", "Normal", "Open"],
};

function hintFromText(text: string) {
  const out: string[] = [];
  const z = text.match(/\b(short|deep)\s+(left|middle|right)/);
  if (z) out.push(`${z[1]} ${z[2]}`);
  const r = text.match(/\brush (left|middle|right)/);
  if (r) out.push(`run ${r[1]}`);
  if (/hurried/.test(text)) out.push("QB hurried");
  if (/broken up/.test(text)) out.push("broken up");
  if (/Shotgun/.test(text)) out.push("shotgun");
  return out.join(" · ");
}

export default function ChartTool({ teams }: { teams: TeamOpt[] }) {
  const [pass, setPass] = useState<string | null>(null);
  const [gateErr, setGateErr] = useState("");
  const [tid, setTid] = useState("");
  const [sched, setSched] = useState<SchedRow[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [side, setSide] = useState<"team" | "both">("team");
  const [cur, setCur] = useState(0);
  const [draft, setDraft] = useState<ChartData>({});
  const [mode, setMode] = useState<"launch" | "target" | "poa" | "contact">("target");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // passcode remembered on this device only
  const tryPass = useCallback(async (p: string) => {
    const r = await fetch("/api/chart/auth", { method: "POST", headers: { "x-chart-pass": p } });
    if (r.ok) { setPass(p); try { localStorage.setItem(PASS_KEY, p); } catch {} setGateErr(""); return; }
    setGateErr(r.status === 503 ? "Charting storage isn't set up yet (Supabase keys missing in Vercel)." : "Wrong passcode.");
  }, []);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(PASS_KEY); } catch {}
    if (!saved) return;
    let live = true;
    fetch("/api/chart/auth", { method: "POST", headers: { "x-chart-pass": saved } }).then((r) => {
      if (live && r.ok) setPass(saved);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function pickTeam(id: string) {
    setTid(id); setGame(null); setSched([]);
    if (!id) return;
    const d = await fetch(`/data/teams/${id}.json`).then((r) => r.json());
    setSched((d.schedule as SchedRow[]).filter((g) => g.completed || /In Progress|Half|Q[1-4]|OT/i.test(String((g as { detail?: string }).detail || ""))).reverse());
  }

  async function pickGame(id: string) {
    if (!id || !pass) return;
    setLoadErr(""); setGame(null); setStatus("Loading plays…");
    const r = await fetch(`/api/chart/game?id=${id}`, { headers: { "x-chart-pass": pass } });
    if (!r.ok) { setLoadErr(`Couldn't load the game (${r.status}).`); setStatus(""); return; }
    const g = (await r.json()) as Game;
    setGame(g);
    const first = g.plays.findIndex((p) => (p.off === tid) && !g.saved[p.seq]);
    openPlay(g, Math.max(0, first));
    setStatus("");
  }

  const list = useMemo(() => (game ? game.plays.map((p, i) => ({ p, i })).filter(({ p }) => side === "both" || p.off === tid) : []), [game, side, tid]);
  const play = game?.plays[cur];
  const kind = play ? kindOf(play) : "other";

  function openPlay(g: Game, i: number) {
    const p = g.plays[i];
    if (!p) return;
    setCur(i);
    const s = g.saved[p.seq]?.data;
    const k = kindOf(p);
    setDraft(s ? { ...s } : k === "sack" ? { pressure: "Sacked" } : /hurried/.test(p.text) ? { pressure: "Hurried" } : {});
    setMode(k === "run" ? "poa" : "launch");
    setDirty(false);
  }

  const set = useCallback((patch: Partial<ChartData>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); }, []);
  const toggle = useCallback((k: keyof ChartData, v: string) => { setDraft((d) => ({ ...d, [k]: d[k] === v ? undefined : v })); setDirty(true); }, []);
  const flag = useCallback((k: keyof ChartData) => { setDraft((d) => ({ ...d, [k]: !d[k] })); setDirty(true); }, []);

  async function save(advance = true) {
    if (!game || !play || !pass) return;
    const data = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v !== "" && v !== false));
    setStatus("Saving…");
    const r = await fetch("/api/chart/play", {
      method: "PUT", headers: { "x-chart-pass": pass, "Content-Type": "application/json" },
      body: JSON.stringify({ game_id: game.id, seq: play.seq, season: game.season, off_tid: play.off, def_tid: play.def, kind, data }),
    });
    if (!r.ok) { setStatus(`Save failed (${r.status})`); return; }
    const g = { ...game, saved: { ...game.saved, [play.seq]: { seq: play.seq, kind, data } } };
    setGame(g); setDirty(false); setStatus("Saved ✓");
    if (advance) {
      const pos = list.findIndex((x) => x.i === cur);
      const next = list[pos + 1];
      if (next) openPlay(g, next.i);
    }
  }

  async function clear() {
    if (!game || !play || !pass || !game.saved[play.seq]) { setDraft({}); return; }
    const r = await fetch(`/api/chart/play?game_id=${game.id}&seq=${play.seq}`, { method: "DELETE", headers: { "x-chart-pass": pass } });
    if (r.ok) {
      const saved = { ...game.saved }; delete saved[play.seq];
      setGame({ ...game, saved }); setDraft({}); setStatus("Cleared");
    }
  }

  function step(d: number) {
    if (!game) return;
    const pos = list.findIndex((x) => x.i === cur);
    const n = list[pos + d];
    if (n) openPlay(game, n.i);
  }

  // keyboard: Enter save+next, ←/→ move, L/T launch/target (P/C for runs), 1-4 pressure, A play action
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "Enter") { e.preventDefault(); void save(true); }
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "l") setMode("launch");
    else if (e.key === "t") setMode("target");
    else if (e.key === "p") setMode("poa");
    else if (e.key === "c") setMode("contact");
    else if (e.key === "a") flag("pa");
    else if (["1", "2", "3", "4"].includes(e.key)) toggle("pressure", OPTS.pressure[Number(e.key) - 1]);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  function fieldClick(e: React.MouseEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = r1(((e.clientX - box.left) / box.width) * W);
    const y = r1(Y1 - ((e.clientY - box.top) / box.height) * (Y1 - Y0));
    const pt = { x: Math.max(0, Math.min(W, x)), y };
    if (mode === "launch") { set({ launch: pt }); setMode("target"); }
    else if (mode === "target") set({ target: pt });
    else if (mode === "poa") { set({ poa: { x: pt.x, y: 0 } }); setMode("contact"); }
    else set({ contact: pt });
  }

  if (!pass)
    return (
      <div className={t.gate}>
        <h2 style={{ fontSize: 20 }}>Charting tool</h2>
        <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 6 }}>Owner only. Enter the charting passcode.</p>
        <form onSubmit={(e) => { e.preventDefault(); void tryPass(String(new FormData(e.currentTarget).get("p") || "")); }}>
          <input name="p" type="password" autoComplete="current-password" aria-label="Passcode" />
          <button className={`${t.btn} ${t.primary}`} type="submit">Unlock</button>
        </form>
        {gateErr && <p className={t.err} style={{ marginTop: 10 }}>{gateErr}</p>}
      </div>
    );

  const done = game ? list.filter(({ p }) => game.saved[p.seq]).length : 0;
  const lineY = (y: number) => (Y1 - y) * PX;
  const dist = play?.dist ?? 10, toGoal = play?.ytg ?? 99;

  return (
    <div>
      <div className={t.bar}>
        <select value={tid} onChange={(e) => void pickTeam(e.target.value)} aria-label="Team">
          <option value="">Team…</option>
          {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {sched.length > 0 && (
          <select value={game?.id || ""} onChange={(e) => void pickGame(e.target.value)} aria-label="Game">
            <option value="">Game…</option>
            {sched.map((g) => <option key={g.id} value={g.id}>{g.week} · {g.site === "A" ? "at " : g.site === "N" ? "vs " : ""}{g.oppName}{g.res ? ` (${g.res} ${g.pf}-${g.pa})` : ""}</option>)}
          </select>
        )}
        {game && (
          <>
            <span className={t.row}>
              <button className={`${t.chip} ${side === "team" ? t.on : ""}`} onClick={() => setSide("team")}>Their offense</button>
              <button className={`${t.chip} ${side === "both" ? t.on : ""}`} onClick={() => setSide("both")}>Both teams</button>
            </span>
            <span className={t.row} style={{ fontSize: 12, color: "var(--text2)" }}>
              <span className={t.progress}><i style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} /></span>{done} / {list.length} charted
            </span>
          </>
        )}
        <span className={t.status}>{status}</span>
        {loadErr && <span className={t.err}>{loadErr}</span>}
      </div>

      {game && play && (
        <div className={t.layout}>
          <div className={t.list}>
            {list.map(({ p, i }, k) => (
              <div key={p.seq}>
                {(k === 0 || list[k - 1].p.q !== p.q) && <div className={t.qhead}>Quarter {p.q}</div>}
                <div className={`${t.pl} ${i === cur ? t.on : ""}`} onClick={() => { if (!dirty || confirm("Discard unsaved changes to this play?")) openPlay(game, i); }}>
                  <span className={`${t.dot} ${game.saved[p.seq] ? t.done : ""}`} />
                  <span>
                    <b>{p.dd || `${p.down ?? "-"} & ${p.dist ?? "-"}`}</b> · {p.clock}
                    <small>{p.text.replace(/^\(\d+:\d+\)\s*/, "").slice(0, 90)}</small>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className={t.panel}>
            <div className={t.card}>
              <div className={t.ptext}>{play.text}</div>
              <div className={t.meta}>
                <span>Q{play.q} {play.clock}</span>
                {play.wall && <span title="When the play happened (use it to find the play in the broadcast)">🕒 {new Date(play.wall).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>}
                <span>{kind === "run" ? "Run" : kind === "sack" ? "Sack" : kind === "pass" ? "Pass" : "Other"}</span>
                <span>{play.yds} yds</span>
              </div>
              {hintFromText(play.text) && <div className={t.hint}>Play-by-play says: {hintFromText(play.text)}</div>}
              <div className={t.modes}>
                {kind !== "run" ? (
                  <>
                    <button className={`${t.chip} ${mode === "launch" ? t.on : ""}`} onClick={() => setMode("launch")}>QB throws from<kbd>L</kbd></button>
                    <button className={`${t.chip} ${mode === "target" ? t.on : ""}`} onClick={() => setMode("target")}>Ball arrives<kbd>T</kbd></button>
                  </>
                ) : (
                  <>
                    <button className={`${t.chip} ${mode === "poa" ? t.on : ""}`} onClick={() => setMode("poa")}>Point of attack<kbd>P</kbd></button>
                    <button className={`${t.chip} ${mode === "contact" ? t.on : ""}`} onClick={() => setMode("contact")}>First contact<kbd>C</kbd></button>
                  </>
                )}
              </div>
              <svg ref={svgRef} className={t.field} viewBox={`0 0 ${W * PX} ${(Y1 - Y0) * PX}`} onClick={fieldClick} role="img"
                aria-label="Field: click to mark the spot for the selected button">
                <rect width={W * PX} height={(Y1 - Y0) * PX} fill="color-mix(in oklab, var(--turf) 22%, var(--bg))" />
                {toGoal < Y1 && <rect x={0} y={0} width={W * PX} height={lineY(toGoal)} fill="color-mix(in oklab, var(--turf) 40%, var(--bg))" />}
                {Array.from({ length: 13 }, (_, k) => -15 + k * 5).map((y) => (
                  <g key={y}>
                    <line x1={0} x2={W * PX} y1={lineY(y)} y2={lineY(y)} stroke="var(--bg)" strokeOpacity={0.55} strokeWidth={1} />
                    {y !== 0 && <text x={6} y={lineY(y) - 3} fontSize={11} fill="var(--text2)">{y > 0 ? `+${y}` : y}</text>}
                  </g>
                ))}
                {[20, 33.33].map((x) => Array.from({ length: 60 }, (_, k) => Y0 + k).map((y) => (
                  <line key={`${x}-${y}`} x1={x * PX - 4} x2={x * PX + 4} y1={lineY(y)} y2={lineY(y)} stroke="var(--bg)" strokeOpacity={0.5} />
                )))}
                <line x1={0} x2={W * PX} y1={lineY(0)} y2={lineY(0)} stroke="#2563eb" strokeWidth={3} />
                {dist < toGoal && dist <= Y1 && <line x1={0} x2={W * PX} y1={lineY(dist)} y2={lineY(dist)} stroke="#eab308" strokeWidth={3} />}
                {toGoal <= Y1 && <line x1={0} x2={W * PX} y1={lineY(toGoal)} y2={lineY(toGoal)} stroke="var(--text)" strokeWidth={3} />}
                {draft.launch && draft.target && (
                  <line {...{ x1: toPx(draft.launch).cx, y1: toPx(draft.launch).cy, x2: toPx(draft.target).cx, y2: toPx(draft.target).cy }}
                    stroke="var(--text)" strokeWidth={2} strokeDasharray="6 5" />
                )}
                {draft.launch && <circle {...toPx(draft.launch)} r={9} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />}
                {draft.target && <rect x={toPx(draft.target).cx - 8} y={toPx(draft.target).cy - 8} width={16} height={16} transform={`rotate(45 ${toPx(draft.target).cx} ${toPx(draft.target).cy})`} fill="var(--red)" stroke="var(--bg)" strokeWidth={2} />}
                {draft.poa && <circle {...toPx(draft.poa)} r={9} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />}
                {draft.poa && draft.contact && <line x1={toPx(draft.poa).cx} y1={toPx(draft.poa).cy} x2={toPx(draft.contact).cx} y2={toPx(draft.contact).cy} stroke="var(--text)" strokeWidth={2} strokeDasharray="6 5" />}
                {draft.contact && <rect x={toPx(draft.contact).cx - 8} y={toPx(draft.contact).cy - 8} width={16} height={16} fill="var(--red)" stroke="var(--bg)" strokeWidth={2} />}
              </svg>
              <div className={t.meta} style={{ marginTop: 6 }}>
                <span>Blue = line of scrimmage · yellow = line to gain · offense moves up</span>
                {draft.launch && <span>Throw from {draft.launch.y} · {Math.abs(draft.launch.x - W / 2).toFixed(1)} yds {draft.launch.x < W / 2 ? "left" : "right"} of center</span>}
                {draft.target && <span>Air yards {draft.target.y}</span>}
                {draft.contact && <span>Contact at {draft.contact.y >= 0 ? "+" : ""}{draft.contact.y}</span>}
              </div>
            </div>

            <div className={t.card}>
              {kind !== "run" ? (
                <>
                  <Group title="QB platform" opts={OPTS.platform} v={draft.platform} on={(v) => toggle("platform", v)} />
                  <Group title="Pressure" opts={OPTS.pressure} v={draft.pressure} on={(v) => toggle("pressure", v)} keys />
                  {draft.pressure && draft.pressure !== "None" && <Group title="Pressure from" opts={OPTS.pSrc} v={draft.pSrc} on={(v) => toggle("pSrc", v)} />}
                  <div className={t.grp}><h4>Play</h4><div className={t.chips}>
                    <Flag l="Play action" k="A" on={!!draft.pa} f={() => flag("pa")} />
                    <Flag l="RPO" on={!!draft.rpo} f={() => flag("rpo")} />
                    <Flag l="Screen" on={!!draft.screen} f={() => flag("screen")} />
                    <Flag l="Motion at snap" on={!!draft.motion} f={() => flag("motion")} />
                  </div></div>
                  <Group title="Throw window" opts={OPTS.window} v={draft.window} on={(v) => toggle("window", v)} />
                  <Group title="Target's route" opts={OPTS.route} v={draft.route} on={(v) => toggle("route", v)} />
                  <Group title="Coverage" opts={OPTS.cov} v={draft.cov} on={(v) => toggle("cov", v)} />
                  <div className={t.grp}><h4>Result</h4><div className={t.chips}>
                    <Flag l="Drop" on={!!draft.drop} f={() => flag("drop")} />
                    <Flag l="Contested catch" on={!!draft.contested} f={() => flag("contested")} />
                    <Flag l="Throwaway" on={!!draft.throwaway} f={() => flag("throwaway")} />
                    <Flag l="Batted" on={!!draft.batted} f={() => flag("batted")} />
                  </div></div>
                </>
              ) : (
                <>
                  <Group title="Run concept" opts={OPTS.concept} v={draft.concept} on={(v) => toggle("concept", v)} />
                  <Group title="Gap" opts={OPTS.gap} v={draft.gap} on={(v) => toggle("gap", v)} />
                  <Group title="Men in the box" opts={OPTS.box} v={draft.box} on={(v) => toggle("box", v)} />
                  <div className={t.grp}><h4>Play</h4><div className={t.chips}>
                    <Flag l="RPO" on={!!draft.rpo} f={() => flag("rpo")} />
                    <Flag l="Motion at snap" on={!!draft.motion} f={() => flag("motion")} />
                  </div></div>
                </>
              )}
              <div className={t.grp}>
                <h4>Broken tackles</h4>
                <div className={t.row}>
                  <button className={t.btn} onClick={() => set({ bt: Math.max(0, (draft.bt || 0) - 1) || undefined })}>−</button>
                  <b style={{ minWidth: 18, textAlign: "center" }}>{draft.bt || 0}</b>
                  <button className={t.btn} onClick={() => set({ bt: (draft.bt || 0) + 1 })}>+</button>
                </div>
              </div>
              <div className={t.grp}>
                <h4>Notes</h4>
                <textarea className={t.notes} value={draft.notes || ""} maxLength={500} onChange={(e) => set({ notes: e.target.value })} />
              </div>
              <div className={t.save}>
                <button className={`${t.btn} ${t.primary}`} onClick={() => void save(true)}>Save &amp; next ⏎</button>
                <button className={t.btn} onClick={() => void save(false)}>Save</button>
                <button className={t.btn} onClick={() => step(-1)}>← Prev</button>
                <button className={t.btn} onClick={() => step(1)}>Skip →</button>
                <button className={t.btn} onClick={() => void clear()}>Clear</button>
                {dirty && <span className={t.status}>unsaved</span>}
              </div>
              <div className={t.keys}>
                Keys: <b>Enter</b> save &amp; next · <b>← →</b> move · <b>L</b>/<b>T</b> throw-from / ball-arrives (<b>P</b>/<b>C</b> on runs) · <b>1–4</b> pressure · <b>A</b> play action.
                Click the field to mark the spot for the highlighted button. Everything is optional.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, opts, v, on, keys }: { title: string; opts: string[]; v?: string; on: (v: string) => void; keys?: boolean }) {
  return (
    <div className={t.grp}>
      <h4>{title}</h4>
      <div className={t.chips}>
        {opts.map((o, i) => (
          <button key={o} className={`${t.chip} ${v === o ? t.on : ""}`} onClick={() => on(o)}>{o}{keys && <kbd>{i + 1}</kbd>}</button>
        ))}
      </div>
    </div>
  );
}

function Flag({ l, on, f, k }: { l: string; on: boolean; f: () => void; k?: string }) {
  return <button className={`${t.chip} ${on ? t.on : ""}`} onClick={f}>{l}{k && <kbd>{k}</kbd>}</button>;
}
