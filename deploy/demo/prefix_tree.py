"""Copy a site checkout into a /demo/ publish tree.

Source HTML keeps root paths so production tests stay the same. The published
copy prefixes those paths, sets the bjj-base meta, and turns waiver flags on
only in the published JSON. The git checkout is not modified.
"""

import argparse
import json
import os
import re
import shutil

SKIP_DIRS = {".git", "server", "tests", "deploy", "node_modules", "__pycache__", ".cursor"}
TEXT_EXT = {".html", ".js", ".css", ".webmanifest"}

ATTR_RE = re.compile(
    r"""(\b(?:href|src|action|poster)\s*=\s*)(["'])(/(?!/)[^"']*)\2""",
    re.IGNORECASE,
)
SRCSET_RE = re.compile(
    r"""(\bsrcset\s*=\s*)(["'])([^"']*)\2""",
    re.IGNORECASE,
)
LOC_RE = re.compile(
    r"""((?:window\.)?location(?:\s*\.\s*(?:href|replace|assign))?\s*(?:=\s*|\(\s*))(["'])(/(?!/)[^"']*)\2"""
)
META_RE = re.compile(
    r"""(<meta\s+name=["']bjj-base["']\s+content=["'])[^"']*(["'])""",
    re.IGNORECASE,
)
OG_RE = re.compile(
    r"""(<meta\s+property=["']og:(?:url|image)["']\s+content=["'])https://bjj\.bettrbook\.com(/[^"']*)?(["'])""",
    re.IGNORECASE,
)
# Root paths the published copy must keep under /demo/. Comparison needles
# (startsWith, indexOf, ===) and base + "/app" stay as written: the running
# page already adds the prefix, and rewriting them would double it.
SITE_PATH_RE = re.compile(
    r"""(["'`])(/(?!/)[^"'`\\\n]*)\1"""
)
SKIP_FILE_PREFIXES = ("vendor/",)
SKIP_FILE_NAMES = {"sw.js"}


def prefix_url(url, base):
    if not isinstance(url, str) or not url.startswith("/") or url.startswith("//"):
        return url
    if url == base or url.startswith(base + "/"):
        return url
    return base + url


def prefix_srcset(value, base):
    return re.sub(
        r"(^|,\s*)(/[^\s,]+)",
        lambda match: match.group(1) + prefix_url(match.group(2), base),
        value,
    )


def prefix_attributes(text, base):
    def attr(match):
        return match.group(1) + match.group(2) + prefix_url(match.group(3), base) + match.group(2)

    def srcset(match):
        return match.group(1) + match.group(2) + prefix_srcset(match.group(3), base) + match.group(2)

    text = SRCSET_RE.sub(srcset, text)
    return ATTR_RE.sub(attr, text)


def prefix_locations(text, base):
    def repl(match):
        return match.group(1) + match.group(2) + prefix_url(match.group(3), base) + match.group(2)

    return LOC_RE.sub(repl, text)


def is_site_path(url):
    """True for a root path that is a page, asset, or API on this site."""
    if not isinstance(url, str) or not url.startswith("/") or url.startswith("//"):
        return False
    path = url.split("?", 1)[0].split("#", 1)[0]
    if path == "/demo" or path.startswith("/demo/"):
        return True
    name = path[1:]
    head = name.split("/", 1)[0]
    heads = {
        "api", "app", "kids", "waiver", "privacy", "coloring", "login", "calendar",
        "css", "img", "icons", "fonts", "sheets", "js", "vendor",
    }
    exact = {
        "adult-class.json", "waiver-config.json", "manifest.webmanifest",
        "offline.html", "favicon.ico", "pwa.js", "bjj-base.js", "robots.txt",
        "sw.js", "index.html",
    }
    if head in heads or name in exact:
        return True
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+", name))


def skip_site_literal(text, start, end, url):
    """Leave strings that are path checks or already joined to the demo base."""
    before = text[max(0, start - 80):start]
    if re.search(r"(?:base|workerBase|prefix)\s*\+\s*$", before):
        return True
    if re.search(r"(?:startsWith|endsWith|indexOf)\(\s*$", before):
        return True
    if re.search(r"(?:===|!==)\s*$", before):
        return True
    if url == "/" and re.match(r"\s*:", text[end:end + 8]):
        return True
    bare = url.split("?", 1)[0]
    if bare == "/sw.js" and re.search(r"\bswPath\s*=\s*$", before):
        return True
    return False


