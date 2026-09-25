import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // player pages render on first visit (there are 14,000+), so their server function must
  // carry the data files it reads; prerendered pages don't need this
  // The site used to be static pages (team.html?id=87 ...). Old links and search results land
  // on the new pages: numeric ids go to /teams/87 etc., which the pages redirect to the name URL.
  async redirects() {
    const id = [{ type: "query" as const, key: "id", value: "(?<id>\\d+)" }];
    const noId = [{ type: "query" as const, key: "id" }];
    return [
      { source: "/team.html", has: id, destination: "/teams/:id", permanent: true },
      { source: "/team.html", missing: noId, destination: "/teams", permanent: true },
      { source: "/depth.html", has: id, destination: "/depth/:id", permanent: true },
      { source: "/depth.html", missing: noId, destination: "/depth", permanent: true },
      { source: "/player.html", has: id, destination: "/players/:id", permanent: true },
      { source: "/player.html", missing: noId, destination: "/players", permanent: true },
      { source: "/players.html", destination: "/players", permanent: true },
      { source: "/index.html", destination: "/", permanent: true },
    ];
  },
  outputFileTracingIncludes: {
    "/players/*": [
      "./public/data/hub.json", "./public/data/players/*.json", "./public/data/teams/*.json", "./public/data/careers.json",
      "./public/data/seasons/*/hub.json", "./public/data/seasons/*/players/*.json",
    ],
  },
};

export default nextConfig;
