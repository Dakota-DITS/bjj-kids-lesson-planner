/* Section library search, add/remove, and in-plan order. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const P = require("../js/plan-math.js");

const library = [
  { id: "bear", name: "Bear crawl", how: "Hands and feet.", tags: ["animal"] },
  { id: "gorilla", name: "Gorilla Walk", how: "Big stompy steps." },
  { id: "jog", name: "Light jog", how: "Easy jog around the mat.", say: "Follow me" },
  { id: "shrimp", name: "Hip escape", how: "Bridge and shrimp.", tags: ["base"] },
];

const open = P.planPickerGroups(library, ["gorilla", "jog"], "");
assert.deepStrictEqual(open.inPlan.map((item) => item.id), ["gorilla", "jog"]);
assert.deepStrictEqual(open.rest.map((item) => item.id), ["bear", "shrimp"]);
assert.strictEqual(open.inPlanCount, 2);

const filtered = P.planPickerGroups(library, ["gorilla", "jog", "bear"], "STOMPY");
assert.deepStrictEqual(filtered.inPlan.map((item) => item.id), ["gorilla"]);
assert.deepStrictEqual(filtered.rest.map((item) => item.id), []);
assert.strictEqual(filtered.inPlanCount, 3);

const tagged = P.planPickerGroups(library, ["jog"], "animal");
assert.deepStrictEqual(tagged.inPlan.map((item) => item.id), []);
assert.deepStrictEqual(tagged.rest.map((item) => item.id), ["bear"]);
assert.strictEqual(tagged.inPlanCount, 1);

const none = P.planPickerGroups(library, ["jog", "bear"], "zzzz");
assert.deepStrictEqual(none.inPlan, []);
assert.deepStrictEqual(none.rest, []);
assert.strictEqual(none.inPlanCount, 2);

assert.strictEqual(P.matchesPlanQuery(library[2], "follow"), true);
assert.strictEqual(P.matchesPlanQuery(library[2], "  JoG "), true);

let ids = ["gorilla", "jog"];
ids = P.togglePlanIds(ids, "bear");
assert.deepStrictEqual(ids, ["gorilla", "jog", "bear"]);
ids = P.togglePlanIds(ids, "gorilla");
assert.deepStrictEqual(ids, ["jog", "bear"]);
ids = P.togglePlanIds(ids, "jog");
assert.deepStrictEqual(ids, ["bear"]);
const after = P.planPickerGroups(library, ids, "");
assert.deepStrictEqual(after.inPlan.map((item) => item.id), ["bear"]);
assert.deepStrictEqual(after.rest.map((item) => item.id), ["gorilla", "jog", "shrimp"]);

const app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
assert.ok(app.includes('aria-label="${esc(meta.search)}"'));
assert.ok(app.includes('search: "Search warmups"'));
assert.ok(app.includes('search: "Search base movements"'));
assert.ok(app.includes('search: "Search techniques"'));
assert.ok(app.includes('search: "Search games"'));
assert.ok(app.includes('search: "Search sparring"'));
assert.ok(app.includes("Add to plan"));
assert.ok(app.includes("Remove from plan"));
assert.ok(app.includes('aria-pressed='));
assert.ok(app.includes("In plan"));
assert.ok(app.includes("No matches"));
assert.ok(app.includes("ageOverrideGroups"));
assert.ok(app.includes("togglePlanIds"));

console.log("plan picker checks passed");
