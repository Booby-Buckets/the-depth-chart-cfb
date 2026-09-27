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
    conf_of = np.array([teams[p["tid"]].get("conf") or "" for p in cands])
    confs = sorted(set(conf_of))
    opoy = {c: np.zeros(len(cands)) for c in confs}           # times each is his conference's top offensive player
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
        raw = Z @ beta
        for c in confs:
            idx = np.where(conf_of == c)[0]
            if len(idx):
                opoy[c][idx[np.argmax(raw[idx])]] += 1
        z = raw / temp
        e = np.exp(z - z.max())
        sims += e / e.sum()
    prob = sims / N_SIMS
    return prob, cands, {c: v / N_SIMS for c, v in opoy.items()}


def top_list(prob, pool, teams, k):
    order = [i for i in np.argsort(-prob)[:k] if prob[i] > 0]
    return [base(pool[i], teams) | {"p": round(float(prob[i]), 4)} for i in order]


# ---------------- position awards ----------------
def z(vals):
    a = np.array(vals, float)
    s = a.std()
    return (a - a.mean()) / s if s > 0 else a * 0


# (weight, per-game feature, scales with the rest of the season?) — rates like Y/A or FG% don't
C_, R_ = True, False
AWARDS = [
    # key, name, what it's for, position filter, min games, terms
    ("obrien", "Davey O'Brien Award", "Best quarterback", lambda p: p.get("pos") == "QB", 3,
     [(1.0, lambda p, g: S(p, "passing", "YDS") / g, C_), (1.2, lambda p, g: S(p, "passing", "TD") / g, C_),
      (-0.9, lambda p, g: S(p, "passing", "INT") / g, C_), (0.5, lambda p, g: S(p, "rushing", "YDS") / g, C_),
      (0.6, lambda p, g: S(p, "passing", "YPA"), R_)]),
    ("walker", "Doak Walker Award", "Best running back", lambda p: p.get("pos") in ("RB", "FB"), 3,
     [(1.3, lambda p, g: S(p, "rushing", "YDS") / g, C_), (0.8, lambda p, g: S(p, "rushing", "TD") / g, C_),
      (0.5, lambda p, g: S(p, "rushing", "YPC") if S(p, "rushing", "CAR") >= 30 else 0, R_), (0.4, lambda p, g: S(p, "receiving", "YDS") / g, C_)]),
    ("biletnikoff", "Biletnikoff Award", "Best receiver", lambda p: p.get("pos") == "WR", 3,
     [(1.3, lambda p, g: S(p, "receiving", "YDS") / g, C_), (0.8, lambda p, g: S(p, "receiving", "TD") / g, C_),
      (0.6, lambda p, g: S(p, "receiving", "REC") / g, C_)]),
    ("mackey", "John Mackey Award", "Best tight end", lambda p: p.get("pos") == "TE", 3,
     [(1.2, lambda p, g: S(p, "receiving", "YDS") / g, C_), (0.8, lambda p, g: S(p, "receiving", "TD") / g, C_),
      (0.6, lambda p, g: S(p, "receiving", "REC") / g, C_)]),
    ("butkus", "Butkus Award", "Best linebacker", lambda p: p.get("pos") in ("LB", "OLB", "ILB", "MLB"), 3,
     [(1.0, lambda p, g: S(p, "defensive", "TOT") / g, C_), (1.0, lambda p, g: S(p, "defensive", "TFL") / g, C_),
      (0.8, lambda p, g: S(p, "defensive", "SACKS") / g, C_), (0.6, lambda p, g: (S(p, "defensive", "PD") + S(p, "interceptions", "INT")) / g, C_)]),
    ("thorpe", "Jim Thorpe Award", "Best defensive back", lambda p: p.get("pos") in ("CB", "S", "FS", "SS", "DB"), 3,
     [(1.3, lambda p, g: (S(p, "defensive", "PD") + 1.5 * S(p, "interceptions", "INT")) / g, C_),
      (0.5, lambda p, g: S(p, "defensive", "TOT") / g, C_), (0.3, lambda p, g: S(p, "defensive", "TFL") / g, C_)]),
    ("nagurski", "Bronko Nagurski Trophy", "Best defensive player", lambda p: p.get("pos") in DEF_POS, 3, None),
    ("groza", "Lou Groza Award", "Best place-kicker", lambda p: p.get("pos") in ("PK", "K") and S(p, "kicking", "FGA") >= 3, 3,
     [(1.2, lambda p, g: S(p, "kicking", "FGM") / g, C_), (1.0, lambda p, g: S(p, "kicking", "PCT"), R_),
      (0.6, lambda p, g: S(p, "kicking", "LONG"), R_)]),
    ("guy", "Ray Guy Award", "Best punter", lambda p: p.get("pos") == "P" and S(p, "punting", "NO") >= 8, 3,
     [(1.4, lambda p, g: S(p, "punting", "YPP"), R_), (0.6, lambda p, g: S(p, "punting", "In 20") / max(1, S(p, "punting", "NO")), R_)]),
]
DEF_POS = ("DL", "DE", "DT", "NT", "EDGE", "LB", "OLB", "ILB", "MLB", "CB", "S", "FS", "SS", "DB")
DEFENSE = [(1.2, lambda p, g: S(p, "defensive", "SACKS") / g, C_), (1.0, lambda p, g: S(p, "defensive", "TFL") / g, C_),
           (0.9, lambda p, g: (S(p, "defensive", "PD") + 1.5 * S(p, "interceptions", "INT")) / g, C_),
           (0.5, lambda p, g: S(p, "defensive", "TOT") / g, C_), (0.4, lambda p, g: S(p, "defensive", "QB HUR") / g, C_)]
