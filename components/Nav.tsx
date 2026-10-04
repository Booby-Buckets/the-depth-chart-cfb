"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import ThemeToggle from "./ThemeToggle";

const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/", label: "Power Rankings", match: (p) => p === "/" },
  { href: "/#slate", label: "This Week", match: () => false },
  { href: "/teams", label: "Teams", match: (p) => p.startsWith("/teams") },
  { href: "/depth", label: "Depth Charts", match: (p) => p.startsWith("/depth") },
  { href: "/players", label: "Players", match: (p) => p.startsWith("/players") },
  { href: "/plays", label: "Plays", match: (p) => p.startsWith("/plays") },
  { href: "/recruiting", label: "Recruiting", match: (p) => p.startsWith("/recruiting") },
  { href: "/betting", label: "Betting", match: (p) => p.startsWith("/betting") },
  { href: "/awards", label: "Awards", match: (p) => p.startsWith("/awards") },
  { href: "/seasons", label: "Past Seasons", match: (p) => p.startsWith("/seasons") },
];
const SOON = ["Portal"];

export default function Nav() {
  const pathname = usePathname() || "/";
  // phones: the link row scrolls sideways; keep the current page's link in view
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const a = row.current?.querySelector("a.active") as HTMLElement | null;
    if (a && row.current && row.current.scrollWidth > row.current.clientWidth) row.current.scrollTo({ left: Math.max(0, a.offsetLeft - 16), behavior: "smooth" });
  }, [pathname]);
  return (
    <div className="nav-wrap">
      <div className="col nav-top">
        <Link className="nav-logo" href="/">
          The <span>Depth</span> Chart
        </Link>
        <div className="nav-actions">
          <a className="nav-x" href="https://www.thedepthchartcbb.com/">Basketball ↗</a>
          <ThemeToggle />
        </div>
      </div>
      <div className="nav-sub">
        <div className="col" ref={row}>
          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} className={l.match(pathname) ? "active" : undefined}>{l.label}</Link>
          ))}
          {SOON.map((s) => (
            <span key={s}>{s}<small>SOON</small></span>
          ))}
        </div>
      </div>
    </div>
  );
}
