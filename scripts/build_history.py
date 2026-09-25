"""build_history.py — past seasons, built the same way as the live one.

    python3 scripts/build_history.py 2014 2025        # a range (inclusive)
    python3 scripts/build_history.py 2019             # one season
    python3 scripts/build_history.py --careers        # just rebuild careers.json from disk

For each season it writes public/data/seasons/<year>/:
  hub.json            final power ratings (same model, same prior from the season before)
  teams/<id>.json     schedule + game scores, rating by week, team stats (ESPN, by season),
                      our play-by-play advanced stats ranked across that season's FBS, roster
  players/<id>.json   every player who recorded a stat for that team: season totals summed from
                      ESPN box scores, play-by-play advanced stats, estimated snaps
  leaders.json        that season's leaderboards
and, across every built season plus the current one, public/data/careers.json:
  {player id: [[season, team id], ...]} for career tables.

What history can't have: starting lineups (ESPN only lists them for the current season) and
CFBD stats (EPA, usage, recruiting: quota). Box scores carry no position, so a player's
position comes from the current roster when they're still on one, else from their stats
(QB / RB / WR / DEF / K / P).

Everything is fetched once and cached forever (past seasons are final): ~800 games a season,
two keyless ESPN requests each (play-by-play + box score), both trimmed before caching.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hub as H
from build_pbp import load_plays, build_plays_involved
from build_advanced import team_advanced, rank_teams, player_advanced, rank_players
from build_teams import build_team_files
from build_players import estimate_snaps, write_leaders

ROOT = H.ROOT
CACHE = H.CACHE
SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary?event="

# box-score label -> our stat key, per category; "c/a" splits made/attempted
LABELS = {
    "passing": {"C/ATT": ("COMPLETIONS", "ATT"), "YDS": "YDS", "TD": "TD", "INT": "INT"},
    "rushing": {"CAR": "CAR", "YDS": "YDS", "TD": "TD", "LONG": "LONG"},
    "receiving": {"REC": "REC", "YDS": "YDS", "TD": "TD", "LONG": "LONG"},
    "fumbles": {"FUM": "FUM", "LOST": "LOST", "REC": "REC"},
    "defensive": {"TOT": "TOT", "SOLO": "SOLO", "SACKS": "SACKS", "TFL": "TFL", "PD": "PD", "QB HUR": "QB HUR", "TD": "TD"},
    "interceptions": {"INT": "INT", "YDS": "YDS", "TD": "TD"},
    "kickReturns": {"NO": "NO", "YDS": "YDS", "TD": "TD", "LONG": "LONG"},
    "puntReturns": {"NO": "NO", "YDS": "YDS", "TD": "TD", "LONG": "LONG"},
    "kicking": {"FG": ("FGM", "FGA"), "LONG": "LONG", "XP": ("XPM", "XPA"), "PTS": "PTS"},
    "punting": {"NO": "NO", "YDS": "YDS", "TB": "TB", "In 20": "In 20", "LONG": "LONG"},
}
MAXED = {"LONG"}


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def load_box(games):
    """{game_id: [(team_id, category, labels, athlete{id,name,jersey}, stats[])]} from ESPN box
    scores, trimmed to the players block and cached forever (box_<id>.json)."""
    def fetch(g):
        gid = g["id"]
        path = os.path.join(CACHE, f"box_{gid}.json")
        if os.path.exists(path):
            with open(path) as f:
                return gid, json.load(f)
        try:
            d = H.get(SUMMARY + gid)
        except Exception as e:
            print(f"box: game {gid} unavailable ({e})")
            return gid, []
        rows = []
        for t in (d.get("boxscore") or {}).get("players", []):
            tid = str((t.get("team") or {}).get("id"))
            for cat in t.get("statistics", []):
                for a in cat.get("athletes", []):
                    at = a.get("athlete") or {}
                    if at.get("id"):
                        rows.append([tid, cat.get("name"), cat.get("labels"), {"id": str(at["id"]), "name": at.get("displayName"), "no": at.get("jersey")}, a.get("stats")])
        with open(path, "w") as f:
            json.dump(rows, f, separators=(",", ":"))
        return gid, rows

    with ThreadPoolExecutor(8) as ex:
        return dict(ex.map(fetch, [g for g in games if g["completed"]]))


def role_from_stats(st):
    """QB / RB / WR / DEF / K / P from what a player did (box scores have no position)."""
    g = lambda c, k: (st.get(c) or {}).get(k) or 0
    if g("passing", "ATT") >= 10:
        return "QB"
    if g("kicking", "FGA") or g("kicking", "XPA"):
        return "PK"
    if g("punting", "NO"):
        return "P"
    off = g("rushing", "CAR") + g("receiving", "REC")
    dfn = g("defensive", "TOT") + g("interceptions", "INT")
    if off >= dfn and off:
        return "RB" if g("rushing", "CAR") > g("receiving", "REC") else "WR"
    return "DEF" if dfn else None


def season_players(teams, games, box):
    """Sum each FBS player's box-score lines into season totals (CFBD-style stat keys)."""
    P = {}
    for g in games:
        for tid, cat, labels, ath, stats in box.get(g["id"], []):
            if tid not in teams or cat not in LABELS or not labels or not stats:
                continue
            p = P.setdefault(ath["id"], {"id": ath["id"], "name": ath["name"], "no": ath.get("no"), "tid": tid,
                                         "stats": {}, "games": set()})
            p["games"].add(g["id"])
            s = p["stats"].setdefault(cat, {})
            for lab, v in zip(labels, stats):
                key = LABELS[cat].get(lab)
                if not key:
                    continue
                if isinstance(key, tuple):  # "made/att"
                    parts = str(v).split("/")
                    if len(parts) == 2 and _num(parts[0]) is not None and _num(parts[1]) is not None:
                        s[key[0]] = s.get(key[0], 0) + _num(parts[0])
                        s[key[1]] = s.get(key[1], 0) + _num(parts[1])
                    continue
                x = _num(v)
                if x is None:
                    continue
                s[key] = max(s.get(key, x), x) if key in MAXED else s.get(key, 0) + x
    return P


