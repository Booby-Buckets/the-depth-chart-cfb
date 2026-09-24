"use client";

import { useRouter } from "next/navigation";

export default function TeamSwitcher({ current, options, className }: { current: string; options: { slug: string; name: string }[]; className?: string }) {
  const router = useRouter();
  return (
    <select className={className} value={current} aria-label="Switch team" onChange={(e) => router.push(`/teams/${e.target.value}`)}>
      {options.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
    </select>
  );
}
