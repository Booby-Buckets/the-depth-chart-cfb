"""build_betting.py — the betting page's data (public/data/betting.json).

Three parts, all measured against the closing consensus line (ESPN's core odds feed, the median
across books; in-game "live" books excluded):

  board    this week's games: our model spread/total/win probability vs the market's, the edge,
           and how often the model has covered at that size of edge (from the record below)
  record   the model against the spread and the total, every FBS game since 2015. Every model line
           is walk-forward (fit only on games played before that week, like it would have been
           published), so the record is what you'd actually have seen. By season and by edge size.
  teams    each team's record against the spread and the total, by season (2024 on), with
           favourite / underdog and home / away splits

Past seasons' walk-forward predictions are computed once and kept in scripts/betting_history.json
(`python3 scripts/build_betting.py --history`); the current season is refit every build.
"""
import json, math, os, statistics, sys, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache")
HIST = os.path.join(HERE, "betting_history.json")
OUT = os.path.join(ROOT, "public", "data", "betting.json")
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
FIRST = 2015
BUCKETS = [(0, 2), (2, 4), (4, 7), (7, 99)]


def odds(gid, cache=True):
    """{"spread": home expected margin, "total": .., "books": [..]} (median across pregame books)."""
    path = os.path.join(CACHE, f"line_{gid}.json")
    if cache and os.path.exists(path):
        d = json.load(open(path))
        if "books" in d:
            return d
    out = {}
    for _ in range(3):
        try:
            with urllib.request.urlopen(f"{CORE}/events/{gid}/competitions/{gid}/odds?limit=50", timeout=20) as r:
                d = json.load(r)
            items = [it for it in d.get("items", []) if "live" not in ((it.get("provider") or {}).get("name") or "").lower()]
            out["books"] = sorted({(it.get("provider") or {}).get("name") or "?" for it in items})
            op = _opening(items)
            if op:
                json.dump(op, open(os.path.join(CACHE, f"open_{gid}.json"), "w"))
            sp = [-float(it["spread"]) for it in items if it.get("spread") is not None]
            tot = [float(it["overUnder"]) for it in items if it.get("overUnder")]
            if sp:
                out["spread"] = statistics.median(sp)
            if tot:
                out["total"] = statistics.median(tot)
            break
        except Exception as e:
            if "404" in str(e):
                break
            time.sleep(1)
    if cache and out:
        json.dump(out, open(path, "w"))
    return out


def _num(v):
    try:
        return float(str(v).replace("+", ""))
    except (TypeError, ValueError):
        return None


def _opening(items):
    """Opening spread (home expected margin) and total, median across books. ESPN has these from ~2023."""
    sp, tt = [], []
    for it in items:
        o = (it.get("homeTeamOdds") or {}).get("open") or {}
        v = _num((o.get("pointSpread") or {}).get("american"))
        if v is not None:
            sp.append(-v)                              # "+5.5" for the home side = home expected margin −5.5
        t = _num((((it.get("open") or {}).get("total")) or {}).get("american"))
        if t:
            tt.append(t)
    out = {}
    if sp:
        out["open"] = statistics.median(sp)
    if tt:
        out["otot"] = statistics.median(tt)
    return out


