/* Out-of-age library rows stay hidden until search, then Override can add them. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const P = require("../js/plan-math.js");

assert.strictEqual(P.ageLimitLabel(["peewee", "junior", "teen"]), `For ages ${P.AGE_RANGES.peewee}+`);
assert.strictEqual(P.ageLimitLabel(["junior", "teen"]), `For ages ${P.AGE_RANGES.junior}+`);
assert.strictEqual(P.ageLimitLabel(["teen"]), `For ages ${P.AGE_RANGES.teen}`);
assert.strictEqual(P.ageLimitLabel(["mite"]), `For ages ${P.AGE_RANGES.mite}`);
assert.strictEqual(P.ageLimitLabel([]), "");

const inAge = [
  { id: "ls-scissor", name: "Scissor sweep", how: "Chop like scissors.", ages: ["mite", "peewee", "junior", "teen"], themes: ["sweeps", "guard"] },
  { id: "ls-shrimp", name: "Hip escape", how: "Bridge and shrimp.", ages: ["mite"] },
];
const outOfAge = [
  { id: "ls-kimura", name: "Kimura from guard", how: "Figure-four the arm.", ages: ["junior", "teen"], theme: "guard" },
  { id: "ls-sickle", name: "Sickle sweep", how: "Hook the heel.", ages: ["junior", "teen"], themes: ["sweeps"] },
  { id: "ls-butterfly", name: "Butterfly sweep", how: "Hooks in and lift.", ages: ["peewee", "junior", "teen"], themes: ["sweeps"] },
];

const hidden = P.ageOverrideGroups(inAge, outOfAge, ["ls-scissor"], "");
assert.deepStrictEqual(hidden.outOfAge.map((item) => item.id), []);
assert.deepStrictEqual(hidden.inPlan.map((item) => item.id), ["ls-scissor"]);
assert.ok(hidden.rest.some((item) => item.id === "ls-shrimp"));
assert.ok(!hidden.rest.some((item) => item.id === "ls-kimura"));
assert.ok(!hidden.rest.some((item) => item.id === "ls-sickle"));

const kimura = P.ageOverrideGroups(inAge, outOfAge, ["ls-scissor"], "kimura");
assert.deepStrictEqual(kimura.rest.map((item) => item.id), []);
assert.deepStrictEqual(kimura.outOfAge.map((item) => item.id), ["ls-kimura"]);
assert.ok(!kimura.inPlan.some((item) => item.id === "ls-kimura"));

const sweep = P.ageOverrideGroups(inAge, outOfAge, ["ls-scissor"], "sweep");
assert.deepStrictEqual(sweep.inPlan.map((item) => item.id), ["ls-scissor"]);
assert.deepStrictEqual(sweep.rest.map((item) => item.id), []);
assert.deepStrictEqual(sweep.outOfAge.map((item) => item.id), ["ls-sickle", "ls-butterfly"]);

const picked = [{ id: "ls-scissor", name: "Scissor sweep" }];
const previous = [
  { id: "ls-kimura", name: "Kimura from guard", ageOverride: true },
  { id: "ls-shrimp", name: "Hip escape" },
];
const kept = P.keepAgeOverrides(picked, previous);
assert.deepStrictEqual(kept.map((item) => item.id), ["ls-kimura", "ls-scissor"]);
assert.strictEqual(kept[0].ageOverride, true);
assert.ok(!kept[1].ageOverride);

const dropped = P.keepAgeOverrides(picked, [{ id: "ls-shrimp", name: "Hip escape" }]);
assert.deepStrictEqual(dropped.map((item) => item.id), ["ls-scissor"]);

const once = P.keepAgeOverrides(
  [{ id: "ls-kimura", name: "Kimura from guard" }],
  [{ id: "ls-kimura", name: "Kimura from guard", ageOverride: true }]
);
assert.strictEqual(once.length, 1);

let ids = ["ls-scissor"];
ids = ["ls-kimura"].concat(ids);
assert.deepStrictEqual(ids, ["ls-kimura", "ls-scissor"]);
ids = P.togglePlanIds(ids, "ls-kimura");
assert.deepStrictEqual(ids, ["ls-scissor"]);

const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/data.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/curriculum.js"), "utf8"), sandbox);
const DATA = sandbox.window.BJJ_DATA;
const scissor = DATA.activities.find((item) => item.id === "ls-scissor");
const sickle = DATA.activities.find((item) => item.id === "ls-sickle");
assert.ok(scissor.ages.includes("mite"));
assert.ok(!sickle.ages.includes("mite"));
assert.ok(!sickle.ages.includes("peewee"));
assert.strictEqual(P.ageLimitLabel(Array.from(sickle.ages)), `For ages ${P.AGE_RANGES.junior}+`);

const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
assert.ok(app.includes("data-plan-override"));
assert.ok(app.includes("is-out-of-age"));
assert.ok(app.includes("Age override"));
assert.ok(app.includes("Override age limit and add "));
assert.ok(app.includes("ageOverride: !!item.ageOverride"));
assert.ok(app.includes("function carryAgeOverrides"));
assert.ok(app.includes("carryAgeOverrides(lesson, \"lesson\", age)"));
assert.ok(app.includes("libraryOutOfAge"));
assert.ok(css.includes(".pick-row.is-out-of-age .pick-copy"));
const overrideRule = css.slice(css.indexOf("button.plan-override.danger"), css.indexOf(".age-override {"));
assert.ok(overrideRule.includes("min-height: 44px"));
assert.ok(overrideRule.includes("min-width: 44px"));
assert.ok(overrideRule.includes("#9f1239"));
assert.ok(css.includes("body[data-print=\"lesson\"] .age-override"));

const prayerAt = app.indexOf('placeItems("prayer"');
const openingAt = app.indexOf('placeItems("opening"');
assert.ok(prayerAt > 0 && prayerAt < openingAt);

const spar = app.slice(app.indexOf("function sparringSection"), app.indexOf("function waterBlock"));
assert.ok(!spar.includes("plan-override"));
assert.ok(!spar.includes("data-plan-override"));
const live = app.slice(app.indexOf("function liveSparring"), app.indexOf("function themesForAge"));
assert.ok(!live.includes("ageOverride"));
assert.ok(live.includes("kidCanSpar"));

console.log("age override checks passed");
