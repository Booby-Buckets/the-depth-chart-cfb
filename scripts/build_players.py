"""build_players.py — player data for player.html / players.html / team-page leaders.

Called from build_hub.main() after the team build (it reuses the ESPN rosters it fetched).

Outputs (public/data/players/, served at /data/players/):
  {team_id}.json  every player on that FBS team: ESPN bio + CFBD season stats, EPA (PPA)
                  per play by situation, usage share, FBS ranks, 2026 recruiting profile;
                  plus the position-group EPA averages the page compares against
  index.json      [id, name, team_id, pos] for every FBS player with stats (player search)
  ids.json        {player id: team id} for every FBS player (page URLs)
  leaders.json    top-300 boards: passing, rushing, receiving, defense; EPA per play top 150 per group

Identity: CFBD player ids are ESPN athlete ids, so ESPN roster bio and CFBD stats join on
id; CFBD school names equal our ESPN location names. Players CFBD has but ESPN's roster
doesn't (walk-ons, late adds) still get a page from CFBD's name/position.

CFBD calls: 4 bulk feeds, each at most once per build_hub.CFBD_MAX_AGE. If CFBD can't be
reached, player stat blocks are carried over from the last published files instead of
being dropped.
"""
import json, os
from build_pbp import build_plays_involved
from build_starters import build_starters, OL_POS
from build_advanced import player_advanced, rank_players
import snap_model

# ranked stats: (category, stat, label, min per team game to qualify, higher is better)
RANKED = [
    ("passing", "YDS", "Pass yards", ("passing", "ATT", 1), True),
    ("passing", "TD", "Pass TD", ("passing", "ATT", 1), True),
    ("passing", "YPA", "Yards / att.", ("passing", "ATT", 12), True),
    ("passing", "PCT", "Completion %", ("passing", "ATT", 12), True),
    ("rushing", "YDS", "Rush yards", ("rushing", "CAR", 0.01), True),
    ("rushing", "TD", "Rush TD", ("rushing", "CAR", 0.01), True),
    ("rushing", "YPC", "Yards / carry", ("rushing", "CAR", 6), True),
    ("receiving", "REC", "Receptions", ("receiving", "REC", 0.01), True),
    ("receiving", "YDS", "Rec. yards", ("receiving", "REC", 0.01), True),
    ("receiving", "TD", "Rec. TD", ("receiving", "REC", 0.01), True),
    ("receiving", "YPR", "Yards / catch", ("receiving", "REC", 2), True),
    ("defensive", "TOT", "Tackles", ("defensive", "TOT", 0.01), True),
    ("defensive", "TFL", "Tackles for loss", ("defensive", "TOT", 0.01), True),
    ("defensive", "SACKS", "Sacks", ("defensive", "TOT", 0.01), True),
    ("defensive", "PD", "Passes defended", ("defensive", "TOT", 0.01), True),
    ("defensive", "QB HUR", "QB hurries", ("defensive", "TOT", 0.01), True),
    ("interceptions", "INT", "Interceptions", ("interceptions", "INT", 0.01), True),
    ("kicking", "FGM", "Field goals", ("kicking", "FGA", 0.01), True),
    ("kicking", "PCT", "FG %", ("kicking", "FGA", 1), True),
]

# EPA qualifiers: offensive plays per team game, by position group
GROUPS = {"QB": ("QB",), "RB": ("RB", "FB"), "WR/TE": ("WR", "TE")}
GROUP_MIN = {"QB": 12, "RB": 6, "WR/TE": 4}
PPA_KEYS = ("all", "pass", "rush", "firstDown", "secondDown", "thirdDown", "standardDowns", "passingDowns")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _group(pos):
    for g, ps in GROUPS.items():
        if pos in ps:
            return g
    return None


def _rank_desc(pairs):
    """[(pid, value)] -> {pid: rank}, ties share the better rank."""
    out, prev, prev_rank = {}, None, 0
    for i, (pid, v) in enumerate(sorted(pairs, key=lambda x: -x[1])):
        if v != prev:
            prev_rank, prev = i + 1, v
        out[pid] = prev_rank
    return out


