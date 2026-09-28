"""build_props.py — player prop projections for this week's FBS games (public/data/props.json).

For every player with a real role, a projection for the markets books post on college games:
passing yards, passing TDs, rushing yards, receiving yards, receptions and an anytime TD chance.

  projection = recency-weighted per-game average (this season, shrunk toward last season's)
               × opponent factor  (what that defence has allowed per game vs. the FBS average, half weight)
               × game-script factor (our implied team points for this game vs. the team's average)
  spread     = the player's own game-to-game spread, floored, for over/under chances

Validated walk-forward on 2025 (`python3 scripts/build_props.py --test 2025`): each game projected
from only the games before it, scored against a plain season average.
Book prop lines, when a feed is connected, are merged in by build_betting's odds step (see ODDS below).
"""
import json, math, os, statistics, sys, time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "public", "data")
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(DATA, "props.json")

# market: (label, category, key, player filter)
MARKETS = {
    "passYds": ("Passing yards", "passing", "YDS"),
    "passTD": ("Passing TDs", "passing", "TD"),
    "rushYds": ("Rushing yards", "rushing", "YDS"),
    "recYds": ("Receiving yards", "receiving", "YDS"),
    "rec": ("Receptions", "receiving", "REC"),
}
MIN_ROLE = {"passYds": ("passing", "ATT", 12), "passTD": ("passing", "ATT", 12), "rushYds": ("rushing", "CAR", 5),
            "recYds": ("receiving", "REC", 1.5), "rec": ("receiving", "REC", 1.5)}
TEAM_KEY = {"passYds": ("passing", "YDS"), "passTD": ("passing", "TD"), "rushYds": ("rushing", "YDS"), "recYds": ("receiving", "YDS"), "rec": ("receiving", "REC")}
DECAY, SHRINK_N, OPP_W, VOL_EXP = 0.8, 1.5, 0.5, 0.5
# per-market settings, tuned walk-forward on 2024 and confirmed on 2025 (python3 scripts/build_props.py --tune)
PARAMS = {}
PFILE = os.path.join(HERE, "props_params.json")
if os.path.exists(PFILE):
    PARAMS = json.load(open(PFILE))
SD_FLOOR = {"passYds": 0.30, "passTD": 0.6, "rushYds": 0.45, "recYds": 0.5, "rec": 0.4}


def g(line, c, k):
    return ((line or {}).get(c) or {}).get(k) or 0


def load(y, current):
    """players {pid: {name,pos,tid,gl}}, game dates {gid: date}, team games {tid: [gid sorted]}."""
    pdir = os.path.join(DATA, "players") if current else os.path.join(DATA, "seasons", str(y), "players")
    tdir = os.path.join(DATA, "teams") if current else os.path.join(DATA, "seasons", str(y), "teams")
    players, date, sched = {}, {}, {}
    for fn in os.listdir(pdir):
        if not fn[0].isdigit():
            continue
        for p in json.load(open(os.path.join(pdir, fn)))["players"]:
            if p.get("gl") and not str(p["id"]).startswith("-") and (p.get("name") or "").strip() not in ("", "Team", " Team"):
                players[p["id"]] = {"name": p["name"], "pos": p.get("pos"), "tid": p.get("tid") or fn[:-5], "gl": p["gl"]}
    for fn in os.listdir(tdir):
        if not fn[0].isdigit():
            continue
        t = json.load(open(os.path.join(tdir, fn)))
        tid = fn[:-5]
        sched[tid] = []
        for x in t.get("schedule") or []:
            date[x["id"]] = x["date"]
            sched[tid].append({**x, "tid": tid})
        sched[tid].sort(key=lambda x: x["date"])
    return players, date, sched


def allowed(y, sched):
    """{(tid, gid): {market: what opponents did vs this defence in that game}} from box scores."""
    from box import load_box
    import build_hub as H
    games = [{"id": x["id"], "completed": True} for xs in sched.values() for x in xs if x.get("completed")]
    box = load_box(H.get, CACHE, list({g_["id"]: g_ for g_ in games}.values()))
    out = defaultdict(lambda: defaultdict(float))
    opp_of = {(x["tid"], x["id"]): x["opp"] for xs in sched.values() for x in xs}
    for gid, rows in box.items():
        teams = {r[0] for r in rows}
        for tid, cat, labels, ath, stats in rows:
            from box import line_of
            ln = line_of(cat, labels, stats)
            for m, (c, k) in TEAM_KEY.items():
                if cat == c and k in ln:
                    for d in teams - {tid}:
                        out[(d, gid)][m] += ln[k]
    return out


