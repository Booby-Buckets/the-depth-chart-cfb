"""build_charting.py — "charting" stats from the play-by-play TEXT: where every pass went, how far
it travelled in the air, yards after the catch, run direction, pressure and formation.

ESPN's play text (2026 on; about two-thirds of 2025 games) spells out the spots:
  "Shotgun #7 A.Grigsby Jr. pass complete short middle to #2 T.McCoy caught at SJSU17, for 2 yards to the SJSU17"
  "Shotgun #12 K.Russell pass incomplete short left to #17 T.Brown thrown to FSU32 QB hurried by #88 J.Sanders"
  "#6 J.Bates rush left for 1 yard gain to the SJSU31"
so for each pass we get its direction (left/middle/right), the spot it was caught or thrown to,
hence AIR YARDS (line of scrimmage to that spot) and YAC (gain minus air yards). Which team a
spot's abbreviation belongs to ("SJSU17" = San José State's 17) is learned per game from plays
whose end spot must equal start spot minus the gain.

Heat-map grid: 3 directions (L/M/R) x 7 air-yard bands (behind the line, 0-4, 5-9, 10-14,
15-19, 20-29, 30+), each cell [attempts, completions, yards]. Every play counts (garbage
time included): these are descriptive, like a box score.

Output (attached by build_hub): team_chart[tid] = {"off": {...}, "def": {...}} with FBS ranks,
player_chart[pid] = {"pass": {...}} | {"recv": {...}} | {"rush": {...}}.
"""
import re
from collections import defaultdict

BANDS = (-99, 0, 5, 10, 15, 20, 30)          # lower edges: <0, 0-4, 5-9, 10-14, 15-19, 20-29, 30+
BAND_LABELS = ("Behind", "0–4", "5–9", "10–14", "15–19", "20–29", "30+")
DIRS = ("L", "M", "R")
PASS_T = {"Pass Reception", "Pass Incompletion", "Passing Touchdown", "Interception", "Pass Interception Return",
          "Interception Return Touchdown", "Pass"}
RUSH_T = {"Rush", "Rushing Touchdown"}
SPOT = r"([A-Za-z&]{2,8})\s?(\d{1,2})\b"
RE_ZONE = re.compile(r"\bpass (?:complete|incomplete|intercepted)?\s*(short|deep)\s+(left|middle|right)")
RE_ZONE2 = re.compile(r"\b(short|deep)\s+(left|middle|right)\b")
RE_CATCH = re.compile(r"(?:caught at|thrown to)\s+" + SPOT)
RE_INT = re.compile(r"intercepted by .*? at\s+" + SPOT)
RE_END = re.compile(r"to the\s+" + SPOT)
RE_RUSHDIR = re.compile(r"\brush (left|middle|right|up the middle)\b")


def _band(air):
    b = 0
    for i, lo in enumerate(BANDS):
        if air >= lo:
            b = i
    return b


def _pid(p, role):
    for x in p.get("participants") or []:
        if x.get("type") == role and x.get("athlete"):
            return x["athlete"]["$ref"].rsplit("/", 1)[-1].split("?", 1)[0]
    return None


def _sides(p):
    s = {t.get("type"): t.get("id") for t in p.get("teamParticipants") or []}
    return s.get("offense"), s.get("defense")


def _learn_spots(items):
    """{ABBR: 'off'|'def' votes per team}: which team each spot abbreviation in this game belongs to."""
    votes = defaultdict(lambda: defaultdict(int))
    for p in items:
        t = (p.get("type") or {}).get("text", "")
        if t not in ("Rush", "Pass Reception"):
            continue
        off, dfn = _sides(p)
        m = RE_END.search(p.get("text") or "")
        ytg = (p.get("start") or {}).get("yardsToEndzone")
        if not (m and off and dfn and ytg is not None) or "PENALTY" in (p.get("text") or "") or "FUMBLE" in (p.get("text") or "").upper():
            continue
        ab, n = m.group(1).upper(), int(m.group(2))
        if n == 50:
            continue
        end = ytg - (p.get("statYardage") or 0)
        if abs(n - end) <= 1:
            votes[ab][dfn] += 1          # spot counted toward the defense's end zone
        elif abs((100 - n) - end) <= 1:
            votes[ab][off] += 1
    return {ab: max(v, key=v.get) for ab, v in votes.items() if v}


