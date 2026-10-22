/* Combo class labels, multi-select controls, and printable safety note. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
const math = fs.readFileSync(path.join(root, "js/plan-math.js"), "utf8");

assert.ok(html.includes('aria-label="Age group. Choose one, or more than one for a combo class."'));
assert.ok(html.includes('data-group="mite" class="on" aria-pressed="true"'));
assert.ok(html.includes('data-group="upper" aria-pressed="false"'));
assert.equal(html.includes('data-group="peewee"'), false);
assert.equal(html.includes('data-group="junior"'), false);
assert.equal(html.includes('data-group="teen"'), false);
assert.ok(html.includes("Tap one group, or more than one for a combo class."));
assert.ok(js.includes("function toggleAgeGroup("));
assert.ok(js.includes("aria-pressed"));
assert.ok(js.includes("P.comboLabel("));
assert.ok(math.includes("Combo class:"));
assert.ok(js.includes("not in this combo class."));
assert.ok(js.includes("P.kidFitsClass("));
assert.ok(js.includes("P.olderVariationNote("));
assert.ok(js.includes("P.COMBO_SPARRING_SAFETY"));
assert.ok(js.includes('class="combo-note"'));
assert.ok(math.includes("Partner kids within their own age group and similar size. Never pair a 4–7 with an 8–10."));
assert.ok(css.includes(".combo-note"));
assert.ok(css.includes('body[data-print="lesson"] .combo-note'));
assert.ok(css.includes("min-height: 44px"));
assert.ok(css.includes(".seg.ages button:focus-visible"));

console.log("combo class checks passed");
