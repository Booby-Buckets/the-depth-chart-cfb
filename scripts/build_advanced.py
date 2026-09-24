"""build_advanced.py — our own advanced stats from ESPN play-by-play (no CFBD calls).

Every number here is computed from plays we already download for the snap estimates, so it
costs nothing, never runs out of quota, and we control the definitions:

  success      1st down: gain >= 50% of the distance; 2nd: >= 70%; 3rd/4th: all of it
               (a touchdown is always a success, a turnover never is)
  explosive    runs of 10+ yards, completions of 20+ yards
  line yards   per carry, the offensive line's share of each run (Football Outsiders' scheme:
               a loss counts 120%, the first 0-4 yards 100%, yards 5-10 50%, 11+ nothing)
  stuff rate   runs stopped at or behind the line
  opportunity  runs gaining 5+ yards (the line did its job; the rest is the runner)
  havoc        plays where the defense made a TFL (incl. sacks), a pass breakup, an
               interception or a forced fumble, per play
  red zone     drives reaching the opponent's 20, and the share ending in a touchdown
  garbage time excluded: a play doesn't count once the margin is over 38 in the 2nd quarter,
               28 in the 3rd or 22 in the 4th (Bill Connelly's cutoffs)

Output: team_adv[tid] = {"off": {...}, "def": {...}} (defense = what opponents did against it)
        player_adv[pid] = {"rush": {...}, "recv": {...}, "pass": {...}, "def": {...}}
with FBS ranks added by rank_teams / rank_players.
"""
PASS_TYPES = {"Pass Reception", "Pass Incompletion", "Passing Touchdown", "Pass", "Sack",
              "Pass Interception Return", "Interception Return Touchdown", "Interception"}
RUSH_TYPES = {"Rush", "Rushing Touchdown"}
INT_TYPES = {"Pass Interception Return", "Interception Return Touchdown", "Interception"}
GARBAGE = {2: 38, 3: 28, 4: 22}


def _rid(ref):
    return ref.rsplit("/", 1)[-1].split("?", 1)[0]


def _success(down, dist, yds, td, turnover):
    if turnover:
        return False
    if td:
        return True
    if not down or dist is None:
        return None
    need = dist * (0.5 if down == 1 else 0.7 if down == 2 else 1.0)
    return yds >= need


def _line_yards(y):
    if y < 0:
        return 1.2 * y
    return min(y, 4) + 0.5 * max(0, min(y, 10) - 4)


def classify(games, plays):
    """Yield one dict per counted scrimmage play (garbage time and nullified plays dropped)."""
    for g in games:
        if not g["completed"]:
            continue
        items = plays.get(g["id"], [])
        prev_h = prev_a = 0
        drive, last_off = 0, None
        for p in items:
            ttype = (p.get("type") or {}).get("text", "")
            sides = {t.get("type"): t.get("id") for t in p.get("teamParticipants") or []}
            off, dfn = sides.get("offense"), sides.get("defense")
            text = p.get("text") or ""
            margin_before = abs(prev_h - prev_a)
            prev_h, prev_a = p.get("homeScore") or prev_h, p.get("awayScore") or prev_a
            if off and off != last_off and ttype in PASS_TYPES | RUSH_TYPES:
                drive += 1
                last_off = off
            if ttype not in PASS_TYPES | RUSH_TYPES or not off or "NO PLAY" in text:
                continue
            q = (p.get("period") or {}).get("number") or 1
            if q in GARBAGE and margin_before > GARBAGE[q]:
                continue
            st = p.get("start") or {}
            roles = {}
            for x in p.get("participants") or []:
                if x.get("athlete"):
                    roles.setdefault(x.get("type"), []).append(_rid(x["athlete"]["$ref"]))
            kind = "pass" if ttype in PASS_TYPES else "rush"
            yds = p.get("statYardage") or 0
            td = "Touchdown" in ttype and ttype not in ("Interception Return Touchdown",)
            turnover = ttype in INT_TYPES or bool(roles.get("fumbler") and "Fumble Recovery (Opponent)" in text)
            yield {
                "gid": g["id"], "drive": (g["id"], drive), "off": off, "def": dfn, "kind": kind, "type": ttype,
                "down": st.get("down"), "dist": st.get("distance"), "ytg": st.get("yardsToEndzone"),
                "yds": yds, "td": td, "sack": ttype == "Sack", "int": ttype in INT_TYPES,
                "complete": ttype in ("Pass Reception", "Passing Touchdown"),
                "success": _success(st.get("down"), st.get("distance"), yds, td, turnover),
                "deep": " deep " in text, "roles": roles,
            }


