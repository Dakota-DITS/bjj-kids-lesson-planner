/* Every HTML page must tell crawlers not to index the site. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const robotsMeta = '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">';
const googleMeta = '<meta name="googlebot" content="noindex, nofollow">';

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "vendor") continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
}

const pages = [];
walk(root, pages);
assert.ok(pages.length >= 12, "expected the site HTML pages");

pages.forEach((full) => {
  const rel = path.relative(root, full);
  const html = fs.readFileSync(full, "utf8");
  assert.ok(html.includes(robotsMeta), rel + " is missing the robots noindex meta");
  assert.ok(html.includes(googleMeta), rel + " is missing the googlebot noindex meta");
  assert.equal(/rel=["']canonical["']/i.test(html), false, rel + " has a canonical link");
  assert.equal(/application\/ld\+json/i.test(html), false, rel + " has search structured data");
  assert.equal(/sitemap/i.test(html), false, rel + " mentions a sitemap");
});

const robotsPath = path.join(root, "robots.txt");
assert.ok(fs.existsSync(robotsPath), "robots.txt is missing");
const robots = fs.readFileSync(robotsPath, "utf8");
assert.ok(robots.includes("User-agent: *\nDisallow: /"), "robots.txt must disallow the whole site");
assert.equal(fs.existsSync(path.join(root, "sitemap.xml")), false, "sitemap.xml must not exist");
assert.equal(fs.existsSync(path.join(root, "sitemap_index.xml")), false);

const nginx = fs.readFileSync(path.join(root, "deploy/nginx-bjj.conf"), "utf8");
assert.equal(/sitemap/i.test(nginx), false, "nginx must not advertise a sitemap");

console.log("noindex checks passed");
