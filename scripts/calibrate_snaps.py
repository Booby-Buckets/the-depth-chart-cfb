"""calibrate_snaps.py — trains the snap-count ESTIMATOR and writes scripts/snap_model.json.

Run by hand (needs pandas + scikit-learn); the nightly build only reads the JSON:
    python3 scripts/calibrate_snaps.py

Why NFL data: college snap counts aren't published anywhere we may use, but the NFL's are,
openly, via nflverse (github.com/nflverse/nflverse-data), next to the same involvement stats
we can see in college play-by-play (carries, targets, tackles...). So we learn how
involvement maps to snap share on real NFL snaps, measure the error on a season the model
never saw, and apply that mapping to college players.

Model, per position group (RB, WR, TE, DL, LB, DB), one row per involved player-game:
  inputs  share  the player's slice of his group's involvement that game
          rate   his involvement per team play
          n      how many players in his group were involved
          rk     his rank within the group that game
  target  snaps / team plays
Gradient-boosted trees (absolute-error loss; monotone increasing in share and rate).
Quarterbacks aren't modeled: the play-by-play estimate (every play credited to the QB on
the field) is already close to exact. Offensive linemen can't be: they leave no trace.
"""
import json, os, urllib.request
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "cache", "nfl")
OUT = os.path.join(ROOT, "scripts", "snap_model.json")
REL = "https://github.com/nflverse/nflverse-data/releases/download"
GROUPS = {"RB": ["RB", "FB"], "WR": ["WR"], "TE": ["TE"], "DL": ["DE", "DT", "NT", "DL"],
          "LB": ["LB", "ILB", "OLB", "MLB"], "DB": ["CB", "S", "SS", "FS", "DB"]}
FEATURES = ["share", "rate", "n", "rk"]
TRAIN_TEST = (2023, 2024)


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, os.path.basename(path))
    if not os.path.exists(local):
        urllib.request.urlretrieve(f"{REL}/{path}", local)
    return local


def load(year, ids):
    sc = pd.read_csv(fetch(f"snap_counts/snap_counts_{year}.csv"))
    sc = sc[sc.game_type == "REG"]
    st = pd.read_csv(fetch(f"stats_player/stats_player_week_{year}.csv"), low_memory=False)
    st = st[st.season_type == "REG"].merge(ids, left_on="player_id", right_on="gsis_id", how="left")
    st = st.assign(
        off=st.carries.fillna(0) + st.targets.fillna(0),
        dfn=(st.def_tackles_solo.fillna(0) + st.def_tackle_assists.fillna(0) + st.def_sacks.fillna(0)
             + st.def_pass_defended.fillna(0) + st.def_interceptions.fillna(0) + st.def_fumbles_forced.fillna(0)))
    d = sc.merge(st[["pfr_id", "week", "off", "dfn"]], left_on=["pfr_player_id", "week"], right_on=["pfr_id", "week"], how="left")
    d[["off", "dfn"]] = d[["off", "dfn"]].fillna(0)
    d["T"] = d.groupby(["game_id", "team"]).offense_snaps.transform("max")
    d["Td"] = d.groupby(["game_id", "team"]).defense_snaps.transform("max")
    d["grp"] = None
    for g, ps in GROUPS.items():
        d.loc[d.position.isin(ps), "grp"] = g
    d = d[d.grp.notna()].copy()
    is_off = d.grp.isin(["RB", "WR", "TE"])
    d["x"] = np.where(is_off, d.off, d.dfn)
    d["snaps"] = np.where(is_off, d.offense_snaps, d.defense_snaps)
    d["TT"] = np.where(is_off, d["T"], d["Td"])
    d = d[(d.x > 0) & (d.TT > 20)].copy()   # in college we only ever see involved players
    g = d.groupby(["game_id", "team", "grp"])
    d["X"] = g.x.transform("sum")
    d["n"] = g.x.transform("count")
    d["rk"] = g.x.rank(ascending=False, method="first")
    d["share"] = d.x / d.X
    d["rate"] = d.x / d.TT
    d["pct"] = (d.snaps / d.TT).clip(0, 1)
    return d


def fit(df):
    return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=4,
                                         monotonic_cst=[1, 1, 0, -1], loss="absolute_error").fit(df[FEATURES], df.pct)


def export(model):
    """sklearn tree ensemble -> plain JSON (evaluated by build_players.snap_pct)."""
    trees = []
    for (pred,) in model._predictors:
        trees.append([[int(n["feature_idx"]), float(n["num_threshold"]), int(n["left"]), int(n["right"]),
                       int(n["is_leaf"]), round(float(n["value"]), 6), int(n["missing_go_to_left"])] for n in pred.nodes])
    return {"baseline": float(model._baseline_prediction.ravel()[0]), "trees": trees}


def main():
    ids = pd.read_csv(fetch("players/players.csv"), usecols=["gsis_id", "pfr_id"], low_memory=False).dropna()
    train, test = (load(y, ids) for y in TRAIN_TEST)
    out = {"features": FEATURES, "source": "nflverse snap counts + weekly player stats, "
           f"validated {TRAIN_TEST[0]}->{TRAIN_TEST[1]}, final fit on both", "groups": {}}
    for grp in GROUPS:
        a, b = train[train.grp == grp], test[test.grp == grp]
        p = np.clip(fit(a).predict(b[FEATURES]), 0, 1)
        per_game = float((np.abs(p - b.pct) * b.TT).mean())
        season = b.assign(pred=p * b.TT).groupby("pfr_player_id").agg(pred=("pred", "sum"), act=("snaps", "sum"))
        season = season[season.act >= 100]
        season_err = float((np.abs(season.pred - season.act) / season.act).median())
        final = fit(pd.concat([a, b]))
        out["groups"][grp] = {"mae_snaps_per_game": round(per_game, 1), "median_season_error": round(season_err, 3),
                              "n_train": int(len(a) + len(b)), **export(final)}
        print(f"{grp}: ±{per_game:.1f} snaps/game, season totals within {season_err:.0%} (median), {len(a) + len(b)} player-games")
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
