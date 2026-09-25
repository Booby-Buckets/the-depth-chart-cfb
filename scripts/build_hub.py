"""build_hub.py — builds public/data/hub.json, the CFB home page's power rankings + this week's slate.

  python3 scripts/build_hub.py                 # current season, games from ESPN (no key)
  CFBD_KEY=... python3 scripts/build_hub.py    # + CFBD advanced stats (EPA/play, success rate)

Rating model (the "TDC Rating"): an opponent-adjusted points model solved by ridge
least squares.  For every FBS game  pts_for = mu + Off[team] - Def[opp] (+/- HFA/2),
so Net = Off + Def is a neutral-field point margin vs an average FBS team.
  - Blowouts are compressed (margin beyond 24 counts 35%) so garbage time and
    cupcake scores don't set the ranking.
  - FCS opponents share one pooled "FCS" team.
  - Early season, every team is pulled toward a prior = last season's final
    rating regressed 40% to the mean; the pull fades as games are played.
Raw feeds are cached in scripts/cache/ so re-runs are cheap.
"""
import json, os, re, sys, math, time, statistics, unicodedata, urllib.request, urllib.error, datetime
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "cache")
OUT = os.path.join(ROOT, "public", "data", "hub.json")   # served at /data/hub.json
os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# site.web.api answers from GitHub Actions runners; site.api 403s them
ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football"
ESPN_WEB = "https://site.web.api.espn.com/apis/v2/sports/football/college-football"
CFBD = "https://api.collegefootballdata.com"
HFA_PRIOR = 2.5         # home-field points, also solved for
MARGIN_SD = 14.5        # CFB game margin sd around the spread -> win prob (backtested, spread_model.py)
BLOWOUT_AT, BLOWOUT_KEEP = 24, 0.35
PRIOR_REGRESS = 0.40
PRIOR_GAMES = 4.0       # prior is worth ~this many games of evidence
RATING_SD0 = 4.5        # preseason rating error (pts); shrinks as sqrt(PRIOR_GAMES / (PRIOR_GAMES + games))
FCS_SD = 9.0            # pooled FCS "team" hides a wide spread of opponents
CONF_SHORT = {"acc": "ACC", "sec": "SEC", "big10": "Big Ten", "big12": "Big 12", "American": "American",
              "usa": "CUSA", "midam": "MAC", "mwest": "Mountain West", "pac12": "Pac-12", "belt": "Sun Belt",
              "ind": "Independent"}


def get(url, cache_name=None, max_age=None, headers=None):
    path = os.path.join(CACHE, cache_name) if cache_name else None
    if path and os.path.exists(path) and (max_age is None or time.time() - os.path.getmtime(path) < max_age):
        with open(path) as f:
            return json.load(f)
    for attempt in range(3):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if attempt == 2:
                raise
            if e.code == 403 and "espn.com" in url:   # the other ESPN host usually answers
                a, b = "://site.web.api.espn.com", "://site.api.espn.com"
                url = url.replace(a, b) if a in url else url.replace(b, a)
            time.sleep(2)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)
    if path:
        with open(path, "w") as f:
            json.dump(data, f)
    return data


# ---------- teams ----------
def fbs_teams(season):
    d = get(f"{ESPN_WEB}/standings?group=80&season={season}", f"standings_{season}.json", max_age=6 * 3600)
    teams = {}

    def walk(node, conf):
        conf = conf or {"abbr": node.get("abbreviation"), "name": node.get("name")}
        for e in node.get("standings", {}).get("entries", []):
            t = e["team"]
            teams[t["id"]] = {
                "id": t["id"], "name": t.get("location") or t["displayName"], "full": t["displayName"],
                "abbr": t.get("abbreviation"), "conf": CONF_SHORT.get(conf["abbr"], conf["name"].replace(" Conference", "")),
                "confAbbr": conf["abbr"],
                "logo": (t.get("logos") or [{}])[0].get("href") or f"https://a.espncdn.com/i/teamlogos/ncaa/500/{t['id']}.png",
            }
        for k in node.get("children", []):
            walk(k, conf)

    for c in d.get("children", []):
        walk(c, None)
    return teams


