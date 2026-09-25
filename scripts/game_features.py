"""game_features.py — per-game, per-team efficiency from our cached play-by-play.

For every completed FBS-involved game: each offense's non-garbage plays, success rate, yards
per play, explosive-play rate and turnovers (build_advanced.classify's definitions), cached
as cache/gamefeat_<season>.json = {gid: {tid: {...}}}.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_advanced import classify

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")


def _load(gid):
    p = os.path.join(CACHE, f"pbp_{gid}.json")
    return json.load(open(p)) if os.path.exists(p) else None


def game_features(y, games, refresh=False):
    path = os.path.join(CACHE, f"gamefeat_{y}.json")
    out = json.load(open(path)) if os.path.exists(path) and not refresh else {}
    todo = [g for g in games if g["completed"] and g["id"] not in out]
    for g in todo:
        plays = _load(g["id"])
        if not plays:
            continue
        agg = {}
        for pl in classify([g], {g["id"]: plays}):
            a = agg.setdefault(pl["off"], {"n": 0, "succ": 0, "sn": 0, "yds": 0, "expl": 0, "to": 0})
            a["n"] += 1
            a["yds"] += pl["yds"]
            if pl["success"] is not None:
                a["sn"] += 1; a["succ"] += pl["success"]
            a["expl"] += (pl["kind"] == "rush" and pl["yds"] >= 10) or (pl["kind"] == "pass" and pl["yds"] >= 20)
            a["to"] += pl["int"] or ("Fumble Recovery (Opponent)" in pl["type"] or "Fumble Return" in pl["type"])
        if len(agg) == 2 and all(a["n"] >= 20 for a in agg.values()):
            out[g["id"]] = agg
    if todo:
        json.dump(out, open(path, "w"), separators=(",", ":"))
    return out


if __name__ == "__main__":
    from model_backtest import season
    for y in range(int(sys.argv[1]), int(sys.argv[-1]) + 1):
        teams, games = season(y)
        f = game_features(y, [g for g in games if g["home"] in teams or g["away"] in teams])
        print(y, len(f), flush=True)
