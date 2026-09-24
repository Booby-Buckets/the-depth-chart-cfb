import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // player pages render on first visit (there are 14,000+), so their server function must
  // carry the data files it reads; prerendered pages don't need this
  outputFileTracingIncludes: {
    "/players/*": ["./public/data/hub.json", "./public/data/players/*.json", "./public/data/teams/*.json"],
  },
};

export default nextConfig;
