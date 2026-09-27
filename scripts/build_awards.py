"""build_awards.py — award projections for the live season -> public/data/awards.json.

Heisman: the conditional-logit model in heisman_model.py (trained on the 2014-2025 winners; held
out, it put the real winner #1 in 8 of 12 seasons, top 3 in 10). For the live season each
contender's rest of the year is simulated N_SIMS times — per-game production drifts around his
current pace (more drift the more games are left), a small chance he misses the rest, his team's
final record drawn from our record-odds distribution — and the model's softmax probabilities are
averaged over the simulations.

Position awards (Davey O'Brien, Doak Walker, Biletnikoff, Mackey, Butkus, Thorpe, Nagurski,
Lou Groza, Ray Guy): no voting history in our data, so these rank the position's projected
leaders by a transparent stat composite (per-game production, z-scored within the position, with
a small team-success term). Labelled as TDC projections, not vote predictions.
"""
import glob, json, math, os, random
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
N_SIMS = 1500
TOP = 12


def S(p, c, k):
    return float(((p.get("stats") or {}).get(c) or {}).get(k) or 0)


def games_of(p):
    return int((p.get("pi") or {}).get("g") or 0)


def load():
    hub = json.load(open(os.path.join(DATA, "hub.json")))
    teams = {t["id"]: t for t in hub["teams"]}
    outlook = {}
    for tid in teams:
        try:
            outlook[tid] = json.load(open(os.path.join(DATA, "teams", f"{tid}.json")))["outlook"]
        except (OSError, KeyError, ValueError):
            outlook[tid] = None
    players = []
    for f in glob.glob(os.path.join(DATA, "players", "*.json")):
        b = os.path.basename(f)[:-5]
        if not b.isdigit():
            continue
        for p in json.load(open(f))["players"]:
            if p.get("stats") and games_of(p):
                players.append(p)
    return hub, teams, outlook, players


def stat_line(p):
    g = games_of(p)
    parts = []
    if S(p, "passing", "ATT") >= 20:
        parts.append(f"{int(S(p, 'passing', 'YDS'))} pass yds, {int(S(p, 'passing', 'TD'))} TD, {int(S(p, 'passing', 'INT'))} INT")
    if S(p, "rushing", "CAR") >= 15:
        parts.append(f"{int(S(p, 'rushing', 'YDS'))} rush yds, {int(S(p, 'rushing', 'TD'))} TD")
    if S(p, "receiving", "REC") >= 5:
        parts.append(f"{int(S(p, 'receiving', 'REC'))} rec, {int(S(p, 'receiving', 'YDS'))} yds, {int(S(p, 'receiving', 'TD'))} TD")
    if S(p, "defensive", "TOT") >= 8:
        d = f"{int(S(p, 'defensive', 'TOT'))} tkl, {S(p, 'defensive', 'TFL'):g} TFL, {S(p, 'defensive', 'SACKS'):g} sacks"
        pd = S(p, "defensive", "PD") + S(p, "interceptions", "INT")
        parts.append(d + (f", {int(S(p, 'interceptions', 'INT'))} INT, {int(pd)} PD" if pd else ""))
    if S(p, "kicking", "FGA"):
        parts.append(f"{int(S(p, 'kicking', 'FGM'))}/{int(S(p, 'kicking', 'FGA'))} FG, long {int(S(p, 'kicking', 'LONG'))}")
    if S(p, "punting", "NO") >= 5:
        parts.append(f"{S(p, 'punting', 'YPP'):.1f} yds/punt, {int(S(p, 'punting', 'In 20'))} inside 20")
    return f"{g} G · " + "; ".join(parts[:2])


def base(p, teams):
    t = teams.get(p["tid"], {})
    return {"id": p["id"], "name": p["name"], "tid": p["tid"], "team": t.get("name"), "rank": t.get("rank"),
            "rec": f"{t.get('w', 0)}-{t.get('l', 0)}", "pos": p.get("pos"), "cls": p.get("cls"), "line": stat_line(p)}


