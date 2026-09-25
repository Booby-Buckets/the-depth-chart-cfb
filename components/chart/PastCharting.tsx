import type { CareerRow } from "@/components/player/Career";
import PlayerCharting from "./PlayerCharting";

/** Past seasons' charting (2025 on), one collapsible block per season, newest first. */
export default function PastCharting({ rows, name, open = false }: { rows: CareerRow[]; name: string; open?: boolean }) {
  const past = rows.filter((r) => !r.current && r.p.chart && (r.p.chart.pass?.gc || r.p.chart.recv?.gc || r.p.chart.rush));
  if (!past.length) return null;
  return (
    <section style={{ padding: "20px 0 8px" }}>
      {past.map((r, i) => (
        <details key={r.season} open={open && i === 0} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
          <summary style={{ cursor: "pointer", fontFamily: "var(--font-serif), serif", fontSize: 20, fontWeight: 700 }}>
            {r.season} charting{r.team ? ` · ${r.team.name}` : ""}
          </summary>
          <PlayerCharting ch={r.p.chart!} name={name} season={r.season} />
        </details>
      ))}
    </section>
  );
}
