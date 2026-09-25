"""census.py — which FBS athletics sites allow automated access to their game notes.

For every school in domains.json: homepage (to confirm the domain and detect the platform),
robots.txt checked with urllib.robotparser for our crawler name and "*", on the paths game
notes live under. Writes census.json.
"""
import json, os, re, urllib.request, urllib.robotparser
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "TheDepthChartCFB/1.0 (+https://www.thedepthchartcfb.com)"
PATHS = ("/sports/football/schedule", "/documents/x.pdf")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 " + UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def check(item):
    tid, dom = item
    out = {"tid": tid, "domain": dom}
    try:
        final, html = get(f"https://{dom}/")
        out["final"] = final
        out["title"] = (re.search(r"<title[^>]*>([^<]*)", html, re.I) or [None, ""])[1].strip()[:90]
        out["platform"] = ("sidearm" if re.search(r"sidearm", html, re.I) else
                           "wmt" if re.search(r"_nuxt|wmt|storage\.googleapis\.com/[a-z-]+-(com|prod)", html) else "other")
        host = re.match(r"https?://[^/]+", final).group(0)
        rp = urllib.robotparser.RobotFileParser()
        try:
            _, txt = get(host + "/robots.txt")
            rp.parse(txt.splitlines())
        except Exception:
            rp.parse([])
        out["allowed"] = {p: rp.can_fetch(UA, host + p) for p in PATHS}
    except Exception as e:
        out["error"] = str(e)[:120]
    return out


if __name__ == "__main__":
    doms = json.load(open(os.path.join(HERE, "domains.json")))
    with ThreadPoolExecutor(12) as ex:
        res = list(ex.map(check, doms.items()))
    json.dump(res, open(os.path.join(HERE, "census.json"), "w"), indent=1)
    from collections import Counter
    print(Counter((r.get("platform", "ERR"), all((r.get("allowed") or {}).values())) for r in res))
    for r in res:
        if "error" in r:
            print("ERR", r["tid"], r["domain"], r["error"])