def _rate(n, d):
    return round(n / d, 3) if d else None


def team_advanced(games, plays, teams):
    agg = {}
    drives = {}
    for pl in classify(games, plays):
        for side, tid in (("off", pl["off"]), ("def", pl["def"])):
            if tid not in teams:
                continue
            a = agg.setdefault(tid, {}).setdefault(side, {k: 0 for k in (
                "plays", "succ", "succN", "rush", "rushSucc", "rushSuccN", "rushExpl", "stuff", "opp", "lineYds",
                "pass", "passSucc", "passSuccN", "passExpl", "dropbacks", "sacks", "ints", "yds",
                "third", "thirdConv", "havoc")})
            a["plays"] += 1
            a["yds"] += pl["yds"]
            if pl["success"] is not None:
                a["succN"] += 1
                a["succ"] += pl["success"]
            if pl["kind"] == "rush":
                a["rush"] += 1
                a["rushExpl"] += pl["yds"] >= 10
                a["stuff"] += pl["yds"] <= 0
                a["opp"] += pl["yds"] >= 5
                a["lineYds"] += _line_yards(pl["yds"])
                if pl["success"] is not None:
                    a["rushSuccN"] += 1
                    a["rushSucc"] += pl["success"]
            else:
                a["dropbacks"] += 1
                a["sacks"] += pl["sack"]
                a["ints"] += pl["int"]
                if not pl["sack"]:
                    a["pass"] += 1
                    a["passExpl"] += pl["complete"] and pl["yds"] >= 20
                if pl["success"] is not None:
                    a["passSuccN"] += 1
                    a["passSucc"] += pl["success"]
            if pl["down"] == 3:
                a["third"] += 1
                a["thirdConv"] += pl["yds"] >= (pl["dist"] or 99) or pl["td"]
            r = pl["roles"]
            a["havoc"] += bool(pl["sack"] or pl["int"] or r.get("passDefender") or r.get("forcedBy")
                               or (pl["kind"] == "rush" and pl["yds"] < 0))
        d = drives.setdefault(pl["drive"], {"off": pl["off"], "def": pl["def"], "rz": False, "td": False})
        d["rz"] |= (pl["ytg"] or 100) <= 20
        d["td"] |= pl["td"]
    for d in drives.values():
        if not d["rz"]:
            continue
        for side, tid in (("off", d["off"]), ("def", d["def"])):
            if tid in agg:
                a = agg[tid][side]
                a["rzTrips"] = a.get("rzTrips", 0) + 1
                a["rzTD"] = a.get("rzTD", 0) + d["td"]
    out = {}
    for tid, sides in agg.items():
        out[tid] = {}
        for side, a in sides.items():
            out[tid][side] = {
                "plays": a["plays"], "sr": _rate(a["succ"], a["succN"]), "ypp": _rate(a["yds"], a["plays"]),
                "rushSr": _rate(a["rushSucc"], a["rushSuccN"]), "passSr": _rate(a["passSucc"], a["passSuccN"]),
                "rushExpl": _rate(a["rushExpl"], a["rush"]), "passExpl": _rate(a["passExpl"], a["pass"]),
                "lineYds": _rate(a["lineYds"], a["rush"]), "stuff": _rate(a["stuff"], a["rush"]), "opp": _rate(a["opp"], a["rush"]),
                "sackRate": _rate(a["sacks"], a["dropbacks"]), "intRate": _rate(a["ints"], a["pass"]),
                "third": _rate(a["thirdConv"], a["third"]), "havoc": _rate(a["havoc"], a["plays"]),
                "rzTD": _rate(a.get("rzTD", 0), a.get("rzTrips", 0)), "rzTrips": a.get("rzTrips", 0),
            }
    return out


