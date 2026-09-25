"""fetch_lines.py — closing betting lines for past games from ESPN's core API (keyless).

Used only as a yardstick for the spread model (model_backtest.py); lines are never published.
Caches cache/line_<gid>.json = {"spread": home expected margin (median across books), "total": ...}
or {} when ESPN has no line.  python3 scripts/fetch_lines.py 2014 2025
"""
import json, os, sys, statistics, urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from build_hub import season_games, fbs_teams, CACHE

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"


def fetch(gid):
    path = os.path.join(CACHE, f"line_{gid}.json")
    if os.path.exists(path) and "books" in json.load(open(path)):
        return
    out = {}
    for _ in range(3):
        try:
            with urllib.request.urlopen(f"{CORE}/events/{gid}/competitions/{gid}/odds?limit=50", timeout=20) as r:
                d = json.load(r)
            # pregame books only: "ESPN Bet - Live Odds" is the in-game line, set once the game is mostly decided
            items = [it for it in d.get("items", []) if "live" not in ((it.get("provider") or {}).get("name") or "").lower()]
            out["books"] = sorted({(it.get("provider") or {}).get("name") or "?" for it in items})
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
    json.dump(out, open(path, "w"))


if __name__ == "__main__":
    a, b = int(sys.argv[1]), int(sys.argv[-1])
    for y in range(a, b + 1):
        teams = fbs_teams(y)
        games, _ = season_games(y, finished_season=True)
        ids = [g["id"] for g in games if g["completed"] and (g["home"] in teams or g["away"] in teams)]
        with ThreadPoolExecutor(12) as ex:
            list(ex.map(fetch, ids))
        have = sum(1 for i in ids if json.load(open(os.path.join(CACHE, f"line_{i}.json"))).get("spread") is not None)
        print(f"{y}: {have}/{len(ids)} games with a line", flush=True)
