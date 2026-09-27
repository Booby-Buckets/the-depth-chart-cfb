"""build_plays.py — every play with EPA and win probability added, for the Play Finder (/plays).

Expected points (EP) is our own model, fit on every FBS play in the cache (2014 on): for each
down, distance bucket and yard line, the average value of the next score in the half, from the
offense's point of view (TD 7, FG 3, safety 2), smoothed across the field. EPA for a play is the
EP of the state it left minus the state it started in (a score counts its points; a change of
possession flips the sign; the end of a half is worth 0).

Win probability added uses the same model as the live pages (lib/livewp.ts): the closing line
(scripts/cache/line_<id>.json) blended with the score, clock and field position. Older ESPN play
text has no clock, so plays are spread evenly across their quarter when it's missing.

    python3 scripts/build_plays.py --fit            # refit ep_model.json from the cache
    python3 scripts/build_plays.py 2026 2025        # write public/data/plays/<season>/

Output per season: g/<game id>.json (the game's plays, compact rows) and index.json (games by
team + the season's top plays by EPA, WPA and yards, for searches across every team).
"""
import glob, json, math, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache")
EP_FILE = os.path.join(HERE, "ep_model.json")
DATA = os.path.join(ROOT, "public", "data")

DIST = [(1, 1), (2, 2), (3, 3), (4, 6), (7, 10), (11, 99)]
NO_STATE = re.compile(r"kickoff|extra point|two-point|timeout|end (of )?(period|half|game|quarter)|coin toss|^$", re.I)
# participant role -> one letter (rows carry pids + a role string, same order)
ROLE = {"passer": "Q", "rusher": "R", "receiver": "C", "tackler": "T", "assistedBy": "A", "kicker": "K", "punter": "P",
        "scorer": "S", "penalized": "X", "passDefender": "D", "returner": "U", "patScorer": "s", "sackedBy": "B",
        "fumbler": "F", "recoverer": "V", "forcedBy": "O", "patPasser": "q", "interceptor": "I"}
RESULT = {"Pass Reception": "C", "Passing Touchdown": "C", "Pass Incompletion": "N", "Pass Interception Return": "I",
          "Interception Return Touchdown": "I", "Sack": "S", "Rush": "R", "Rushing Touchdown": "R"}
CLOCK = re.compile(r"^\((\d{1,2}):(\d{2})\)")

# play type -> short code for the finder
def ptype(t, text):
    t = (t or "").lower()
    if "sack" in t:
        return "sack"
    if "pass" in t or "interception" in t:
        return "pass"
    if "rush" in t:
        return "rush"
    if "punt" in t:
        return "punt"
    if "field goal" in t:
        return "fg"
    if "penalty" in t:
        return "pen"
    if "fumble" in t:
        return "rush" if "rush" in (text or "").lower() or " run " in (text or "").lower() else "other"
    return "other"


def dist_bucket(d):
    for i, (a, b) in enumerate(DIST):
        if a <= d <= b:
            return i
    return len(DIST) - 1


def state(p):
    s = p.get("start") or {}
    d, dist, y = s.get("down"), s.get("distance"), s.get("yardsToEndzone")
    if not d or d < 1 or d > 4 or not y or y < 1 or y > 99 or dist is None or dist < 0:
        return None
    if NO_STATE.search((p.get("type") or {}).get("text") or ""):
        return None
    return d, max(1, min(int(dist), 99)), int(y)


def score_pts(delta):
    return 7 if delta >= 6 else 3 if delta == 3 else 2 if delta == 2 else 0


def offense(p):
    for t in p.get("teamParticipants") or []:
        if t.get("type") == "offense":
            return str(t.get("id"))
    return None


def half(q):
    return 1 if q <= 2 else 2 if q <= 4 else 3


# ---------------- expected points model ----------------