# Production depth chart: (unit, slot label, how many starters, roster positions that can fill it)
DEPTH = [
    ("offense", "QB", 1, ("QB",)),
    ("offense", "RB", 1, ("RB", "FB")),
    ("offense", "WR", 3, ("WR",)),
    ("offense", "TE", 1, ("TE",)),
    ("offense", "OL", 5, ("OL", "OT", "OG", "G", "C", "IOL")),
    ("defense", "DL", 4, ("DL", "DE", "DT", "NT", "EDGE")),
    ("defense", "LB", 3, ("LB", "OLB", "ILB", "MLB")),
    ("defense", "CB", 2, ("CB", "DB")),
    ("defense", "S", 2, ("S", "FS", "SS", "DB")),
    ("special", "K", 1, ("PK", "K")),
    ("special", "P", 1, ("P",)),
    ("special", "LS", 1, ("LS",)),
]
CLASS_ORDER = {"GR": 0, "SR": 1, "JR": 2, "SO": 3, "FR": 4}


def depth_chart(plist, tgames):
    """Order every position group by the work players actually get.
    Skill spots + defense: estimated snaps (season + the latest game again, so a new starter
    rises fast). QB: estimated snaps from play-by-play. Offensive line: games started, from
    ESPN's per-game starting lineups (falls back to roster order if a team has none).
    Specialists: kicks/punts."""
    last = tgames[-1]["id"] if tgames else None

    def recent(p, key):
        return next((g.get(key, 0) for g in (p.get("pi") or {}).get("log", []) if g["id"] == last), 0)

    def score(p, slot):
        pi = p.get("pi") or {}
        if slot == "QB":
            return pi.get("qb", 0) + recent(p, "qb")
        if slot == "OL":  # real starting lineups: starts first, the latest game's start breaks ties
            return 100 * pi.get("gs", 0) + 50 * recent(p, "gs") + pi.get("es", 0)
        if slot in ("RB", "WR", "TE", "DL", "LB", "CB", "S"):
            return pi.get("es", 0) + recent(p, "es")
        if slot in ("K", "P"):
            return pi.get("st", 0)
        return 0

    def roster_key(p):
        wt = int("".join(ch for ch in (p.get("wt") or "") if ch.isdigit()) or 0)
        return (CLASS_ORDER.get(p.get("cls"), 5), -wt, p["name"])

    used, out = set(), {}
    for unit, slot, n, positions in DEPTH:
        # ESPN's rosters miss some real contributors (LSU's top two receivers, early 2026), so anyone
        # with recorded plays counts even when only CFBD knows them
        pool = [p for p in plist if p.get("pos") in positions and p["id"] not in used and (p.get("onRoster") or p.get("pi"))]
        pool.sort(key=lambda p: (-score(p, slot), roster_key(p)))
        by_production = any(score(p, slot) > 0 for p in pool)
        starters = pool[:n]
        if slot in ("CB", "S"):
            used.update(p["id"] for p in starters)  # a generic DB can start at CB or S, not both
        pi_key = {"QB": "qb", "K": "st", "P": "st", "LS": "st"}.get(slot, "es")
        out.setdefault(unit, []).append({
            "slot": slot, "starters": n,
            "basis": ("starts" if slot == "OL" else "production") if by_production and slot != "LS" else "roster",
            "players": [{"id": p["id"], "name": p["name"], "no": p.get("no"), "pos": p.get("pos"), "cls": p.get("cls"),
                         "val": (p.get("pi") or {}).get(pi_key, 0), "g": (p.get("pi") or {}).get("g", 0),
                         "last": recent(p, pi_key), "tp": (p.get("pi") or {}).get("esTP", 0),
                         "lo": (p.get("pi") or {}).get("esLo"), "hi": (p.get("pi") or {}).get("esHi"),
                         "inv": (p.get("pi") or {}).get("off" if unit == "offense" else "def", 0),
                         "gs": (p.get("pi") or {}).get("gs", 0), "startedLast": bool(recent(p, "gs"))}
                        for p in pool[:max(n * 2 + 1, 4)]],
        })
    return out


