"""build_ol_notes.py — offensive-line starters BY POSITION (LT/LG/C/RG/RT) from school game notes.

ESPN only tells us which five linemen started, never where. Most schools' weekly game notes carry
a "game-by-game starters" table (LT LG C RG RT per game). We read it only from schools whose
robots.txt lets automated clients reach both the schedule page and /documents/
(scripts/ol_notes/census.py writes that list; most SIDEARM-hosted sites disallow /documents/,
so they are left out on purpose).

For each allowed school: collect links to notes PDFs (schedule page + any "game notes" hub page
it links) -> newest first, open up to MAX_TRIES PDFs -> the first with a starters table wins ->
rows matched to that team's games by opponent name -> five names matched to the roster's OL.

Writes public/data/ol_positions.json:
  {tid: {"source": pdf_url, "notes": "Game Notes", "games": {game_id: {"LT": pid, ...}}}}
A team with no readable table is simply absent. Cached per PDF URL, so a weekly run costs a
couple of page fetches per school plus one new PDF.

  python3 scripts/build_ol_notes.py [-v]
"""
import hashlib, io, json, os, re, sys, urllib.request, urllib.robotparser
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "cache")
OUT = os.path.join(ROOT, "public", "data", "ol_positions.json")
CENSUS = os.path.join(ROOT, "scripts", "ol_notes", "census.json")
UA = "TheDepthChartCFB/1.0 (+https://www.thedepthchartcfb.com)"
SLOTS = ("LT", "LG", "C", "RG", "RT")
HEAD = {"LT": "LT", "LOT": "LT", "LG": "LG", "LOG": "LG", "C": "C", "OC": "C", "RG": "RG", "ROG": "RG", "RT": "RT", "ROT": "RT"}
SUFFIX = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}
OL_POS = {"OL", "OT", "OG", "G", "C", "T", "IOL"}
MAX_TRIES = 6
VERBOSE = "-v" in sys.argv
A = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S | re.I)


