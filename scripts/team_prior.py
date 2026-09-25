"""team_prior.py — roster-continuity features for the preseason prior.

For season y and team T, from our own player files (public/data/seasons/<y>/players and, for
the live season, public/data/players):

  retOff   share of T's y-1 offensive production (scrimmage yards; passing counted at 0.5) by
           players who are on T again in y
  retQB    share of T's y-1 pass attempts thrown by a returning player
  retDef   share of T's y-1 defensive production (tackles + 2*TFL + 2*PD + 4*INT + 3*sacks) returning
  inOff/inDef/inQB   the same production brought in by transfers, measured at their old school
                     as a share of T's own y-1 totals (so 0.3 = a transfer class worth 30% of last
                     year's output)

"On T again in y" = appears in T's season-y player file. For past seasons that file lists only
players who recorded a stat, which leaks a little hindsight (a returner hurt all year looks gone);
for the live season it is the actual roster.
"""
import json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
_cache = {}


def _stat(p, c, k):
    return ((p.get("stats") or {}).get(c) or {}).get(k) or 0.0


def off_prod(p):
    return 0.5 * _stat(p, "passing", "YDS") + _stat(p, "rushing", "YDS") + _stat(p, "receiving", "YDS")


def def_prod(p):
    return (_stat(p, "defensive", "TOT") + 2 * _stat(p, "defensive", "TFL") + 2 * _stat(p, "defensive", "PD")
            + 3 * _stat(p, "defensive", "SACKS") + 4 * _stat(p, "interceptions", "INT"))


def season_players(y, live=False):
    """{tid: [player, ...]} for season y."""
    k = (y, live)
    if k not in _cache:
        d = os.path.join(DATA, "players") if live else os.path.join(DATA, "seasons", str(y), "players")
        out = {}
        for f in glob.glob(os.path.join(d, "*.json")):
            b = os.path.basename(f)[:-5]
            if not b.isdigit():
                continue
            j = json.load(open(f))
            out[b] = [p for p in j.get("players", []) if p.get("id") and not str(p["id"]).startswith("-")
                      and (not live or p.get("onRoster", True))]
        _cache[k] = out
    return _cache[k]


def features(y, live=False):
    """{tid: {retOff, retQB, retDef, inOff, inQB, inDef}} for season y."""
    prev = season_players(y - 1)
    cur = season_players(y, live=live)
    where_prev = {}
    for tid, ps in prev.items():
        for p in ps:
            where_prev[str(p["id"])] = (tid, p)
    out = {}
    for tid, ps in cur.items():
        last = prev.get(tid)
        if not last:
            continue
        tot_o = sum(off_prod(p) for p in last) or 1
        tot_q = sum(_stat(p, "passing", "ATT") for p in last) or 1
        tot_d = sum(def_prod(p) for p in last) or 1
        f = dict.fromkeys(("retOff", "retQB", "retDef", "inOff", "inQB", "inDef"), 0.0)
        for p in ps:
            w = where_prev.get(str(p["id"]))
            if not w:
                continue
            old_tid, op = w
            pre = "ret" if old_tid == tid else "in"
            f[pre + "Off"] += off_prod(op) / tot_o
            f[pre + "QB"] += _stat(op, "passing", "ATT") / tot_q
            f[pre + "Def"] += def_prod(op) / tot_d
        out[tid] = {k: round(min(v, 1.5), 3) for k, v in f.items()}
    return out
