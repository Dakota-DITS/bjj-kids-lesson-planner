/* Contrast for the staff calendar, tabs, age control, and potty notice. */
const assert = require("assert");
const fs = require("fs");
const css = fs.readFileSync(require("path").join(__dirname, "../css/styles.css"), "utf8");

function channel(hex, i) {
  const value = parseInt(hex.slice(i, i + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const raw = hex.replace("#", "");
  return 0.2126 * channel(raw, 0) + 0.7152 * channel(raw, 2) + 0.0722 * channel(raw, 4);
}

function contrast(fore, back) {
  const lighter = Math.max(luminance(fore), luminance(back));
  const darker = Math.min(luminance(fore), luminance(back));
  return (lighter + 0.05) / (darker + 0.05);
}

function atLeast(name, fore, back, min) {
  const ratio = contrast(fore, back);
  assert.ok(ratio >= min, name + " is " + ratio.toFixed(2) + ":1, needs " + min + ":1");
}

assert.ok(css.includes("display: flex"), "view tabs share one row");
assert.ok(!css.includes("repeat(3, minmax(0, 1fr))"), "phone tabs no longer leave an empty cell");
assert.ok(css.includes("#calendarView .field label { color: #3f3a36; }"));
assert.ok(css.includes("background: #fff7ed"));
assert.ok(css.includes("border: 2px solid #c2410c"));
assert.ok(css.includes("color: #595959"));

atLeast("calendar label", "#3f3a36", "#fffdf8", 4.5);
atLeast("calendar card text", "#1c1917", "#ffffff", 4.5);
atLeast("skipped card text", "#1c1917", "#fff7ed", 4.5);
atLeast("placeholder", "#595959", "#ffffff", 4.5);
atLeast("placeholder on skipped card", "#595959", "#fff7ed", 4.5);
atLeast("input border", "#44403c", "#ffffff", 3);
atLeast("input border on sheet", "#44403c", "#fffdf8", 3);
atLeast("skip border", "#c2410c", "#fff7ed", 3);
atLeast("skip border on sheet", "#c2410c", "#fffdf8", 3);
atLeast("primary button", "#fff7ed", "#9f1239", 4.5);
atLeast("hint", "#4a4a4a", "#fffdf8", 4.5);
atLeast("tab text", "#f5f0e8", "#0c0a09", 4.5);
atLeast("selected tab text", "#f5f0e8", "#9f1239", 4.5);
atLeast("tab border on sidebar", "#a8a29e", "#292524", 3);
atLeast("age border on panel", "#a8a29e", "#1c1917", 3);
atLeast("potty text", "#fff7ed", "#292524", 4.5);
atLeast("potty border on panel", "#a8a29e", "#1c1917", 3);
atLeast("potty fill on check-in form", "#292524", "#ffffff", 3);

const homeCss = fs.readFileSync(require("path").join(__dirname, "../css/home.css"), "utf8");
assert.ok(homeCss.includes("--text: #f5f0e8"));
assert.ok(homeCss.includes("--bg: #1c1917"));
assert.ok(homeCss.includes("--red: #9b2a12"));
atLeast("home text", "#f5f0e8", "#1c1917", 4.5);
atLeast("home text on card", "#f5f0e8", "#292524", 4.5);
atLeast("home muted", "#d6d3d1", "#1c1917", 4.5);
atLeast("home link", "#ffd7cc", "#1c1917", 4.5);
atLeast("home link on card", "#ffd7cc", "#292524", 4.5);
atLeast("home nav on bar", "#f5f0e8", "#141210", 4.5);
atLeast("home button", "#fff7ed", "#9b2a12", 4.5);
atLeast("home card border", "#a8a29e", "#1c1917", 3);
atLeast("kids site nav", "#f5f0e8", "#1c1917", 4.5);
atLeast("kids pill text", "#1c1917", "#fff7ed", 4.5);
atLeast("kids pill on bar", "#fff7ed", "#141210", 3);
atLeast("kids pill hover text", "#1c1917", "#ffd7cc", 4.5);
atLeast("home pill text", "#1c1917", "#fff7ed", 4.5);
atLeast("home pill on kids bar", "#fff7ed", "#1c1917", 3);
atLeast("waiver text", "#1c1917", "#fff8f3", 4.5);
atLeast("waiver muted", "#3f3a36", "#fff8f3", 4.5);
atLeast("waiver link", "#7c210e", "#fff8f3", 4.5);
atLeast("waiver button", "#fff7ed", "#9b2a12", 4.5);
atLeast("waiver closed", "#fff7ed", "#292524", 4.5);
atLeast("waiver border", "#44403c", "#fff8f3", 3);
atLeast("staff waiver link", "#ffd7cc", "#1c1917", 4.5);
atLeast("waitlist banner", "#fff7ed", "#9b2a12", 4.5);
assert.ok(css.includes(".waitlist-banner"));
assert.ok(css.includes("background: #9b2a12"));
assert.ok(homeCss.includes("min-height: 44px"));
const splashCss = fs.readFileSync(require("path").join(__dirname, "../css/splash.css"), "utf8");
assert.ok(splashCss.includes("min-height: 44px"));
const headerCss = fs.readFileSync(require("path").join(__dirname, "../css/site-header.css"), "utf8");
assert.ok(headerCss.includes(".kids-pill"));
assert.ok(headerCss.includes(".site-nav .home-pill"));
assert.ok(headerCss.includes("scroll-padding-top"));
assert.ok(headerCss.includes("max-width: 800px"));

console.log("contrast checks passed");