def _spot_ytg(ab, n, owner, off):
    """Yards to the offense's goal line for spot ABBR+n."""
    team = owner.get(ab.upper())
    if team is None:
        return None
    if n == 50:
        return 50
    return 100 - n if team == off else n


def parse_game(g, items):
    """One record per pass attempt / sack / designed run of the game."""
    owner = _learn_spots(items)
    out = []
    for p in items:
        t = (p.get("type") or {}).get("text", "")
        text = p.get("text") or ""
        if "NO PLAY" in text or not (t in PASS_T or t in RUSH_T or t == "Sack"):
            continue
        off, dfn = _sides(p)
        ytg = (p.get("start") or {}).get("yardsToEndzone")
        if not off or ytg is None:
            continue
        r = {"g": g["id"], "off": off, "def": dfn, "yds": p.get("statYardage") or 0, "ytg": ytg,
             "sg": "Shotgun" in text, "nh": "No Huddle" in text, "hur": "hurried" in text, "down": (p.get("start") or {}).get("down")}
        if t in RUSH_T:
            m = RE_RUSHDIR.search(text)
            if "scramble" in text.lower():
                continue
            r.update(kind="rush", rusher=_pid(p, "rusher"), dir={"left": "L", "right": "R"}.get(m.group(1), "M") if m else None,
                     td="TOUCHDOWN" in text.upper() or t == "Rushing Touchdown")
        elif t == "Sack":
            r.update(kind="sack", passer=_pid(p, "passer"))
        else:
            comp = t in ("Pass Reception", "Passing Touchdown")
            inter = "intercepted" in text or t.startswith("Interception") or "Interception" in t
            m = RE_ZONE.search(text) or RE_ZONE2.search(text)
            spot = RE_INT.search(text) if inter else RE_CATCH.search(text)
            air = None
            if spot:
                sy = _spot_ytg(spot.group(1), int(spot.group(2)), owner, off)
                if sy is not None and -15 <= ytg - sy <= 75:   # outside that = a misread spot
                    air = ytg - sy
            r.update(kind="pass", passer=_pid(p, "passer"), target=_pid(p, "receiver"), comp=comp, int=inter,
                     td=comp and ("TOUCHDOWN" in text.upper() or t == "Passing Touchdown"),
                     dir={"left": "L", "middle": "M", "right": "R"}[m.group(2)] if m else None,
                     deep=(m.group(1) == "deep") if m else None, air=air, brk="broken up" in text)
            if comp and air is not None:
                r["yac"] = r["yds"] - air
        out.append(r)
    return out


# ---------------- aggregation ----------------
def _grid():
    return {d: [[0, 0, 0] for _ in BANDS] for d in DIRS}


ZONES = ("own", "opp", "rz", "gl")   # own half (61+ to go... i.e. >50), opponent 21-50, red zone <=20, inside the 10


def zones_of(ytg):
    if ytg is None:
        return ()
    if ytg > 50:
        return ("own",)
    if ytg > 20:
        return ("opp",)
    return ("rz", "gl") if ytg <= 10 else ("rz",)


def _new_zone():
    return {"att": 0, "comp": 0, "yds": 0, "td": 0, "int": 0, "airN": 0, "airSum": 0, "deep20": 0, "yacN": 0, "yac": 0, "grid": _grid()}


def _add_zone(z, r):
    z["att"] += 1
    z["comp"] += r["comp"]
    z["yds"] += r["yds"] if r["comp"] else 0
    z["td"] += bool(r["td"])
    z["int"] += bool(r["int"])
    if r["air"] is not None:
        z["airN"] += 1
        z["airSum"] += r["air"]
        z["deep20"] += r["air"] >= 20
        if r["dir"]:
            cell = z["grid"][r["dir"]][_band(r["air"])]
            cell[0] += 1; cell[1] += r["comp"]; cell[2] += r["yds"] if r["comp"] else 0
    if "yac" in r:
        z["yacN"] += 1
        z["yac"] += r["yac"]


