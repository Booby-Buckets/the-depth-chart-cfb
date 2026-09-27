"""box.py — ESPN box scores, per game: the loader (cached forever) and per-game stat lines.

Shared by the live build (player game logs) and build_history (season totals + game logs)."""
import json, os
from concurrent.futures import ThreadPoolExecutor

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


def load_box(get, cache, games, refresh=()):
    """{game_id: [(team_id, category, labels, athlete{id,name,jersey}, stats[])]} from ESPN box
    scores, trimmed to the players block and cached forever (box_<id>.json). Games in `refresh`
    are fetched again (recent games: ESPN corrects stats for a day or two after the final)."""
    def fetch(g):
        gid = g["id"]
        path = os.path.join(cache, f"box_{gid}.json")
        if os.path.exists(path) and gid not in refresh:
            with open(path) as f:
                return gid, json.load(f)
        try:
            d = get(SUMMARY + gid)
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



def line_of(cat, labels, stats):
    """One box-score row -> {our key: number} (made/att split, blanks dropped)."""
    out = {}
    for lab, v in zip(labels or [], stats or []):
        key = LABELS.get(cat, {}).get(lab)
        if not key:
            continue
        if isinstance(key, tuple):
            parts = str(v).split("/")
            if len(parts) == 2 and _num(parts[0]) is not None and _num(parts[1]) is not None:
                out[key[0]], out[key[1]] = _num(parts[0]), _num(parts[1])
            continue
        x = _num(v)
        if x is not None:
            out[key] = x
    return out


def game_logs(box, keep):
    """{player id: {game id: {category: {key: n}}}} for players where keep(pid, tid) is true.
    Only lines with something in them (a zero defensive line is still a game played)."""
    out = {}
    for gid, rows in box.items():
        for tid, cat, labels, ath, stats in rows:
            if cat not in LABELS or not keep(ath["id"], tid):
                continue
            ln = line_of(cat, labels, stats)
            if ln:
                out.setdefault(ath["id"], {}).setdefault(gid, {})[cat] = {k: (int(v) if v == int(v) else v) for k, v in ln.items()}
    return out


VOLUME = {"passing": "ATT", "rushing": "CAR", "receiving": "REC", "defensive": "TOT", "interceptions": "INT", "fumbles": "FUM",
          "kicking": "FGA", "punting": "NO", "kickReturns": "NO", "puntReturns": "NO"}


def season_from_logs(gl):
    """Season totals from a player's game logs ({game id: {category: {key: n}}}), with the same
    derived rates the CFBD season stats carry (PCT, YPA, YPC, YPR, AVG, YPP)."""
    out = {}
    for line in gl.values():
        for cat, st in line.items():
            o = out.setdefault(cat, {})
            for k, v in st.items():
                o[k] = max(o.get(k, v), v) if k in MAXED else o.get(k, 0) + v
    g = lambda c, k: (out.get(c) or {}).get(k) or 0
    if "passing" in out and g("passing", "ATT"):
        out["passing"]["PCT"] = round(g("passing", "COMPLETIONS") / g("passing", "ATT"), 3)
        out["passing"]["YPA"] = round(g("passing", "YDS") / g("passing", "ATT"), 1)
    if "rushing" in out and g("rushing", "CAR"):
        out["rushing"]["YPC"] = round(g("rushing", "YDS") / g("rushing", "CAR"), 1)
    if "receiving" in out and g("receiving", "REC"):
        out["receiving"]["YPR"] = round(g("receiving", "YDS") / g("receiving", "REC"), 1)
    if "kicking" in out and g("kicking", "FGA"):
        out["kicking"]["PCT"] = round(g("kicking", "FGM") / g("kicking", "FGA"), 3)
    if "punting" in out and g("punting", "NO"):
        out["punting"]["YPP"] = round(g("punting", "YDS") / g("punting", "NO"), 1)
    for c in ("kickReturns", "puntReturns"):
        if c in out and g(c, "NO"):
            out[c]["AVG"] = round(g(c, "YDS") / g(c, "NO"), 1)
    return out


def freshen_stats(stats, gl):
    """Replace any stat category where the box scores are ahead of the season feed (CFBD posts a
    day or more after the games; ESPN's box scores are up the same night). Returns categories replaced."""
    box = season_from_logs(gl)
    swapped = 0
    for cat, st in box.items():
        vk = VOLUME.get(cat)
        cur = (stats.get(cat) or {})
        if vk and (st.get(vk) or 0) > (cur.get(vk) or 0):
            stats[cat] = {**cur, **st}
            swapped += 1
    return swapped