OFFENSE = [(1.0, lambda p, g: (S(p, "passing", "YDS") * 0.6 + S(p, "rushing", "YDS") + S(p, "receiving", "YDS")) / g, C_),
           (1.0, lambda p, g: (S(p, "passing", "TD") + S(p, "rushing", "TD") + S(p, "receiving", "TD")) / g, C_),
           (-0.5, lambda p, g: S(p, "passing", "INT") / g, C_)]


# How hard a player's start regresses (his pace so far counts like K games of "average") and one
# game's spread around his level (in SDs of the award score). Defensive counting stats (sacks, TFL,
# INTs) are far noisier week to week than passing/rushing/receiving production, so they regress more.
NOISE = {"off": (6.0, 2.5), "def": (10.0, 4.5), "fr": (8.0, 3.5)}
K_REGRESS, PER_GAME_SD = NOISE["off"]


def composite(pool, terms, teams, team_w=0.35):
    """Standardized award score now: each term z-scored across the pool, plus a small winning-team term."""
    total = 0
    for w, f, _ in terms:
        v = np.array([f(p, games_of(p)) for p in pool], float)
        total = total + w * (v - v.mean()) / (v.std() or 1.0)
    tz = np.array([-math.log(max(1, teams.get(p["tid"], {}).get("rank", 130))) for p in pool])
    c = total + team_w * (tz - tz.mean()) / (tz.std() or 1)
    return (c - c.mean()) / (c.std() or 1)


def sim_from(c, pool, outlook, seed, kind="off"):
    """[n, sims] end-of-season scores from the standardized score now: remaining games drawn around
    his level regressed toward average (K_REGRESS), per-game noise averaged over them, a small chance
    he misses the rest; final = games-weighted blend of now and the rest."""
    rnd = np.random.default_rng(seed)
    K, SD = NOISE[kind]
    c = (c - c.mean()) / (c.std() or 1)
    g = np.array([games_of(p) for p in pool], float)
    rem = np.array([float((outlook.get(p["tid"]) or {}).get("remaining", 0)) for p in pool])
    fut = rnd.normal((c * g / (g + K))[:, None], SD / np.sqrt(np.maximum(rem, 1))[:, None], (len(pool), N_SIMS))
    miss = rnd.random((len(pool), N_SIMS)) < (0.04 * rem / 8)[:, None]
    played = np.where(miss, 0.0, rem[:, None])
    final = (c[:, None] * g[:, None] + fut * played) / np.maximum(1, g[:, None] + played)
    return np.where(miss, final - 1.0 * (rem / np.maximum(1, g + rem))[:, None], final)


