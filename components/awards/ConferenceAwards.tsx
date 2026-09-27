"use client";

import Link from "next/link";
import { useState } from "react";
import type { AwardRow } from "@/lib/data";
import { playerHref } from "@/lib/slug";
import { logo } from "@/lib/logo";
import s from "@/app/awards/awards.module.css";

type Conf = { opoy: AwardRow[]; dpoy: AwardRow[]; fr: AwardRow[] };
const CARDS: [keyof Conf, string, string][] = [
  ["opoy", "Offensive Player of the Year", "Heisman-model score, simulated"],
  ["dpoy", "Defensive Player of the Year", "Defensive composite, simulated"],
  ["fr", "Freshman of the Year", "Best of offense or defense, freshmen only"],
];

/** Conference awards with a conference picker (Offensive POY, Defensive POY, Freshman of the Year). */
export default function ConferenceAwards({ data, logos, slugs, initial }: {
  data: Record<string, Conf>; logos: Record<string, string>; slugs: Record<string, string>; initial: string;
}) {
  const confs = Object.keys(data).sort();
  const [c, setC] = useState(confs.includes(initial) ? initial : confs[0]);
  const d = data[c];
  return (
    <section style={{ padding: "18px 0 8px" }}>
      <div className="sec-h"><h2>Conference Awards</h2><p>Chance to win each conference honor</p></div>
      <div className="controls" style={{ marginBottom: 12 }}>
        <select className="filter-select" value={c} onChange={(e) => setC(e.target.value)} aria-label="Conference">
          {confs.map((x) => <option key={x}>{x}</option>)}
        </select>
      </div>
      <div className={s.grid}>
        {CARDS.map(([k, name, how]) => (
          <section key={k} className={s.card}>
            <h3>{name}<span>{how}</span></h3>
            {d[k].length === 0 ? <div className="note">No contenders yet.</div> : d[k].map((x, i) => (
              <div key={x.id} className={s.row}>
                <span className={s.rk}>{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo(logos[x.tid], 20)} alt="" loading="lazy" />
                <span className={s.nm}>
                  <Link href={playerHref(x.name, x.id)}>{x.name}</Link>
                  <small>{x.pos}{x.cls ? ` · ${x.cls}` : ""} · {slugs[x.tid] ? <Link href={`/teams/${slugs[x.tid]}`}>{x.team}</Link> : x.team} ({x.rec})</small>
                </span>
                <b className={s.pc}>{Math.round((x.p || 0) * 100)}%</b>
                <span className={s.line2}>{x.line.replace(/^\d+ G · /, "")}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