# ---------- games ----------
def season_games(season, finished_season, group=80):
    """All FBS-involved games for a season (group=81: FCS games instead). finished_season=True caches forever."""
    sb = get(f"{ESPN}/scoreboard?groups=80&dates={season}&limit=1", f"cal_{season}.json",
             max_age=None if finished_season else 6 * 3600)
    cal = sb["leagues"][0]["calendar"]
    games, weeks = [], []
    for block in cal:
        stype = int(block.get("value", 2))
        if stype not in (2, 3):
            continue
        for w in block.get("entries", []):
            wk = int(w["value"])
            weeks.append({"type": stype, "week": wk, "label": w.get("label"), "start": w.get("startDate"), "end": w.get("endDate")})
    now = datetime.datetime.now(datetime.timezone.utc)
    seen = set()
    for w in weeks:
        start = datetime.datetime.fromisoformat(w["start"].replace("Z", "+00:00"))
        end = datetime.datetime.fromisoformat(w["end"].replace("Z", "+00:00"))
        done = finished_season or end < now - datetime.timedelta(days=2)
        soon = start < now + datetime.timedelta(days=8)
        # finished weeks never change; this week's scores refresh fast; far-future schedules twice a day
        d = get(f"{ESPN}/scoreboard?groups={group}&seasontype={w['type']}&week={w['week']}&dates={season}&limit=400",
                f"sb{'' if group == 80 else group}_{season}_{w['type']}_{w['week']}.json", max_age=None if done else 1800 if soon else 12 * 3600)
        for ev in d.get("events", []):
            if not ev.get("id") or not ev.get("competitions"):
                continue  # ESPN occasionally returns an empty placeholder event (2014 week 1)
            if ev["id"] in seen:
                continue  # ESPN lists playoff games under both the "Bowls" and "CFP" weeks
            seen.add(ev["id"])
            c = ev["competitions"][0]
            side = {x["homeAway"]: x for x in c["competitors"]}
            if "home" not in side or "away" not in side:
                continue
            st = c["status"]["type"]
            games.append({
                "id": ev["id"], "date": ev["date"], "type": w["type"], "week": w["week"], "weekLabel": w["label"],
                "neutral": bool(c.get("neutralSite")), "completed": bool(st.get("completed")),
                "state": st.get("state"), "detail": st.get("shortDetail"),
                "home": side["home"]["team"]["id"], "away": side["away"]["team"]["id"],
                "homeName": side["home"]["team"].get("location"), "awayName": side["away"]["team"].get("location"),
                "hs": int(side["home"]["score"]) if st.get("completed") else None,
                "as": int(side["away"]["score"]) if st.get("completed") else None,
                "tv": ((c.get("broadcasts") or [{}])[0].get("names") or [None])[0],
                "conf": bool(c.get("conferenceCompetition")),
                "venue": (c.get("venue") or {}).get("fullName"),
            })
    return games, weeks


# ---------- rating ----------
def compress(a, b):
    """Shrink blowout margins: keep the loser's score, pull the winner's toward BLOWOUT_AT."""
    m = a - b
    if abs(m) <= BLOWOUT_AT:
        return a, b
    extra = (abs(m) - BLOWOUT_AT) * (1 - BLOWOUT_KEEP)
    return (a - extra, b) if m > 0 else (a, b - extra)