KICK_TYPES = {"Kickoff", "Punt", "Punt Return", "Kickoff Return (Offense)"}
ATHLETE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/athletes/"


def load_athletes(ids):
    """{athlete id: {"name", "pos", "no"}} from ESPN's athlete endpoint, cached forever. Box scores
    have no position and play-by-play has no names, so this fills both for past players."""
    def fetch(pid):
        path = os.path.join(CACHE, f"athlete_{pid}.json")
        if os.path.exists(path):
            with open(path) as f:
                return pid, json.load(f)
        try:
            a = H.get(ATHLETE + pid)
            rec = {"name": a.get("displayName"), "pos": (a.get("position") or {}).get("abbreviation"), "no": a.get("jersey")}
        except Exception:
            rec = {}
        with open(path, "w") as f:
            json.dump(rec, f)
        return pid, rec

    with ThreadPoolExecutor(8) as ex:
        return dict(ex.map(fetch, sorted(ids)))


def pbp_defense(games, plays, teams):
    """Defensive season totals rebuilt from play-by-play, for seasons whose box scores are thin
    (ESPN's 2014-15 box scores carry no defense; 2016-19 only some). NCAA scoring: a tackle or
    assist is one tackle; a solo TFL counts 1 and an assisted one 0.5; shared sacks are split.
    Checked against 2025, where box scores are complete: r = 0.98 for tackles, 0.97 sacks, 0.96
    TFL, but totals run ~10% low (some tackles aren't tagged in the play-by-play), so the pages
    say these seasons' defense is rebuilt from play-by-play rather than passing it off as official."""
    D = {}
    for g in games:
        if not g["completed"]:
            continue
        for p in plays.get(g["id"], []):
            if "NO PLAY" in (p.get("text") or ""):
                continue
            sides = {t.get("type"): t.get("id") for t in p.get("teamParticipants") or []}
            ttype = (p.get("type") or {}).get("text", "")
            kick = ttype in KICK_TYPES  # ESPN lists the kicking team as the defense, so its tacklers count
            dfn = sides.get("defense")
            if dfn not in teams:
                continue
            roles = {}
            for x in p.get("participants") or []:
                roles.setdefault(x.get("type"), []).append(x["athlete"]["$ref"].rsplit("/", 1)[-1].split("?", 1)[0])
            loss = not kick and (ttype == "Sack" or (p.get("statYardage") or 0) < 0)  # runs, sacks, catches behind the line
            solo = roles.get("tackler", []) + roles.get("sackedBy", [])
            assists = roles.get("assistedBy", [])
            sackers = roles.get("sackedBy", [])

            def rec(pid):
                d = D.setdefault(pid, {"tid": dfn, "stats": {}, "games": set()})
                d["games"].add(g["id"])
                return d["stats"]

            for pid in set(solo) | set(assists):
                st = rec(pid)
                st["TOT"] = st.get("TOT", 0) + 1
                if pid in solo:
                    st["SOLO"] = st.get("SOLO", 0) + 1
                if loss:
                    st["TFL"] = st.get("TFL", 0) + (1 if pid in solo and not assists else 0.5)
            for pid in sackers:
                st = rec(pid)
                st["SACKS"] = st.get("SACKS", 0) + 1 / len(sackers)
            for pid in roles.get("passDefender", []):
                st = rec(pid)
                st["PD"] = st.get("PD", 0) + 1
            for pid in roles.get("forcedBy", []):
                st = rec(pid)
                st["FF"] = st.get("FF", 0) + 1
    return D


