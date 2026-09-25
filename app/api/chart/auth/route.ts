import { chartAuthed, chartConfigured, json } from "@/lib/chartdb";

/** Checks the passcode (the /chart gate) and whether storage is configured. */
export async function POST(req: Request) {
  if (!chartConfigured()) return json({ ok: false, configured: false }, 503);
  if (chartAuthed(req)) return json({ ok: true, configured: true });
  await new Promise((r) => setTimeout(r, 800));   // slow down passcode guessing
  return json({ ok: false, configured: true }, 401);
}
