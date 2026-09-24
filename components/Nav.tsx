"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

// Pages not yet moved to Next.js are still the static .html files in public/.
const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/", label: "Power Rankings", match: (p) => p === "/" },
  { href: "/#slate", label: "This Week", match: () => false },
  { href: "/teams", label: "Teams", match: (p) => p.startsWith("/teams") },
  { href: "/depth.html", label: "Depth Charts", match: (p) => p.startsWith("/depth") },
  { href: "/players.html", label: "Players", match: (p) => p.startsWith("/players") },
];
const SOON = ["Recruiting", "Portal"];

export default function Nav() {
  const pathname = usePathname() || "/";
  return (
    <div className="nav-wrap">
      <div className="col nav-top">
        <Link className="nav-logo" href="/">
          The <span>Depth</span> Chart<em>CFB</em>
        </Link>
        <div className="nav-actions">
          <a className="nav-x" href="https://www.thedepthchartcbb.com/">Basketball ↗</a>
          <ThemeToggle />
        </div>
      </div>
      <div className="nav-sub">
        <div className="col">
          {LINKS.map((l) =>
            l.href.endsWith(".html") ? (
              <a key={l.label} href={l.href} className={l.match(pathname) ? "active" : undefined}>{l.label}</a>
            ) : (
              <Link key={l.label} href={l.href} className={l.match(pathname) ? "active" : undefined}>{l.label}</Link>
            ),
          )}
          {SOON.map((s) => (
            <span key={s}>{s}<small>SOON</small></span>
          ))}
        </div>
      </div>
    </div>
  );
}
