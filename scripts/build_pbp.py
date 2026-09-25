"""build_pbp.py — per-player, per-game PLAYS INVOLVED from ESPN play-by-play.

Called from build_players. Free and keyless (ESPN core API), one request per completed FBS
game, cached forever once final.

What it counts (these are NOT snap counts — nobody publishes college snaps for free; see
the depth chart page's note):
  off  offensive plays the player was part of: dropbacks (passer), carries (rusher),
       targets (receiver) — once per play
  qb   ESTIMATED QB snaps: every offensive scrimmage play is credited to the quarterback
       running the offense at that moment (the play's passer, a rostered QB who ran it, or
       else the last QB seen on that drive/game). Close to a true snap count for QBs.
  def  defensive plays made: tackles, assists, sacks, pass breakups, interceptions
  st   special-teams plays: kicks, punts, returns
  pen  penalties charged (the only box-score trace most linemen leave)
Per team per game it also records offensive scrimmage plays, so shares can be computed.
"""
import json, os
from concurrent.futures import ThreadPoolExecutor

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
SCRIMMAGE = {
    "Rush", "Rushing Touchdown", "Pass Reception", "Pass Incompletion", "Passing Touchdown", "Pass",
    "Sack", "Pass Interception Return", "Interception Return Touchdown", "Fumble Recovery (Own)",
    "Fumble Recovery (Opponent)", "Fumble Return Touchdown", "Fumble", "Safety", "Interception",
}
OFF_ROLES = {"passer", "rusher", "receiver"}
DEF_ROLES = {"tackler", "assistedBy", "sackedBy", "passDefender", "interceptor", "forcedBy"}
ST_ROLES = {"kicker", "punter", "returner", "holder", "longSnapper"}


def _ref_id(ref):
    return ref.rsplit("/", 1)[-1].split("?", 1)[0]


def _trim(p):
    """Keep only what the builds read, in the same shape ESPN sends (a full game is ~0.9 MB,
    trimmed ~50 KB; twelve seasons of history would otherwise be ~8 GB of cache)."""
    return {
        "sequenceNumber": p.get("sequenceNumber"), "type": {"text": (p.get("type") or {}).get("text")},
        "text": p.get("text"), "statYardage": p.get("statYardage"), "period": {"number": (p.get("period") or {}).get("number")},
        "homeScore": p.get("homeScore"), "awayScore": p.get("awayScore"),
        "start": {k: (p.get("start") or {}).get(k) for k in ("down", "distance", "yardsToEndzone")},
        "teamParticipants": [{"type": t.get("type"), "id": t.get("id")} for t in p.get("teamParticipants") or []],
        "participants": [{"type": x.get("type"), "athlete": {"$ref": _ref_id(x["athlete"]["$ref"])}}
                         for x in p.get("participants") or [] if x.get("athlete")],
    }


def load_plays(get, games, cache_dir=None):
    """{game_id: [play, ...]} for every completed game (ESPN core API). Cached forever once final,
    trimmed to the fields we use (pbp_<id>.json)."""
    done = [g for g in games if g["completed"]]
    cache_dir = cache_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")

    def fetch(g):
        gid = g["id"]
        path = os.path.join(cache_dir, f"pbp_{gid}.json")
        if os.path.exists(path):
            with open(path) as f:
                return gid, json.load(f)
        old = os.path.join(cache_dir, f"plays_{gid}.json")  # full-size cache from before trimming
        try:
            if os.path.exists(old):
                with open(old) as f:
                    items = json.load(f).get("items", [])
            else:
                url = f"{CORE}/events/{gid}/competitions/{gid}/plays?limit=500"
                d = get(url)
                items = d.get("items", [])
                page, pages = 1, d.get("pageCount", 1)
                while page < pages:  # rare: games with more than 500 plays
                    page += 1
                    items += get(url + f"&page={page}").get("items", [])
        except Exception as e:
            print(f"pbp: game {gid} unavailable ({e})")
            return gid, []
        items = sorted((_trim(p) for p in items), key=lambda p: int(p.get("sequenceNumber") or 0))
        with open(path, "w") as f:
            json.dump(items, f, separators=(",", ":"))
        if os.path.exists(old):
            os.remove(old)
        return gid, items

    with ThreadPoolExecutor(8) as ex:
        return dict(ex.map(fetch, done))


def build_plays_involved(get, games, qb_ids, plays=None):
    """games: completed FBS game dicts from build_hub. qb_ids: set of athlete ids rostered at QB.
    Returns (players, team_plays):
      players[pid] = {"off","qb","def","st","pen","g", "games": {gid: {...}}}
      team_plays[(gid, team_id)] = offensive scrimmage plays"""
    plays = plays if plays is not None else load_plays(get, games)
    results = [(g, plays.get(g["id"], [])) for g in games if g["completed"]]
    done = [g for g in games if g["completed"]]

    players, team_plays = {}, {}

    def rec(pid, gid, key, n=1):
        p = players.setdefault(pid, {"off": 0, "qb": 0, "def": 0, "st": 0, "pen": 0, "games": {}})
        p[key] += n
        gg = p["games"].setdefault(gid, {"off": 0, "qb": 0, "def": 0, "st": 0, "pen": 0})
        gg[key] += n

    for g, items in results:
        gid = g["id"]
        current_qb = {}   # offense team id -> qb id
        pending = {}      # offense team id -> plays seen before any QB was identified
        for p in items:
            ttype = (p.get("type") or {}).get("text", "")
            parts = [(x.get("type"), _ref_id(x["athlete"]["$ref"])) for x in p.get("participants") or [] if x.get("athlete")]
            sides = {t.get("type"): t.get("id") for t in p.get("teamParticipants") or []}
            off_team = sides.get("offense")
            nullified = "NO PLAY" in (p.get("text") or "")
            for role, pid in parts:
                if role == "penalized":
                    rec(pid, gid, "pen")
            if nullified:
                continue
            seen_off, seen_def, seen_st = set(), set(), set()
            for role, pid in parts:
                if role in OFF_ROLES and pid not in seen_off:
                    seen_off.add(pid); rec(pid, gid, "off")
                elif role in DEF_ROLES and pid not in seen_def:
                    seen_def.add(pid); rec(pid, gid, "def")
                elif role in ST_ROLES and pid not in seen_st:
                    seen_st.add(pid); rec(pid, gid, "st")
            if ttype in SCRIMMAGE and off_team:
                team_plays[(gid, off_team)] = team_plays.get((gid, off_team), 0) + 1
                qb = next((pid for role, pid in parts if role == "passer"), None) \
                    or next((pid for role, pid in parts if role == "rusher" and pid in qb_ids), None)
                if qb:
                    current_qb[off_team] = qb
                    if pending.get(off_team):          # credit the plays before we knew who it was
                        rec(qb, gid, "qb", pending.pop(off_team))
                elif off_team in current_qb:
                    qb = current_qb[off_team]
                else:
                    pending[off_team] = pending.get(off_team, 0) + 1
                if qb:
                    rec(qb, gid, "qb")
    for p in players.values():
        p["g"] = len(p["games"])
    n_games = sum(1 for _, items in results if items)
    print(f"pbp: {n_games}/{len(done)} games parsed, {len(players)} players with a recorded play")
    return players, team_plays