def prefix_script_urls(text, base):
    """Prefix fetch, href, and other site-path strings in a published copy."""

    def repl(match):
        url = match.group(2)
        if not is_site_path(url):
            return match.group(0)
        if skip_site_literal(text, match.start(), match.end(), url):
            return match.group(0)
        quote = match.group(1)
        return quote + prefix_url(url, base) + quote

    return SITE_PATH_RE.sub(repl, text)


def prefix_og(html, base):
    def repl(match):
        path = match.group(2) or "/"
        return match.group(1) + "https://bjj.bettrbook.com" + prefix_url(path, base) + match.group(3)

    return OG_RE.sub(repl, html)


def set_base_meta(html, base):
    if META_RE.search(html):
        return META_RE.sub(lambda match: match.group(1) + base + match.group(2), html, count=1)
    return html.replace("<head>", '<head>\n  <meta name="bjj-base" content="%s">' % base, 1)


def transform(rel, text, base):
    ext = os.path.splitext(rel)[1].lower()
    if ext == ".html":
        text = set_base_meta(text, base)
        text = prefix_og(text, base)
        text = prefix_attributes(text, base)
        text = prefix_locations(text, base)
        return prefix_script_urls(text, base)
    if ext == ".js":
        text = prefix_locations(text, base)
        rel_key = rel.replace("\\", "/")
        if os.path.basename(rel_key) in SKIP_FILE_NAMES or rel_key.startswith(SKIP_FILE_PREFIXES):
            return text
        return prefix_script_urls(text, base)
    if ext == ".css":
        return re.sub(
            r"""url\((['"]?)(/[^)'"]+)\1\)""",
            lambda match: "url(%s%s%s)" % (match.group(1), prefix_url(match.group(2), base), match.group(1)),
            text,
        )
    if ext == ".webmanifest":
        data = json.loads(text)
        for key in ("id", "start_url", "scope"):
            if key in data:
                data[key] = prefix_url(data[key], base)
        for icon in data.get("icons") or []:
            if "src" in icon:
                icon["src"] = prefix_url(icon["src"], base)
        return json.dumps(data, indent=2) + "\n"
    return text


def publish(source, dest_root, base="/demo"):
    """Write source into dest_root + base. Returns the publish directory."""
    base = "/" + base.strip("/")
    publish_dir = os.path.join(os.path.abspath(dest_root), base.strip("/"))
    if os.path.realpath(source) == os.path.realpath(publish_dir):
        raise SystemExit("Refusing to publish a tree onto itself.")
    parent = os.path.realpath(dest_root)
    prod = os.path.realpath("/srv/bjj-planner")
    if parent == prod or os.path.realpath(publish_dir).startswith(prod + os.sep):
        raise SystemExit("Refusing to publish into the production checkout.")
    if os.path.isdir(publish_dir):
        shutil.rmtree(publish_dir)
    os.makedirs(publish_dir, exist_ok=True)

    for dirpath, dirnames, filenames in os.walk(source):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS and not name.endswith(".db")]
        rel_dir = os.path.relpath(dirpath, source)
        if rel_dir == ".":
            rel_dir = ""
        target_dir = os.path.join(publish_dir, rel_dir)
        os.makedirs(target_dir, exist_ok=True)
        for name in filenames:
            if name.endswith((".db", ".sqlite", ".sqlite3")):
                continue
            src = os.path.join(dirpath, name)
            rel = os.path.join(rel_dir, name) if rel_dir else name
            dest = os.path.join(publish_dir, rel)
            ext = os.path.splitext(name)[1].lower()
            if ext in TEXT_EXT:
                with open(src, encoding="utf-8") as handle:
                    text = handle.read()
                with open(dest, "w", encoding="utf-8") as handle:
                    handle.write(transform(rel, text, base))
            else:
                shutil.copy2(src, dest)

    config_path = os.path.join(publish_dir, "waiver-config.json")
    with open(config_path, "w", encoding="utf-8") as handle:
        json.dump({"waiverSubmissionsEnabled": True, "waitlistEnabled": True}, handle, indent=2)
        handle.write("\n")
    return publish_dir


def main(argv=None):
    parser = argparse.ArgumentParser(description="Publish a /demo/ tree from a checkout.")
    parser.add_argument("source")
    parser.add_argument("dest_root")
    parser.add_argument("--base", default="/demo")
    args = parser.parse_args(argv)
    path = publish(args.source, args.dest_root, args.base)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
