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


def band(group, est_total, games):
    """80% range for an estimated snap total over `games` games -> (lo, hi) in snaps."""
    g = _model()["groups"].get(group)
    if not g or "bands" not in g or est_total <= 0:
        return None
    b = g["bands"]
    i = next((i for i, (k0, k1) in enumerate(b["k_bins"]) if k0 <= games <= k1), len(b["k_bins"]) - 1)
    per_game = est_total / max(1, games)
    j = 0 if per_game < 15 else 1 if per_game < 40 else 2
    lo, hi = b["q10_q90"][i][j]
    return round(est_total * lo), round(est_total * hi)


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
