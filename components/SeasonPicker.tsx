"use client";

import { useRouter } from "next/navigation";

/** Jump between seasons: "This season" goes to the live page, a year to its past-season page. */
export default function SeasonPicker({ years, current, basePath, suffix = "", liveHref = "/" }: {
  years: number[]; current: number | null; basePath: string; suffix?: string; liveHref?: string;
}) {
  const router = useRouter();
  return (
    <select className="filter-select" aria-label="Season" value={current ?? "live"}
      onChange={(e) => router.push(e.target.value === "live" ? liveHref : `${basePath}/${e.target.value}${suffix}`)}>
      <option value="live">This season</option>
      {years.map((y) => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}
