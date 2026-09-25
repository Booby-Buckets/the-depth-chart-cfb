"""spread_model.py — the TDC game model: team ratings -> spreads, totals, win odds.

Tested walk-forward on every FBS game 2019-2025 (model_backtest.py): each week predicted from
only the games before it. Mean miss 12.6 points vs 12.2 for the closing betting line; from
week 5 on within ~0.3 of the line. What moved it (MAE, from 13.71 for the old model):
  - every FCS team rated on its own, from FCS-vs-FCS games too, not one pooled "FCS" team
  - no blowout compression: big margins are real information for the next spread
  - each game counted 70% on the score, 30% on the score its play-by-play efficiency implies
    (success rate, yards/play, explosive plays, turnovers; garbage time dropped)
  - preseason prior from a regression on the last two seasons + returning production and
    transfers (team_prior.py), refit each year; FCS teams regress 25% toward their group mean
  - ratings scaled by k=1.1 (ridge shrinks them; this undoes it), bowls shrunk 25% toward even
"""
import math, statistics
import numpy as np

PARAMS = dict(blow_at=24, blow_keep=1.0, prior_games=4.0, regress=0.25, k=1.1, hfa0=2.5, decay=0.0,
              fcs=True, unknown=-4.0, nonfbs_mean_shift=0.0, prior_model=1, alpha=0.7, k_bowl=0.75)
MARGIN_SD = 14.5      # game noise around a perfect spread
RATING_SD0 = 4.5      # preseason rating error, shrinks as sqrt(prior_games / (prior_games + games))


# points implied by a game's efficiency (fit on 2014-2025 FBS games: pts ~ plays, success rate,
# yards/play, explosive rate, turnovers lost, turnovers forced; R^2 0.59)
EFF_B = (-15.225, 0.046, 64.085, 0.728, 66.497, -1.462, 1.798)


def eff_points(me, op):
    b = EFF_B
    return (b[0] + b[1] * me["n"] + b[2] * me["succ"] / max(me["sn"], 1) + b[3] * me["yds"] / me["n"]
            + b[4] * me["expl"] / me["n"] + b[5] * me["to"] + b[6] * op["to"])


def attach_eff(games, feats):
    """Set g["eh"]/g["ea"], the points each side's efficiency implies, where we have play-by-play."""
    for g in games:
        f = feats.get(g["id"])
        if f and g["home"] in f and g["away"] in f:
            g["eh"], g["ea"] = eff_points(f[g["home"]], f[g["away"]]), eff_points(f[g["away"]], f[g["home"]])


def compress(m, at, keep):
    if abs(m) <= at:
        return m
    return math.copysign(at + (abs(m) - at) * keep, m)


def fit(games, teams, prior, P, weights=None):
    """Ridge O/D points model. games: completed games used for fitting.
    Returns ({team: {"off","def","net","gp"}}, mu, hfa)."""
    use_fcs = P["fcs"]
    key = (lambda t: t if (t in teams or use_fcs) else "FCS")
    ids = set()
    for g in games:
        ids.add(key(g["home"])); ids.add(key(g["away"]))
    ids |= set(teams)
    ids = sorted(ids)
    ix = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    m = len(games)
    X = np.zeros((2 * m, 2 * n + 2)); y = np.zeros(2 * m); w = np.ones(2 * m)
    played = dict.fromkeys(ids, 0)
    r = 0
    for gi, g in enumerate(games):
        h, a = key(g["home"]), key(g["away"])
        if h == a:
            continue
        ghs, gas = g["hs"], g["as"]
        if P.get("alpha", 1.0) < 1 and g.get("eh") is not None:
            al = P["alpha"]
            ghs, gas = al * ghs + (1 - al) * g["eh"], al * gas + (1 - al) * g["ea"]
        mg = ghs - gas
        cm = compress(mg, P["blow_at"], P["blow_keep"])
        # keep the total, shrink the margin
        tot = ghs + gas
        hs, as_ = (tot + cm) / 2, (tot - cm) / 2
        loc = 0.0 if g["neutral"] else 0.5
        wt = weights[gi] if weights is not None else 1.0
        for team, opp, pts, sgn in ((h, a, hs, 1), (a, h, as_, -1)):
            X[r, ix[team]] = 1; X[r, n + ix[opp]] = -1; X[r, 2 * n] = 1; X[r, 2 * n + 1] = sgn * loc
            y[r] = pts; w[r] = wt; r += 1
        played[h] += 1; played[a] += 1
    X, y, w = X[:r], y[:r], w[:r]
    lam = np.zeros(2 * n + 2); target = np.zeros(2 * n + 2)
    nonfbs_prior = [p for t, p in (prior or {}).items() if t not in teams]
    nf_off = statistics.mean(p["off"] for p in nonfbs_prior) if nonfbs_prior else -10
    nf_def = statistics.mean(p["def"] for p in nonfbs_prior) if nonfbs_prior else -10
    for t, i in ix.items():
        p = (prior or {}).get(t)
        if t == "FCS":
            lam[i] = lam[n + i] = 1.0
            continue
        lam[i] = lam[n + i] = P["prior_games"]
        if p:
            target[i], target[n + i] = p["off"], p["def"]
        elif t in teams:
            target[i] = target[n + i] = P["unknown"]
        else:  # never-seen lower-division team: a bit below the FCS average
            target[i], target[n + i] = nf_off - 3 + P["nonfbs_mean_shift"], nf_def - 3 + P["nonfbs_mean_shift"]
            lam[i] = lam[n + i] = 1.0
    lam[2 * n] = 1e-3; target[2 * n] = 28.0
    lam[2 * n + 1] = 400.0; target[2 * n + 1] = P["hfa0"]
    Xw = X * w[:, None]
    beta = np.linalg.solve(X.T @ Xw + np.diag(lam), Xw.T @ y + lam * target)
    off, dfn = beta[:n].copy(), beta[n:2 * n].copy()
    fbs = [ix[t] for t in teams]
    off -= off[fbs].mean(); dfn -= dfn[fbs].mean()
    out = {t: {"off": float(off[i]), "def": float(dfn[i]), "net": float(off[i] + dfn[i]), "gp": played[t]} for t, i in ix.items()}
    return out, float(beta[2 * n]), float(beta[2 * n + 1])