# ---------------- Heisman ----------------
def heisman(hub, teams, outlook, players):
    import heisman_model as HM
    C = json.load(open(os.path.join(ROOT, "scripts", "heisman_coefs.json")))
    mu, sd, beta = np.array(C["mu"]), np.array(C["sd"]), np.array(C["beta"])
    F = C["feats"]
    team_g = {tid: t["w"] + t["l"] for tid, t in teams.items()}
    cands = []
    for p in players:
        g = games_of(p)
        if g < 1:
            continue
        pace = (S(p, "passing", "YDS") + S(p, "rushing", "YDS") + S(p, "receiving", "YDS")) / g
        if pace < 60:
            continue
        cands.append(p)
    rnd = random.Random(7)
    sims = np.zeros(len(cands))
    rem_of = {tid: (outlook.get(tid) or {}).get("remaining", 0) for tid in teams}
    # early in the season the race is mostly narrative still to come: flatten the odds by the share
    # of the regular season left (temperature 1 at the end, ~2 with two-thirds to go)
    left = float(np.median([rem_of[t] / max(1, rem_of[t] + teams[t]["w"] + teams[t]["l"]) for t in teams]))
    temp = 1 + 1.5 * left
    for _ in range(N_SIMS):
        # the season's final win % per team, from our record odds
        wp = {}
        for tid, t in teams.items():
            o = outlook.get(tid)
            if o and o.get("dist"):
                r, acc = rnd.random(), 0.0
                pick = o["dist"][-1]
                for row in o["dist"]:
                    acc += row["p"]
                    if r <= acc:
                        pick = row
                        break
                wp[tid] = pick["w"] / max(1, pick["w"] + pick["l"])
            else:
                wp[tid] = t["w"] / max(1, t["w"] + t["l"])
        X = []
        for p in cands:
            g, tid = games_of(p), p["tid"]
            rem = rem_of.get(tid, 0)
            played_rest = 0 if rnd.random() < 0.04 * rem / 8 else rem          # small chance he misses the rest
            m = max(0.2, rnd.gauss(1.0, 0.28))                                  # rest-of-season production vs pace
            share = (g + m * played_rest) / max(1, g + played_rest) if played_rest else 1.0
            q = dict(p)
            q["stats"] = {c: {k: (v * share if isinstance(v, (int, float)) and k in ("YDS", "TD", "INT", "PD") else v)
                              for k, v in (vals or {}).items()} for c, vals in (p.get("stats") or {}).items()}
            t = teams[tid]
            x = HM.features(q, g, wp[tid], t["rank"], team_g[tid] or g, t.get("conf"), tid)
            x["played"] = min(1.0, (g + played_rest) / max(1, team_g[tid] + rem))
            X.append([x[f] for f in F])
        Z = (np.array(X) - mu) / sd
        z = (Z @ beta) / temp
        e = np.exp(z - z.max())
        sims += e / e.sum()
    prob = sims / N_SIMS
    return prob, cands


def heisman_odds(hub, teams, outlook, players):
    prob, cands = heisman(hub, teams, outlook, players)
    order = np.argsort(-prob)[:TOP]
    return [base(cands[i], teams) | {"p": round(float(prob[i]), 4)} for i in order]


# ---------------- position awards ----------------
def z(vals):
    a = np.array(vals, float)
    s = a.std()
    return (a - a.mean()) / s if s > 0 else a * 0


