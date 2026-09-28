"""fetch_prop_lines.py — sportsbook player prop lines for this week's FBS games (The Odds API).

ESPN doesn't carry college props, so book lines come from the-odds-api.com (the same service the
basketball site's Betting Lab uses). Needs ODDS_API_KEY in the environment (a GitHub secret in CI);
without it this exits quietly and the props page shows our projections at a line near our number.

Writes public/data/prop_lines.json = {"built", "credits_left", "lines": {"<player id>|<market>":
{"line", "over", "under", "book", "books"}}}: the median line across books and the best price for
each side. Players are matched by name within the two teams of each game.

Cost: one call for the event list (free) + one per game with props; the API charges per market
returned per region, so about 6 credits a game at most. ~60 games a week ≈ 360 credits a run.
"""
import json, os, re, statistics, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "public", "data")
OUT = os.path.join(DATA, "prop_lines.json")
API = "https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf"
MARKETS = {"player_pass_yds": "passYds", "player_pass_tds": "passTD", "player_rush_yds": "rushYds",
           "player_reception_yds": "recYds", "player_receptions": "rec", "player_anytime_td": "anyTD"}


def norm(s):
    s = (s or "").lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r), r.headers.get("x-requests-remaining")


def main():
    key = os.environ.get("ODDS_API_KEY")
    if not key:
        print("prop lines: no ODDS_API_KEY; skipping (the props page uses our own lines)")
        return
    hub = json.load(open(os.path.join(DATA, "hub.json")))
    # save credits: at most one pull per 12 hours, and only in the days before games
    built = json.load(open(OUT)).get("built", "") if os.path.exists(OUT) else ""   # (file times reset on checkout)
    if built > time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(time.time() - 12 * 3600)) and "--force" not in sys.argv:
        print("prop lines: pulled in the last 12 hours; skipping")
        return
    up = [x["date"] for x in hub["slate"] if not x["completed"]]
    if not up or min(up) > time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(time.time() + 4 * 86400)):
        print("prop lines: no games in the next 4 days; skipping")
        return
    full = {norm(t["full"]): t["id"] for t in hub["teams"]}
    slate = {(x["home"], x["away"]): x for x in hub["slate"] if not x["completed"]}
    roster = {}
    for tid in {t for k in slate for t in k}:
        p = os.path.join(DATA, "players", f"{tid}.json")
        if os.path.exists(p):
            roster[tid] = {norm(x["name"]): x["id"] for x in json.load(open(p))["players"] if x.get("name")}
    events, left = get(f"{API}/events?apiKey={key}")
    lines, calls, unmatched = {}, 0, 0
    for ev in events:
        h, a = full.get(norm(ev.get("home_team"))), full.get(norm(ev.get("away_team")))
        if (h, a) not in slate:
            continue
        q = urllib.parse.urlencode({"apiKey": key, "regions": "us", "markets": ",".join(MARKETS), "oddsFormat": "american"})
        try:
            d, left = get(f"{API}/events/{ev['id']}/odds?{q}")
        except Exception as e:
            print(f"prop lines: {ev.get('away_team')} @ {ev.get('home_team')} failed ({e})")
            continue
        calls += 1
        acc = {}
        for bk in d.get("bookmakers", []):
            for mk in bk.get("markets", []):
                m = MARKETS.get(mk.get("key"))
                for o in mk.get("outcomes", []):
                    who = norm(o.get("description"))
                    pid = roster.get(h, {}).get(who) or roster.get(a, {}).get(who)
                    if not pid:
                        unmatched += 1
                        continue
                    k = f"{pid}|{m}"
                    x = acc.setdefault(k, {"pts": [], "over": [], "under": [], "books": set()})
                    x["books"].add(bk.get("title"))
                    if o.get("point") is not None:
                        x["pts"].append(float(o["point"]))
                    side = (o.get("name") or "").lower()
                    if side in ("over", "yes"):
                        x["over"].append(o.get("price"))
                    elif side in ("under", "no"):
                        x["under"].append(o.get("price"))
        for k, x in acc.items():
            rec = {"books": len(x["books"])}
            if x["pts"]:
                rec["line"] = statistics.median(x["pts"])
            if x["over"]:
                rec["over"] = max(x["over"])
            if x["under"]:
                rec["under"] = max(x["under"])
            lines[k] = rec
        time.sleep(0.3)
    json.dump({"built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()), "credits_left": left, "lines": lines},
              open(OUT, "w"), separators=(",", ":"))
    print(f"prop lines: {len(lines)} player lines from {calls} games ({unmatched} book names unmatched); credits left {left}")


if __name__ == "__main__":
    main()