# (key, label, higher is better FOR THE OFFENSE, tooltip)
TEAM_METRICS = [
    ("sr", "Success rate", True, "Share of plays that stay on schedule: 50% of the yards needed on 1st down, 70% on 2nd, all of it on 3rd/4th"),
    ("rushSr", "Rushing success rate", True, "Success rate on runs"),
    ("passSr", "Passing success rate", True, "Success rate on dropbacks (sacks included)"),
    ("rushExpl", "Explosive run rate", True, "Runs of 10+ yards, per carry"),
    ("passExpl", "Explosive pass rate", True, "Completions of 20+ yards, per attempt"),
    ("lineYds", "Line yards / carry", True, "The line's share of each run: losses count 120%, yards 0-4 fully, 5-10 half, 11+ not at all"),
    ("opp", "Opportunity rate", True, "Runs gaining 5+ yards: the line did its job"),
    ("stuff", "Stuff rate", False, "Runs stopped at or behind the line"),
    ("sackRate", "Sack rate", False, "Sacks per dropback"),
    ("third", "3rd-down conversion", True, "3rd downs converted"),
    ("rzTD", "Red-zone TD rate", True, "Drives reaching the opponent's 20 that end in a touchdown"),
    ("havoc", "Havoc rate", False, "Plays with a TFL, sack, pass breakup, interception or forced fumble (for the defense, higher is better)"),
]


def rank_teams(adv):
    """Adds <key>Rk for offense and defense (defense: lower is better wherever offense wants higher)."""
    for key, _, hi, _ in TEAM_METRICS:
        for side in ("off", "def"):
            better_high = hi if side == "off" else not hi
            vals = sorted(((a[side][key], t) for t, a in adv.items() if side in a and a[side].get(key) is not None),
                          reverse=better_high)
            prev, prk = None, 0
            for i, (v, t) in enumerate(vals):
                if v != prev:
                    prk, prev = i + 1, v
                adv[t][side][key + "Rk"] = prk
    return adv


def player_advanced(games, plays):
    """Per-player advanced lines, keyed by ESPN athlete id."""
    P = {}

    def pa(pid, k):
        return P.setdefault(pid, {}).setdefault(k, {})

    def add(d, k, v=1):
        d[k] = d.get(k, 0) + v

    team_att = {}  # (gid, team) -> pass attempts, for target share
    for pl in classify(games, plays):
        r = pl["roles"]
        if pl["kind"] == "rush":
            for pid in r.get("rusher", [])[:1]:
                d = pa(pid, "rush")
                add(d, "car"); add(d, "yds", pl["yds"])
                if pl["success"] is not None:
                    add(d, "succN"); add(d, "succ", pl["success"])
                add(d, "expl", pl["yds"] >= 10); add(d, "stuff", pl["yds"] <= 0)
                add(d, "fd", pl["yds"] >= (pl["dist"] or 99) or pl["td"])
                add(d, "rz", (pl["ytg"] or 100) <= 20); add(d, "gl", (pl["ytg"] or 100) <= 5)
        else:
            qb = (r.get("passer") or [None])[0]
            if qb:
                d = pa(qb, "pass")
                add(d, "db"); add(d, "sacks", pl["sack"]); add(d, "ints", pl["int"])
                if not pl["sack"]:
                    add(d, "att"); add(d, "deep", pl["deep"]); add(d, "expl", pl["complete"] and pl["yds"] >= 20)
                if pl["success"] is not None:
                    add(d, "succN"); add(d, "succ", pl["success"])
                if pl["down"] == 3:
                    add(d, "third"); add(d, "thirdConv", pl["yds"] >= (pl["dist"] or 99) or pl["td"])
            if not pl["sack"]:
                team_att[(pl["gid"], pl["off"])] = team_att.get((pl["gid"], pl["off"]), 0) + 1
            for pid in (r.get("receiver") or [])[:1]:
                d = pa(pid, "recv")
                add(d, "tgt"); add(d, "rec", pl["complete"]); add(d, "yds", pl["yds"] if pl["complete"] else 0)
                add(d, "deep", pl["deep"]); add(d, "expl", pl["complete"] and pl["yds"] >= 20)
                if pl["success"] is not None:
                    add(d, "succN"); add(d, "succ", pl["success"])
                add(d, "third", pl["down"] == 3); add(d, "rz", (pl["ytg"] or 100) <= 20)
                d.setdefault("_games", set()).add((pl["gid"], pl["off"]))
        # defense: tackles for loss, sacks, breakups, interceptions, forced fumbles, run stops
        tfl = pl["sack"] or (pl["kind"] == "rush" and pl["yds"] < 0)
        tacklers = set(r.get("tackler", []) + r.get("assistedBy", []) + r.get("sackedBy", []))
        for pid in tacklers:
            d = pa(pid, "def")
            add(d, "tkl"); add(d, "tfl", tfl)
            if pl["kind"] == "rush" and pl["success"] is False:
                add(d, "stops")
        for pid in r.get("sackedBy", []):
            add(pa(pid, "def"), "sacks")
        for pid in r.get("passDefender", []):
            add(pa(pid, "def"), "pd")
        for pid in r.get("forcedBy", []):
            add(pa(pid, "def"), "ff")
        if pl["int"]:
            for pid in r.get("interceptor", []) or []:
                add(pa(pid, "def"), "ints")
        for pid in set(r.get("sackedBy", []) + r.get("passDefender", []) + r.get("forcedBy", [])) | (tacklers if tfl else set()):
            add(pa(pid, "def"), "havoc")

    out = {}
    for pid, a in P.items():
        o = {}
        if (x := a.get("rush")) and x.get("car"):
            o["rush"] = {"car": x["car"], "sr": _rate(x.get("succ", 0), x.get("succN", 0)), "expl": _rate(x.get("expl", 0), x["car"]),
                         "stuff": _rate(x.get("stuff", 0), x["car"]), "fd": x.get("fd", 0), "rz": x.get("rz", 0), "gl": x.get("gl", 0)}
        if (x := a.get("recv")) and x.get("tgt"):
            att = sum(team_att.get(k, 0) for k in x.get("_games", ()))
            o["recv"] = {"tgt": x["tgt"], "catch": _rate(x.get("rec", 0), x["tgt"]), "sr": _rate(x.get("succ", 0), x.get("succN", 0)),
                         "expl": _rate(x.get("expl", 0), x["tgt"]), "deep": _rate(x.get("deep", 0), x["tgt"]),
                         "ypt": _rate(x.get("yds", 0), x["tgt"]), "share": _rate(x["tgt"], att), "third": x.get("third", 0), "rz": x.get("rz", 0)}
        if (x := a.get("pass")) and x.get("db"):
            o["pass"] = {"db": x["db"], "sr": _rate(x.get("succ", 0), x.get("succN", 0)), "expl": _rate(x.get("expl", 0), x.get("att", 0)),
                         "sackRate": _rate(x.get("sacks", 0), x["db"]), "deep": _rate(x.get("deep", 0), x.get("att", 0)),
                         "intRate": _rate(x.get("ints", 0), x.get("att", 0)), "third": _rate(x.get("thirdConv", 0), x.get("third", 0))}
        if (x := a.get("def")) and (x.get("tkl") or x.get("pd") or x.get("havoc")):
            o["def"] = {k: x.get(k, 0) for k in ("tkl", "tfl", "sacks", "pd", "ints", "ff", "stops", "havoc")}
        if o:
            out[pid] = o
    return out