AWARDS = [
    # key, name, what it's for, position filter, min games, [(weight, per-game feature)]
    ("obrien", "Davey O'Brien Award", "Best quarterback", lambda p: p.get("pos") == "QB", 3,
     [(1.0, lambda p, g: S(p, "passing", "YDS") / g), (1.2, lambda p, g: S(p, "passing", "TD") / g),
      (-0.9, lambda p, g: S(p, "passing", "INT") / g), (0.5, lambda p, g: S(p, "rushing", "YDS") / g),
      (0.6, lambda p, g: S(p, "passing", "YPA"))]),
    ("walker", "Doak Walker Award", "Best running back", lambda p: p.get("pos") in ("RB", "FB"), 3,
     [(1.3, lambda p, g: S(p, "rushing", "YDS") / g), (0.8, lambda p, g: S(p, "rushing", "TD") / g),
      (0.5, lambda p, g: S(p, "rushing", "YPC") if S(p, "rushing", "CAR") >= 30 else 0), (0.4, lambda p, g: S(p, "receiving", "YDS") / g)]),
    ("biletnikoff", "Biletnikoff Award", "Best receiver", lambda p: p.get("pos") == "WR", 3,
     [(1.3, lambda p, g: S(p, "receiving", "YDS") / g), (0.8, lambda p, g: S(p, "receiving", "TD") / g),
      (0.6, lambda p, g: S(p, "receiving", "REC") / g)]),
    ("mackey", "John Mackey Award", "Best tight end", lambda p: p.get("pos") == "TE", 3,
     [(1.2, lambda p, g: S(p, "receiving", "YDS") / g), (0.8, lambda p, g: S(p, "receiving", "TD") / g),
      (0.6, lambda p, g: S(p, "receiving", "REC") / g)]),
    ("butkus", "Butkus Award", "Best linebacker", lambda p: p.get("pos") in ("LB", "OLB", "ILB", "MLB"), 3,
     [(1.0, lambda p, g: S(p, "defensive", "TOT") / g), (1.0, lambda p, g: S(p, "defensive", "TFL") / g),
      (0.8, lambda p, g: S(p, "defensive", "SACKS") / g), (0.6, lambda p, g: (S(p, "defensive", "PD") + S(p, "interceptions", "INT")) / g)]),
    ("thorpe", "Jim Thorpe Award", "Best defensive back", lambda p: p.get("pos") in ("CB", "S", "FS", "SS", "DB"), 3,
     [(1.3, lambda p, g: (S(p, "defensive", "PD") + 1.5 * S(p, "interceptions", "INT")) / g),
      (0.5, lambda p, g: S(p, "defensive", "TOT") / g), (0.3, lambda p, g: S(p, "defensive", "TFL") / g)]),
    ("nagurski", "Bronko Nagurski Trophy", "Best defensive player", lambda p: p.get("pos") in
     ("DL", "DE", "DT", "NT", "EDGE", "LB", "OLB", "ILB", "MLB", "CB", "S", "FS", "SS", "DB"), 3,
     [(1.2, lambda p, g: S(p, "defensive", "SACKS") / g), (1.0, lambda p, g: S(p, "defensive", "TFL") / g),
      (0.9, lambda p, g: (S(p, "defensive", "PD") + 1.5 * S(p, "interceptions", "INT")) / g),
      (0.5, lambda p, g: S(p, "defensive", "TOT") / g), (0.4, lambda p, g: S(p, "defensive", "QB HUR") / g)]),
    ("groza", "Lou Groza Award", "Best place-kicker", lambda p: p.get("pos") in ("PK", "K") and S(p, "kicking", "FGA") >= 3, 3,
     [(1.2, lambda p, g: S(p, "kicking", "FGM") / g), (1.0, lambda p, g: S(p, "kicking", "PCT")),
      (0.6, lambda p, g: S(p, "kicking", "LONG"))]),
    ("guy", "Ray Guy Award", "Best punter", lambda p: p.get("pos") == "P" and S(p, "punting", "NO") >= 8, 3,
     [(1.4, lambda p, g: S(p, "punting", "YPP")), (0.6, lambda p, g: S(p, "punting", "In 20") / max(1, S(p, "punting", "NO")))]),
]


def position_awards(teams, players):
    out = []
    for key, name, what, flt, gmin, terms in AWARDS:
        pool = [p for p in players if flt(p) and games_of(p) >= gmin]
        if len(pool) < 5:
            continue
        cols = [z([f(p, games_of(p)) for p in pool]) for _, f in terms]
        score = sum(w * c for (w, _), c in zip(terms, cols))
        team = z([-math.log(max(1, teams.get(p["tid"], {}).get("rank", 130))) for p in pool])
        score = score + 0.35 * team                                     # voters notice winning teams
        order = np.argsort(-score)[:8]
        top = score[order]
        rel = (top - top.min()) / (top.max() - top.min() or 1)
        out.append({"key": key, "name": name, "for": what,
                    "list": [base(pool[i], teams) | {"score": round(float(score[i]), 2), "rel": round(float(r), 3)} for i, r in zip(order, rel)]})
    return out


def main():
    hub, teams, outlook, players = load()
    out = {"season": hub["season"], "built": hub["built"], "gamesPlayed": hub["gamesPlayed"],
           "heisman": heisman_odds(hub, teams, outlook, players), "awards": position_awards(teams, players)}
    json.dump(out, open(os.path.join(DATA, "awards.json"), "w"), separators=(",", ":"))
    h = out["heisman"][:5]
    print("awards: Heisman top 5 " + ", ".join(f"{x['name']} ({x['team']}) {x['p']:.0%}" for x in h))


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
