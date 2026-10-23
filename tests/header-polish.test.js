/* Slim header, kids lockup, and anchor offset. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const home = read("index.html");
const kids = read("kids/index.html");
const adultWaiver = read("waiver/index.html");
const kidsWaiver = read("kids/waiver/index.html");
const privacy = read("privacy/index.html");
const headerCss = read("css/site-header.css");
const nav = read("site-nav.js");
const waiverCss = read("css/waiver.css");

assert.equal(home.includes("<span>Grace BJJ</span>"), false);
assert.ok(home.includes('alt="Grace Jiu-Jitsu home"'));
assert.ok(home.includes('class="kids-pill" href="/kids/">Grace BJJ Kids</a>'));
assert.ok(home.includes('class="nav-toggle"'));
assert.ok(home.includes('aria-expanded="false"'));
assert.ok(home.includes('aria-controls="site-menu"'));
assert.ok(home.includes('id="site-menu"'));
assert.ok(kids.includes('alt="Grace Jiu-Jitsu Kids home"'));
assert.ok(kids.includes('src="/img/logo/grace-logo-kids-reversed-transparent.png"'));
assert.ok(kids.includes('src="/img/logo/grace-logo-kids-transparent.png"'));
assert.ok(kids.includes('class="home-pill" href="/">Grace BJJ</a>'));
assert.ok(kids.includes('<p class="eyebrow">Grace BJJ Kids</p>'));
assert.ok(kidsWaiver.includes('src="/img/logo/grace-logo-kids-reversed-transparent.png"'));
assert.ok(adultWaiver.includes('class="nav-toggle"'));
assert.ok(adultWaiver.includes('href="/kids/">Grace BJJ Kids</a>'));
assert.equal(adultWaiver.includes("splash.css"), false);
assert.ok(privacy.includes('alt="Grace Jiu-Jitsu home"'));
assert.equal(privacy.includes(">Grace BJJ</a>"), false);

assert.ok(headerCss.includes("scroll-padding-top"));
assert.ok(headerCss.includes("--demo-banner-h"));
assert.ok(headerCss.includes("--site-header-h"));
assert.ok(headerCss.includes("max-width: 800px"));
assert.ok(headerCss.includes("min-width: 801px") === false);
assert.ok(nav.includes('aria-expanded'));
assert.ok(nav.includes('button.focus()'));
assert.ok(nav.includes('event.key !== "Escape"'));
assert.ok(nav.includes("closest(\"a\")"));
assert.ok(read("bjj-base.js").includes("--demo-banner-h"));

assert.ok(waiverCss.includes('body[data-kind="adult"]'));
assert.ok(waiverCss.includes("background: #1c1917"));
assert.ok(waiverCss.includes("background: #9b2a12"));
assert.ok(waiverCss.includes("@media print"));
assert.ok(waiverCss.includes("background: #fff !important"));

for (const rel of [
  "img/logo/grace-logo-kids-transparent.png",
  "img/logo/grace-logo-kids-reversed-transparent.png",
  "img/logo/grace-logo-kids.svg",
  "img/logo/grace-logo-kids-reversed.svg"
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), rel);
}

const sw = read("sw.js");
assert.ok(sw.includes('"/css/site-header.css"'));
assert.ok(sw.includes('"/site-nav.js"'));
assert.ok(sw.includes('"/img/logo/grace-logo-kids-transparent.png"'));
assert.equal(sw.includes('"/js/site-nav.js"'), false);

console.log("header polish checks passed");