def project(vals, last_mean, opp_ratio, vol, m, P=None):
    """vals: this season's per-game values, oldest first. Returns (projection, sd)."""
    P = P or PARAMS.get(m) or {}
    DECAY, SHRINK_N, OPP_W, VOL_EXP = (P.get(k, d) for k, d in (("decay", 0.8), ("shrink", 1.5), ("opp", 0.5), ("vol", 0.5)))
    w = [DECAY ** i for i in range(len(vals) - 1, -1, -1)]
    base = sum(a * b for a, b in zip(w, vals)) / sum(w)
    if last_mean is not None:
        base = (sum(w) * base + SHRINK_N * last_mean) / (sum(w) + SHRINK_N)
    f_opp = 1 + OPP_W * (opp_ratio - 1) if opp_ratio else 1.0
    f_vol = min(1.25, max(0.8, max(vol, 0.1) ** VOL_EXP)) if vol else 1.0
    proj = max(0.0, base * f_opp * f_vol)
    sd = statistics.pstdev(vals) if len(vals) >= 3 else 0.0
    sd = max(sd, SD_FLOOR[m] * max(proj, 1.0 if m in ("passTD", "rec") else 10.0))
    return proj, sd


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def p_over_m(line, mean, sd, m):
    """Over chance as validated (Brier on 2024 + 2025): a plain normal for passing and rushing, a 50/50
    normal/gamma mix for receiving (catches are lumpier)."""
    n = 1 - phi((line - mean) / sd)
    return 0.5 * n + 0.5 * p_over(line, mean, sd) if m in ("recYds", "rec") else n


def p_over(line, mean, sd):
    """P(X > line) for a right-skewed stat: a gamma with this mean and sd (Wilson–Hilferty cube-root
    normal). Yardage is lopsided, so the median sits below the mean and 'over the average' hits < 50%."""
    if mean <= 0:
        return 0.0
    k = (mean / sd) ** 2                       # shape
    th = sd * sd / mean                        # scale
    x = max(line, 1e-9) / th
    z = ((x / k) ** (1 / 3) - (1 - 1 / (9 * k))) / math.sqrt(1 / (9 * k))
    return 1 - phi(z)


def context(y, current, players, date, sched):
    """Per team: games in date order with points for/against; per defence: allowed by market."""
    al = allowed(y, sched)
    lg = defaultdict(list)
    for (tid, gid), ms in al.items():
        for m, v in ms.items():
            lg[m].append(v)
    league = {m: statistics.mean(v) for m, v in lg.items()}
    last = {}
    if not current or True:
        prev_dir = os.path.join(DATA, "seasons", str(y - 1), "players")
        if os.path.isdir(prev_dir):
            for fn in os.listdir(prev_dir):
                if fn[0].isdigit():
                    for p in json.load(open(os.path.join(prev_dir, fn)))["players"]:
                        if p.get("gl"):
                            n = len(p["gl"])
                            last[p["id"]] = {m: sum(g(l, c, k) for l in p["gl"].values()) / n for m, (_, c, k) in MARKETS.items()}
    return al, league, last


def opp_ratio(al, league, sched, opp, before, m):
    xs = [al[(opp, x["id"])][m] for x in sched.get(opp, []) if x.get("completed") and x["date"] < before and (opp, x["id"]) in al]
    if len(xs) < 2 or not league.get(m):
        return None
    return statistics.mean(xs) / league[m]


def team_pts(sched, tid, before):
    xs = [x["pf"] for x in sched.get(tid, []) if x.get("completed") and x["date"] < before and x.get("pf") is not None]
    return statistics.mean(xs) if xs else None


_WALK = {}


def walk(y, params=None, markets=None):
    """Walk-forward on a finished season. Returns {market: [(proj, sd, actual, naive), ...]}."""
    if y not in _WALK:
        players, date, sched = load(y, False)
        _WALK[y] = (players, date, sched, *context(y, False, players, date, sched),
                    {r["id"]: r for r in json.load(open(os.path.join(HERE, "betting_history.json"))) if r["season"] == y})
    players, date, sched, al, league, last, hist = _WALK[y]
    res = defaultdict(list)
    for pid, p in players.items():
        gids = sorted((q for q in p["gl"] if q in date), key=lambda q: date[q])
        for i, gid in enumerate(gids):
            if i < 3:
                continue
            prior = gids[:i]
            x = next((s_ for s_ in sched.get(p["tid"], []) if s_["id"] == gid), None)
            if not x:
                continue
            r = hist.get(gid)
            vol = None
            if r:
                home = r["home"] == p["tid"]
                imp = (r["ptot"] + (r["pred"] if home else -r["pred"])) / 2
                tp = team_pts(sched, p["tid"], date[gid])
                vol = imp / tp if tp else None
            for m, (_, c, k) in MARKETS.items():
                if markets and m not in markets:
                    continue
                rc, rk, rmin = MIN_ROLE[m]
                if statistics.mean(g(p["gl"][q], rc, rk) for q in prior[-3:]) < rmin:
                    continue
                vals = [g(p["gl"][q], c, k) for q in prior]
                proj, sd = project(vals, last.get(pid, {}).get(m), opp_ratio(al, league, sched, x["opp"], date[gid], m), vol, m,
                                   (params or {}).get(m))
                res[m].append((proj, sd, g(p["gl"][gid], c, k), statistics.mean(vals)))
    return res