# (group key, metric, label, higher better, minimum volume key, minimum per team game)
PLAYER_METRICS = [
    ("rush", "sr", "Rushing success rate", True, "car", 6), ("rush", "expl", "Explosive run rate (10+)", True, "car", 6),
    ("rush", "stuff", "Stuffed at the line", False, "car", 6),
    ("recv", "sr", "Success rate per target", True, "tgt", 3), ("recv", "expl", "Explosive catches per target (20+)", True, "tgt", 3),
    ("recv", "catch", "Catch rate", True, "tgt", 3), ("recv", "share", "Target share", True, "tgt", 3),
    ("recv", "ypt", "Yards per target", True, "tgt", 3),
    ("pass", "sr", "Dropback success rate", True, "db", 12), ("pass", "expl", "Explosive pass rate (20+)", True, "db", 12),
    ("pass", "sackRate", "Sack rate", False, "db", 12), ("pass", "deep", "Deep-throw rate", True, "db", 12),
    ("pass", "third", "3rd-down conversion", True, "db", 12),
    ("def", "havoc", "Havoc plays", True, None, 0), ("def", "tfl", "Tackles for loss", True, None, 0), ("def", "stops", "Run stops", True, None, 0),
]


def rank_players(adv, games_of):
    """Adds FBS ranks as adv[pid][group]["rk"][metric] = [rank, n] among qualifiers.
    games_of(pid) -> team games played (for the per-game volume minimums)."""
    for grp, key, _, hi, vol, per_g in PLAYER_METRICS:
        pool = [(pid, a[grp][key]) for pid, a in adv.items() if grp in a and a[grp].get(key) is not None
                and (vol is None or a[grp].get(vol, 0) >= per_g * max(1, games_of(pid)))
                and (vol is not None or a[grp][key] > 0)]
        pool.sort(key=lambda x: -x[1] if hi else x[1])
        prev, prk = None, 0
        for i, (pid, v) in enumerate(pool):
            if v != prev:
                prk, prev = i + 1, v
            adv[pid][grp].setdefault("rk", {})[key] = [prk, len(pool)]
    return adv