# snap estimator groups (see calibrate_snaps.py) and the most any group can plausibly have on
# the field per play in college; if a group's estimates add up past that, they're scaled down
SNAP_GROUPS = {"RB": ("RB", "FB"), "WR": ("WR",), "TE": ("TE",), "DL": ("DL", "DE", "DT", "NT", "EDGE"),
               "LB": ("LB", "OLB", "ILB", "MLB"), "DB": ("CB", "S", "FS", "SS", "DB")}
OL_STARTER_SHARE = 0.97
ON_FIELD_MAX = {"RB": 1.3, "WR": 3.6, "TE": 1.8, "DL": 4.3, "LB": 3.6, "DB": 5.8}


def snap_group(pos):
    return next((g for g, ps in SNAP_GROUPS.items() if pos in ps), None)


def estimate_snaps(P, team_plays, game_info):
    """ESTIMATED snaps per player-game ("es" on each log row, season total on pi).
    QB: the play-by-play estimate (every offensive play credited to the QB on the field).
    RB/WR/TE/DL/LB/DB: the NFL-calibrated model in snap_model.json, from the player's share of
    his group's involvement that game. Linemen on offense: not estimable (no trace)."""
    games = {}  # (gid, tid, group) -> [(player, log row)]
    for p in P.values():
        pi = p.get("pi")
        if not pi:
            continue
        grp = snap_group(p.get("pos"))
        for row in pi["log"]:
            if p.get("pos") == "QB":
                row["es"] = row["qb"]
            elif p.get("pos") in OL_POS:
                # NFL snap data: starting linemen play a median 100% of snaps (mean 97%, 10th
                # percentile 90%); backups only jumbo/injury snaps, which we can't see
                if row.get("gs") and row.get("tp"):
                    row["es"], row["esTP"] = round(OL_STARTER_SHARE * row["tp"]), row["tp"]
                    row["esLo"], row["esHi"] = round(0.90 * row["tp"]), row["tp"]
            elif grp:
                x = row["off"] if grp in ("RB", "WR", "TE") else row["def"]
                if x > 0:
                    games.setdefault((row["id"], p["tid"], grp), []).append((p, row, x))
    for (gid, tid, grp), members in games.items():
        g = game_info.get(gid)
        if not g:
            continue
        opp = g["away"] if g["home"] == tid else g["home"]
        plays = team_plays.get((gid, tid if grp in ("RB", "WR", "TE") else opp), 0)
        if plays < 20:
            continue
        X = sum(x for _, _, x in members)
        ranked = sorted(members, key=lambda m: -m[2])
        pcts = [snap_model.snap_pct(grp, x / X, x / plays, len(members), rk + 1) for rk, (_, _, x) in enumerate(ranked)]
        scale = min(1.0, ON_FIELD_MAX[grp] / max(sum(pcts), 1e-9))
        for (p, row, _), pct in zip(ranked, pcts):
            row["es"] = round(pct * scale * plays)
            row["esTP"] = plays
            b = snap_model.band(grp, row["es"], 1)
            if b:
                row["esLo"], row["esHi"] = b[0], min(plays, b[1])
    for p in P.values():
        pi = p.get("pi")
        if pi and any("es" in r for r in pi["log"]):
            pi["es"] = sum(r.get("es", 0) for r in pi["log"])
            pi["esTP"] = sum(r.get("esTP", r.get("tp", 0)) for r in pi["log"] if "es" in r)
            grp = "QB" if p.get("pos") == "QB" else snap_group(p.get("pos"))
            if p.get("pos") in OL_POS:
                pi["esLo"] = sum(r.get("esLo", 0) for r in pi["log"] if "es" in r)
                pi["esHi"] = sum(r.get("esHi", 0) for r in pi["log"] if "es" in r)
            elif grp and grp != "QB":
                pi["esErr"] = snap_model.error(grp)[0]
                b = snap_model.band(grp, pi["es"], sum(1 for r in pi["log"] if "es" in r))
                if b:  # 80% range for the season-to-date total
                    pi["esLo"], pi["esHi"] = b[0], min(pi["esTP"], b[1])


