"""build_recruiting.py — the recruiting class, joined to what the recruits are doing on the field.

Called from build_players (it needs the player files' snaps, starts and stats). Recruit data
comes from CFBD's /recruiting/players (the 247Sports composite: stars, 0-1 rating, national
rank); CFBD school names equal our ESPN team names and CFBD athlete ids equal ESPN ids, so a
signee links straight to their player page.

Writes public/data/recruiting.json:
  teams     one row per FBS team: signees, star mix, average rating, TDC class score, and how
            many of the class have played / started this season, with their estimated snaps
  recruits  every ranked FBS signee in the top 400 plus any signee who has played, each with
            games, starts, estimated snap share and a one-line stat summary

TDC class score: recruits sorted by rating (0-100 scale), each worth (rating - 80) points,
weighted by a Gaussian on their place in the class, e^(-i^2 / 2*12^2), so the best signees
count most and the 30th adds little. Same idea as the services' team formulas, our own
constants, and it only uses the public composite ratings.
"""
import json, math, os

SIGMA = 12
FLOOR = 80


def class_score(ratings):
    rs = sorted((r * 100 for r in ratings if r), reverse=True)
    return round(sum(max(0.0, r - FLOOR) * math.exp(-(i * i) / (2 * SIGMA * SIGMA)) for i, r in enumerate(rs)), 1)


def _statline(p):
    st = p.get("stats") or {}
    g = lambda c, k: (st.get(c) or {}).get(k)
    if (g("passing", "ATT") or 0) >= 5:
        return f"{int(g('passing', 'YDS') or 0)} pass yds, {int(g('passing', 'TD') or 0)} TD"
    if (g("rushing", "CAR") or 0) >= 3:
        return f"{int(g('rushing', 'YDS') or 0)} rush yds on {int(g('rushing', 'CAR'))} car"
    if g("receiving", "REC"):
        return f"{int(g('receiving', 'REC'))} rec, {int(g('receiving', 'YDS') or 0)} yds"
    if g("defensive", "TOT"):
        return f"{int(g('defensive', 'TOT'))} tkl" + (f", {g('defensive', 'SACKS'):g} sacks" if g("defensive", "SACKS") else "")
    return ""


def build_recruiting(root, season, teams, P, recruits):
    out_path = os.path.join(root, "public", "data", "recruiting.json")
    if not recruits:
        print("recruiting: no CFBD recruiting feed; keeping the last published file")
        return
    by_name = {info["name"]: tid for tid, info in teams.items()}
    rows, per_team = [], {}
    for r in recruits:
        tid = by_name.get(r.get("committedTo"))
        if not tid:
            continue  # FCS / D-II signees
        p = P.get(r.get("athleteId") or "")
        pi = (p or {}).get("pi") or {}
        row = {
            "id": r.get("athleteId"), "name": r.get("name"), "pos": r.get("position"), "stars": r.get("stars"),
            "rating": r.get("rating"), "rank": r.get("ranking"), "hs": r.get("school"),
            "home": ", ".join(x for x in (r.get("city"), r.get("stateProvince")) if x),
            "tid": tid, "onFile": bool(p), "name2": (p or {}).get("name"),
            "g": pi.get("g", 0), "gs": pi.get("gs", 0),
            "es": pi.get("es"), "esTP": pi.get("esTP"), "line": _statline(p) if p else "",
        }
        rows.append(row)
        per_team.setdefault(tid, []).append(row)

    trows = []
    for tid, rs in per_team.items():
        stars = [x["stars"] or 0 for x in rs]
        trows.append({
            "tid": tid, "signees": len(rs), "five": stars.count(5), "four": stars.count(4), "three": stars.count(3),
            "avg": round(sum(rated) / len(rated), 4) if (rated := [x["rating"] for x in rs if x["rating"]]) else None,
            "score": class_score([x["rating"] for x in rs]),
            "played": sum(1 for x in rs if x["g"]), "started": sum(1 for x in rs if x["gs"]),
            "starts": sum(x["gs"] for x in rs), "snaps": sum(x["es"] or 0 for x in rs),
            "top": sorted(rs, key=lambda x: x["rank"] or 9999)[0]["name"],
        })
    trows.sort(key=lambda x: -x["score"])
    for i, t in enumerate(trows):
        t["rank"] = i + 1

    keep = [x for x in rows if (x["rank"] and x["rank"] <= 400) or x["g"]]
    keep.sort(key=lambda x: (x["rank"] or 9999, -(x["rating"] or 0)))
    out = {"season": season, "classYear": season, "source": "CollegeFootballData.com (247Sports composite)",
           "counts": {"signees": len(rows), "onFile": sum(1 for x in rows if x["onFile"]),
                      "played": sum(1 for x in rows if x["g"]), "started": sum(1 for x in rows if x["gs"])},
           "teams": trows, "recruits": keep}
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"recruiting: {len(rows)} FBS signees ({out['counts']['played']} have played, {out['counts']['started']} started), "
          f"{len(trows)} classes, {len(keep)} recruits written")
