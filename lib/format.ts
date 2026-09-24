// Number and date formatting shared by server and client components.
// Dates use a fixed locale + Eastern time so the server render and the browser agree
// (a mismatch would be a hydration error).

export const fmt = (v: number | null | undefined, d = 1, sign = false) =>
  v == null ? "—" : (sign && v > 0 ? "+" : "") + Number(v).toFixed(d);

export const pct = (p: number | null | undefined) =>
  p == null ? "—" : p > 0.995 ? ">99%" : p < 0.005 ? "<1%" : Math.round(p * 100) + "%";

export const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const ET = "America/New_York";
export const etDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: ET });
export const etTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
export const etStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ET }) + " ET";
