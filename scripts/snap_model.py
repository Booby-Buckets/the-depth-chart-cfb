"""snap_model.py — evaluates scripts/snap_model.json (trained by calibrate_snaps.py) in pure
Python, so the nightly build needs no ML libraries.

snap_pct(group, share, rate, n, rk) -> estimated fraction of team plays on the field.
"""
import json, os

_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "snap_model.json")) as f:
            _MODEL = json.load(f)
    return _MODEL


def error(group):
    g = _model()["groups"].get(group) or {}
    return g.get("mae_snaps_per_game"), g.get("median_season_error")


def snap_pct(group, share, rate, n, rk):
    g = _model()["groups"].get(group)
    if not g:
        return None
    x = (share, rate, n, rk)
    total = g["baseline"]
    for nodes in g["trees"]:
        i = 0
        while True:
            feat, thr, left, right, leaf, value, _missing_left = nodes[i]
            if leaf:
                total += value
                break
            i = left if x[feat] <= thr else right
    return min(1.0, max(0.0, total))
