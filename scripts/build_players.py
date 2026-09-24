"""build_players.py — player data for player.html / players.html / team-page leaders.

Called from build_hub.main() after the team build (it reuses the ESPN rosters it fetched).

Outputs (data/players/):
  {team_id}.json  every player on that FBS team: ESPN bio + CFBD season stats, EPA (PPA)
                  per play by situation, usage share, FBS ranks, 2026 recruiting profile;
                  plus the position-group EPA averages the page compares against
  index.json      [id, name, team_id, pos] for every FBS player with stats (player search)
  leaders.json    top-300 boards: passing, rushing, receiving, defense; EPA per play top 150 per group

Identity: CFBD player ids are ESPN athlete ids, so ESPN roster bio and CFBD stats join on
id; CFBD school names equal our ESPN location names. Players CFBD has but ESPN's roster
doesn't (walk-ons, late adds) still get a page from CFBD's name/position.

CFBD calls: 4 bulk feeds, each at most once per build_hub.CFBD_MAX_AGE. If CFBD can't be
reached, player stat blocks are carried over from the last published files instead of
being dropped.
"""
import json, os

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


def build_player_files(ctx):
    root, season, teams, rows, rosters, cfbd_get = (ctx[k] for k in ("root", "season", "teams", "rows", "rosters", "cfbd_get"))
    outdir = os.path.join(root, "data", "players")
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
        if stats is None and old.get("stats"):
            p["stats"] = old["stats"]
            p["name"] = p["name"] or old.get("name")
            p["pos"] = p["pos"] or old.get("pos")
        if ppa is None and old.get("ppa"):
            p["ppa"] = old["ppa"]
        if usage is None and old.get("use"):
            p["use"] = old["use"]
        if recruits is None and old.get("recruit"):
            p["recruit"] = old["recruit"]
    if stats is None and ppa is None and not prev:
        print("players: no CFBD data and nothing published yet; writing bios only")

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
        with open(os.path.join(outdir, f"{tid}.json"), "w") as f:
            json.dump({"season": season, "tid": tid, "groupAvg": group_avg, "players": plist}, f, separators=(",", ":"))

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