def solve(games, teams, prior=None):
    ids = list(teams) + ["FCS"]
    ix = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    rows, y = [], []
    played = {t: 0 for t in ids}
    for g in games:
        if not g["completed"]:
            continue
        h = g["home"] if g["home"] in teams else "FCS"
        a = g["away"] if g["away"] in teams else "FCS"
        if h == a:
            continue
        hs, as_ = compress(g["hs"], g["as"])
        loc = 0.0 if g["neutral"] else 0.5
        # cols: [Off(n), Def(n), mu, hfa]
        for team, opp, pts, sgn in ((h, a, hs, 1), (a, h, as_, -1)):
            r = np.zeros(2 * n + 2)
            r[ix[team]] = 1; r[n + ix[opp]] = -1; r[2 * n] = 1; r[2 * n + 1] = sgn * loc
            rows.append(r); y.append(pts)
        played[h] += 1; played[a] += 1
    X, y = np.array(rows), np.array(y, float)
    # ridge toward the prior (per-team strength), plus a weak pull on mu/hfa
    lam = np.zeros(2 * n + 2); target = np.zeros(2 * n + 2)
    for t, i in ix.items():
        p = (prior or {}).get(t)
        lam[i] = lam[n + i] = PRIOR_GAMES if t != "FCS" else 1.0
        if p:
            target[i], target[n + i] = p["off"], p["def"]
        elif t != "FCS":
            target[i] = target[n + i] = -4.0   # unknown FBS team (new/transition): below average
    lam[2 * n] = 1e-3; target[2 * n] = 28.0
    lam[2 * n + 1] = 400.0; target[2 * n + 1] = HFA_PRIOR
    A = X.T @ X + np.diag(lam)
    b = X.T @ y + lam * target
    beta = np.linalg.solve(A, b)
    off, dfn = beta[:n], beta[n:2 * n]
    # centre on the FBS average so 0 = average FBS team
    fbs = [ix[t] for t in teams]
    off -= off[fbs].mean(); dfn -= dfn[fbs].mean()
    out = {t: {"off": float(off[i]), "def": float(dfn[i]), "net": float(off[i] + dfn[i]), "gp": played[t]} for t, i in ix.items()}
    return out, float(beta[2 * n]), float(beta[2 * n + 1])


def rating_sd(r, tid):
    return FCS_SD if tid == "FCS" else RATING_SD0 * math.sqrt(PRIOR_GAMES / (PRIOR_GAMES + r["gp"]))


