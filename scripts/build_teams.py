"""build_teams.py — one data/teams/{espn_id}.json per FBS team, for team.html.

Called from build_hub.main() (it reuses the ratings, games and HTTP cache), so there's
still one command:  python3 scripts/build_hub.py

Each file holds:
  meta      colors, mascot, coach, home stadium
  rating    current TDC rating + ranks (overall / off / def / SOS) out of the FBS field
  history   the rating re-solved after every completed week (Preseason = the prior)
  schedule  every game: result + opponent-adjusted "game score", or our line + win %
  outlook   exact final-record distribution (overall + conference) from the win %s
  stats     ESPN season stats, offense vs defense, each ranked among FBS teams
  roster    ESPN roster
"""
import json, os
from concurrent.futures import ThreadPoolExecutor

# key, label, category, stat, divide-by-games, offense higher-is-better (defense is the reverse)
METRICS = [
    ("ppg", "Points / game", "scoring", "totalPointsPerGame", False, True),
    ("ypg", "Yards / game", "passing", "yardsPerGame", False, True),
    ("ypp", "Yards / play", None, None, False, True),
    ("pypg", "Pass yards / game", "passing", "netPassingYardsPerGame", False, True),
    ("ypa", "Yards / pass att.", "passing", "yardsPerPassAttempt", False, True),
    ("cmp", "Completion %", "passing", "completionPct", False, True),
    ("rypg", "Rush yards / game", "rushing", "rushingYardsPerGame", False, True),
    ("ypc", "Yards / carry", "rushing", "yardsPerRushAttempt", False, True),
    ("third", "3rd-down conv. %", "miscellaneous", "thirdDownConvPct", False, True),
    ("to", "Turnovers / game", "miscellaneous", "totalGiveaways", True, False),
    ("sk", "Sacks / game", "passing", "sacks", True, False),
    ("pen", "Penalty yards / game", "miscellaneous", "totalPenaltyYards", True, False),
]


# CFBD advanced (garbage time excluded): key, label, offense field, defense field
ADV = [
    ("epa", "EPA / play", "oEPA", "dEPA"),
    ("sr", "Success rate", "oSR", "dSR"),
    ("expl", "Explosiveness", "oExpl", "dExpl"),
]


def _stat_block(cats):
    """ESPN category list -> {cat: {stat: value}}"""
    out = {}
    for c in cats or []:
        out[c["name"]] = {s["name"]: s.get("value") for s in c.get("stats", [])}
    return out


def _metrics(block):
    games = (block.get("passing", {}).get("teamGamesPlayed") or block.get("general", {}).get("gamesPlayed") or 0)
    vals = {}
    for key, _, cat, stat, per_game, _hi in METRICS:
        if key == "ypp":
            r = block.get("rushing", {})
            v = r.get("totalYards") / r["totalOffensivePlays"] if r.get("totalOffensivePlays") else None
        else:
            v = block.get(cat, {}).get(stat)
            if v is not None and per_game:
                v = v / games if games else None
        vals[key] = v
    return vals


def _r(v):
    return None if v is None else round(v, 2)


def _poisson_binomial(ps):
    dist = [1.0]
    for p in ps:
        nxt = [0.0] * (len(dist) + 1)
        for k, q in enumerate(dist):
            nxt[k] += q * (1 - p)
            nxt[k + 1] += q * p
        dist = nxt
    return dist


# Gauss-Hermite nodes/weights (probabilists', 9 points) for averaging over a team's own rating error
_GH = [(-4.5127, 2.2e-05), (-3.2054, 0.002789), (-2.0768, 0.049916), (-1.0233, 0.244098), (0.0, 0.406349),
       (1.0233, 0.244098), (2.0768, 0.049916), (3.2054, 0.002789), (4.5127, 2.2e-05)]


def _record_dist(games, my_sd, win_prob):
    """games = [(spread, sd_without_my_error)]. A team's own rating error hits every game at
    once, so average the win-count distribution over that error instead of treating games as
    independent (which makes records far too certain)."""
    total = [0.0] * (len(games) + 1)
    for z, w in _GH:
        d = _poisson_binomial([win_prob(sp + z * my_sd, sd) for sp, sd in games])
        for k, p in enumerate(d):
            total[k] += w * p
    s = sum(total)
    return [p / s for p in total]


def _rank(values, higher_better):
    """{id: value} -> {id: rank}, ties share the better rank; None is unranked."""
    have = sorted(((v, t) for t, v in values.items() if v is not None), reverse=higher_better)
    ranks, prev, prev_rank = {}, None, 0
    for i, (v, t) in enumerate(have):
        if v != prev:
            prev_rank, prev = i + 1, v
        ranks[t] = prev_rank
    return ranks


