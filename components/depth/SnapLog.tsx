"use client";

import { useState } from "react";
import type { TeamGame } from "@/lib/data";

export type LogGroup = {
  label: string;
  rawKey: "qb" | "off" | "def";
  players: { id: string; name: string; pos: string; es: number[]; esRange: ([number, number] | null)[]; raw: number[]; esTotal: number; rawTotal: number }[];
};

export default function SnapLog({ games, groups, teamId }: { games: TeamGame[]; groups: LogGroup[]; teamId: string }) {
  const [mode, setMode] = useState<"es" | "raw">("es");
  const total = (k: "tp" | "otp") => games.reduce((sum, g) => sum + (g[k] || 0), 0);
  return (
    <>
      <div className="sec-h">
        <h2>Snaps by Game</h2>
        <p style={{ display: "inline-flex", gap: 6 }}>
          {([["es", "Estimated snaps"], ["raw", "Plays involved / made"]] as const).map(([k, l]) => (
            <button key={k} className={`chip ${k === mode ? "on" : ""}`} onClick={() => setMode(k)}>{l}</button>
          ))}
        </p>
      </div>
      <div className="sheet-wrap">
        <table className="sheet dense freeze2">
          <thead>
            <tr>
              <th className="l">Player</th><th className="c">Pos</th>
              {games.map((g) => (
                <th key={g.id} title={g.wk}>
                  {g.wk.replace("Week ", "Wk ")}<br />
                  <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>{g.site === "A" ? "@" : "vs"} {g.oppName}</span>
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="l strong">Team offensive plays</td><td />{games.map((g) => <td key={g.id} className="strong">{g.tp}</td>)}<td className="strong">{total("tp")}</td></tr>
            <tr><td className="l strong">Opponent offensive plays</td><td />{games.map((g) => <td key={g.id} className="strong">{g.otp ?? "—"}</td>)}<td className="strong">{total("otp")}</td></tr>
            {groups.map((grp) => {
              const useEs = mode === "es";
              const rows = grp.players
                .map((p) => ({ ...p, vals: useEs ? p.es : p.raw, tot: useEs ? p.esTotal : p.rawTotal }))
                .filter((p) => p.tot > 0)
                .sort((a, b) => b.tot - a.tot);
              if (!rows.length) return null;
              const what = useEs || grp.rawKey === "qb" ? "estimated snaps" : grp.rawKey === "off" ? "plays involved" : "plays made";
              return [
                <tr key={`h-${grp.label}`} className="grp-row">
                  <td className="l" colSpan={games.length + 3} style={{ background: "var(--bg2)", fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text3)" }}>
                    {grp.label} · {what}
                  </td>
                </tr>,
                ...rows.map((p) => (
                  <tr key={`${grp.label}-${p.id}`}>
                    <td className="l nm"><a href={`/player.html?id=${p.id}&t=${teamId}`} style={{ color: "var(--text)", textDecoration: "none" }}>{p.name}</a></td>
                    <td className="c dim">{p.pos}</td>
                    {p.vals.map((v, i) => {
                      const rng = useEs && grp.rawKey !== "qb" ? p.esRange[i] : null;
                      return (
                        <td key={games[i].id} className={v ? "" : "dim"} title={rng ? `likely ${rng[0]}–${rng[1]} snaps` : undefined}>
                          {v ? `${rng ? "~" : ""}${v}` : "·"}
                        </td>
                      );
                    })}
                    <td className="strong">{p.tot}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