def slugify(s):
    """URL slug, identical to lib/slug.ts: strip accents and apostrophes, lowercase, dash the rest."""
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not 0x300 <= ord(c) <= 0x36F).lower()
    s = re.sub(r"[&'’ʻ]", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def win_prob(spread, sd=MARGIN_SD):
    return 0.5 * (1 + math.erf(spread / (sd * math.sqrt(2))))


def game_sd(rat, a, b):
    """Game-margin sd: on-field noise plus both teams' rating uncertainty."""
    return math.sqrt(MARGIN_SD ** 2 + rating_sd(rat[a], a) ** 2 + rating_sd(rat[b], b) ** 2)


# ---------- CFBD advanced (optional) ----------
# CFBD's free tier is 1,000 calls/month and the pool is shared with the basketball site's
# CBBD scripts, so every feed is fetched at most once per CFBD_MAX_AGE and every consumer
# falls back to the last published data when a call fails (quota, network, no key).
CFBD_MAX_AGE = 20 * 3600
ADV_KEYS = ("oEPA", "dEPA", "oSR", "dSR", "oExpl", "dExpl")


def cfbd_get(path, cache_name, max_age=CFBD_MAX_AGE):
    """A CFBD feed, or None if it can't be had right now (caller falls back)."""
    key = (os.environ.get("CFBD_KEY") or "").strip()
    cached = os.path.join(CACHE, cache_name)
    if not key and not os.path.exists(cached):
        return None
    try:
        return get(f"{CFBD}/{path}", cache_name, max_age=max_age if key else None,
                   headers={"Authorization": "Bearer " + key} if key else None)
    except Exception as e:
        print(f"CFBD {path} unavailable ({e}); using last published data")
        return None


def cfbd_advanced(season, teams):
    adv = cfbd_get(f"stats/season/advanced?year={season}&excludeGarbageTime=true", f"cfbd_adv_{season}.json")
    if adv is None:
        # keep whatever the site already shows rather than dropping the columns
        try:
            prev = json.load(open(OUT))
            out = {t["id"]: {k: t[k] for k in ADV_KEYS if t.get(k) is not None} for t in prev["teams"]
                   if prev.get("season") == season and any(t.get(k) is not None for k in ADV_KEYS)}
        except (OSError, ValueError, KeyError):
            out = {}
        print(f"CFBD advanced stats: reused last published values for {len(out)} teams")
        return out
    by_name = {info["name"]: tid for tid, info in teams.items()}  # CFBD school == ESPN location
    out = {}
    for r in adv:
        tid = by_name.get(r.get("team"))
        if tid is None:
            continue
        o, d = r.get("offense") or {}, r.get("defense") or {}
        out[tid] = {"oEPA": o.get("ppa"), "dEPA": d.get("ppa"), "oSR": o.get("successRate"), "dSR": d.get("successRate"),
                    "oExpl": o.get("explosiveness"), "dExpl": d.get("explosiveness")}
    print(f"CFBD advanced stats: {len(out)}/{len(teams)} teams matched")
    return out


def rate_season(season, finished=False, with_cfbd=True):
    """Ratings, records and SOS for one season: the shared core of the live build and the
    history backfill (build_history.py). finished=True caches every week's scores forever."""
    teams = fbs_teams(season)
    print(f"{season}: {len(teams)} FBS teams")
    if len(teams) < 115:
        sys.exit(f"Refusing to write: only {len(teams)} FBS teams found for {season}.")

    games, weeks = season_games(season, finished_season=finished)
    fbs_games = [g for g in games if g["home"] in teams or g["away"] in teams]
    model_prior = os.path.join(ROOT, "scripts", f"model_prior_{season}.json")
    if os.path.exists(model_prior):
        # the backtested game model (spread_model.py): every FCS team rated, efficiency blend,
        # regression prior written by `model_backtest.py --write-prior <season>`
        prior, rat, mu, hfa, solve_fn = model_ratings(season, finished, teams, fbs_games, model_prior)
    else:
        # past seasons (build_history.py): the original points model, prior from last season
        prev_teams = fbs_teams(season - 1)
        prev_games, _ = season_games(season - 1, finished_season=True)
        prev, _, _ = solve(prev_games, prev_teams)
        prior = {}
        for t, r in prev.items():
            if t in teams:
                prior[t] = {"off": r["off"] * (1 - PRIOR_REGRESS), "def": r["def"] * (1 - PRIOR_REGRESS), "net": r["net"] * (1 - PRIOR_REGRESS)}
        rat, mu, hfa = solve(fbs_games, teams, prior)
        solve_fn = solve
    adv = cfbd_advanced(season, teams) if with_cfbd else {}

    # records + SOS (avg opponent net) from completed games
    rec = {t: {"w": 0, "l": 0, "cw": 0, "cl": 0, "opp": []} for t in teams}
    for g in fbs_games:
        if not g["completed"]:
            continue
        for me, op, ms, os_ in ((g["home"], g["away"], g["hs"], g["as"]), (g["away"], g["home"], g["as"], g["hs"])):
            if me not in teams:
                continue
            r = rec[me]
            win = ms > os_
            r["w" if win else "l"] += 1
            if g["conf"]:
                r["cw" if win else "cl"] += 1
            r["opp"].append(rat.get(op if op in teams else "FCS")["net"])

    rows = []
    for t, info in teams.items():
        r, rc = rat[t], rec[t]
        rows.append({
            **info, "net": round(r["net"], 1), "off": round(r["off"], 1), "def": round(r["def"], 1),
            "prior": round(prior[t]["net"], 1) if t in prior else None,
            "w": rc["w"], "l": rc["l"], "cw": rc["cw"], "cl": rc["cl"],
            "sos": round(sum(rc["opp"]) / len(rc["opp"]), 1) if rc["opp"] else None,
            **({k: (round(v, 3) if isinstance(v, float) else v) for k, v in adv.get(t, {}).items()}),
        })
    rows.sort(key=lambda r: -r["net"])
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    spread_net = max(r["net"] for r in rows) - min(r["net"] for r in rows)
    if not (25 < spread_net < 90):
        sys.exit(f"Refusing to write: implausible rating spread {spread_net:.1f} for {season}")
    return {"teams": teams, "prior": prior, "games": fbs_games, "rat": rat, "mu": mu, "hfa": hfa, "rows": rows, "adv": adv,
            "solve": solve_fn}


def model_ratings(season, finished, teams, fbs_games, prior_path):
    """Ratings from spread_model.fit, scaled by its k so a rating gap IS the neutral-site spread.
    Returns (prior, rat, mu, hfa, solve_fn); rat also holds every FCS opponent, plus "FCS" = their mean."""
    from spread_model import PARAMS, fit, attach_eff
    from build_pbp import load_plays
    from game_features import game_features
    P, k = PARAMS, PARAMS["k"]
    prior = json.load(open(prior_path))["prior"]
    ids = {g["id"] for g in fbs_games}
    fcs_games = [g for g in season_games(season, finished_season=finished, group=81)[0] if g["id"] not in ids]
    load_plays(get, fbs_games)                      # cached; main() reuses it
    attach_eff(fbs_games, game_features(season, fbs_games))

    def solve_fn(gs, teams_, prior_=None):
        last = max(((g["type"], g["week"]) for g in gs), default=(0, 0))
        done = [g for g in gs if g["completed"]] + [g for g in fcs_games if g["completed"] and (g["type"], g["week"]) <= last]
        r, mu_, hfa_ = fit(done, teams_, prior, P)
        for v in r.values():
            v["off"] *= k; v["def"] *= k; v["net"] *= k
        other = [v for t, v in r.items() if t not in teams_ and v["gp"] >= 2]
        r["FCS"] = {s: statistics.mean(v[s] for v in other) if other else -20.0 for s in ("off", "def", "net")} | {"gp": 0}
        return r, mu_, hfa_

    rat, mu, hfa = solve_fn(fbs_games, teams)
    shown = {t: {s: p[s] * k for s in ("off", "def", "net")} for t, p in prior.items() if t in teams}
    return shown, rat, mu, hfa, solve_fn


def team_rating(rat, tid):
    return rat.get(tid) or rat["FCS"]


def game_spread(rat, g, hfa):
    """Home team's expected margin. Bowls are pulled 25% toward even (opt-outs, coaching exits)."""
    d = team_rating(rat, g["home"])["net"] - team_rating(rat, g["away"])["net"]
    return d * (0.75 if g.get("type") == 3 else 1.0) + (0 if g["neutral"] else hfa)


def main():
    today = datetime.date.today()
    season = int(sys.argv[1]) if len(sys.argv) > 1 else (today.year if today.month >= 7 else today.year - 1)
    S = rate_season(season)
    teams, prior, fbs_games, rat, mu, hfa, rows, adv, solve_fn = (S[k] for k in ("teams", "prior", "games", "rat", "mu", "hfa", "rows", "adv", "solve"))

    rank_of = {r["id"]: r["rank"] for r in rows}

    # this week's slate: the earliest week that still has unplayed FBS games
    upcoming = [g for g in fbs_games if not g["completed"]]
    slate, slate_label = [], None
    if upcoming:
        first = min(upcoming, key=lambda g: g["date"])
        wk = (first["type"], first["week"])
        slate_label = first["weekLabel"]
        for g in sorted([g for g in fbs_games if (g["type"], g["week"]) == wk], key=lambda g: g["date"]):
            hk, ak = (g["home"] if g["home"] in rat else "FCS"), (g["away"] if g["away"] in rat else "FCS")
            h, a = rat[hk], rat[ak]
            spread = game_spread(rat, g, hfa)
            slate.append({
                "id": g["id"], "date": g["date"], "neutral": g["neutral"], "completed": g["completed"], "detail": g["detail"],
                "tv": g["tv"], "home": g["home"], "away": g["away"], "homeName": g["homeName"], "awayName": g["awayName"],
                "homeRank": rank_of.get(g["home"]), "awayRank": rank_of.get(g["away"]),
                "hs": g["hs"], "as": g["as"],
                "spread": round(spread, 1), "homeWin": round(win_prob(spread, game_sd(rat, hk, ak)), 3),
                "total": round(2 * mu + h["off"] - a["def"] + a["off"] - h["def"], 1),
            })

    out = {
        "season": season, "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
        "gamesPlayed": sum(1 for g in fbs_games if g["completed"]), "hfa": round(hfa, 2), "ptsAvg": round(mu, 1),
        "hasAdvanced": bool(adv), "slateLabel": slate_label, "teams": rows, "slate": slate,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(rows)} teams, {out['gamesPlayed']} games, slate {slate_label} ({len(slate)} games), HFA {hfa:.2f}")
    from build_teams import build_team_files
    # play-by-play for every completed game: loaded once, shared by the advanced stats and the
    # snap estimates (ESPN core API, cached forever once final)
    from build_pbp import load_plays
    from build_advanced import team_advanced, rank_teams
    plays = load_plays(get, fbs_games)
    team_adv = rank_teams(team_advanced(fbs_games, plays, teams))
    from build_charting import chart_all
    team_chart, player_chart = chart_all(fbs_games, plays, teams)
    print(f"advanced: {len(team_adv)} teams from {sum(1 for v in plays.values() if v)} games of play-by-play")

    rosters = build_team_files({
        "get": get, "ESPN": ESPN, "outdir": os.path.join(ROOT, "public", "data", "teams"), "season": season, "built": out["built"],
        "teams": teams, "rows": rows, "games": fbs_games, "rat": rat, "hfa": hfa, "mu": mu, "prior": prior,
        "solve": solve_fn, "win_prob": win_prob, "compress": compress, "game_spread": game_spread,
        "rating_sd": rating_sd, "margin_sd": MARGIN_SD, "team_adv": team_adv, "team_chart": team_chart,
    })
    from build_players import build_player_files
    build_player_files({
        "root": ROOT, "season": season, "teams": teams, "rows": rows, "rosters": rosters, "cfbd_get": cfbd_get,
        "games": fbs_games, "get": get, "plays": plays, "player_chart": player_chart,
    })
    # sitemap: home, directories, every team + depth-chart page, every player with stats.
    # Slugs follow lib/slug.ts exactly (the Next.js pages 404 on anything else).
    site = "https://www.thedepthchartcfb.com"
    tslug, seen = {}, set()
    for r in rows:
        sl = slugify(r["name"])
        if sl in seen:
            sl = f"{sl}-{r['id']}"
        seen.add(sl)
        tslug[r["id"]] = sl
    urls = [f"{site}/", f"{site}/teams", f"{site}/depth", f"{site}/players", f"{site}/recruiting"] \
        + [f"{site}/teams/{tslug[r['id']]}" for r in rows] + [f"{site}/depth/{tslug[r['id']]}" for r in rows]
    # past seasons (scripts/build_history.py): rankings, leaderboards, every team's season
    seasons_dir = os.path.join(ROOT, "public", "data", "seasons")
    past = sorted((int(d) for d in os.listdir(seasons_dir) if d.isdigit()), reverse=True) if os.path.isdir(seasons_dir) else []
    if past:
        urls.append(f"{site}/seasons")
    for y in past:
        try:
            ph = json.load(open(os.path.join(seasons_dir, str(y), "hub.json")))
        except (OSError, ValueError):
            continue
        urls += [f"{site}/seasons/{y}", f"{site}/seasons/{y}/players"]
        pseen = set()
        for t in ph["teams"]:
            sl = slugify(t["name"])
            if sl in pseen:
                sl = f"{sl}-{t['id']}"
            pseen.add(sl)
            urls.append(f"{site}/seasons/{y}/teams/{sl}")
    try:
        urls += [f"{site}/players/{slugify(name) or 'player'}-{pid}"
                 for pid, name, _, _ in json.load(open(os.path.join(ROOT, "public", "data", "players", "index.json")))]
    except (OSError, ValueError):
        pass
    with open(os.path.join(ROOT, "public", "sitemap.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        f.writelines(f"  <url><loc>{u}</loc></url>\n" for u in urls)
        f.write("</urlset>\n")
    for r in rows[:15]:
        print(f"{r['rank']:>3} {r['name']:<22} {r['w']}-{r['l']}  net {r['net']:+.1f}  off {r['off']:+.1f}  def {r['def']:+.1f}  prior {r['prior']}")


if __name__ == "__main__":
    main()
