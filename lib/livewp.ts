/** Live win probability for the home team, calibrated on every 2024-25 FBS play (Brier 0.121):
 *  final margin ~ Normal(mu, 16 * sqrt(share of the game left)), where
 *  mu = current margin + value of the possession + pregame TDC spread * share of the game left.
 *  Possession value = -0.3 + 0.05 * (yards from own goal), from the offense's point of view. */
export function liveWinProb(o: {
  spread: number; margin: number; secsLeft: number; ot?: boolean; possHome?: boolean | null; ytg?: number | null;
}): number {
  const frac = o.ot ? 0.01 : Math.max(0, o.secsLeft) / 3600;
  const ep = o.possHome == null || o.ytg == null ? 0 : (o.possHome ? 1 : -1) * (-0.3 + 0.05 * (100 - o.ytg));
  const mu = o.margin + ep + o.spread * frac;
  const s = 16 * Math.sqrt(Math.max(frac, 20 / 3600));
  if (o.secsLeft <= 0 && !o.ot) return o.margin > 0 ? 1 : o.margin < 0 ? 0 : 0.5;
  // never call a game that's still going: a late big play or onside kick keeps 1% alive
  return Math.min(0.99, Math.max(0.01, 0.5 * (1 + erf(mu / (s * Math.SQRT2)))));
}

function erf(x: number) {  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Seconds left in regulation from ESPN's period (1-4, 5+ = OT) and "MM:SS" clock. */
export function secsLeft(period: number, clock: string | undefined): number {
  const m = /(\d+):(\d+)/.exec(clock || "");
  const inQ = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  return period >= 5 ? 0 : (4 - period) * 900 + inQ;
}

/** "NIU 35" -> yards to the offense's goal line, given the offense's abbreviation. */
export function ytgFrom(possText: string | undefined, offAbbr: string | undefined): number | null {
  const m = /^([A-Za-z&]+)\s+(\d+)$/.exec((possText || "").trim());
  if (!m) return /^50$/.test((possText || "").trim()) ? 50 : null;
  const n = Number(m[2]);
  return offAbbr && m[1].toUpperCase() === offAbbr.toUpperCase() ? 100 - n : n;
}

export type LiveGame = {
  id: string; state: "pre" | "in" | "post"; detail: string; period: number; clock: string;
  home: string; away: string; hs: number; as: number; homeAbbr?: string; awayAbbr?: string;
  poss?: string | null; dd?: string | null; possText?: string | null; redZone?: boolean; lastPlay?: string | null;
};