def fetch(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 " + UA}), timeout=30) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def allowed(rp_cache, url):
    m = re.match(r"https?://[^/]+", url)
    if not m:
        return False
    host = m.group(0)
    if "storage.googleapis.com" in host:
        return True   # the school's own file host (WMT sites); their page linked it to us
    if host not in rp_cache:
        rp = urllib.robotparser.RobotFileParser()
        try:
            rp.parse(fetch(host + "/robots.txt").splitlines())
        except Exception:
            rp.parse([])
        rp_cache[host] = rp
    return rp_cache[host].can_fetch(UA, url)


def anchors(html, base):
    for href, inner in A.findall(html):
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>|<!--.*?-->", " ", inner)).strip()
        href = href.replace("&amp;", "&")
        if href.startswith("/"):
            href = base + href
        yield text, href


def wmt_links(base, rp):
    """WMT sites: every game's links (notes, stats...) from the site's own schedule API."""
    api = base + "/website-api"
    if not allowed(rp, api + "/sports"):
        return []
    try:
        sports = json.loads(fetch(api + "/sports?per_page=100"))["data"]
        sid = next(x["id"] for x in sports if x.get("slug") == "football")
        out = []
        for q in ("past%5D=true&sort=-datetime&per_page=6", "upcoming%5D=true&sort=datetime&per_page=2"):
            evs = json.loads(fetch(f"{api}/schedule-events?filter%5Bschedule.sport_id%5D={sid}&filter%5B{q}&include=scheduleEventLinks"))["data"]
            for e in evs:
                for l in e.get("schedule_event_links") or []:
                    if re.search(r"notes", l.get("title") or "", re.I) and l.get("link"):
                        link = l["link"] if l["link"].startswith("http") else base + "/" + l["link"].lstrip("/")
                        out.append((e["datetime"][:10], l["title"], link))
        # notes posted as news articles ("LSU week game notes and press conference")
        arts = json.loads(fetch(f"{api}/articles?filter%5Bsport_id%5D={sid}&sort=-published_at&per_page=40"))["data"]
        for a in arts[:40]:
            link = a.get("permalink") or ""
            if re.search(r"notes", link) and allowed(rp, link):
                try:
                    for text, href in anchors(fetch(link), base):
                        if re.search(r"\.pdf|/documents/", href) and (re.search(r"notes", text, re.I) or "storage.googleapis" in href):
                            out.append(((a.get("published_at") or "")[:10], text or "Game Notes", href))
                except Exception:
                    pass
        return [(t, u) for _, t, u in sorted(out)]
    except Exception:
        return []


def candidates(base, rp):
    """[(label, pdf_or_doc_url)] notes links, oldest -> newest, pregame notes before postgame."""
    seen, found, hubs = set(), [], []
    for t, u in wmt_links(base, rp):
        if u not in seen:
            seen.add(u)
            found.append((t, u))
    for path in ("/sports/football/schedule", "/sports/football"):
        url = base + path
        if not allowed(rp, url):
            continue
        try:
            html = fetch(url)
        except Exception:
            continue
        for text, href in anchors(html, base):
            if not re.search(r"notes", text, re.I) or href in seen:
                continue
            seen.add(href)
            if re.search(r"\.pdf|/documents/", href, re.I):
                found.append((text, href))
            elif re.search(r"game-notes|notes", href, re.I) and href.startswith(base):
                hubs.append(href)
        if found or hubs:
            break
    try:
        tid_hubs = json.load(open(os.path.join(ROOT, "scripts", "ol_notes", "hubs.json"))).get(TID.get(base), [])
    except (OSError, ValueError):
        tid_hubs = []
    for hub in tid_hubs + hubs[:3]:          # e.g. /iowa-football-game-notes-2026, a news post with the PDF
        if not allowed(rp, hub):
            continue
        try:
            html = fetch(hub)
        except Exception:
            continue
        for text, href in anchors(html, base):
            if href not in seen and re.search(r"\.pdf|/documents/", href, re.I):
                seen.add(href)
                found.append((text or "notes", href))
    pre = [f for f in found if not re.search(r"post", f[0], re.I)]
    post = [f for f in found if re.search(r"post", f[0], re.I)]
    return post + pre   # tried from the end: newest pregame notes first


def dated(url):
    m = re.search(r"/(20\d\d)/(\d\d)/(\d\d)/", url)
    return m.group(0) if m else ""


def resolve(url, rp):
    """A WMT /documents/<uuid>.pdf is an HTML page wrapping the real file on Google storage."""
    if "/documents/" in url and not url.endswith(".pdf"):
        pass
    if "storage.googleapis.com" in url:
        return url
    if not allowed(rp, url):
        return None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 " + UA}), timeout=30) as r:
            ctype = r.headers.get("content-type", "")
            if "pdf" in ctype:
                return url
            html = r.read().decode("utf-8", "replace")
    except Exception:
        return None
    # the page also carries site-wide footer PDFs (annual report...); the document itself is
    # the file the page references most
    from collections import Counter
    c = Counter(re.findall(r'https://storage\.googleapis\.com/[^"\' ]+\.pdf', html))
    return c.most_common(1)[0][0] if c else None


_resolve_path = os.path.join(CACHE, "olnotes_resolve.json")
try:
    _resolve_cache = json.load(open(_resolve_path))
except (OSError, ValueError):
    _resolve_cache = {}


def resolve_cached(url, rp):
    """/documents/<uuid> links never change target, so the lookup is cached."""
    if url not in _resolve_cache:
        _resolve_cache[url] = resolve(url, rp)
    return _resolve_cache[url]


def pdf_pages(url):
    path = os.path.join(CACHE, "olnotes_" + hashlib.md5(url.encode()).hexdigest()[:16] + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    from pypdf import PdfReader
    try:
        pages = [p.extract_text() or "" for p in PdfReader(io.BytesIO(fetch(url, binary=True))).pages]
    except Exception as e:
        pages = []
        if VERBOSE:
            print("   unreadable", url, e)
    json.dump(pages, open(path, "w"))
    return pages


def last_name(full):
    parts = [p for p in re.split(r"[\s,]+", full) if p and p.lower().strip(".") not in {x.strip(".") for x in SUFFIX}]
    return (parts[-1] if parts else full).lower().replace("’", "'")


def clean(tok):
    """'C.Luniewski' -> ('c', 'luniewski'); 'Jones' -> (None, 'jones')."""
    m = re.match(r"^([A-Z])\.\s?(.+)$", tok)
    return (m.group(1).lower(), m.group(2).lower().replace("’", "'")) if m else (None, tok.lower().replace("’", "'"))


def header_slots(toks):
    """Slot order for a starters-table header line, or None. Accepts LT/LG/C/RG/RT (and LOT/ROG...)
    or the bare OT OG C OG OT form (read left to right)."""
    idx = [(i, HEAD[t]) for i, t in enumerate(toks) if t in HEAD]
    got = {s for _, s in idx}
    if got >= set(SLOTS) and len(toks) > 5:
        first = {}
        for i, s in idx:
            first.setdefault(s, i)
        return sorted(SLOTS, key=first.get), max(first.values()) == len(toks) - 1
    tg = [t for t in toks if t in ("OT", "T", "OG", "G", "C")]
    if len(toks) > 5 and [t.lstrip("O") for t in tg[:5]] == ["T", "G", "C", "G", "T"]:
        last = [i for i, t in enumerate(toks) if t in ("OT", "T", "OG", "G", "C")][4] == len(toks) - 1
        return list(SLOTS), last
    return None


NAME_TOK = re.compile(r"(?:[A-Z]\.\s?)?[A-Z][A-Za-z'’\-]+(?:\s(?:Jr\.?|Sr\.?|II|III|IV))?")


def per_game_table(pages, lastnames):
    """Game-by-game starters, rows = games: [(row_label, {slot: (initial, last)})]."""
    for text in pages:
        lines = text.split("\n")
        for i, ln in enumerate(lines):
            hs = header_slots(ln.split())
            if not hs:
                continue
            order, ol_last = hs
            rows = []
            for row in lines[i + 1:i + 25]:
                if header_slots(row.split()):
                    break                                   # next table (e.g. last season's)
                toks = [clean(t) for t in re.findall(r"(?:[A-Z]\.\s?)?[A-Za-z'’\-]+", row)]
                # five consecutive tokens, at least four of them known linemen (a starter missing
                # from ESPN's roster fills the gap as a bare name)
                wins = [i for i in range(len(toks) - 4) if sum(t[1] in lastnames for t in toks[i:i + 5]) >= 4
                        and toks[i][1] in lastnames and toks[i + 4][1] in lastnames]
                if wins:
                    w = wins[-1] if ol_last else wins[0]
                    rows.append((row.strip(), dict(zip(order, toks[w:w + 5]))))
            if rows:
                return rows
    return []


def transposed_table(pages, lastnames):
    """Rows = positions, columns = games ('LT Jones Jones Borjon ...'): [(None, {slot: name})] per game."""
    for text in pages:
        lines = [l.split() for l in text.split("\n")]
        for i in range(len(lines) - 4):
            block = lines[i:i + 5]
            if [HEAD.get(l[0]) if l else None for l in block] != list(SLOTS):
                continue
            cols = []
            for l in block:
                toks = [clean(t) for t in re.findall(r"(?:[A-Z]\.\s?)?[A-Za-z'’\-]+", " ".join(l[1:]))]
                cols.append([t for t in toks if t[1] in lastnames])
            n = min(len(c) for c in cols)
            if n and max(len(c) for c in cols) == n:
                return [(None, {s: cols[k][j] for k, s in enumerate(SLOTS)}) for j in range(n)]
    return []


def depth_chart(pages, ol):
    """Listed depth chart ('LT 68 Reese Osei-Wusu 6-2 ...'): {slot: player} for the first-teamers,
    full-name matches only."""
    full = {re.sub(r"[^a-z]", "", p["name"].lower()): p for p in ol}
    for text in pages:
        if not re.search(r"depth chart", text, re.I):
            continue
        got = {}
        for ln in text.split("\n"):
            m = re.match(r"^\s*(LT|LG|C|RG|RT|LOT|LOG|ROG|ROT)\s+\d{1,2}\s+(.+)$", ln)
            if not m or HEAD[m.group(1)] in got:
                continue
            words = re.findall(r"[A-Za-z'’\-\.]+", m.group(2))
            for k in (4, 3, 2):
                key = re.sub(r"[^a-z]", "", "".join(words[:k]).lower())
                if key in full:
                    got[HEAD[m.group(1)]] = full[key]
                    break
        if len(got) == 5 and len({p["id"] for p in got.values()}) == 5:
            return got
    return None


def norm(s):
    return re.sub(r"[^a-z]", "", s.lower().replace("state", "st").replace("&", ""))


def match_games(rows, games):
    """Pair each table row with a game: by opponent name in the row label, else by position."""
    out, used = {}, set()
    for i, (label, slots) in enumerate(rows):
        lab = norm(label or "")
        hit = next((g for g in games if label and g["id"] not in used and norm(g["oppName"])[:6] in lab), None)
        if hit is None and i < len(games) and games[i]["id"] not in used:
            hit = games[i]
        if hit:
            used.add(hit["id"])
            out[hit["id"]] = slots
    return out


def espn_ol_starters(gid, tid, ol_ids):
    p = os.path.join(CACHE, f"gameroster_{gid}_{tid}.json")
    if not os.path.exists(p):
        return set()
    return {str(e["playerId"]) for e in json.load(open(p)).get("entries", []) if e.get("starter") and str(e["playerId"]) in ol_ids}


def resolve_slots(slots, by_last, espn):
    """(initial, last) per slot -> player id; ties broken by ESPN's starters for that game, then initial."""
    out, unknown = {}, 0
    for s, (ini, last) in slots.items():
        c = by_last.get(last, [])
        if not c:
            unknown += 1
            out[s] = "?" + last.title()     # starter not on ESPN's roster: name only
            continue
        if len(c) > 1 and espn:
            c = [p for p in c if p["id"] in espn] or c
        if len(c) > 1 and ini:
            c = [p for p in c if p["name"][:1].lower() == ini] or c
        if len(c) != 1:
            return None
        out[s] = c[0]["id"]
    return out if len(set(out.values())) == 5 and unknown <= 1 else None


TID = {}


def school(r):
    tid, base = r["tid"], r["final"].rstrip("/")
    TID[base] = tid
    rp = {}
    try:
        team = json.load(open(os.path.join(ROOT, "public", "data", "players", f"{tid}.json")))
    except OSError:
        return tid, None, "no player file"
    ol = [p for p in team["players"] if p.get("pos") in OL_POS]
    if len(ol) < 8:   # ESPN sometimes mislabels a whole line (San Diego State: listed as LB)
        ol = [p for p in team["players"] if p.get("id")]
    ol_ids = {p["id"] for p in ol}
    by_last = {}
    for p in ol:
        by_last.setdefault(last_name(p["name"]), []).append(p)
    games = [g for g in team.get("games", [])]
    cands = candidates(base, rp)
    resolved = []
    for i, (label, url) in enumerate(cands):
        pdf = resolve_cached(url, rp)
        if pdf:
            resolved.append((dated(pdf), i, label, pdf))
    resolved.sort(reverse=True)            # newest file first (Google-storage paths carry the date)
    tried, depth = 0, None
    for _, _, label, pdf in resolved:
        if tried >= MAX_TRIES:
            break
        tried += 1
        pages = pdf_pages(pdf)
        rows = per_game_table(pages, by_last) or transposed_table(pages, by_last)
        if rows:
            res = {}
            for gid, slots in match_games(rows, games).items():
                got = resolve_slots(slots, by_last, espn_ol_starters(gid, tid, ol_ids))
                if got:
                    res[gid] = got
            if res:
                return tid, {"kind": "starters", "source": pdf, "notes": label[:40], "games": res}, f"{len(res)} games (starters table)"
        if depth is None:
            d = depth_chart(pages, ol)
            if d:
                depth = {"kind": "depth", "source": pdf, "notes": label[:40], "asOf": dated(pdf).strip("/").replace("/", "-") or None,
                         "depth": {s: p["id"] for s, p in d.items()}}
    if depth:
        return tid, depth, "listed depth chart"
    return tid, None, f"nothing usable ({len(cands)} notes links, {tried} PDFs read)"


def main():
    census = [r for r in json.load(open(CENSUS)) if r.get("allowed") and all(r["allowed"].values())]
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(school, census))
    json.dump(_resolve_cache, open(_resolve_path, "w"))
    out = {tid: v for tid, v, _ in results if v}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    for tid, v, why in sorted(results, key=lambda x: x[1] is None):
        print(f"  {tid:>5} {'OK ' if v else '-- '} {why}")
    print(f"ol_positions: {len(out)} of {len(census)} allowed schools have OL starters by position")
    return out


if __name__ == "__main__":
    main()
