"""Fail when a published /demo/ tree links outside /demo/.

External sites (Lebre, Realm, YouTube, maps, and any other host) are allowed.
mailto and tel are allowed. Root paths, same-site URLs, and relative links that
resolve above /demo/ are not.

The service worker keeps logical paths such as /kids/ and prefixes them at
runtime with absAsset when the worker is /demo/sw.js. Those table entries are
not navigations. A location or fetch string in sw.js still has to stay in /demo/.
"""

import importlib.util
import json
import os
import re
import sys
import tempfile
from urllib.parse import urljoin, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ORIGIN = "https://bjj.bettrbook.com"
OWN_HOSTS = {"bjj.bettrbook.com", "www.bjj.bettrbook.com"}

ATTR_RE = re.compile(
    r"""\b(?:href|src|action|poster)\s*=\s*(["'])(.*?)\1""",
    re.IGNORECASE | re.DOTALL,
)
SRCSET_RE = re.compile(r"""\bsrcset\s*=\s*(["'])(.*?)\1""", re.IGNORECASE | re.DOTALL)
CSS_URL_RE = re.compile(r"""url\(\s*(['"]?)([^)'"]+)\1\s*\)""", re.IGNORECASE)
NAV_RE = re.compile(
    r"""(?:(?:window\.)?location(?:\s*\.\s*(?:href|replace|assign))?|\.href)\s*(?:=\s*|\(\s*)(["'`])(.*?)\1"""
)
FETCH_RE = re.compile(r"""\bfetch\(\s*(["'`])(.*?)\1""")
HTTP_RE = re.compile(r"""(["'])(https?://[^"']+)\1""")


