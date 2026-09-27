"""heisman_model.py — who wins the Heisman, learned from 2014-2025.

Conditional logit: within each season, P(player wins) = softmax(beta . x) over that season's
contenders. x = per-game production (passing yards/TDs, rushing+receiving yards/TDs, INTs thrown,
defensive plays for two-way players), QB flag, and team success (win %, final rank).
Fit with L2 on the 12 winners vs every contender; leave-one-season-out check in __main__.
Writes scripts/heisman_coefs.json for build_awards.py.
"""
import json, glob, os, math
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WINNERS = {2014: ("Marcus Mariota", "2483"), 2015: ("Derrick Henry", "333"), 2016: ("Lamar Jackson", "97"),
           2017: ("Baker Mayfield", "201"), 2018: ("Kyler Murray", "201"), 2019: ("Joe Burrow", "99"),
           2020: ("DeVonta Smith", "333"), 2021: ("Bryce Young", "333"), 2022: ("Caleb Williams", "30"),
           2023: ("Jayden Daniels", "99"), 2024: ("Travis Hunter", "38"), 2025: ("Fernando Mendoza", "84")}
FEATS = ("passYds", "passTD", "otherYds", "otherTD", "intThrown", "defPlays", "qb", "winPct", "top10", "rankLog", "played", "power")


def S(p, c, k):
    return float(((p.get("stats") or {}).get(c) or {}).get(k) or 0)


POWER = {"SEC", "Big Ten", "ACC", "Big 12", "Pac-12"}


def features(p, g, win_pct, rank, team_games=None, conf=None, tid=None):
    """Per-game production (g = games) + team context -> feature dict. played = share of the
    team's games he played (voters want a full season's body of work)."""
    g = max(g, 1)
    return {
        "played": min(1.0, g / max(team_games or 13, 1)),
        "power": 1.0 if conf in POWER or tid == "87" else 0.0,   # Notre Dame counts as power
        "passYds": S(p, "passing", "YDS") / g / 100,
        "passTD": S(p, "passing", "TD") / g,
        "otherYds": (S(p, "rushing", "YDS") + S(p, "receiving", "YDS")) / g / 100,
        "otherTD": (S(p, "rushing", "TD") + S(p, "receiving", "TD")) / g,
        "intThrown": S(p, "passing", "INT") / g,
        # defense only counts for two-way players (a real offensive role too): pure DBs don't win it
        "defPlays": (S(p, "interceptions", "INT") + S(p, "defensive", "PD")) / g
        if (S(p, "rushing", "YDS") + S(p, "receiving", "YDS")) / g >= 30 else 0.0,
        "qb": 1.0 if p.get("pos") == "QB" or S(p, "passing", "ATT") > 100 else 0.0,
        "winPct": win_pct,
        "top10": 1.0 if rank <= 10 else 0.0,
        "rankLog": -math.log(max(rank, 1)),
    }


def contender(p, g):
    return g >= 6 and (S(p, "passing", "YDS") >= 1200 or S(p, "rushing", "YDS") + S(p, "receiving", "YDS") >= 600)


def season_rows(y):
    hub = json.load(open(os.path.join(ROOT, "public", "data", "seasons", str(y), "hub.json")))
    team = {t["id"]: t for t in hub["teams"]}
    rows = []
    for f in glob.glob(os.path.join(ROOT, "public", "data", "seasons", str(y), "players", "*.json")):
        if "leaders" in f:
            continue
        for p in json.load(open(f))["players"]:
            t = team.get(p["tid"])
            if not t or not contender(p, p.get("g") or 0):
                continue
            wp = t["w"] / max(1, t["w"] + t["l"])
            rows.append((p, features(p, p["g"], wp, t["rank"], t["w"] + t["l"], t.get("conf"), p["tid"])))
    return rows


def fit(data, l2=0.05, steps=3000, lr=0.05):
    """data = [(X [n,k], winner index)] per season."""
    k = data[0][0].shape[1]
    b = np.zeros(k)
    for _ in range(steps):
        grad = l2 * b
        for X, w in data:
            z = X @ b
            p = np.exp(z - z.max()); p /= p.sum()
            grad -= X[w] - p @ X
        b -= lr * grad / len(data)
    return b


def main():
    data, seasons = [], []
    for y, (name, tid) in WINNERS.items():
        rows = season_rows(y)
        X = np.array([[x[f] for f in FEATS] for _, x in rows])
        w = next((i for i, (p, _) in enumerate(rows) if p["name"] == name and p["tid"] == tid), None)
        if w is None:
            print("winner missing", y, name)
            continue
        data.append((X, w)); seasons.append((y, rows))
    mu = np.vstack([X for X, _ in data]).mean(0); sd = np.vstack([X for X, _ in data]).std(0) + 1e-9
    Z = [((X - mu) / sd, w) for X, w in data]
    # leave one season out: where does the real winner rank?
    ranks = []
    for i, (y, rows) in enumerate(seasons):
        b = fit([z for j, z in enumerate(Z) if j != i])
        s = Z[i][0] @ b
        order = np.argsort(-s)
        rk = int(np.where(order == Z[i][1])[0][0]) + 1
        p = np.exp(s - s.max()); p /= p.sum()
        top = rows[order[0]][0]["name"]
        ranks.append(rk)
        print(f"{y}: winner {rows[Z[i][1]][0]['name']:<18} ranked {rk:>2} (model's #1: {top}, winner prob {p[Z[i][1]]:.0%})")
    print("held-out: winner ranked #1 in", sum(r == 1 for r in ranks), "of", len(ranks), "; top 3 in", sum(r <= 3 for r in ranks))
    b = fit(Z)
    out = {"feats": FEATS, "mu": mu.tolist(), "sd": sd.tolist(), "beta": b.tolist()}
    json.dump(out, open(os.path.join(ROOT, "scripts", "heisman_coefs.json"), "w"), indent=1)
    print("beta", dict(zip(FEATS, np.round(b, 2))))


if __name__ == "__main__":
    main()
