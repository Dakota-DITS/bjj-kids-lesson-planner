/* Staff assets must not be edge-cacheable, and HTML must version every script and stylesheet. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const VERSION = "20261021-17";
const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function linkedAssets(html) {
  const hrefs = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  return hrefs.filter((url) => /\.(?:js|css)(?:\?|$)/.test(url));
}

const pages = ["index.html", "login/index.html", "coloring/index.html", "app/index.html"];
pages.forEach((rel) => {
  const html = read(rel);
  const assets = linkedAssets(html);
  assert.ok(assets.length, `${rel} links no js or css`);
  assets.forEach((url) => {
    assert.ok(url.includes(`?v=${VERSION}`), `${rel} asset ${url} is not versioned ${VERSION}`);
  });
});

const nginx = read("deploy/nginx-bjj.conf");
assert.ok(nginx.includes('location /js/'), "nginx is missing /js/");
assert.ok(nginx.includes('add_header Cache-Control "private, no-store" always;'), "gated files need private, no-store");
const jsBlock = nginx.split("location /js/")[1].split("location ")[0];
assert.ok(jsBlock.includes("private, no-store"), "/js/ must be private, no-store");
assert.ok(jsBlock.includes("auth_request"), "/js/ stays behind login");
const stylesBlock = nginx.split("location = /css/styles.css")[1].split("location ")[0];
assert.ok(stylesBlock.includes("private, no-store"), "staff css must be private, no-store");
const splashBlock = nginx.split("location = /css/splash.css")[1].split("location ")[0];
assert.ok(splashBlock.includes('Cache-Control "no-cache"'), "public css must revalidate");
const rootBlock = nginx.split("\n    location / {")[1];
assert.ok(rootBlock.includes('Cache-Control "no-cache"'), "public HTML must revalidate");
assert.ok(!nginx.includes("max-age=14400"), "nginx must not send the Cloudflare 4-hour cache");
assert.ok(nginx.includes(`?v=${VERSION}`), "nginx should name the asset version the HTML uses");
assert.ok(nginx.includes('X-Content-Type-Options "nosniff"'), "nginx needs nosniff");
assert.ok(nginx.includes('X-Frame-Options "SAMEORIGIN"'), "nginx needs a frame policy");
assert.ok(nginx.includes("Content-Security-Policy"), "nginx needs a content security policy");
assert.ok(nginx.includes("Referrer-Policy"), "nginx needs a referrer policy");
assert.ok(nginx.includes("listen 80 default_server;"), "this site is the default server on port 80");
assert.ok(nginx.includes("location ~ /\\.git { return 404; }"), "nginx must not serve .git");

console.log("asset cache checks passed");