def opening(gid):
    p = os.path.join(CACHE, f"open_{gid}.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def predictions(y):
    """Walk-forward model lines for every FBS game of season y that has been played."""
    from model_backtest import walk_forward, season
    from spread_model import PARAMS
    teams, _ = season(y)
    rows = []
    for g, pred in walk_forward(y, PARAMS):
        if not g.get("completed") or g.get("hs") is None:
            continue
        rows.append({"id": g["id"], "season": y, "date": g["date"], "wk": g.get("week"), "type": g.get("type"),
                     "home": g["home"], "away": g["away"], "neutral": bool(g.get("neutral")),
                     "fbs": [g["home"] in teams, g["away"] in teams],
                     "pred": round(pred, 1), "ptot": round(g["_tot"][1.0], 1), "hs": g["hs"], "as": g["as"]})
    with ThreadPoolExecutor(12) as ex:
        lines = list(ex.map(lambda r: odds(r["id"]), rows))
    for r, l in zip(rows, lines):
        r["line"], r["ltot"] = l.get("spread"), l.get("total")
        if y >= 2023:                                  # opening lines exist from about 2023
            if not os.path.exists(os.path.join(CACHE, f"open_{r['id']}.json")) and r["line"] is not None:
                odds(r["id"], cache=False)
            o = opening(r["id"])
            r["open"], r["otot"] = o.get("open"), o.get("otot")
    return rows


def grade(r):
    """Model's side and total picks vs the closing line: 1 win, 0 loss, None push / no line."""
    out = {}
    if r["line"] is not None and r["pred"] != r["line"]:
        m = r["hs"] - r["as"]
        c = m - r["line"]                       # home cover margin
        out["ats"] = None if c == 0 else int((c > 0) == (r["pred"] > r["line"]))
        out["edge"] = abs(r["pred"] - r["line"])
    if r["ltot"] is not None and r["ptot"] != r["ltot"]:
        t = r["hs"] + r["as"] - r["ltot"]
        out["ou"] = None if t == 0 else int((t > 0) == (r["ptot"] > r["ltot"]))
        out["tedge"] = abs(r["ptot"] - r["ltot"])
    return out


def wl(xs):
    w = sum(1 for x in xs if x == 1); l = sum(1 for x in xs if x == 0)
    return [w, l, round(w / (w + l), 3) if w + l else None]


def record(rows):
    G = [(r, grade(r)) for r in rows if r["fbs"][0] and r["fbs"][1]]
    by_season = {}
    for y in sorted({r["season"] for r, _ in G}):
        s = [(r, g) for r, g in G if r["season"] == y]
        by_season[y] = {"ats": wl([g.get("ats") for _, g in s if "ats" in g]), "ats3": wl([g["ats"] for _, g in s if "ats" in g and g["edge"] >= 3]),
                        "ou": wl([g.get("ou") for _, g in s if "ou" in g]),
                        "mae": round(statistics.mean(abs(r["pred"] - (r["hs"] - r["as"])) for r, _ in s), 2),
                        "maeLine": round(statistics.mean(abs(r["line"] - (r["hs"] - r["as"])) for r, _ in s if r["line"] is not None), 2) if any(r["line"] is not None for r, _ in s) else None,
                        "n": len(s)}
    buckets = []
    for lo, hi in BUCKETS:
        a = [g["ats"] for _, g in G if "ats" in g and lo <= g["edge"] < hi]
        o = [g["ou"] for _, g in G if "ou" in g and lo <= g["tedge"] < hi]
        buckets.append({"lo": lo, "hi": hi, "ats": wl(a), "ou": wl(o)})
    return {"seasons": by_season, "buckets": buckets,
            "all": {"ats": wl([g["ats"] for _, g in G if "ats" in g]), "ou": wl([g["ou"] for _, g in G if "ou" in g])}}


def record_open(rows, bias_by_season):
    """The model against the OPENING line (2023 on), regular season: the number you'd bet early in
    the week. Plus closing line value: how often the line moved toward the model after it opened."""
    G = [r for r in rows if r.get("open") is not None and r["fbs"][0] and r["fbs"][1] and r["type"] == 2]
    def side(r):
        g = r["pred"] - r["open"]
        c = (r["hs"] - r["as"]) - r["open"]
        return None if g == 0 or c == 0 else int((c > 0) == (g > 0)), abs(g)
    def tot(r):
        if r.get("otot") is None:
            return None, 0
        g = r["ptot"] - r["otot"] - bias_by_season.get(r["season"], 0)
        d = r["hs"] + r["as"] - r["otot"]
        return None if g == 0 or d == 0 else int((d > 0) == (g > 0)), abs(g)
    buckets = []
    for lo, hi in BUCKETS:
        a = [x for x, e in map(side, G) if x is not None and lo <= e < hi]
        o = [x for x, e in map(tot, G) if x is not None and lo <= e < hi]
        buckets.append({"lo": lo, "hi": hi, "ats": wl(a), "ou": wl(o)})
    plus4 = {y: wl([x for x, e in map(side, [r for r in G if r["season"] == y]) if x is not None and e >= 4]) for y in sorted({r["season"] for r in G})}
    mv = [(r["pred"] - r["open"], r["line"] - r["open"]) for r in G if r["line"] is not None and r["line"] != r["open"] and r["pred"] != r["open"]]
    toward = sum(1 for g, m in mv if (m > 0) == (g > 0))
    return {"buckets": buckets, "plus4": plus4, "clv": [toward, len(mv) - toward, round(toward / len(mv), 3) if mv else None],
            "ats4": wl([x for x, e in map(side, G) if x is not None and e >= 4]), "ou4": wl([x for x, e in map(tot, G) if x is not None and e >= 4]),
            "since": min((r["season"] for r in G), default=None), "n": len(G)}


def team_ats(rows, names):
    T = defaultdict(lambda: defaultdict(lambda: {"ats": [0, 0, 0], "ou": [0, 0, 0], "fav": [0, 0, 0], "dog": [0, 0, 0],
                                                  "home": [0, 0, 0], "away": [0, 0, 0], "cover": [], "n": 0}))
    for r in rows:
        if r["line"] is None:
            continue
        m = r["hs"] - r["as"]
        for tid, sign in ((r["home"], 1), (r["away"], -1)):
            if tid not in names:
                continue
            t = T[r["season"]][tid]
            c = sign * (m - r["line"])            # this team's cover margin
            k = 0 if c > 0 else 1 if c < 0 else 2
            t["ats"][k] += 1; t["n"] += 1
            t["cover"].append(c)
            fav = sign * r["line"] > 0
            t["fav" if fav else "dog"][k] += 1
            if not r["neutral"]:
                t["home" if sign > 0 else "away"][k] += 1
            if r["ltot"] is not None:
                d = r["hs"] + r["as"] - r["ltot"]
                t["ou"][0 if d > 0 else 1 if d < 0 else 2] += 1
    out = {}
    for y, teams in T.items():
        out[y] = {tid: {**{k: v for k, v in t.items() if k != "cover"}, "avgCover": round(statistics.mean(t["cover"]), 1)} for tid, t in teams.items()}
    return out


def board(hub, rec, bias):
    """This week's games: model vs the current market line. Total gaps are shown net of the
    model's average total-vs-line gap this season (bias), so a model that runs high doesn't
    lean over on every game."""
    todo = [g for g in hub["slate"] if not g["completed"]]
    with ThreadPoolExecutor(12) as ex:
        lines = list(ex.map(lambda g: odds(g["id"], cache=False), todo))
    opens = [opening(g["id"]) for g in todo]
    cover_at = {b["lo"]: b["ats"][2] for b in rec["buckets"]}
    rows = []
    for g, l, o in zip(todo, lines, opens):
        sp, tot = l.get("spread"), l.get("total")
        op, otot = o.get("open"), o.get("otot")
        edge = round(g["spread"] - sp, 1) if sp is not None else None
        b = next((b for b in rec["buckets"] if edge is not None and b["lo"] <= abs(edge) < b["hi"]), None)
        rows.append({"id": g["id"], "date": g["date"], "home": g["home"], "away": g["away"], "homeName": g["homeName"], "awayName": g["awayName"],
                     "neutral": g["neutral"], "tv": g.get("tv"),
                     "model": g["spread"], "mtot": g["total"], "homeWin": g["homeWin"], "line": sp, "ltot": tot,
                     "books": l.get("books", []), "edge": edge, "tedge": round(g["total"] - tot - bias, 1) if tot is not None else None,
                     "hist": cover_at.get(b["lo"]) if b else None,
                     "open": op, "otot": otot, "ogap": round(g["spread"] - op, 1) if op is not None else None,
                     "otgap": round(g["total"] - otot - bias, 1) if otot is not None else None,
                     "bowl": g.get("type") == 3 if "type" in g else False})
    return rows


def main(history=False):
    hub = json.load(open(os.path.join(ROOT, "public", "data", "hub.json")))
    cur = hub["season"]
    if history or not os.path.exists(HIST):
        past = []
        for y in range(FIRST, cur):
            t0 = time.time()
            past += predictions(y)
            print(f"betting: {y} walk-forward done ({time.time() - t0:.0f}s)", flush=True)
        json.dump(past, open(HIST, "w"), separators=(",", ":"))
    past = json.load(open(HIST))
    now = predictions(cur)
    rows = past + now
    names = {t["id"]: t["name"] for t in hub["teams"]}
    rec = record(rows)
    tb = [r["ptot"] - r["ltot"] for r in now if r["ltot"] is not None and r["fbs"][0] and r["fbs"][1]]
    if len(tb) < 50:
        tb = [r["ptot"] - r["ltot"] for r in past if r["season"] == cur - 1 and r["ltot"] is not None]
    bias = round(statistics.mean(tb), 1) if tb else 0.0
    ats = team_ats([r for r in rows if r["season"] >= cur - 2], names)
    bias_by = {}
    for y in {r["season"] for r in rows if r.get("otot") is not None}:
        prev = [r["ptot"] - r["ltot"] for r in rows if r["season"] == y - 1 and r["ltot"] is not None]
        bias_by[y] = round(statistics.mean(prev), 1) if prev else 0.0   # last season's bias: no look-ahead
    ropen = record_open(rows, bias_by)
    out = {"season": cur, "built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), "slateLabel": hub.get("slateLabel"),
           "record": rec, "open": ropen, "board": board(hub, rec, bias), "totBias": bias, "teams": ats,
           "recent": [r for r in now if r["line"] is not None and r["fbs"][0] and r["fbs"][1]][-200:]}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    a = rec["all"]["ats"]
    o4 = ropen["ats4"]
    print(f"betting: vs the opener (4+ pt gap, {ropen['since']}+) {o4[0]}-{o4[1]} ({(o4[2] or 0):.1%}); line moved toward the model {ropen['clv'][2]}")
    print(f"betting: model ATS since {FIRST} {a[0]}-{a[1]} ({a[2]:.1%}); {len(out['board'])} games on this week's board, "
          f"{sum(1 for b in out['board'] if b['line'] is not None)} with a market line")


if __name__ == "__main__":
    main(history="--history" in sys.argv)