def finalize(P, current_pos, athletes):
    for p in P.values():
        st = p["stats"]
        pa, ru, re, ki, pu = (st.get(k, {}) for k in ("passing", "rushing", "receiving", "kicking", "punting"))
        if pa.get("ATT"):
            pa["PCT"] = round(pa.get("COMPLETIONS", 0) / pa["ATT"], 3)
            pa["YPA"] = round(pa.get("YDS", 0) / pa["ATT"], 1)
        if ru.get("CAR"):
            ru["YPC"] = round(ru.get("YDS", 0) / ru["CAR"], 1)
        if re.get("REC"):
            re["YPR"] = round(re.get("YDS", 0) / re["REC"], 1)
        if ki.get("FGA"):
            ki["PCT"] = round(ki.get("FGM", 0) / ki["FGA"], 3)
        if pu.get("NO"):
            pu["YPP"] = round(pu.get("YDS", 0) / pu["NO"], 1)
        for r in ("kickReturns", "puntReturns"):
            if st.get(r, {}).get("NO"):
                st[r]["AVG"] = round(st[r].get("YDS", 0) / st[r]["NO"], 1)
        p["g"] = len(p.pop("games"))
        a = athletes.get(p["id"]) or {}
        p["name"] = p.get("name") or a.get("name")
        p["no"] = p.get("no") or a.get("no")
        p["pos"] = current_pos.get(p["id"]) or a.get("pos") or role_from_stats(st)
    return {pid: p for pid, p in P.items() if p.get("name")}


def build_season(season, current_pos, careers):
    t0 = time.time()
    out = os.path.join(ROOT, "public", "data", "seasons", str(season))
    os.makedirs(os.path.join(out, "players"), exist_ok=True)
    S = H.rate_season(season, finished=True, with_cfbd=False)
    teams, games, rows = S["teams"], S["games"], S["rows"]
    hub = {"season": season, "built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), "final": True, "defenseFrom": None,
           "gamesPlayed": sum(1 for g in games if g["completed"]), "hfa": round(S["hfa"], 2), "ptsAvg": round(S["mu"], 1),
           "hasAdvanced": False, "slateLabel": None, "teams": rows, "slate": []}
    plays = load_plays(H.get, games)
    box = load_box(games)
    team_adv = rank_teams(team_advanced(games, plays, teams))
    P = season_players(teams, games, box)
    D = pbp_defense(games, plays, teams)
    box_def = sum(1 for p in P.values() if p["stats"].get("defensive"))
    use_pbp = box_def < 0.8 * len(D)  # ESPN's box scores are missing most defense this season
    for pid, d in D.items():
        p = P.setdefault(pid, {"id": pid, "name": None, "no": None, "tid": d["tid"], "stats": {}, "games": set()})
        p["games"] |= d["games"]
        if use_pbp:
            p["stats"]["defensive"] = {k: round(v, 1) for k, v in d["stats"].items()}
    athletes = load_athletes(pid for pid, p in P.items() if not p.get("name") or pid not in current_pos)
    P = finalize(P, current_pos, athletes)
    print(f"  {season}: defense from {'play-by-play' if use_pbp else 'box scores'} "
          f"({box_def} box-score defenders vs {len(D)} in play-by-play); {len(athletes)} athletes looked up")

    hub["defenseFrom"] = "play-by-play" if use_pbp else "box scores"
    with open(os.path.join(out, "hub.json"), "w") as f:
        json.dump(hub, f, separators=(",", ":"))

    # snaps: involvement from play-by-play (players are tagged from 2014 on) + the snap model
    game_info = {g["id"]: g for g in games}
    qb_ids = {pid for pid, p in P.items() if p["pos"] == "QB"}
    pi, team_plays = build_plays_involved(H.get, games, qb_ids, plays)
    for pid, rec in pi.items():
        p = P.get(pid)
        if not p:
            continue
        log = []
        for gid, c in rec["games"].items():
            g = game_info.get(gid)
            if g:
                log.append({"id": gid, "date": g["date"], "tp": team_plays.get((gid, p["tid"]), 0), **c})
        p["pi"] = {k: rec[k] for k in ("off", "qb", "def", "st", "pen")} | {"g": len(log), "log": log}
    estimate_snaps(P, team_plays, game_info)
    adv = {pid: a for pid, a in player_advanced(games, plays).items() if pid in P}
    rank_players(adv, lambda pid: P[pid]["g"])
    for pid, a in adv.items():
        P[pid]["adv"] = a

    # team files: same builder as live, with this season's stats and a box-score roster
    roster = {}
    for p in P.values():
        roster.setdefault(p["tid"], []).append({"id": p["id"], "name": p["name"], "no": p["no"], "pos": p["pos"],
                                                "unit": "offense" if p["pos"] in ("QB", "RB", "WR", "TE") else "specialTeam" if p["pos"] in ("PK", "P") else "defense",
                                                "cls": None, "ht": None, "wt": None, "home": None})
    build_team_files({
        "get": H.get, "ESPN": H.ESPN, "outdir": os.path.join(out, "teams"), "season": season, "built": hub["built"],
        "teams": teams, "rows": rows, "games": games, "rat": S["rat"], "hfa": S["hfa"], "mu": S["mu"], "prior": S["prior"],
        "solve": H.solve, "win_prob": H.win_prob, "compress": H.compress, "rating_sd": H.rating_sd, "margin_sd": H.MARGIN_SD,
        "team_adv": team_adv, "history_roster": roster,
    })

    # compact player files: season totals, advanced, estimated snaps (no per-game logs)
    by_team = {}
    for p in P.values():
        pi_ = p.pop("pi", None) or {}
        p["es"], p["esTP"], p["gs"] = pi_.get("es"), pi_.get("esTP"), None
        by_team.setdefault(p["tid"], []).append(p)
        careers.setdefault(p["id"], {})[season] = p["tid"]
    for tid in teams:
        plist = sorted(by_team.get(tid, []), key=lambda p: p["name"] or "")
        with open(os.path.join(out, "players", f"{tid}.json"), "w") as f:
            json.dump({"season": season, "tid": tid, "players": plist}, f, separators=(",", ":"))
    write_leaders(os.path.join(out, "players"), season, teams, list(P.values()))
    print(f"season {season}: {len(rows)} teams, {hub['gamesPlayed']} games, {len(P)} players "
          f"({len(adv)} with advanced) in {time.time() - t0:.0f}s")


