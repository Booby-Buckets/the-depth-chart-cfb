"""build_hub.py — builds data/hub.json, the CFB home page's power rankings + this week's slate.

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
import json, os, sys, math, time, urllib.request, urllib.error, datetime
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "cache")
OUT = os.path.join(ROOT, "data", "hub.json")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# site.web.api answers from GitHub Actions runners; site.api 403s them
ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football"
ESPN_WEB = "https://site.web.api.espn.com/apis/v2/sports/football/college-football"
CFBD = "https://api.collegefootballdata.com"
HFA_PRIOR = 2.5         # home-field points, also solved for
MARGIN_SD = 14.0        # CFB game margin sd around the spread -> win prob
BLOWOUT_AT, BLOWOUT_KEEP = 24, 0.35
PRIOR_REGRESS = 0.40
PRIOR_GAMES = 3.0       # prior is worth ~this many games of evidence
RATING_SD0 = 6.0        # preseason rating error (pts); shrinks as sqrt(PRIOR_GAMES / (PRIOR_GAMES + games))
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
def season_games(season, finished_season):
    """All FBS-involved games for a season. finished_season=True caches forever."""
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
    for w in weeks:
        start = datetime.datetime.fromisoformat(w["start"].replace("Z", "+00:00"))
        end = datetime.datetime.fromisoformat(w["end"].replace("Z", "+00:00"))
        done = finished_season or end < now - datetime.timedelta(days=2)
        soon = start < now + datetime.timedelta(days=8)
        # finished weeks never change; this week's scores refresh fast; far-future schedules twice a day
        d = get(f"{ESPN}/scoreboard?groups=80&seasontype={w['type']}&week={w['week']}&dates={season}&limit=400",
                f"sb_{season}_{w['type']}_{w['week']}.json", max_age=None if done else 1800 if soon else 12 * 3600)
        for ev in d.get("events", []):
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


def main():
    today = datetime.date.today()
    season = int(sys.argv[1]) if len(sys.argv) > 1 else (today.year if today.month >= 7 else today.year - 1)

    teams = fbs_teams(season)
    print(f"{season}: {len(teams)} FBS teams")
    if len(teams) < 120:
        sys.exit(f"Refusing to write: only {len(teams)} FBS teams found (expected ~138).")

    # prior from last season's final ratings
    prev_teams = fbs_teams(season - 1)
    prev_games, _ = season_games(season - 1, finished_season=True)
    prev, _, _ = solve(prev_games, prev_teams)
    prior = {}
    for t, r in prev.items():
        if t in teams:
            prior[t] = {"off": r["off"] * (1 - PRIOR_REGRESS), "def": r["def"] * (1 - PRIOR_REGRESS), "net": r["net"] * (1 - PRIOR_REGRESS)}

    games, weeks = season_games(season, finished_season=False)
    fbs_games = [g for g in games if g["home"] in teams or g["away"] in teams]
    rat, mu, hfa = solve(fbs_games, teams, prior)
    adv = cfbd_advanced(season, teams)

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
    rank_of = {r["id"]: r["rank"] for r in rows}

    # this week's slate: the earliest week that still has unplayed FBS games
    upcoming = [g for g in fbs_games if not g["completed"]]
    slate, slate_label = [], None
    if upcoming:
        first = min(upcoming, key=lambda g: g["date"])
        wk = (first["type"], first["week"])
        slate_label = first["weekLabel"]
        for g in sorted([g for g in fbs_games if (g["type"], g["week"]) == wk], key=lambda g: g["date"]):
            hk, ak = (g["home"] if g["home"] in teams else "FCS"), (g["away"] if g["away"] in teams else "FCS")
            h, a = rat[hk], rat[ak]
            spread = h["net"] - a["net"] + (0 if g["neutral"] else hfa)
            slate.append({
                "id": g["id"], "date": g["date"], "neutral": g["neutral"], "completed": g["completed"], "detail": g["detail"],
                "tv": g["tv"], "home": g["home"], "away": g["away"], "homeName": g["homeName"], "awayName": g["awayName"],
                "homeRank": rank_of.get(g["home"]), "awayRank": rank_of.get(g["away"]),
                "hs": g["hs"], "as": g["as"],
                "spread": round(spread, 1), "homeWin": round(win_prob(spread, game_sd(rat, hk, ak)), 3),
                "total": round(2 * mu + h["off"] - a["def"] + a["off"] - h["def"], 1),
            })

    # sanity: ratings must look like CFB point margins
    spread_net = max(r["net"] for r in rows) - min(r["net"] for r in rows)
    if not (25 < spread_net < 90):
        sys.exit(f"Refusing to write: implausible rating spread {spread_net:.1f}")

    out = {
        "season": season, "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
        "gamesPlayed": sum(1 for g in fbs_games if g["completed"]), "hfa": round(hfa, 2), "ptsAvg": round(mu, 1),
        "hasAdvanced": bool(adv), "slateLabel": slate_label, "teams": rows, "slate": slate,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(rows)} teams, {out['gamesPlayed']} games, slate {slate_label} ({len(slate)} games), HFA {hfa:.2f}")
    from build_teams import build_team_files
    rosters = build_team_files({
        "get": get, "ESPN": ESPN, "outdir": os.path.join(ROOT, "data", "teams"), "season": season, "built": out["built"],
        "teams": teams, "rows": rows, "games": fbs_games, "rat": rat, "hfa": hfa, "mu": mu, "prior": prior,
        "solve": solve, "win_prob": win_prob, "compress": compress,
        "rating_sd": rating_sd, "margin_sd": MARGIN_SD,
    })
    from build_players import build_player_files
    build_player_files({
        "root": ROOT, "season": season, "teams": teams, "rows": rows, "rosters": rosters, "cfbd_get": cfbd_get,
        "games": fbs_games, "get": get,
    })
    # sitemap: home, directories, every team page, every player with stats
    site = "https://www.thedepthchartcfb.com"
    urls = [f"{site}/", f"{site}/team.html", f"{site}/depth.html", f"{site}/players.html"] \
        + [f"{site}/team.html?id={r['id']}" for r in rows] + [f"{site}/depth.html?id={r['id']}" for r in rows]
    try:
        urls += [f"{site}/player.html?id={pid}&t={tid}" for pid, _, tid, _ in json.load(open(os.path.join(ROOT, "data", "players", "index.json")))]
    except (OSError, ValueError):
        pass
    with open(os.path.join(ROOT, "sitemap.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        f.writelines(f"  <url><loc>{u.replace('&', '&amp;')}</loc></url>\n" for u in urls)
        f.write("</urlset>\n")
    for r in rows[:15]:
        print(f"{r['rank']:>3} {r['name']:<22} {r['w']}-{r['l']}  net {r['net']:+.1f}  off {r['off']:+.1f}  def {r['def']:+.1f}  prior {r['prior']}")


if __name__ == "__main__":
    main()
