/* Opening prayer is the first block of every class and cannot be removed. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const data = fs.readFileSync(path.join(root, "js/data.js"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
const welcome = fs.readFileSync(path.join(root, "index.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const staff = fs.readFileSync(path.join(root, "app/index.html"), "utf8");

const prayerStart = data.indexOf("openingPrayer:");
assert.ok(prayerStart > 0, "opening prayer copy is missing");
const prayerBlock = data.slice(prayerStart, data.indexOf("wildReset:"));
const lines = [...prayerBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const thanks = lines.findIndex((line) => line.startsWith("Thank you, God, for this day."));
const gift = lines.findIndex((line) => line.includes("gift from you") && line.includes("never to hurt or show off"));
const needs = lines.findIndex((line) => line.includes("out sick"));
const amen = lines.findIndex((line) => line === "Amen.");
assert.ok(thanks >= 0 && gift > thanks && needs > gift && amen > needs, lines.join(" | "));
assert.ok(prayerBlock.includes("Gather the kids in close."));
assert.ok(lines.some((line) => line.includes("chance to learn jiu-jitsu")));

function placeOrder(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start >= 0 && end > start, startMark);
  const body = source.slice(start, end);
  const prayerAt = body.indexOf('placeItems("prayer"');
  const openingAt = body.indexOf('placeItems("opening"');
  assert.ok(prayerAt >= 0 && openingAt > prayerAt, startMark);
}

placeOrder(app, "function assembleGrace", "function assemble(");
placeOrder(app, "function assemble(", "function liveSparring");
assert.ok(app.includes('warmupMin: num("warmupMin", 0, 20, 3)'));
assert.ok(app.includes("Opening prayer"));
assert.ok(app.includes("Always first"));
assert.ok(app.includes('class="block prayer-block"'));
assert.ok(app.includes('section === "prayer"'));
assert.ok(!app.includes('searchField("prayer")'));
assert.ok(!app.includes('data-plan-toggle="prayer"'));
assert.ok(app.includes("Opens with a short prayer."));

assert.ok(css.includes("body[data-print=\"lesson\"] .prayer-block .item p.say"));
assert.ok(css.includes("display: block !important;"));

assert.ok(welcome.includes("Class opens with a short prayer, then warmup, base movements, technique, and play time."));
assert.ok(!welcome.includes("Class flow is warmup, base movements, technique, and play time."));
assert.ok(readme.includes("Every class opens with a short prayer"));
assert.ok(readme.includes("A fresh plan uses a 3 minute warm-up"));
assert.ok(staff.includes('id="warmupMin" type="number" min="0" max="20" step="0.5" value="3"'));
assert.ok(staff.includes("Opening prayer is always the first 2 minutes."));

console.log("opening prayer ok");