def _finish_zone(z):
    return {"att": z["att"], "comp": z["comp"], "yds": z["yds"], "td": z["td"], "int": z["int"],
            "adot": round(z["airSum"] / z["airN"], 1) if z["airN"] else None,
            "deep": round(z["deep20"] / z["airN"], 3) if z["airN"] else None,
            "yacPer": round(z["yac"] / z["yacN"], 1) if z["yacN"] else None,
            "cAtt": z["airN"], "grid": z["grid"]}


def _add_pass(a, r):
    for zn in zones_of(r.get("ytg")):
        _add_zone(a["zones"].setdefault(zn, _new_zone()), r)
    a["att"] += 1
    a["comp"] += r["comp"]
    a["yds"] += r["yds"] if r["comp"] else 0
    a["td"] += bool(r["td"])
    a["int"] += bool(r["int"])
    a["brk"] += r["brk"]
    if r["air"] is not None:
        a["gs"].add(r["g"])
        a["airN"] += 1
        a["cComp"] += r["comp"]
        a["cYds"] += r["yds"] if r["comp"] else 0
        a["airSum"] += r["air"]
        if r["dir"]:
            cell = a["grid"][r["dir"]][_band(r["air"])]
            cell[0] += 1
            cell[1] += r["comp"]
            cell[2] += r["yds"] if r["comp"] else 0
        if r["air"] >= 20:
            a["deep20"] += 1
    if "yac" in r:
        a["yacN"] += 1
        a["yac"] += r["yac"]
        a["airComp"] += r["air"]
    if r["dir"]:
        a["dirs"][r["dir"]] += 1


def _new_pass():
    return {"att": 0, "comp": 0, "yds": 0, "td": 0, "int": 0, "brk": 0, "airN": 0, "airSum": 0, "deep20": 0,
            "yacN": 0, "yac": 0, "airComp": 0, "grid": _grid(), "dirs": {d: 0 for d in DIRS}, "gs": set(), "cComp": 0, "cYds": 0, "zones": {}}


def _new_rush():
    return {d: [0, 0, 0] for d in DIRS}   # att, yds, successes


def _succ(r):
    down, yds = r.get("down"), r["yds"]
    return r.get("td") or (down == 1 and yds >= 5) or (down == 2 and yds >= 5) or (down in (3, 4) and yds >= 3)


def _finish_pass(a):
    out = {"att": a["att"], "comp": a["comp"], "yds": a["yds"], "td": a["td"], "int": a["int"], "brk": a["brk"],
           "adot": round(a["airSum"] / a["airN"], 1) if a["airN"] else None,
           "deep": round(a["deep20"] / a["airN"], 3) if a["airN"] else None,
           "yac": a["yac"], "yacPer": round(a["yac"] / a["yacN"], 1) if a["yacN"] else None,
           "airYds": a["airComp"], "grid": a["grid"], "dirs": a["dirs"], "gc": len(a["gs"]),
           "cAtt": a["airN"], "cComp": a["cComp"], "cYds": a["cYds"],   # the charted subset (throws with a spot)
           "zones": {k: _finish_zone(v) for k, v in a["zones"].items() if v["airN"]}}
    return out


