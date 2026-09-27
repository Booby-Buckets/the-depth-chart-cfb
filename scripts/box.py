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