def game_meta():
    """{game id: {home, away, season, wk, date}} from every built season's team schedules + the current one."""
    meta = {}
    dirs = [(int(y), os.path.join(DATA, "seasons", y, "teams")) for y in os.listdir(os.path.join(DATA, "seasons")) if y.isdigit()]
    cur = json.load(open(os.path.join(DATA, "hub.json")))["season"]
    dirs.append((cur, os.path.join(DATA, "teams")))
    for season, d in dirs:
        for fn in os.listdir(d):
            if not fn[0].isdigit():
                continue
            t = json.load(open(os.path.join(d, fn)))
            tid = fn[:-5]
            for g in t.get("schedule") or []:
                if not g.get("completed"):
                    continue
                home, away = (tid, g["opp"]) if g["site"] != "A" else (g["opp"], tid)
                if g["site"] == "N" and g["id"] in meta:
                    continue
                meta[g["id"]] = {"home": home, "away": away, "season": season, "wk": g["week"], "date": g["date"], "neutral": g["site"] == "N"}
    return meta


def fit():
    meta = game_meta()
    acc = defaultdict(lambda: [0.0, 0])
    n_games = 0
    for path in glob.glob(os.path.join(CACHE, "pbp_*.json")):
        gid = os.path.basename(path)[4:-5]
        m = meta.get(gid)
        if not m or m["season"] >= json.load(open(os.path.join(DATA, "hub.json")))["season"]:
            continue                                  # fit on finished seasons only
        plays = json.load(open(path))
        n_games += 1
        # next score in the half, from each play onward
        nxt = [None] * len(plays)
        pending = None
        for i in range(len(plays) - 1, -1, -1):
            p = plays[i]
            q = (p.get("period") or {}).get("number") or 0
            prev = plays[i - 1] if i else None
            h0, a0 = ((prev.get("homeScore") or 0), (prev.get("awayScore") or 0)) if prev else (0, 0)
            dh, da = (p.get("homeScore") or 0) - h0, (p.get("awayScore") or 0) - a0
            if i + 1 < len(plays) and half(((plays[i + 1].get("period") or {}).get("number") or 0)) != half(q):
                pending = None                       # nothing carries over a half
            if dh > 0 and score_pts(dh):
                pending = (m["home"], score_pts(dh))
            elif da > 0 and score_pts(da):
                pending = (m["away"], score_pts(da))
            nxt[i] = pending
        for p, ns in zip(plays, nxt):
            st, off = state(p), offense(p)
            q = (p.get("period") or {}).get("number") or 0
            if not st or not off or q > 4:
                continue
            v = 0 if ns is None else (ns[1] if ns[0] == off else -ns[1])
            d, dist, y = st
            a = acc[(d, dist_bucket(dist), y)]
            a[0] += v; a[1] += 1
    # smooth across the field: kernel-weighted average over nearby yard lines (bandwidth 4)
    model = {}
    for d in range(1, 5):
        for b in range(len(DIST)):
            row = []
            for y in range(1, 100):
                sw = sv = 0.0
                for yy in range(max(1, y - 12), min(99, y + 12) + 1):
                    s, n = acc.get((d, b, yy), (0, 0))
                    if not n:
                        continue
                    w = math.exp(-((yy - y) / 4) ** 2 / 2)
                    sw += w * n; sv += w * s
                row.append(round(sv / sw, 3) if sw > 30 else None)
            model[f"{d}-{b}"] = row
    # fill thin cells from the neighbouring distance bucket (e.g. 1st-and-1 at midfield)
    for d in range(1, 5):
        for b in range(len(DIST)):
            row = model[f"{d}-{b}"]
            for i, v in enumerate(row):
                if v is None:
                    for bb in sorted(range(len(DIST)), key=lambda x: abs(x - b)):
                        alt = model[f"{d}-{bb}"][i]
                        if alt is not None:
                            row[i] = alt
                            break
    with open(EP_FILE, "w") as f:
        json.dump({"dist": DIST, "ep": model}, f, separators=(",", ":"))
    n = sum(v[1] for v in acc.values())
    print(f"ep model: {n} plays from {n_games} games")
    for d in (1, 3):
        r = model[f"{d}-{4 if d == 1 else 2}"]
        print(f"  {d}st/rd & {'10' if d == 1 else '3'}: own 25 {r[74]:+.2f} · midfield {r[49]:+.2f} · opp 25 {r[24]:+.2f} · opp 5 {r[4]:+.2f}")


