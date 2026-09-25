import { chartAuthed, chartConfigured, deleteRow, json, upsertRow } from "@/lib/chartdb";

const ok = (b: Record<string, unknown>) =>
  typeof b.game_id === "string" && /^\d{6,12}$/.test(b.game_id) && typeof b.seq === "string" && /^\d{1,12}$/.test(b.seq);

/** Save (upsert) one charted play. */
export async function PUT(req: Request) {
  if (!chartConfigured()) return json({ error: "not configured" }, 503);
  if (!chartAuthed(req)) return json({ error: "passcode" }, 401);
  const b = await req.json().catch(() => null);
  if (!b || !ok(b) || typeof b.data !== "object" || JSON.stringify(b.data).length > 8000) return json({ error: "bad play" }, 400);
  const row = {
    game_id: b.game_id, seq: b.seq, season: Number(b.season) || new Date().getFullYear(),
    off_tid: b.off_tid ?? null, def_tid: b.def_tid ?? null, kind: b.kind ?? null, data: b.data, updated_at: new Date().toISOString(),
  };
  const err = await upsertRow(row);
  return err ? json({ error: err }, 502) : json({ ok: true, updated_at: row.updated_at });
}

/** Clear one play's chart. */
export async function DELETE(req: Request) {
  if (!chartConfigured()) return json({ error: "not configured" }, 503);
  if (!chartAuthed(req)) return json({ error: "passcode" }, 401);
  const u = new URL(req.url).searchParams;
  const b = { game_id: u.get("game_id") || "", seq: u.get("seq") || "" };
  if (!ok(b)) return json({ error: "bad play" }, 400);
  const err = await deleteRow(b.game_id, b.seq);
  return err ? json({ error: err }, 502) : json({ ok: true });
}
