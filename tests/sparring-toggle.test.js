/* Sparring defaults off for mites and for a stripe-less majority, and its minutes move to play. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const P = require("../js/plan-math.js");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");

const stripes = (n) => ({ stripes: n });

const mite = P.sparringDefault("mite", [stripes(2), stripes(2), stripes(1)]);
assert.strictEqual(mite.enabled, false);
assert.strictEqual(mite.reason, "Sparring off: 4–6 class");

const mostlyNew = P.sparringDefault("peewee", [stripes(0), stripes(0), stripes(1)]);
assert.strictEqual(mostlyNew.enabled, false);
assert.strictEqual(mostlyNew.reason, "Sparring off: most kids have no stripes yet");

const even = P.sparringDefault("peewee", [stripes(0), stripes(1)]);
assert.strictEqual(even.enabled, true, "exactly half with no stripes is not a majority");

const seasoned = P.sparringDefault("peewee", [stripes(1), stripes(2), stripes(0)]);
assert.strictEqual(seasoned.enabled, true);
assert.strictEqual(seasoned.reason, "");

const empty = P.sparringDefault("junior", []);
assert.strictEqual(empty.enabled, false);
assert.strictEqual(empty.reason, "Sparring off: no kids yet");

const oldMite = P.resolveSparring({ mode: "grace", settings: { ageGroup: "mite" } }, "mite", [stripes(3)]);
assert.strictEqual(oldMite.enabled, false);
assert.strictEqual(oldMite.choice, "default");
assert.strictEqual(oldMite.reason, "Sparring off: 4–6 class");

const byHand = {
  sparringChoice: "manual",
  sparringEnabled: true,
  settings: { ageGroup: "mite" },
};
const kept = P.resolveSparring(JSON.parse(JSON.stringify(byHand)), "mite", [stripes(0)]);
assert.strictEqual(kept.enabled, true);
assert.strictEqual(kept.choice, "manual");
assert.strictEqual(kept.reason, "");

const shape = {
  prayer: 120,
  opening: 120,
  warmup: 180,
  base: 240,
  lesson: 1200,
  water: 60,
  sparring: 360,
  game: 300,
  finish: 120,
};
const moved = P.applySparringTime(shape, false);
assert.strictEqual(moved.sparring, 0);
assert.strictEqual(moved.game, 660);
assert.strictEqual(shape.sparring, 360, "the request is not mutated");
const fit = P.fitClassTimes(P.coverOpeningPrayer(moved, 45 * 60), 45 * 60);
assert.strictEqual(fit.seconds.sparring, 0);
assert.strictEqual(fit.seconds.game, 11 * 60);
assert.strictEqual(fit.sum, 45 * 60);
assert.strictEqual(P.formatClock(17 * 60 + 30 + 45), "6:15");
const restored = P.applySparringTime(shape, true);
assert.strictEqual(restored.sparring, 360);
assert.strictEqual(restored.game, 300);

const grace = app.slice(app.indexOf("function assembleGrace"), app.indexOf("function assemble("));
const sparMark = grace.indexOf('placeMark("sparring")');
const gameMark = grace.indexOf('placeItems("games"');
assert.ok(sparMark > 0 && gameMark > sparMark, "sparring stays before play");
assert.ok(grace.includes("applySparringTime"));

const section = app.slice(app.indexOf("function sparringSection"), app.indexOf("function waterBlock"));
const hidden = section.indexOf('class="block no-print"');
const drilling = section.indexOf("Positional drilling");
assert.ok(hidden >= 0 && hidden < drilling, "a removed sparring block is screen-only");
assert.ok(section.includes("if (!plan.sparring)"));
assert.ok(app.includes("Add sparring"));
assert.ok(app.includes("Remove sparring"));
assert.ok(app.includes("data-sparring-toggle"));
assert.ok(app.includes("aria-pressed"));
assert.ok(app.includes("sparringChoice"));
assert.ok(app.includes("sparringEnabled"));
assert.ok(app.includes('raw.sparringChoice === "manual"'));
assert.ok(app.includes("resolveSparring"));
assert.ok(!/key === "mite"/.test(app));
assert.ok(app.includes("Live sparring waits for a kid with at least one stripe and enough adults."));
assert.ok(css.includes("button.sparring-toggle"));
assert.ok(css.slice(css.indexOf("button.sparring-toggle"), css.indexOf(".sparring-reason")).includes("min-height: 44px"));
const printCss = css.slice(css.indexOf("@media print {"));
assert.ok(printCss.includes(".no-print"));
assert.ok(printCss.includes("display: none !important"));

console.log("sparring toggle checks passed");