_EP = None


def ep(d, dist, y):
    global _EP
    if _EP is None:
        _EP = json.load(open(EP_FILE))["ep"]
    v = _EP[f"{d}-{dist_bucket(dist)}"][y - 1]
    return v if v is not None else 0.0


# ---------------- win probability (mirror of lib/livewp.ts) ----------------

def _erf(x):
    return math.erf(x)


def wp_home(spread, margin, secs_left, ot, poss_home, yte):
    frac = 0.01 if ot else max(0, secs_left) / 3600
    epv = 0 if poss_home is None or yte is None else (1 if poss_home else -1) * (-0.3 + 0.05 * (100 - yte))
    mu = margin + epv + spread * frac
    s = 16 * math.sqrt(max(frac, 20 / 3600))
    if secs_left <= 0 and not ot:
        return 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
    return min(0.99, max(0.01, 0.5 * (1 + _erf(mu / (s * math.sqrt(2))))))


# ---------------- per-game play rows ----------------

def game_rows(gid, m, plays):
    """Compact rows for one game: [seq, q, clock, off, down, dist, yte, type, yds, epa, wpa, text, [pids], roles, result]."""
    line = None
    lp = os.path.join(CACHE, f"line_{gid}.json")
    if os.path.exists(lp):
        line = json.load(open(lp)).get("spread")
    spread = line if line is not None else 0.0
    # clock: from the text when ESPN prints it, else spread evenly through the quarter
    by_q = defaultdict(list)
    for i, p in enumerate(plays):
        by_q[(p.get("period") or {}).get("number") or 0].append(i)
    secs_in_q = {}
    for q, idx in by_q.items():
        for k, i in enumerate(idx):
            mm = CLOCK.match(plays[i].get("text") or "")
            secs_in_q[i] = int(mm.group(1)) * 60 + int(mm.group(2)) if mm else round(900 * (1 - k / max(1, len(idx))))
    def left(i, q):
        return 0 if q >= 5 else (4 - q) * 900 + secs_in_q.get(i, 0)
    def wp_at(i):
        p = plays[i]
        q = (p.get("period") or {}).get("number") or 0
        prev = plays[i - 1] if i else {}
        margin = (prev.get("homeScore") or 0) - (prev.get("awayScore") or 0) if i else 0
        off, st = offense(p), state(p)
        return wp_home(spread, margin, left(i, q), q >= 5, (off == m["home"]) if off else None, st[2] if st else None)
    rows = []
    for i, p in enumerate(plays):
        st, off = state(p), offense(p)
        q = (p.get("period") or {}).get("number") or 0
        if not off or not q:
            continue
        typ = (p.get("type") or {}).get("text") or ""
        if NO_STATE.search(typ):
            continue
        text = p.get("text") or ""
        epa = None
        prev = plays[i - 1] if i else {}
        dh = (p.get("homeScore") or 0) - (prev.get("homeScore") or 0)
        da = (p.get("awayScore") or 0) - (prev.get("awayScore") or 0)
        if st and q <= 4:
            before = ep(*st)
            if dh > 0 and score_pts(dh):
                epa = (score_pts(dh) if m["home"] == off else -score_pts(dh)) - before
            elif da > 0 and score_pts(da):
                epa = (score_pts(da) if m["away"] == off else -score_pts(da)) - before
            else:
                after = 0.0
                for j in range(i + 1, len(plays)):
                    nq = (plays[j].get("period") or {}).get("number") or 0
                    if half(nq) != half(q):
                        break
                    ns = state(plays[j])
                    if ns:
                        after = ep(*ns) * (1 if offense(plays[j]) == off else -1)
                        break
                epa = after - before
        # win probability added for the offense: WP at the next play's start (or the final) minus now
        w0 = wp_at(i)
        if i + 1 < len(plays):
            w1 = wp_at(i + 1)
        else:
            f = (p.get("homeScore") or 0) - (p.get("awayScore") or 0)
            w1 = 1.0 if f > 0 else 0.0 if f < 0 else 0.5
        wpa = (w1 - w0) * (1 if off == m["home"] else -1)
        pairs = []                                   # ESPN sometimes lists the same player + role twice
        for x in p.get("participants") or []:
            if x.get("athlete") and (x["athlete"]["$ref"], x.get("type")) not in pairs:
                pairs.append((x["athlete"]["$ref"], x.get("type")))
        pids = [a for a, _ in pairs]
        roles = "".join(ROLE.get(t, "?") for _, t in pairs)
        s_ = secs_in_q.get(i)
        clock = f"{s_ // 60}:{s_ % 60:02d}" if s_ is not None and CLOCK.match(text) else None
        rows.append([p.get("sequenceNumber"), q, clock, off, st[0] if st else None, st[1] if st else None, st[2] if st else None,
                     ptype(typ, text), p.get("statYardage") or 0, None if epa is None else round(epa, 2), round(wpa, 3),
                     CLOCK.sub("", text).strip(), pids, roles, RESULT.get(typ, "")])
    return rows


