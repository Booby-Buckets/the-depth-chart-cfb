"""model_backtest.py — walk-forward test of the spread model on every game since 2015.

For each week of each season the model is fit on ONLY the games already played (plus the
preseason prior), then predicts that week's games. Scored against the real final margins, with
the closing betting line (fetch_lines.py) as a yardstick for how close a strong model can get.

  python3 scripts/model_backtest.py                 # current production model vs candidate
  python3 scripts/model_backtest.py --grid          # parameter search (train 2015-2019, test 2021-2025)
"""
import json, os, sys, math, statistics, itertools
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_hub import season_games, fbs_teams, CACHE
from spread_model import fit, eff_points, PARAMS

FIRST, LAST = 2015, 2025


def line(gid):
    p = os.path.join(CACHE, f"line_{gid}.json")
    if os.path.exists(p):
        return json.load(open(p)).get("spread")
    return None


_season_cache = {}
def season(y):
    """FBS teams + every D-I game of the season (FBS-involved and FCS-vs-FCS), deduped."""
    if y in _season_cache:
        return _season_cache[y]
    teams = fbs_teams(y)
    g80, _ = season_games(y, finished_season=True)
    g81, _ = season_games(y, finished_season=True, group=81)
    seen, games = set(), []
    for g in g80 + g81:
        if g["id"] in seen or not g["completed"] or g["hs"] is None:
            continue
        seen.add(g["id"])
        games.append(g)
    games.sort(key=lambda g: g["date"])
    from game_features import game_features
    F = game_features(y, [])
    for g in games:
        f = F.get(g["id"])
        if f and g["home"] in f and g["away"] in f:
            g["eh"], g["ea"] = eff_points(f[g["home"]], f[g["away"]]), eff_points(f[g["away"]], f[g["home"]])
    _season_cache[y] = (teams, games)
    return teams, games


# ---------------------------------------------------------------- model
DEFAULT = dict(blow_at=24, blow_keep=0.35, prior_games=3.0, regress=0.40, k=1.0, hfa0=2.5,
               decay=0.0, fcs=False, unknown=-4.0, nonfbs_mean_shift=0.0)
PROD = dict(DEFAULT)  # what build_hub.py ships today


_final = {}


def final_ratings(y, P):
    """End-of-season ratings for season y (fit on all its games, with its own prior)."""
    k = (y, tuple(sorted(P.items())))
    if k not in _final:
        teams, games = season(y)
        prior = make_prior(y, P) if y > 2014 else {}
        _final[k] = fit(games if P["fcs"] else [g for g in games if g["home"] in teams or g["away"] in teams], teams, prior, P)[0]
    return _final[k]


_pure = {}


def pure_ratings(y):
    """Season-y ratings from its own games only (a whisker of ridge, no prior): the training
    target and the history inputs for the regression prior."""
    if y not in _pure:
        teams, games = season(y)
        _pure[y] = fit(games, teams, {}, dict(DEFAULT, fcs=True, blow_keep=1.0, prior_games=0.3))[0]
    return _pure[y]


PRIOR_X = ("off1", "def1", "off2", "def2", "retOff", "retQB", "retDef", "inOff", "inQB", "inDef")


def prior_rows(y, live=False):
    """[(tid, x dict)] for FBS teams of season y with two seasons of history."""
    import team_prior
    teams, _ = season(y) if not live else (fbs_teams(y), None)
    F = team_prior.features(y, live=live)
    p1, p2 = pure_ratings(y - 1), pure_ratings(y - 2)
    out = []
    for t in teams:
        if t in F and t in p1 and t in p2 and p1[t]["gp"] >= 6 and p2[t]["gp"] >= 6:
            out.append((t, {"off1": p1[t]["off"], "def1": p1[t]["def"], "off2": p2[t]["off"], "def2": p2[t]["def"], **F[t]}))
    return out


XCOLS = {"off": ("off1", "off2", "def1", "retOff", "retQB", "inOff", "inQB"),
         "def": ("def1", "def2", "off1", "retDef", "inDef")}
_coef = {}


def prior_coefs(upto):
    """Least-squares prior coefficients from seasons 2016..upto (expanding window)."""
    if upto not in _coef:
        X = {"off": [], "def": []}; Y = {"off": [], "def": []}
        for y in range(2016, upto + 1):
            cur = pure_ratings(y)
            for t, x in prior_rows(y):
                if cur.get(t, {}).get("gp", 0) < 6:
                    continue
                for side in ("off", "def"):
                    X[side].append([1.0] + [x[c] for c in XCOLS[side]]); Y[side].append(cur[t][side])
        _coef[upto] = {s: np.linalg.lstsq(np.array(X[s]), np.array(Y[s]), rcond=None)[0] for s in ("off", "def")}
    return _coef[upto]


def make_prior(y, P, live=False):
    prior = make_prior_simple(y, P, live)
    if P.get("prior_model") and y >= 2019:
        B = prior_coefs(y - 1)
        for t, x in prior_rows(y, live):
            p = {s: float(B[s][0] + sum(b * x[c] for b, c in zip(B[s][1:], XCOLS[s]))) for s in ("off", "def")}
            p["net"] = p["off"] + p["def"]
            prior[t] = p
    return prior