def rebuild_careers():
    """careers.json from what's on disk (every built season's player files + the current season),
    so a crash mid-backfill never loses seasons that were already written."""
    data = os.path.join(ROOT, "public", "data")
    careers = {}
    seasons_dir = os.path.join(data, "seasons")
    for y in sorted(int(d) for d in os.listdir(seasons_dir) if d.isdigit()):
        pdir = os.path.join(seasons_dir, str(y), "players")
        for fn in os.listdir(pdir):
            if fn[0].isdigit():
                for p in json.load(open(os.path.join(pdir, fn)))["players"]:
                    careers.setdefault(p["id"], {})[y] = p["tid"]
    cur_season = json.load(open(os.path.join(data, "hub.json")))["season"]
    cur_dir = os.path.join(data, "players")
    for fn in os.listdir(cur_dir):
        if fn[0].isdigit():
            for p in json.load(open(os.path.join(cur_dir, fn)))["players"]:
                if p.get("stats") or (p.get("pi") or {}).get("g"):
                    careers.setdefault(p["id"], {})[cur_season] = p["tid"]
    with open(os.path.join(data, "careers.json"), "w") as f:
        json.dump({pid: sorted([[y, t] for y, t in v.items()]) for pid, v in careers.items()}, f, separators=(",", ":"))
    print(f"careers: {len(careers)} players across {len({y for v in careers.values() for y in v})} seasons")


def main():
    args = sys.argv[1:]
    if args == ["--careers"]:
        return rebuild_careers()
    years = [int(x) for x in args] or [2025]
    seasons = list(range(years[0], years[-1] + 1)) if len(years) == 2 else years
    # positions from the current rosters (players still in college keep their real position)
    current_pos = {}
    cur_dir = os.path.join(ROOT, "public", "data", "players")
    for fn in os.listdir(cur_dir):
        if fn[0].isdigit():
            for p in json.load(open(os.path.join(cur_dir, fn)))["players"]:
                if p.get("pos"):
                    current_pos[p["id"]] = p["pos"]
    for season in seasons:
        build_season(season, current_pos, {})
    rebuild_careers()


if __name__ == "__main__":
    main()
