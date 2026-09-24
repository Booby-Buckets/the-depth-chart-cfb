"use client";

import Link from "next/link";
import { useState } from "react";
import { fmt } from "@/lib/format";
import s from "./directory.module.css";
import { logo } from "@/lib/logo";

type T = { slug: string; name: string; full: string; abbr: string; logo: string; rank: number; w: number; l: number; net: number };

export default function TeamDirectory({ confs }: { confs: { conf: string; teams: T[] }[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  return (
    <section style={{ paddingTop: 14 }}>
      <div className="controls"><input className="search-box" placeholder="Find a team…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a team" /></div>
      <div className={s.dir}>
        {confs.map(({ conf, teams }) => {
          const list = teams.filter((t) => !needle || `${t.name} ${t.full} ${t.abbr}`.toLowerCase().includes(needle));
          if (!list.length) return null;
          return (
            <div key={conf} className={s.conf}>
              <h3>{conf}</h3>
              {list.map((t) => (
                <Link key={t.slug} href={`/teams/${t.slug}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo(t.logo, 22)} alt="" loading="lazy" />
                  <span>{t.name}</span>
                  <span className={s.r}>#{t.rank} · {t.w}-{t.l}</span>
                  <span className={s.n}>{fmt(t.net, 1, true)}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