def make_prior_simple(y, P, live=False):
    teams = fbs_teams(y) if live else season(y)[0]
    prev = final_ratings(y - 1, P)
    prev_teams, _ = season(y - 1)
    fbs_mean = {s: statistics.mean(prev[t][s] for t in prev_teams if t in prev) for s in ("off", "def")}
    nf = [t for t in prev if t not in prev_teams and t != "FCS" and prev[t]["gp"] >= 4]
    nf_mean = {s: statistics.mean(prev[t][s] for t in nf) if nf else 0 for s in ("off", "def")}
    prior = {}
    for t, r in prev.items():
        if t == "FCS" or (t not in teams and not P["fcs"]):
            continue
        mean = fbs_mean if t in prev_teams else nf_mean
        prior[t] = {s: mean[s] + (r[s] - mean[s]) * (1 - P["regress"]) for s in ("off", "def")}
        prior[t]["net"] = prior[t]["off"] + prior[t]["def"]
    return prior


def walk_forward(y, P):
    """Predict every game of season y using only games before its week. Yields (game, pred)."""
    teams, games = season(y)
    prior = make_prior(y, P)
    fbs_games = [g for g in games if g["home"] in teams or g["away"] in teams]
    pool = games if P["fcs"] else fbs_games
    weeks = sorted({(g["type"], g["week"]) for g in fbs_games})
    for wk in weeks:
        todo = [g for g in fbs_games if (g["type"], g["week"]) == wk]
        start = min(g["date"] for g in todo)
        past = [g for g in pool if g["date"] < start[:10]]
        wts = None
        if P.get("decay"):
            import datetime as _dt
            t0 = _dt.date.fromisoformat(start[:10])
            wts = [math.exp(-P["decay"] * (t0 - _dt.date.fromisoformat(g["date"][:10])).days / 7) for g in past]
        rat, mu, hfa = fit(past, teams, prior, P, wts) if past else ({}, 28, P["hfa0"])
        key = (lambda t: t if (t in teams or P["fcs"]) else "FCS")
        for g in todo:
            h = rat.get(key(g["home"])) or prior.get(key(g["home"])) or {"net": -20}
            a = rat.get(key(g["away"])) or prior.get(key(g["away"])) or {"net": -20}
            k = P["k"] if (g["home"] in teams and g["away"] in teams) else P.get("k_fcs", P["k"])
            if g["type"] == 3:
                k *= P.get("k_bowl", 1.0)   # bowls: opt-outs and coaching exits blur the gap
            pred = k * (h["net"] - a["net"]) + (0 if g["neutral"] else hfa)
            g["_tot"] = {kk: 2 * mu + kk * (h.get("off", 0) - a.get("def", 0) + a.get("off", 0) - h.get("def", 0)) for kk in (1.0, P["k"])}
            yield g, pred


def evaluate(P, years=range(FIRST, LAST + 1), verbose=False):
    rows = []
    for y in years:
        for g, pred in walk_forward(y, P):
            rows.append((y, g, pred, g["hs"] - g["as"], line(g["id"])))
    err = [abs(p - m) for _, _, p, m, _ in rows]
    res = {"n": len(rows), "mae": statistics.mean(err), "rmse": math.sqrt(statistics.mean(e * e for e in err)),
           "su": statistics.mean((p > 0) == (m > 0) for _, _, p, m, _ in rows if m != 0)}
    wl = [(p, m, l) for _, _, p, m, l in rows if l is not None]
    res["n_line"] = len(wl)
    res["mae_line_games"] = statistics.mean(abs(p - m) for p, m, _ in wl)
    res["vegas_mae"] = statistics.mean(abs(l - m) for p, m, l in wl)
    res["vs_vegas"] = statistics.mean(abs(p - l) for p, m, l in wl)
    if verbose:
        for y in years:
            e = [abs(p - m) for yy, _, p, m, _ in rows if yy == y]
            v = [abs(l - m) for yy, _, p, m, l in rows if yy == y and l is not None]
            print(f"  {y}: MAE {statistics.mean(e):.2f}  (Vegas {statistics.mean(v):.2f})  n={len(e)}")
    return res, rows


def show(label, res):
    print(f"{label:<28} MAE {res['mae']:.2f}  RMSE {res['rmse']:.2f}  SU {res['su']:.3f}  | lined games: ours {res['mae_line_games']:.2f}"
          f" vs Vegas {res['vegas_mae']:.2f}, |ours-Vegas| {res['vs_vegas']:.2f}  (n={res['n']})", flush=True)


def write_prior(y):
    """The live build's preseason prior for season y (every FBS and FCS team), from the
    seasons before it: scripts/model_prior_<y>.json. Run once the roster files are current."""
    pr = make_prior(y, PARAMS, live=True)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"model_prior_{y}.json")
    json.dump({"season": y, "prior": {t: {k: round(v, 2) for k, v in p.items()} for t, p in pr.items()}},
              open(path, "w"), separators=(",", ":"))
    print(f"wrote {path}: {len(pr)} teams")


if __name__ == "__main__":
    if "--write-prior" in sys.argv:
        write_prior(int(sys.argv[-1]))
    else:
        show("old model (compressed, pooled FCS)", evaluate(PROD)[0])
        show("spread_model.PARAMS", evaluate(PARAMS, verbose=True)[0])