def build(season):
    meta = {g: m for g, m in game_meta().items() if m["season"] == season}
    out = os.path.join(DATA, "plays", str(season))
    os.makedirs(os.path.join(out, "g"), exist_ok=True)
    games, top = {}, []
    by_team = defaultdict(list)
    for gid, m in sorted(meta.items(), key=lambda x: x[1]["date"]):
        path = os.path.join(CACHE, f"pbp_{gid}.json")
        if not os.path.exists(path):
            continue
        rows = game_rows(gid, m, json.load(open(path)))
        if not rows:
            continue
        with open(os.path.join(out, "g", f"{gid}.json"), "w") as f:
            json.dump(rows, f, separators=(",", ":"))
        games[gid] = [m["home"], m["away"], m["wk"], m["date"]]
        by_team[m["home"]].append(gid); by_team[m["away"]].append(gid)
        top += [[gid] + r for r in rows if r[7] in ("pass", "rush", "sack", "fg")]
    # the season's standout plays, for searches that don't pick a team
    keep = {}
    for key, rev in ((9, True), (9, False), (10, True), (10, False), (8, True)):
        for r in sorted((r for r in top if r[key + 1] is not None), key=lambda r: r[key + 1], reverse=rev)[:400]:
            keep[(r[0], r[1])] = r
    epas = [r[10] for r in top if r[10] is not None]
    # team names for every side that appears (FBS: abbreviation from that season's hub; FCS: schedule name)
    cur = json.load(open(os.path.join(DATA, "hub.json")))
    hub = cur if cur["season"] == season else json.load(open(os.path.join(DATA, "seasons", str(season), "hub.json")))
    names = {t["id"]: [t["name"], t["abbr"]] for t in hub["teams"]}
    tdir = os.path.join(DATA, "teams") if cur["season"] == season else os.path.join(DATA, "seasons", str(season), "teams")
    for fn in os.listdir(tdir):
        if fn[0].isdigit():
            for g in json.load(open(os.path.join(tdir, fn))).get("schedule") or []:
                names.setdefault(g["opp"], [g["oppName"], g["oppName"][:4].upper()])
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump({"season": season, "games": games, "teams": by_team, "names": names, "top": list(keep.values())}, f, separators=(",", ":"))
    print(f"plays {season}: {len(games)} games, {len(top)} plays, mean EPA {sum(epas) / max(1, len(epas)):+.3f}, {len(keep)} top plays")