def sim_scores(pool, terms, teams, outlook, seed, team_w=0.35, kind="off"):
    return sim_from(composite(pool, terms, teams, team_w), pool, outlook, seed, kind)


def win_share(scores, groups=None):
    """Share of simulations each player finishes first (within his group if given)."""
    n, S_ = scores.shape
    out = np.zeros(n)
    if groups is None:
        for j in np.argmax(scores, 0):
            out[j] += 1
        return out / S_
    for gname in set(groups):
        idx = np.where(np.array(groups) == gname)[0]
        for j in np.argmax(scores[idx], 0):
            out[idx[j]] += 1
    return out / S_


def position_awards(teams, outlook, players):
    out = []
    for i, (key, name, what, flt, gmin, terms) in enumerate(AWARDS):
        pool = [p for p in players if flt(p) and games_of(p) >= gmin]
        if len(pool) < 5:
            continue
        kind = "def" if key in ("butkus", "thorpe", "nagurski") else "off"
        sc = sim_scores(pool, terms or DEFENSE, teams, outlook, 100 + i, kind=kind)
        out.append({"key": key, "name": name, "for": what, "list": top_list(win_share(sc), pool, teams, 8)})
    return out


def heisman_now(pool, teams):
    """The Heisman model's linear score for each player on his production so far."""
    import heisman_model as HM
    C = json.load(open(os.path.join(ROOT, "scripts", "heisman_coefs.json")))
    X = []
    for p in pool:
        t = teams[p["tid"]]
        x = HM.features(p, games_of(p), t["w"] / max(1, t["w"] + t["l"]), t["rank"], t["w"] + t["l"], t.get("conf"), p["tid"])
        X.append([x[f] for f in C["feats"]])
    return ((np.array(X) - np.array(C["mu"])) / np.array(C["sd"])) @ np.array(C["beta"])


def conference_awards(teams, outlook, players, opoy, heis_pool):
    """Per conference: Offensive POY (the Heisman model's score, simulated), Defensive POY and
    Freshman of the Year (composites, simulated)."""
    confs = sorted({t.get("conf") for t in teams.values() if t.get("conf")})
    conf = lambda p: teams.get(p["tid"], {}).get("conf")
    d_pool = [p for p in players if p.get("pos") in DEF_POS and games_of(p) >= 2]
    d_prob = win_share(sim_scores(d_pool, DEFENSE, teams, outlook, 31, kind="def"), [conf(p) for p in d_pool])
    f_pool = [p for p in players if (p.get("cls") or "").upper().startswith("FR") and games_of(p) >= 2
              and (p.get("pos") in DEF_POS or S(p, "passing", "YDS") + S(p, "rushing", "YDS") + S(p, "receiving", "YDS") > 0)]
    f_now = np.maximum(composite(f_pool, OFFENSE, teams, 0.2), composite(f_pool, DEFENSE, teams, 0.2))
    f_sc = sim_from(f_now, f_pool, outlook, 47, "fr")
    f_prob = win_share(f_sc, [conf(p) for p in f_pool])
    o_prob = win_share(sim_from(heisman_now(heis_pool, teams), heis_pool, outlook, 29), [conf(p) for p in heis_pool])
    out = {}
    for c in confs:
        pick = lambda pool, prob: top_list(np.where(np.array([conf(p) == c for p in pool]), prob, 0), pool, teams, 5)
        out[c] = {"opoy": pick(heis_pool, o_prob),
                  "dpoy": pick(d_pool, d_prob), "fr": pick(f_pool, f_prob)}
    return out


def main():
    hub, teams, outlook, players = load()
    hprob, hpool, opoy = heisman(hub, teams, outlook, players)
    out = {"season": hub["season"], "built": hub["built"], "gamesPlayed": hub["gamesPlayed"],
           "heisman": top_list(hprob, hpool, teams, TOP), "awards": position_awards(teams, outlook, players),
           "conferences": conference_awards(teams, outlook, players, opoy, hpool)}
    json.dump(out, open(os.path.join(DATA, "awards.json"), "w"), separators=(",", ":"))
    h = out["heisman"][:5]
    print("awards: Heisman top 5 " + ", ".join(f"{x['name']} ({x['team']}) {x['p']:.0%}" for x in h))


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
