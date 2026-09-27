"""game_score.py — a 0–10 rating for every player game, from the box-score line (scripts/box.py).

Two steps:
  1. value(line): what the game was worth in yard-equivalents, from every part of the box score.
     Passing is surplus over a replacement rate (yards + 20/TD − 45/INT − 5 per attempt), rushing
     the same idea (− 3 per carry), plus receiving, defense (tackles, TFL, sacks, passes defended,
     picks, hurries), kicking, punting and returns. A QB's rushing counts toward his game.
  2. rating: that value's percentile among every game played at the same position, 2014–2025
     (enough involvement to count; game_score_knots.json keeps each distribution), mapped to
     the scale the basketball site uses: a median game is 6.0, top 10% 8.0, the best game in 200
     is a 10.

    python3 scripts/game_score.py --fit     # refit the knots from the built seasons
"""
import bisect, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
KNOTS_FILE = os.path.join(HERE, "game_score_knots.json")

GROUP = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
         "DL": "DL", "DE": "DL", "DT": "DL", "NT": "DL", "EDGE": "DL",
         "LB": "LB", "OLB": "LB", "ILB": "LB", "MLB": "LB",
         "DB": "DB", "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB", "SAF": "DB",
         "PK": "K", "K": "K", "P": "P"}
# percentile -> rating
SCALE = [(0.01, 2.0), (0.10, 3.8), (0.25, 5.0), (0.50, 6.0), (0.75, 7.0), (0.90, 8.0), (0.97, 9.0), (0.995, 10.0)]


def _g(l, c, k):
    return (l.get(c) or {}).get(k) or 0


def value(l):
    """Yard-equivalents for one game's box line."""
    v = 0.0
    if _g(l, "passing", "ATT"):
        v += _g(l, "passing", "YDS") + 20 * _g(l, "passing", "TD") - 45 * _g(l, "passing", "INT") - 5.0 * _g(l, "passing", "ATT")
    v += _g(l, "rushing", "YDS") + 20 * _g(l, "rushing", "TD") - 3.0 * _g(l, "rushing", "CAR")
    v += _g(l, "receiving", "YDS") + 20 * _g(l, "receiving", "TD") + 2 * _g(l, "receiving", "REC")
    v -= 40 * _g(l, "fumbles", "LOST")
    solo = _g(l, "defensive", "SOLO")
    v += 4 * solo + 2.5 * (_g(l, "defensive", "TOT") - solo) + 10 * _g(l, "defensive", "TFL") + 10 * _g(l, "defensive", "SACKS") \
        + 12 * _g(l, "defensive", "PD") + 4 * _g(l, "defensive", "QB HUR") + 25 * _g(l, "defensive", "TD") \
        + 35 * _g(l, "interceptions", "INT") + 0.5 * _g(l, "interceptions", "YDS") + 25 * _g(l, "fumbles", "REC")
    fga, xpa = _g(l, "kicking", "FGA"), _g(l, "kicking", "XPA")
    if fga or xpa:
        fgm, xpm = _g(l, "kicking", "FGM"), _g(l, "kicking", "XPM")
        v += 15 * fgm - 25 * (fga - fgm) + 2 * xpm - 12 * (xpa - xpm) + 0.3 * max(0, _g(l, "kicking", "LONG") - 40) * (fgm > 0)
    if _g(l, "punting", "NO"):
        v += _g(l, "punting", "YDS") - 40 * _g(l, "punting", "NO") + 6 * _g(l, "punting", "In 20") - 10 * _g(l, "punting", "TB")
    v += _g(l, "kickReturns", "YDS") - 21 * _g(l, "kickReturns", "NO") + 30 * _g(l, "kickReturns", "TD")
    v += _g(l, "puntReturns", "YDS") - 8 * _g(l, "puntReturns", "NO") + 30 * _g(l, "puntReturns", "TD")
    return v