def chart_all(games, plays, teams):
    """(team_chart, player_chart) for every FBS team and player from this season's play-by-play."""
    recs = []
    for g in games:
        items = plays.get(g["id"]) if g.get("completed") else None
        if items:
            recs.extend(parse_game(g, items))
    spotted = sum(1 for r in recs if r["kind"] == "pass" and r["air"] is not None)
    passes = sum(1 for r in recs if r["kind"] == "pass")
    T = defaultdict(lambda: {"off": {"pass": _new_pass(), "rush": _new_rush(), "plays": 0, "sg": 0, "nh": 0, "drop": 0, "press": 0},
                             "def": {"pass": _new_pass(), "rush": _new_rush(), "plays": 0, "sg": 0, "nh": 0, "drop": 0, "press": 0}})
    QB, WR, RB = defaultdict(_new_pass), defaultdict(_new_pass), defaultdict(_new_rush)
    qb_extra = defaultdict(lambda: {"drop": 0, "press": 0, "sacks": 0})
    # formation / tempo / pressure words only appear in the detailed text, so those rates count
    # only games that have it (2025 switches format mid-season)
    detailed = {r["g"] for r in recs if r.get("air") is not None}
    for r in recs:
        rich = r["g"] in detailed
        for side, tid in (("off", r["off"]), ("def", r["def"])):
            if tid not in teams:
                continue
            s = T[tid][side]
            if rich:
                s["plays"] += 1
                s["sg"] += r["sg"]
                s["nh"] += r["nh"]
                if r["kind"] in ("pass", "sack"):
                    s["drop"] += 1
                    s["press"] += r["hur"] or r["kind"] == "sack"
            if r["kind"] == "pass":
                _add_pass(s["pass"], r)
            elif r["kind"] == "rush" and r["dir"]:
                c = s["rush"][r["dir"]]
                c[0] += 1; c[1] += r["yds"]; c[2] += bool(_succ(r))
        if r["kind"] == "pass":
            if r.get("passer"):
                _add_pass(QB[r["passer"]], r)
            if r.get("target"):
                _add_pass(WR[r["target"]], r)
        if rich and r["kind"] in ("pass", "sack") and r.get("passer"):
            e = qb_extra[r["passer"]]
            e["drop"] += 1
            e["press"] += r["hur"] or r["kind"] == "sack"
            e["sacks"] += r["kind"] == "sack"
        if r["kind"] == "rush" and r.get("rusher") and r["dir"]:
            c = RB[r["rusher"]][r["dir"]]
            c[0] += 1; c[1] += r["yds"]; c[2] += bool(_succ(r))

    team_chart = {}
    for tid, sides in T.items():
        team_chart[tid] = {}
        for side, s in sides.items():
            pa = _finish_pass(s["pass"])
            team_chart[tid][side] = {
                "pass": pa, "rush": s["rush"],
                "sg": round(s["sg"] / s["plays"], 3) if s["plays"] else None,
                "nh": round(s["nh"] / s["plays"], 3) if s["plays"] else None,
                "press": round(s["press"] / s["drop"], 3) if s["drop"] else None,
                "adot": pa["adot"], "yacPer": pa["yacPer"], "deep": pa["deep"],
            }
    # FBS ranks for the headline team numbers (offense: more is "more", not "better"; the UI says so)
    for side in ("off", "def"):
        for k in ("adot", "yacPer", "deep", "sg", "nh", "press"):
            vals = sorted(((c[side][k], tid) for tid, c in team_chart.items() if c[side].get(k) is not None), reverse=True)
            for i, (_, tid) in enumerate(vals):
                team_chart[tid][side][k + "Rk"] = i + 1

    player_chart = {}
    for pid, a in QB.items():
        if a["att"] >= 5:
            e = qb_extra[pid]
            player_chart.setdefault(pid, {})["pass"] = _finish_pass(a) | {
                "press": round(e["press"] / e["drop"], 3) if e["drop"] else None, "sacks": e["sacks"]}
    for pid, a in WR.items():
        if a["att"] >= 3:
            player_chart.setdefault(pid, {})["recv"] = _finish_pass(a)
    for pid, d in RB.items():
        if sum(c[0] for c in d.values()) >= 5:
            player_chart.setdefault(pid, {})["rush"] = d
    print(f"charting: {passes} passes ({spotted} with a throw/catch spot = {spotted / max(passes, 1):.0%}), "
          f"{sum(1 for r in recs if r['kind'] == 'rush')} runs; {len(team_chart)} teams, {len(player_chart)} players")
    return team_chart, player_chart