def enrich_leaders(season, current):
    """Adds play-based columns to that season's leaderboards: targets, catch %, catch rate over
    expected (CROE: catches vs. what the average FBS receiver catches on the same depth + direction
    of targets, from the charting grid), and EPA totals for passing / rushing / receiving."""
    pdir = os.path.join(DATA, "players") if current else os.path.join(DATA, "seasons", str(season), "players")
    lp = os.path.join(pdir, "leaders.json")
    gdir = os.path.join(DATA, "plays", str(season), "g")
    if not os.path.exists(lp) or not os.path.isdir(gdir):
        return
    tot = defaultdict(lambda: {"passEpa": 0.0, "rushEpa": 0.0, "recEpa": 0.0, "tgt": 0, "rec": 0, "recYds": 0})
    for fn in os.listdir(gdir):
        for r in json.load(open(os.path.join(gdir, fn))):
            epa, typ, pids, roles, res = r[9], r[7], r[12], r[13], r[14]
            if typ not in ("pass", "rush", "sack"):
                continue
            for pid, ro in zip(pids, roles):
                if ro == "Q" and epa is not None:
                    tot[pid]["passEpa" if typ != "rush" else "rushEpa"] += epa
                elif ro == "R" and epa is not None:
                    tot[pid]["rushEpa"] += epa
                elif ro == "C" and typ == "pass":
                    tot[pid]["tgt"] += 1
                    if res == "C":
                        tot[pid]["rec"] += 1
                    if epa is not None:
                        tot[pid]["recEpa"] += epa
    # CROE from the charting grids: league catch rate per (direction, depth band)
    charts = {}
    for fn in os.listdir(pdir):
        if fn[0].isdigit():
            for p in json.load(open(os.path.join(pdir, fn)))["players"]:
                g = ((p.get("chart") or {}).get("recv") or {}).get("grid")
                if g:
                    charts[p["id"]] = g
    cell = defaultdict(lambda: [0, 0])
    for g in charts.values():
        for d, bands in g.items():
            for b, (a, c, _) in enumerate(bands):
                cell[(d, b)][0] += a; cell[(d, b)][1] += c
    def croe(g):
        att = sum(a for bands in g.values() for a, _, _ in bands)
        if att < 8:
            return None
        comp = sum(c for bands in g.values() for _, c, _ in bands)
        exp = sum(a * cell[(d, b)][1] / max(1, cell[(d, b)][0]) for d, bands in g.items() for b, (a, _, _) in enumerate(bands))
        return round((comp - exp) / att, 3)
    L = json.load(open(lp))
    B = L["boards"]
    for r in B.get("receiving", []):
        t = tot.get(r["id"])
        if t and t["tgt"]:
            r["tgt"] = t["tgt"]
            r["catchPct"] = round(t["rec"] / t["tgt"], 3)
            r["recEpa"] = round(t["recEpa"], 1)
        if r["id"] in charts:
            r["croe"] = croe(charts[r["id"]])
    for key, fld in (("rushing", "rushEpa"), ("passing", "passEpa")):
        for r in B.get(key, []):
            t = tot.get(r["id"])
            if t:
                r[fld] = round(t[fld], 1)
    with open(lp, "w") as f:
        json.dump(L, f, separators=(",", ":"))
    print(f"leaders {season}: play EPA + targets added; CROE for {sum(1 for r in B.get('receiving', []) if r.get('croe') is not None)} receivers")


if __name__ == "__main__":
    if "--fit" in sys.argv:
        fit()
    for a in sys.argv[1:]:
        if a.isdigit():
            build(int(a))
            enrich_leaders(int(a), int(a) == json.load(open(os.path.join(DATA, "hub.json")))["season"])