def group_of(pos, l):
    """Position group; for players with no usable position, read it off the line."""
    g = GROUP.get((pos or "").upper())
    if g:
        return g
    if _g(l, "passing", "ATT") >= 8:
        return "QB"
    if _g(l, "kicking", "FGA") or _g(l, "kicking", "XPA"):
        return "K"
    if _g(l, "punting", "NO"):
        return "P"
    if _g(l, "rushing", "CAR") >= 5:
        return "RB"
    if _g(l, "receiving", "REC"):
        return "WR"
    if _g(l, "defensive", "TOT") or _g(l, "interceptions", "INT"):
        return "DEF"
    return None


def involved(grp, l):
    """Enough of a role that game to rate it (a QB's two kneel-downs isn't a game)."""
    tch = _g(l, "rushing", "CAR") + _g(l, "receiving", "REC")
    dfn = _g(l, "defensive", "TOT") + _g(l, "defensive", "PD") + _g(l, "interceptions", "INT")
    return {"QB": _g(l, "passing", "ATT") >= 8,
            "RB": tch >= 4, "WR": _g(l, "receiving", "REC") >= 1 or tch >= 3, "TE": _g(l, "receiving", "REC") >= 1,
            "DL": dfn >= 1, "LB": dfn >= 1, "DB": dfn >= 1, "DEF": dfn >= 1,
            "K": _g(l, "kicking", "FGA") + _g(l, "kicking", "XPA") >= 1, "P": _g(l, "punting", "NO") >= 1}.get(grp, False)


_KNOTS = None


def knots():
    global _KNOTS
    if _KNOTS is None:
        with open(KNOTS_FILE) as f:
            _KNOTS = json.load(f)
    return _KNOTS


def _pct_to_rating(pc):
    pts = [(0.0, 1.0)] + SCALE + [(1.0, 10.0)]
    for (p0, r0), (p1, r1) in zip(pts, pts[1:]):
        if pc <= p1:
            return r0 + (pc - p0) / max(1e-9, p1 - p0) * (r1 - r0)
    return 10.0


def rate(pos, l):
    """0–10 rating for one game, or None when there wasn't enough of a role to rate."""
    grp = group_of(pos, l)
    if not grp or not involved(grp, l):
        return None
    qs = knots().get(grp)
    if not qs:
        return None
    v = value(l)
    # mid-rank percentile among the position's games (ties share the middle of their range)
    pc = (bisect.bisect_left(qs, v) + bisect.bisect_right(qs, v)) / 2 / len(qs)
    return round(max(1.0, min(10.0, _pct_to_rating(pc))), 1)


def rate_all(players):
    """Adds p["gr"] = {game id: rating} to every player with a game log (in place)."""
    n = 0
    for p in players:
        p.pop("gr", None)
        gr = {gid: r for gid, l in (p.get("gl") or {}).items() if (r := rate(p.get("pos"), l)) is not None}
        if gr:
            p["gr"] = gr
            n += 1
    return n


def fit():
    root = os.path.join(os.path.dirname(HERE), "public", "data", "seasons")
    vals = {}
    for y in sorted(int(d) for d in os.listdir(root) if d.isdigit()):
        d = os.path.join(root, str(y), "players")
        for fn in os.listdir(d):
            if not fn[0].isdigit():
                continue
            for p in json.load(open(os.path.join(d, fn)))["players"]:
                for l in (p.get("gl") or {}).values():
                    grp = group_of(p.get("pos"), l)
                    if grp and involved(grp, l):
                        vals.setdefault(grp, []).append(value(l))
    out = {}
    for grp, v in sorted(vals.items()):
        v.sort()
        q = lambda p: v[min(len(v) - 1, int(p * len(v)))]
        out[grp] = [round(q(k / 400), 1) for k in range(401)]   # the position's distribution, every 0.25%
        print(f"{grp:4s} {len(v):7d} games  " + "  ".join(f"p{int(p*1000)/10:g}={q(p):.0f}" for p, _ in SCALE))
    with open(KNOTS_FILE, "w") as f:
        json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    if "--fit" in sys.argv:
        fit()
