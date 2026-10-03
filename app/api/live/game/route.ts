import { loadGame } from "@/lib/livegame";

/** One game, live (lib/livegame.ts). Edge-cached 5s while live so every viewer shares one ESPN
 *  call; finished games for a day. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\d{6,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    const g = await loadGame(id);
    return Response.json(g, { headers: { "Cache-Control": g.state === "post" ? "public, s-maxage=86400, stale-while-revalidate=604800"
      : g.state === "in" ? "public, s-maxage=5, stale-while-revalidate=10" : "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 502 });
  }
}