def _prefix_mod():
    spec = importlib.util.spec_from_file_location(
        "prefix_tree", os.path.join(HERE, "prefix_tree.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PREFIX = _prefix_mod()


def _page_for(rel):
    rel = rel.replace("\\", "/")
    if rel.endswith("/index.html"):
        rel = rel[: -len("index.html")]
    elif rel == "index.html":
        rel = ""
    if rel and not rel.endswith("/") and not os.path.splitext(rel)[1]:
        rel += "/"
    return ORIGIN + "/demo/" + rel


def _srcset(value):
    urls = []
    for part in value.split(","):
        bits = part.strip().split()
        if bits:
            urls.append(bits[0])
    return urls


def _ignored(raw):
    text = (raw or "").strip()
    if not text or text.startswith("#"):
        return True
    lower = text.lower()
    return lower.startswith(("mailto:", "tel:", "sms:", "data:", "blob:", "javascript:"))


def escapes(page, raw, base="/demo"):
    """True when raw, resolved from page, leaves the demo prefix."""
    if _ignored(raw):
        return False
    absolute = urljoin(page, raw.strip())
    parsed = urlparse(absolute)
    host = (parsed.hostname or "").lower()
    if parsed.scheme in ("http", "https") and host and host not in OWN_HOSTS:
        return False
    if parsed.scheme not in ("http", "https", ""):
        return False
    path = parsed.path or "/"
    base = "/" + base.strip("/")
    return not (path == base or path.startswith(base + "/"))


def _literals(text):
    found = []
    for match in PREFIX.SITE_PATH_RE.finditer(text):
        url = match.group(2)
        if not PREFIX.is_site_path(url):
            continue
        if PREFIX.skip_site_literal(text, match.start(), match.end(), url):
            continue
        found.append(url)
    return found


def _nav_and_fetch(text):
    found = []
    for pattern in (NAV_RE, FETCH_RE):
        for match in pattern.finditer(text):
            found.append(match.group(2))
    return found


def issues_in(rel, text, base="/demo"):
    """Return 'rel -> url' lines for links that leave /demo/."""
    rel = rel.replace("\\", "/")
    page = _page_for(rel)
    problems = []
    seen = set()

    def add(raw):
        if raw in seen:
            return
        seen.add(raw)
        if escapes(page, raw, base):
            problems.append("%s -> %s" % (rel, raw))

    if os.path.basename(rel) == "sw.js":
        if "function absAsset" not in text or "workerBase" not in text:
            problems.append(rel + " -> service worker does not prefix its asset paths")
        for raw in _nav_and_fetch(text):
            add(raw)
        return problems

    if rel.endswith(".html"):
        for match in ATTR_RE.finditer(text):
            add(match.group(2))
        for match in SRCSET_RE.finditer(text):
            for url in _srcset(match.group(2)):
                add(url)
    if rel.endswith(".css") or rel.endswith(".html"):
        for match in CSS_URL_RE.finditer(text):
            add(match.group(2))
    if rel.endswith(".webmanifest"):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            problems.append(rel + " -> manifest is not json")
            return problems
        for key in ("id", "start_url", "scope"):
            if key in data:
                add(data[key])
        for icon in data.get("icons") or []:
            if icon.get("src"):
                add(icon["src"])
        return problems
    if rel.endswith(".js") or rel.endswith(".html"):
        for raw in _literals(text):
            add(raw)
        for raw in _nav_and_fetch(text):
            add(raw)
        for match in HTTP_RE.finditer(text):
            add(match.group(2))
    return problems


def crawl(publish_dir, base="/demo"):
    problems = []
    for dirpath, dirnames, filenames in os.walk(publish_dir):
        dirnames[:] = [name for name in dirnames if name != "vendor"]
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext not in {".html", ".js", ".css", ".webmanifest"}:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, publish_dir)
            with open(full, encoding="utf-8") as handle:
                text = handle.read()
            problems.extend(issues_in(rel, text, base))
    return problems


def mirror_problems(publish_dir):
    """The published tree has to include every public and staff page."""
    problems = []

    def slurp(rel):
        path = os.path.join(publish_dir, rel)
        if not os.path.isfile(path):
            problems.append("missing " + rel)
            return ""
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    home = slurp("index.html")
    if home and 'class="kids-pill" href="/demo/kids/"' not in home:
        problems.append("adult home is missing the Grace BJJ Kids button")
    if home and "Grace BJJ Kids" not in home:
        problems.append("adult home is missing the Grace BJJ Kids label")
    for rel in (
        "kids/index.html",
        "waiver/index.html",
        "kids/waiver/index.html",
        "privacy/index.html",
        "coloring/index.html",
        "login/index.html",
        "app/index.html",
        "app/waitlist/index.html",
        "app/waivers/index.html",
    ):
        slurp(rel)
    kids = slurp("kids/index.html")
    if kids and 'href="/demo/kids/waiver/"' not in kids:
        problems.append("kids page does not link to the kids waiver")
    waiver_js = slurp("waiver/waiver.js")
    if waiver_js and "bjj-demo-states" not in waiver_js:
        problems.append("kids waiver cannot switch cap and waitlist states")
    if waiver_js and "3–6 Mighty Mites" not in waiver_js:
        problems.append("kids waiver does not name the split waitlists")
    login = slurp("login/index.html")
    if login and 'window.location.href = "/demo/app/"' not in login:
        problems.append("login does not stay in /demo/app/")
    app = slurp("app/index.html")
    if app and "Check-in" not in app:
        problems.append("staff app is missing check-in")
    if app and "/demo/vendor/qrcode-generator/qrcode.js" not in app:
        problems.append("staff app is missing the QR card script")
    app_js = slurp("js/app.js")
    if app_js and '" of "' not in app_js:
        problems.append("roster is missing the X of 12 line")
    if app_js and 'link.href = "/demo/app/waitlist/"' not in app_js:
        problems.append("staff waitlist link leaves /demo/")
    wait = slurp("app/waitlist/index.html")
    if wait and 'data-filter="mite"' not in wait:
        problems.append("waitlist is missing the 3–6 view")
    if wait and 'data-filter="upper"' not in wait:
        problems.append("waitlist is missing the 7–10 view")
    if wait and ">All<" not in wait:
        problems.append("waitlist is missing the All view")
    pwa = slurp("pwa.js")
    if pwa and "base + swPath" not in pwa:
        problems.append("service worker registration is not prefixed")
    return problems


def self_check():
    """Return failures of the crawler's own examples."""
    failures = []

    def expect(rel, text, bad):
        got = issues_in(rel, text)
        if bad and not got:
            failures.append("allowed an escape in " + text)
        if not bad and got:
            failures.append("flagged a safe link: " + "; ".join(got))

    expect("index.html", '<a href="/kids/">Kids</a>', True)
    expect("index.html", '<a href="/">Home</a>', True)
    expect("index.html", '<a href="https://bjj.bettrbook.com/">Live</a>', True)
    expect("index.html", '<a href="https://bjj.bettrbook.com/kids/">Live kids</a>', True)
    expect("js/app.js", 'link.href = "/app/waitlist/";', True)
    expect("app/waitlist/index.html", 'csvLink.href = "/api/waitlist.csv?group=" + filter;', True)
    expect("index.html", 'location.replace("/kids/#" + id);', True)
    expect("index.html", '<a class="kids-pill" href="/demo/kids/">Grace BJJ Kids</a>', False)
    expect("index.html", '<a href="https://bjj.bettrbook.com/demo/">Demo</a>', False)
    expect("index.html", '<a href="https://lebrejiujitsu.com">Lebre</a>', False)
    expect("index.html", '<a href="https://onrealm.org/GBCSalem/-/form/give/BJJ">Give</a>', False)
    expect("kids/index.html", '<a href="https://www.youtube.com/watch?v=QPy386CpuQg">Video</a>', False)
    expect(
        "kids/index.html",
        '<a href="https://www.google.com/maps/search/?api=1&amp;query=Grace+Baptist+Church">Map</a>',
        False,
    )
    expect("privacy/index.html", '<a href="mailto:dits%2Bbjj@mail.grokbot.com">Email</a>', False)
    expect("js/app.js", 'link.href = "/demo/app/waitlist/";', False)
    expect(
        "sw.js",
        'function absAsset(path) {}\nconst workerBase = "/demo";\n"/kids/",\n"/index.html",',
        False,
    )
    expect(
        "sw.js",
        'function absAsset(path) {}\nconst workerBase = "/demo";\nlocation.href = "/kids/";',
        True,
    )
    expect("sw.js", '"/kids/"', True)
    expect("pwa.js", 'var swPath = "/sw.js";\nif (base) swPath = base + swPath;', False)
    expect("css/splash.css", 'src: url("/fonts/LuckiestGuy-Regular.ttf")', True)
    expect("css/splash.css", 'src: url("/demo/fonts/LuckiestGuy-Regular.ttf")', False)
    expect("css/styles.css", 'src: url("../fonts/LuckiestGuy-Regular.ttf")', False)
    return failures


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--self-check" in argv:
        failures = self_check()
        if failures:
            print("\n".join(failures))
            return 1
        print("demo crawl self-check passed")
        return 0
    if "--publish" in argv:
        argv.remove("--publish")
        if len(argv) != 2:
            print("usage: crawl_links.py --publish SOURCE DEST_ROOT", file=sys.stderr)
            return 2
        published = PREFIX.publish(argv[0], argv[1], "/demo")
        problems = mirror_problems(published) + crawl(published)
        if problems:
            print("\n".join(problems))
            return 1
        print("demo crawl passed (%s)" % published)
        return 0
    if len(argv) != 1:
        print("usage: crawl_links.py PUBLISH_DIR | --self-check | --publish SOURCE DEST", file=sys.stderr)
        return 2
    problems = mirror_problems(argv[0]) + crawl(argv[0])
    if problems:
        print("\n".join(problems))
        return 1
    print("demo crawl passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
