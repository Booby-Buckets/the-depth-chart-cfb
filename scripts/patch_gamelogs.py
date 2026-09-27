"""patch_gamelogs.py — add box-score game logs ("gl") to already-built past seasons, from the
cached box scores, without rebuilding the season. build_history.py writes them on new builds.

    python3 scripts/patch_gamelogs.py            # every built season
    python3 scripts/patch_gamelogs.py 2024 2025
    python3 scripts/patch_gamelogs.py --current  # the live season's player files
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from box import load_box, game_logs
from game_score import rate_all

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "cache")
SEASONS = os.path.join(ROOT, "public", "data", "seasons")


def no_fetch(url):
    raise RuntimeError("not cached")


def patch(y, d=None, get=no_fetch):
    d = d or os.path.join(SEASONS, str(y))
    games = {}
    for fn in os.listdir(os.path.join(d, "teams")):
        if fn[0].isdigit():
            for g in json.load(open(os.path.join(d, "teams", fn))).get("schedule") or []:
                if g.get("completed"):
                    games[g["id"]] = {"id": g["id"], "completed": True}
    box = load_box(get, CACHE, list(games.values()))
    files = {}
    for fn in os.listdir(os.path.join(d, "players")):
        if fn[0].isdigit() and fn.endswith(".json"):
            files[fn] = json.load(open(os.path.join(d, "players", fn)))
    team_of = {p["id"]: p["tid"] for f in files.values() for p in f["players"]}
    gl = game_logs(box, lambda pid, tid: team_of.get(pid) == tid)
    n = 0
    for fn, f in files.items():
        for p in f["players"]:
            p.pop("gl", None)
            if p["id"] in gl:
                p["gl"] = gl[p["id"]]
                n += 1
        rate_all(f["players"])
        with open(os.path.join(d, "players", fn), "w") as fh:
            json.dump(f, fh, separators=(",", ":"))
    print(f"{y}: {len(games)} games, {sum(1 for r in box.values() if r)} box scores, {n} players with game logs")


if __name__ == "__main__":
    if sys.argv[1:] == ["--current"]:        # the live season (fetches any box score not cached yet)
        import build_hub as H
        patch("current", os.path.join(ROOT, "public", "data"), H.get)
        sys.exit()
    years = [int(a) for a in sys.argv[1:]] or sorted(int(x) for x in os.listdir(SEASONS) if x.isdigit())
    for y in years:
        patch(y)
