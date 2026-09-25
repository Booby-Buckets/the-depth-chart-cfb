"""build_handchart.py — fold the owner's hand-charted plays (Tier 2, /chart) into the site data.

The charting tool saves plays to Supabase; the site serves them read-only at
/api/chart/export?season=YYYY. This pulls that export, joins each charted play to our cached
ESPN play-by-play by (game id, sequence number) to learn the passer / target / rusher and the
result, and totals it per player and per team (offense and defense).

Output (attached by build_hub, like the text charting):
  player_hand[pid] = {"pass": {...}, "recv": {...}, "rush": {...}}
  team_hand[tid]   = {"off": {...}, "def": {...}}
Every section says how many plays it's built on ("n"); nothing is published below MIN_PLAYS.
"""
import json, os, urllib.request
from collections import Counter, defaultdict

EXPORT = os.environ.get("CHART_EXPORT_URL", "https://www.thedepthchartcfb.com/api/chart/export")
MIN_PLAYS = 5


def fetch_export(season):
    try:
        req = urllib.request.Request(f"{EXPORT}?season={season}", headers={"User-Agent": "tdc-cfb-build"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r).get("plays") or []
    except Exception as e:
        print(f"handchart: export unavailable ({e}); skipping")
        return []


def _pid(p, role):
    for x in p.get("participants") or []:
        if x.get("type") == role and x.get("athlete"):
            return x["athlete"]["$ref"].rsplit("/", 1)[-1].split("?", 1)[0]
    return None


def _result(t):
    if t in ("Pass Reception", "Passing Touchdown"):
        return "C"
    if "Interception" in t:
        return "I"
    if t == "Sack":
        return "S"
    if t in ("Rush", "Rushing Touchdown"):
        return "R"
    return "X"


def _new_pass():
    return {"n": 0, "att": 0, "comp": 0, "yds": 0, "pts": [], "platform": Counter(), "pressure": Counter(),
            "pSrc": Counter(), "route": Counter(), "cov": Counter(), "window": Counter(),
            "split": {k: [0, 0, 0] for k in ("clean", "pressured", "pa", "nopa")},   # att, comp, yds
            "pa": 0, "rpo": 0, "screen": 0, "motion": 0, "drop": 0, "contested": 0, "throwaway": 0, "bt": 0}


def _add_pass(a, d, res, yds):
    a["n"] += 1
    thrown = res in ("C", "X", "I")
    if thrown and not d.get("throwaway"):
        a["att"] += 1
        a["comp"] += res == "C"
        a["yds"] += yds if res == "C" else 0
    for k in ("platform", "pressure", "pSrc", "route", "cov", "window"):
        if d.get(k):
            a[k][d[k]] += 1
    for k in ("pa", "rpo", "screen", "motion", "drop", "contested", "throwaway"):
        a[k] += bool(d.get(k))
    a["bt"] += int(d.get("bt") or 0)
    if thrown:
        press = d.get("pressure") not in (None, "None")
        for key in (("pressured" if press else "clean"), ("pa" if d.get("pa") else "nopa")):
            s = a["split"][key]
            s[0] += 1; s[1] += res == "C"; s[2] += yds if res == "C" else 0
    if d.get("launch") or d.get("target"):
        L, T = d.get("launch") or {}, d.get("target") or {}
        a["pts"].append([L.get("x"), L.get("y"), T.get("x"), T.get("y"), res])


def _new_rush():
    return {"n": 0, "yds": 0, "concept": {}, "gap": {}, "box": {}, "bt": 0, "ybc": [], "pts": []}   # concept/gap/box: [carries, yds]


def _add_rush(a, d, yds):
    a["n"] += 1
    a["yds"] += yds
    for k in ("concept", "gap", "box"):
        if d.get(k):
            c = a[k].setdefault(d[k], [0, 0])
            c[0] += 1; c[1] += yds
    a["bt"] += int(d.get("bt") or 0)
    c = d.get("contact")
    if c and c.get("y") is not None:
        a["ybc"].append(c["y"])
    if d.get("poa"):
        a["pts"].append([d["poa"].get("x"), c.get("x") if c else None, c.get("y") if c else None, yds])


def _finish(a):
    if not a or a["n"] < MIN_PLAYS:
        return None
    out = {k: (dict(v) if isinstance(v, Counter) else v) for k, v in a.items()}
    if "ybc" in out:
        out["ybcAvg"] = round(sum(out["ybc"]) / len(out["ybc"]), 1) if out["ybc"] else None
        out["yac"] = round((out["yds"] - sum(out["ybc"])) / len(out["ybc"]), 1) if out["ybc"] and len(out["ybc"]) == out["n"] else None
        del out["ybc"]
    return out


def build_handchart(season, plays):
    """(team_hand, player_hand) from the export joined to this season's cached play-by-play.
    plays = {game_id: [ESPN core play, ...]} (build_pbp.load_plays)."""
    rows = fetch_export(season)
    if not rows:
        return {}, {}
    by_seq = {gid: {str(p.get("sequenceNumber")): p for p in items or []} for gid, items in plays.items()}
    T = defaultdict(lambda: {"off": {"pass": _new_pass(), "rush": _new_rush()}, "def": {"pass": _new_pass(), "rush": _new_rush()}})
    QB, WR, RB = defaultdict(_new_pass), defaultdict(_new_pass), defaultdict(_new_rush)
    joined = 0
    for r in rows:
        p = (by_seq.get(r["game_id"]) or {}).get(str(r["seq"]))
        if not p:
            continue
        joined += 1
        d = r.get("data") or {}
        res = _result((p.get("type") or {}).get("text", ""))
        yds = p.get("statYardage") or 0
        kind = r.get("kind")
        if kind in ("pass", "sack"):
            for side, tid in (("off", r.get("off_tid")), ("def", r.get("def_tid"))):
                if tid:
                    _add_pass(T[tid][side]["pass"], d, res, yds)
            qb = _pid(p, "passer") or _pid(p, "rusher")
            if qb:
                _add_pass(QB[qb], d, res, yds)
            tg = _pid(p, "receiver")
            if tg and kind == "pass":
                _add_pass(WR[tg], d, res, yds)
        elif kind == "run":
            for side, tid in (("off", r.get("off_tid")), ("def", r.get("def_tid"))):
                if tid:
                    _add_rush(T[tid][side]["rush"], d, yds)
            rb = _pid(p, "rusher")
            if rb:
                _add_rush(RB[rb], d, yds)
    team_hand = {}
    for tid, sides in T.items():
        t = {side: {k: v for k, v in (("pass", _finish(s["pass"])), ("rush", _finish(s["rush"]))) if v} for side, s in sides.items()}
        if t["off"] or t["def"]:
            team_hand[tid] = t
    player_hand = defaultdict(dict)
    for src, key in ((QB, "pass"), (WR, "recv"), (RB, "rush")):
        for pid, a in src.items():
            f = _finish(a)
            if f:
                player_hand[pid][key] = f
    print(f"handchart: {len(rows)} charted plays ({joined} matched to play-by-play); {len(team_hand)} teams, {len(player_hand)} players")
    return team_hand, dict(player_hand)