def build_team_files(ctx):
    get, ESPN, OUTDIR = ctx["get"], ctx["ESPN"], ctx["outdir"]
    teams, rows, games, rat = ctx["teams"], ctx["rows"], ctx["games"], ctx["rat"]
    hfa, mu, prior, solve, win_prob, compress = ctx["hfa"], ctx["mu"], ctx["prior"], ctx["solve"], ctx["win_prob"], ctx["compress"]
    rating_sd, margin_sd = ctx["rating_sd"], ctx["margin_sd"]
    season = ctx["season"]
    os.makedirs(OUTDIR, exist_ok=True)
    row_of = {r["id"]: r for r in rows}
    n = len(rows)

    # --- ESPN per-team feeds (parallel; cached) ---
    def fetch(tid):
        info = get(f"{ESPN}/teams/{tid}", f"team_{tid}.json", max_age=7 * 86400)
        roster = get(f"{ESPN}/teams/{tid}/roster", f"roster_{season}_{tid}.json", max_age=20 * 3600)
        stats = get(f"{ESPN}/teams/{tid}/statistics", f"stats_{season}_{tid}.json", max_age=3 * 3600)
        return tid, info, roster, stats
    with ThreadPoolExecutor(8) as ex:
        feeds = {tid: (i, r, s) for tid, i, r, s in ex.map(fetch, list(teams))}

    # --- stats + FBS ranks ---
    off_m, def_m = {}, {}
    for tid, (_, _, st) in feeds.items():
        res = st.get("results") or {}
        own = res.get("stats") or {}
        opp = res.get("opponent") or []
        off_m[tid] = _metrics(_stat_block(own.get("categories") if isinstance(own, dict) else own))
        def_m[tid] = _metrics(_stat_block(opp.get("categories") if isinstance(opp, dict) else opp))
    stat_ranks = {}
    for key, _, _, _, _, hi in METRICS:
        stat_ranks[("off", key)] = _rank({t: off_m[t][key] for t in teams}, hi)
        stat_ranks[("def", key)] = _rank({t: def_m[t][key] for t in teams}, not hi)

    # --- CFBD advanced stats (only when build_hub ran with CFBD_KEY): higher is better on
    # offense, lower on defense ---
    adv_ranks = {}
    for _, _, o_k, d_k in ADV:
        adv_ranks[o_k] = _rank({r["id"]: r.get(o_k) for r in rows}, True)
        adv_ranks[d_k] = _rank({r["id"]: r.get(d_k) for r in rows}, False)

    # --- rating ranks ---
    rk = {k: _rank({r["id"]: r[k] for r in rows}, True) for k in ("off", "def", "sos")}

    # --- weekly history: re-solve after each completed week ---
    done_weeks = sorted({(g["type"], g["week"]) for g in games if g["completed"]})
    label_of = {(g["type"], g["week"]): g["weekLabel"] for g in games}
    pre = {t: (prior[t]["net"] if t in prior else -8.0) for t in teams}
    snaps = [("Preseason", pre, _rank(pre, True))]
    for wk in done_weeks:
        r_wk, _, _ = solve([g for g in games if (g["type"], g["week"]) <= wk], teams, prior)
        nets = {t: r_wk[t]["net"] for t in teams}
        snaps.append((label_of[wk], nets, _rank(nets, True)))

    def net_of(tid):
        return rat[tid if tid in teams else "FCS"]

    for tid, info in teams.items():
        row = row_of[tid]
        tinfo, roster, _ = feeds[tid]
        t = tinfo.get("team", {})

        # schedule
        sched, ps_all, ps_conf, g_all, g_conf = [], [], [], [], []
        my_sd = rating_sd(rat[tid], tid)
        home_venue = None
        for g in sorted((g for g in games if tid in (g["home"], g["away"])), key=lambda g: g["date"]):
            home = g["home"] == tid
            opp = g["away"] if home else g["home"]
            site = "N" if g["neutral"] else ("H" if home else "A")
            if site == "H" and g.get("venue"):
                home_venue = home_venue or g["venue"]
            site_adj = 0 if site == "N" else (hfa if site == "H" else -hfa)
            me, op = net_of(tid), net_of(opp)
            e = {
                "id": g["id"], "date": g["date"], "week": g["weekLabel"], "site": site, "conf": g["conf"], "tv": g["tv"],
                "opp": opp, "oppName": g["awayName"] if home else g["homeName"],
                "oppFbs": opp in teams, "oppRank": row_of[opp]["rank"] if opp in teams else None,
                "oppLogo": teams[opp]["logo"] if opp in teams else f"https://a.espncdn.com/i/teamlogos/ncaa/500/{opp}.png",
                "completed": g["completed"],
            }
            if g["completed"]:
                pf, pa = (g["hs"], g["as"]) if home else (g["as"], g["hs"])
                cpf, cpa = compress(pf, pa)
                e.update({"pf": pf, "pa": pa, "res": "W" if pf > pa else "L",
                          # what rating this one game implies: margin, adjusted for venue and opponent
                          "score": round((cpf - cpa) - site_adj + op["net"], 1)})
            else:
                spread = me["net"] - op["net"] + site_adj
                opk = opp if opp in teams else "FCS"
                sd_rest = (margin_sd ** 2 + rating_sd(rat[opk], opk) ** 2) ** 0.5
                p = win_prob(spread, (sd_rest ** 2 + my_sd ** 2) ** 0.5)
                e.update({"line": round(spread, 1), "win": round(p, 3),
                          "total": round(2 * mu + me["off"] - op["def"] + op["off"] - me["def"], 1), "detail": g["detail"]})
                ps_all.append(p); g_all.append((spread, sd_rest))
                if g["conf"]:
                    ps_conf.append(p); g_conf.append((spread, sd_rest))
            sched.append(e)

        dist = _record_dist(g_all, my_sd, win_prob)
        cdist = _record_dist(g_conf, my_sd, win_prob)
        outlook = {
            "remaining": len(ps_all),
            "expW": round(row["w"] + sum(ps_all), 1), "expL": round(row["l"] + len(ps_all) - sum(ps_all), 1),
            "dist": [{"w": row["w"] + k, "l": row["l"] + len(ps_all) - k, "p": round(p, 4)} for k, p in enumerate(dist)],
            "confExpW": round(row["cw"] + sum(ps_conf), 1), "confExpL": round(row["cl"] + len(ps_conf) - sum(ps_conf), 1),
            "confDist": [{"w": row["cw"] + k, "l": row["cl"] + len(ps_conf) - k, "p": round(p, 4)} for k, p in enumerate(cdist)],
            "bowlP": round(sum(p for k, p in enumerate(dist) if row["w"] + k >= 6), 3),
        }

        # roster
        players = []
        for grp in roster.get("athletes", []):
            for a in grp.get("items", []):
                pos = a.get("position") or {}
                players.append({
                    "id": a.get("id"), "name": a.get("fullName"), "no": a.get("jersey"),
                    "pos": pos.get("abbreviation"), "unit": grp.get("position"),
                    "cls": (a.get("experience") or {}).get("abbreviation"),
                    "ht": a.get("displayHeight"), "wt": a.get("displayWeight"),
                    "home": (a.get("birthPlace") or {}).get("displayText"),
                })
        coach = (roster.get("coach") or [{}])[0]

        stats = []
        for key, label, o_k, d_k in ADV:
            if row.get(o_k) is None and row.get(d_k) is None:
                continue
            stats.append({"k": key, "l": label, "hi": True, "adv": True,
                          "off": row.get(o_k), "offRk": adv_ranks[o_k].get(tid),
                          "def": row.get(d_k), "defRk": adv_ranks[d_k].get(tid)})
        for key, label, _, _, _, hi in METRICS:
            stats.append({"k": key, "l": label, "hi": hi,
                          "off": _r(off_m[tid][key]), "offRk": stat_ranks[("off", key)].get(tid),
                          "def": _r(def_m[tid][key]), "defRk": stat_ranks[("def", key)].get(tid)})

        out = {
            "season": season, "fbsTeams": n,   # no timestamp: unchanged teams stay byte-identical "hfa": round(hfa, 2),
            "meta": {**info, "mascot": t.get("name"), "color": t.get("color"), "alt": t.get("alternateColor"),
                     "coach": " ".join(x for x in (coach.get("firstName"), coach.get("lastName")) if x) or None,
                     "venue": home_venue},
            "rating": {k: row[k] for k in ("rank", "net", "off", "def", "sos", "prior", "w", "l", "cw", "cl")}
                      | {"offRk": rk["off"].get(tid), "defRk": rk["def"].get(tid), "sosRk": rk["sos"].get(tid)},
            "history": [{"wk": lbl, "net": round(nets[tid], 1), "rank": rks[tid]} for lbl, nets, rks in snaps],
            "schedule": sched, "outlook": outlook, "stats": stats, "roster": players,
        }
        with open(os.path.join(OUTDIR, f"{tid}.json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
    print(f"wrote {len(teams)} team files to {OUTDIR} ({len(snaps) - 1} weekly snapshots)")