def build_player_files(ctx):
    root, season, teams, rows, rosters, cfbd_get = (ctx[k] for k in ("root", "season", "teams", "rows", "rosters", "cfbd_get"))
    games_list, get, pbp_plays = ctx["games"], ctx["get"], ctx.get("plays")
    outdir = os.path.join(root, "public", "data", "players")
    os.makedirs(outdir, exist_ok=True)
    by_name = {info["name"]: tid for tid, info in teams.items()}
    games = {r["id"]: max(1, r["w"] + r["l"]) for r in rows}

    stats = cfbd_get(f"stats/player/season?year={season}", f"cfbd_pstats_{season}.json")
    ppa = cfbd_get(f"ppa/players/season?year={season}", f"cfbd_pppa_{season}.json")
    usage = cfbd_get(f"player/usage?year={season}", f"cfbd_pusage_{season}.json")
    recruits = cfbd_get(f"recruiting/players?year={season}&classification=HighSchool", f"cfbd_recruits_{season}.json", max_age=7 * 86400)

    # previous publish: the fallback for any feed that couldn't be fetched
    prev = {}
    for tid in teams:
        try:
            for p in json.load(open(os.path.join(outdir, f"{tid}.json")))["players"]:
                prev[p["id"]] = p
        except (OSError, ValueError, KeyError):
            pass

    P = {}  # id -> player

    def player(pid, tid):
        if pid not in P:
            P[pid] = {"id": pid, "tid": tid, "name": None, "no": None, "pos": None, "cls": None, "ht": None,
                      "wt": None, "home": None, "onRoster": False, "stats": {}}
        return P[pid]

    for tid, roster in rosters.items():
        for grp in roster.get("athletes", []):
            for a in grp.get("items", []):
                p = player(a["id"], tid)
                pos = a.get("position") or {}
                p.update({"name": a.get("fullName"), "no": a.get("jersey"), "pos": pos.get("abbreviation"),
                          "unit": grp.get("position"), "cls": (a.get("experience") or {}).get("abbreviation"),
                          "ht": a.get("displayHeight"), "wt": a.get("displayWeight"),
                          "home": (a.get("birthPlace") or {}).get("displayText"), "onRoster": True})

    if stats is not None:
        for r in stats:
            tid = by_name.get(r["team"])
            if tid is None:
                continue
            p = player(r["playerId"], tid)
            p["name"] = p["name"] or r["player"]
            p["pos"] = p["pos"] or r["position"]
            v = _num(r["stat"])
            if v is not None:
                p["stats"].setdefault(r["category"], {})[r["statType"]] = v
    if ppa is not None:
        for r in ppa:
            tid = by_name.get(r["team"])
            if tid is None:
                continue
            p = player(r["id"], tid)
            p["name"] = p["name"] or r["name"]
            p["pos"] = p["pos"] or r["position"]
            avg, tot = r.get("averagePPA") or {}, r.get("totalPPA") or {}
            plays = round(tot["all"] / avg["all"]) if avg.get("all") else 0
            p["ppa"] = {"avg": {k: avg.get(k) for k in PPA_KEYS}, "tot": round(tot.get("all") or 0, 1), "plays": plays}
    if usage is not None:
        for r in usage:
            tid = by_name.get(r["team"])
            if tid is None:
                continue
            p = player(r["id"], tid)
            p["use"] = {k: r["usage"].get(k) for k in PPA_KEYS if k != "all"} | {"overall": r["usage"].get("overall")}
    if recruits is not None:
        for r in recruits:
            pid = r.get("athleteId")
            if pid and pid in P:
                P[pid]["recruit"] = {k: r.get(k) for k in ("year", "stars", "rating", "ranking", "school", "city", "stateProvince", "position")}

    # carry CFBD blocks over from the last publish for any feed we couldn't fetch
    for pid, old in prev.items():
        if old.get("tid") not in teams:
            continue
        p = player(pid, old["tid"])
        carried = False
        if stats is None and old.get("stats"):
            p["stats"] = old["stats"]
            carried = True
        if ppa is None and old.get("ppa"):
            p["ppa"] = old["ppa"]
            carried = True
        if usage is None and old.get("use"):
            p["use"] = old["use"]
        if recruits is None and old.get("recruit"):
            p["recruit"] = old["recruit"]
        if carried:  # CFBD-only players (not on ESPN's roster) need their name back too
            p["name"] = p["name"] or old.get("name")
            p["pos"] = p["pos"] or old.get("pos")
    if stats is None and ppa is None and not prev:
        print("players: no CFBD data and nothing published yet; writing bios only")

    # --- plays involved + estimated QB snaps from ESPN play-by-play (free, keyless) ---
    qb_ids = {pid for pid, p in P.items() if p["pos"] == "QB"}
    pi, team_plays = build_plays_involved(get, games_list, qb_ids, pbp_plays)
    game_info = {g["id"]: g for g in games_list}
    for pid, rec in pi.items():
        if pid not in P:
            continue  # FCS opponents, or players on no FBS roster
        p = P[pid]
        tid = p["tid"]
        log = []
        for gid, c in rec["games"].items():
            g = game_info.get(gid)
            if not g:
                continue
            opp = g["away"] if g["home"] == tid else g["home"]
            log.append({"id": gid, "date": g["date"], "wk": g["weekLabel"], "opp": opp,
                        "oppName": g["awayName"] if g["home"] == tid else g["homeName"],
                        "tp": team_plays.get((gid, tid), 0), **c})
        log.sort(key=lambda x: x["date"])
        p["pi"] = {k: rec[k] for k in ("off", "qb", "def", "st", "pen")} | {"g": len(log), "log": log}

    # --- who started each game (ESPN per-game rosters): the only trace offensive linemen leave ---
    def log_row(p, gid):
        pi_ = p.setdefault("pi", {"off": 0, "qb": 0, "def": 0, "st": 0, "pen": 0, "g": 0, "log": []})
        row = next((r for r in pi_["log"] if r["id"] == gid), None)
        if row is None:
            g, tid = game_info[gid], p["tid"]
            row = {"id": gid, "date": g["date"], "wk": g["weekLabel"], "opp": g["away"] if g["home"] == tid else g["home"],
                   "oppName": g["awayName"] if g["home"] == tid else g["homeName"],
                   "tp": team_plays.get((gid, tid), 0), "off": 0, "qb": 0, "def": 0, "st": 0, "pen": 0}
            pi_["log"].append(row)
            pi_["log"].sort(key=lambda x: x["date"])
        return row
    starters = build_starters(get, games_list)
    for (gid, tid), lineup in starters.items():
        if gid not in game_info:
            continue
        for pid, pos in lineup:
            p = P.get(pid)
            if p is None or p["tid"] != tid:
                continue
            row = log_row(p, gid)
            row["gs"] = 1
            if pos:
                row["gsPos"] = pos
    lineup_games = {k for k in starters}
    for p in P.values():
        if p.get("pi"):
            p["pi"]["g"] = len(p["pi"]["log"])
            p["pi"]["gs"] = sum(1 for r in p["pi"]["log"] if r.get("gs"))

    estimate_snaps(P, team_plays, game_info)

    # --- our own advanced stats from the same play-by-play (success, explosive, havoc ...) ---
    if pbp_plays:
        adv = {pid: a for pid, a in player_advanced(games_list, pbp_plays).items() if pid in P}
        rank_players(adv, lambda pid: (P[pid].get("pi") or {}).get("g", 1))
        for pid, a in adv.items():
            P[pid]["adv"] = a
        print(f"advanced: {len(adv)} FBS players with play-by-play advanced stats")

    # --- FBS ranks for the headline stats ---
    for cat, stat, _, (qc, qs, per_g), _hi in RANKED:
        pairs = []
        for pid, p in P.items():
            s = p["stats"].get(cat, {})
            if s.get(stat) is None or p["stats"].get(qc, {}).get(qs, 0) < per_g * games[p["tid"]]:
                continue
            if per_g < 1 and not s.get(stat):
                continue  # volume stats: rank only players who have any
            pairs.append((pid, s[stat]))
        rk, n = _rank_desc(pairs), len(pairs)
        for pid, r in rk.items():
            P[pid].setdefault("rk", {})[f"{cat}.{stat}"] = [r, n]

    # --- EPA per play: rank + averages within position group, among qualifiers ---
    group_avg = {}
    for g in GROUPS:
        q = [p for p in P.values() if _group(p["pos"]) == g and p.get("ppa")
             and p["ppa"]["plays"] >= GROUP_MIN[g] * games[p["tid"]] and p["ppa"]["avg"].get("all") is not None]
        rk = _rank_desc([(p["id"], p["ppa"]["avg"]["all"]) for p in q])
        for p in q:
            p.setdefault("rk", {})["ppa.all"] = [rk[p["id"]], len(q)]
        avg = {}
        for k in PPA_KEYS:
            vals = [p["ppa"]["avg"][k] for p in q if p["ppa"]["avg"].get(k) is not None]
            avg[k] = round(sum(vals) / len(vals), 3) if vals else None
        use = {}
        for k in ("overall", "pass", "rush", "firstDown", "secondDown", "thirdDown", "standardDowns", "passingDowns"):
            vals = [p["use"][k] for p in q if p.get("use") and p["use"].get(k) is not None]
            use[k] = round(sum(vals) / len(vals), 3) if vals else None
        group_avg[g] = {"ppa": avg, "use": use, "n": len(q), "minPerGame": GROUP_MIN[g]}

    # --- per-team files ---
    by_team = {}
    for p in P.values():
        if p["name"]:
            by_team.setdefault(p["tid"], []).append(p)
    for tid in teams:
        plist = sorted(by_team.get(tid, []), key=lambda p: (p["no"] is None, int(p["no"]) if str(p["no"] or "").isdigit() else 999, p["name"]))
        tgames = [{"id": g["id"], "date": g["date"], "wk": g["weekLabel"],
                   "opp": g["away"] if g["home"] == tid else g["home"],
                   "oppName": g["awayName"] if g["home"] == tid else g["homeName"],
                   "site": "N" if g["neutral"] else ("H" if g["home"] == tid else "A"),
                   "tp": team_plays.get((g["id"], tid), 0),
                   "otp": team_plays.get((g["id"], g["away"] if g["home"] == tid else g["home"]), 0)}
                  for g in sorted(games_list, key=lambda g: g["date"]) if g["completed"] and tid in (g["home"], g["away"])]
        with open(os.path.join(outdir, f"{tid}.json"), "w") as f:
            json.dump({"season": season, "tid": tid, "groupAvg": group_avg, "games": tgames,
                       "depth": depth_chart(plist, tgames), "players": plist}, f, separators=(",", ":"))

    # --- player id -> team id for every FBS player (resolves /players/<name>-<id> URLs) ---
    with open(os.path.join(outdir, "ids.json"), "w") as f:
        json.dump({p["id"]: p["tid"] for p in P.values() if p["name"]}, f, separators=(",", ":"))

    # --- search index + leaderboards (only rewritten when we actually have stats) ---
    have_stats = [p for p in P.values() if p["name"] and (p["stats"] or p.get("ppa"))]
    if not have_stats:
        return
    with open(os.path.join(outdir, "index.json"), "w") as f:
        json.dump([[p["id"], p["name"], p["tid"], p["pos"]] for p in sorted(have_stats, key=lambda p: p["name"])], f, separators=(",", ":"))

    def base(p):
        t = teams[p["tid"]]
        return {"id": p["id"], "name": p["name"], "tid": p["tid"], "team": t["name"], "conf": t["conf"], "pos": p["pos"], "cls": p["cls"]}

    def st(p, cat, k):
        return p["stats"].get(cat, {}).get(k)

    def epa(p, k):
        return (p.get("ppa") or {}).get("avg", {}).get(k)

    boards = {}
    q = [p for p in have_stats if st(p, "passing", "ATT")]
    boards["passing"] = [base(p) | {"att": st(p, "passing", "ATT"), "cmp": st(p, "passing", "COMPLETIONS"), "pct": st(p, "passing", "PCT"),
                                    "yds": st(p, "passing", "YDS"), "td": st(p, "passing", "TD"), "int": st(p, "passing", "INT"),
                                    "ypa": st(p, "passing", "YPA"), "epa": epa(p, "pass")}
                         for p in sorted(q, key=lambda p: -(st(p, "passing", "YDS") or 0))[:300]]
    q = [p for p in have_stats if st(p, "rushing", "CAR")]
    boards["rushing"] = [base(p) | {"car": st(p, "rushing", "CAR"), "yds": st(p, "rushing", "YDS"), "ypc": st(p, "rushing", "YPC"),
                                    "td": st(p, "rushing", "TD"), "long": st(p, "rushing", "LONG"), "epa": epa(p, "rush")}
                         for p in sorted(q, key=lambda p: -(st(p, "rushing", "YDS") or 0))[:300]]
    q = [p for p in have_stats if st(p, "receiving", "REC")]
    boards["receiving"] = [base(p) | {"rec": st(p, "receiving", "REC"), "yds": st(p, "receiving", "YDS"), "ypr": st(p, "receiving", "YPR"),
                                      "td": st(p, "receiving", "TD"), "long": st(p, "receiving", "LONG"),
                                      "use": (p.get("use") or {}).get("pass")}
                           for p in sorted(q, key=lambda p: -(st(p, "receiving", "YDS") or 0))[:300]]
    q = [p for p in have_stats if st(p, "defensive", "TOT")]
    boards["defense"] = [base(p) | {"tot": st(p, "defensive", "TOT"), "solo": st(p, "defensive", "SOLO"), "tfl": st(p, "defensive", "TFL"),
                                    "sacks": st(p, "defensive", "SACKS"), "int": st(p, "interceptions", "INT") or 0,
                                    "pd": st(p, "defensive", "PD"), "qbh": st(p, "defensive", "QB HUR")}
                         for p in sorted(q, key=lambda p: -(st(p, "defensive", "TOT") or 0))[:300]]
    q = [p for p in have_stats if "ppa.all" in p.get("rk", {})]
    boards["epa"] = [base(p) | {"group": _group(p["pos"]), "plays": p["ppa"]["plays"], "epa": epa(p, "all"),
                                "epaPass": epa(p, "pass"), "epaRush": epa(p, "rush"), "use": (p.get("use") or {}).get("overall")}
                     for g in GROUPS
                     for p in sorted((p for p in q if _group(p["pos"]) == g), key=lambda p: -(epa(p, "all") or -9))[:150]]
    with open(os.path.join(outdir, "leaders.json"), "w") as f:
        json.dump({"season": season, "groupMin": GROUP_MIN, "boards": boards}, f, separators=(",", ":"))
    n_stats = sum(1 for p in P.values() if p["stats"])
    print(f"wrote player files: {len(P)} FBS players ({n_stats} with stats, {sum(1 for p in P.values() if p.get('ppa'))} with EPA), "
          f"{len(have_stats)} searchable")
