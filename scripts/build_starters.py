"""build_starters.py — who STARTED each FBS game, from ESPN's per-game rosters.

ESPN's core API lists every player on each team's game roster with a `starter` flag: 22 per
team (11 offense, 11 defense), each with the position they started at. That is the only free
source of college starting lineups we have found, and it is the only way to see offensive
linemen at all (they leave no trace in play-by-play).

Coverage checked on 68 random FBS team-games (Sept 2026): 65 list exactly 22 starters, 3 list
none (those games simply have no lineup). ESPN's `didNotPlay` flag is never set, so games
*played* still come from the play-by-play.

Requests: the game's competitors + one roster per team (3 per game), keyless, cached forever
once the game is final.
"""
from concurrent.futures import ThreadPoolExecutor

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
OL_POS = {"OL", "OT", "OG", "G", "T", "C", "IOL"}


def _ref_id(ref):
    return ref.rsplit("/", 1)[-1].split("?", 1)[0]


def build_starters(get, games):
    """games: completed game dicts from build_hub. Returns
    {(game_id, team_id): [(player_id, position_abbr), ...]} for every team that listed starters."""
    done = [g for g in games if g["completed"]]
    pos_cache = {}

    def position(ref):
        pid = ref.split("/positions/")[1].split("?")[0]
        if pid not in pos_cache:
            try:
                pos_cache[pid] = get(f"{CORE}/positions/{pid}", f"espn_pos_{pid}.json", max_age=None).get("abbreviation")
            except Exception:
                pos_cache[pid] = None
        return pos_cache[pid]

    def fetch(g):
        gid, out = g["id"], {}
        try:
            comps = get(f"{CORE}/events/{gid}/competitions/{gid}/competitors", f"comps_{gid}.json", max_age=None)
            for c in comps.get("items", []):
                tid = _ref_id(c["$ref"])
                r = get(f"{CORE}/events/{gid}/competitions/{gid}/competitors/{tid}/roster", f"gameroster_{gid}_{tid}.json", max_age=None)
                st = [(str(e["playerId"]), (e.get("position") or {}).get("$ref"))
                      for e in r.get("entries", []) if e.get("starter")]
                if st:
                    out[(gid, tid)] = st
        except Exception as e:
            print(f"starters: game {gid} unavailable ({e})")
        return out

    with ThreadPoolExecutor(8) as ex:
        raw = {}
        for part in ex.map(fetch, done):
            raw.update(part)
    starters = {k: [(pid, position(ref) if ref else None) for pid, ref in v] for k, v in raw.items()}
    listed = sum(1 for g in done for t in (g["home"], g["away"]) if (g["id"], t) in starters)
    print(f"starters: {listed} team-games with a starting lineup across {len(done)} games")
    return starters
