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

console.log("contrast checks passed");