def report(res):
    for m, xs in res.items():
        a = statistics.mean(abs(p - act) for p, _, act, _ in xs); b = statistics.mean(abs(n - act) for _, _, act, n in xs)
        bins = defaultdict(list)
        for p, sd, act, _ in xs:
            line = math.floor(p) + 0.5 if m in ("passTD", "rec") else round(p) + 0.5
            bins[round(p_over(line, p, sd) * 10) / 10].append(int(act > line))
        print(f"{m:8s} n={len(xs):5d}  MAE ours {a:6.2f}  season avg {b:6.2f} ({100 * (1 - a / b):+.1f}%)  calib: " +
              " ".join(f"{k:.1f}→{statistics.mean(v):.2f}({len(v)})" for k, v in sorted(bins.items()) if len(v) >= 40))


def tune():
    import itertools
    best = {}
    for m in MARKETS:
        top = None
        for d, sh, o, v in itertools.product((0.6, 0.75, 0.9, 1.0), (0, 1.5, 3, 5), (0, 0.25, 0.5, 0.75), (0, 0.5, 1.0)):
            P = {m: {"decay": d, "shrink": sh, "opp": o, "vol": v}}
            xs = walk(2024, P, [m])[m]
            mae = statistics.mean(abs(p - a) for p, _, a, _ in xs)
            if top is None or mae < top[0]:
                top = (mae, P[m])
        best[m] = top[1]
        print(f"{m}: 2024 MAE {top[0]:.2f} with {top[1]}", flush=True)
    json.dump(best, open(PFILE, "w"), indent=1)
    print("2025 (out of sample) with tuned settings:")
    report(walk(2025, best))


def main():
    hub = json.load(open(os.path.join(DATA, "hub.json")))
    y = hub["season"]
    players, date, sched = load(y, True)
    al, league, last = context(y, True, players, date, sched)
    todo = [x for x in hub["slate"] if not x["completed"]]
    names = {t["id"]: t for t in hub["teams"]}
    by_team = defaultdict(list)
    for pid, p in players.items():
        by_team[p["tid"]].append(pid)
    out = []
    for G in todo:
        for tid, opp, home in ((G["home"], G["away"], True), (G["away"], G["home"], False)):
            imp = (G["total"] + (G["spread"] if home else -G["spread"])) / 2
            tp = team_pts(sched, tid, G["date"])
            vol = imp / tp if tp else None
            for pid in by_team.get(tid, []):
                p = players[pid]
                gids = sorted((q for q in p["gl"] if q in date and date[q] < G["date"]), key=lambda q: date[q])
                if len(gids) < 2:
                    continue
                recent = gids[-3:]
                mk = {}
                for m, (_, c, k) in MARKETS.items():
                    rc, rk, rmin = MIN_ROLE[m]
                    if statistics.mean(g(p["gl"][q], rc, rk) for q in recent) < rmin:
                        continue
                    vals = [g(p["gl"][q], c, k) for q in gids]
                    proj, sd = project(vals, last.get(pid, {}).get(m), opp_ratio(al, league, sched, opp, G["date"], m), vol, m)
                    mk[m] = {"proj": round(proj, 1), "sd": round(sd, 1), "log": [round(v, 1) for v in vals[-8:]], "avg": round(statistics.mean(vals), 1)}
                # anytime TD: rushing + receiving TDs per game → chance of 1+
                tds = [g(p["gl"][q], "rushing", "TD") + g(p["gl"][q], "receiving", "TD") for q in gids]
                touches = statistics.mean(g(p["gl"][q], "rushing", "CAR") + g(p["gl"][q], "receiving", "REC") for q in recent)
                if touches >= 3:
                    w = [DECAY ** i for i in range(len(tds) - 1, -1, -1)]
                    lam = sum(a * b for a, b in zip(w, tds)) / sum(w) * min(1.25, max(0.8, max(vol or 1, 0.1) ** VOL_EXP))
                    mk["anyTD"] = {"proj": round(1 - math.exp(-lam), 3), "log": tds[-8:]}
                if mk:
                    out.append({"id": pid, "name": p["name"], "pos": p["pos"], "tid": tid, "opp": opp, "game": G["id"], "home": home, "m": mk})
    games = [{"id": G["id"], "date": G["date"], "home": G["home"], "away": G["away"], "homeName": G["homeName"], "awayName": G["awayName"],
              "spread": G["spread"], "total": G["total"]} for G in todo]
    lines = {}
    lp = os.path.join(DATA, "prop_lines.json")                 # book lines, when a feed is connected
    if os.path.exists(lp):
        lines = json.load(open(lp)).get("lines", {})
    json.dump({"season": y, "built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), "slateLabel": hub.get("slateLabel"),
               "markets": {m: v[0] for m, v in MARKETS.items()} | {"anyTD": "Anytime TD"}, "games": games, "players": out, "lines": lines},
              open(OUT, "w"), separators=(",", ":"))
    print(f"props: {len(out)} players across {len(games)} games, {sum(len(p['m']) for p in out)} projections, {len(lines)} book lines")


if __name__ == "__main__":
    if "--tune" in sys.argv:
        tune()
    elif "--test" in sys.argv:
        report(walk(int(sys.argv[-1])))
    else:
        main()
