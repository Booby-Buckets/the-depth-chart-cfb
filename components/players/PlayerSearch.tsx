"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { playerHref } from "@/lib/slug";
import s from "./players.module.css";
import { logo } from "@/lib/logo";

type TeamInfo = { slug: string; logo: string; name: string; abbr: string; rank: number };
type Entry = { id: string; name: string; tid: string; pos: string | null; key: string };
const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");

export default function PlayerSearch({ teams }: { teams: Record<string, TeamInfo> }) {
  const router = useRouter();
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  // the 280 KB search index loads the first time the box is focused, not with the page
  const loading = useRef(false);
  async function ensureIndex() {
    if (index || loading.current) return;
    loading.current = true;
    try {
      const rows: [string, string, string, string | null][] = await (await fetch("/data/players/index.json")).json();
      setIndex(rows.map(([id, name, tid, pos]) => ({ id, name, tid, pos, key: norm(`${name} ${teams[tid]?.name ?? ""} ${teams[tid]?.abbr ?? ""} ${pos ?? ""}`) })));
    } catch { setIndex([]); }
  }
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  // best first: a name word that IS the query ("carr" -> CJ Carr), then one that starts with it, then team strength
  const score = (p: Entry) => { const toks = norm(p.name).split(" "); return words.some((w) => toks.includes(w)) ? 0 : words.some((w) => toks.some((t) => t.startsWith(w))) ? 1 : 2; };
  const hits = !index || !words.length ? [] : index.filter((p) => words.every((w) => p.key.includes(w)))
    .sort((a, b) => score(a) - score(b) || (teams[a.tid]?.rank ?? 999) - (teams[b.tid]?.rank ?? 999)).slice(0, 12);

  return (
    <div className={s.finder} ref={box}>
      <input
        placeholder="Search players, e.g. “Carr” or “Ohio State QB”…" autoComplete="off" aria-label="Search players" value={q}
        onFocus={() => { ensureIndex(); setOpen(true); }}
        onChange={(e) => { ensureIndex(); setQ(e.target.value); setCursor(-1); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (hits.length) setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length); }
          if (e.key === "Enter" && hits.length) { const p = hits[Math.max(0, cursor)]; router.push(playerHref(p.name, p.id)); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && words.length > 0 && (
        <div className={s.hits}>
          {!index ? <span className={s.none}>Loading players…</span> : hits.length === 0 ? <span className={s.none}>No players match.</span> : hits.map((p, i) => (
            <Link key={p.id} href={playerHref(p.name, p.id)} className={i === cursor ? s.on : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo(teams[p.tid]?.logo, 22)} alt="" />
              {p.name}
              <span>{p.pos || ""} · {teams[p.tid]?.name || ""}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
