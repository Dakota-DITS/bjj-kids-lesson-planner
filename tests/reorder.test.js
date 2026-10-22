/* Reorder plan items inside one section, then restamp the clocks. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const P = require("../js/plan-math.js");

const lesson = [
  { id: "ls-shrimp", name: "Hip escape", prefMinutes: 1 },
  { id: "ls-bridge", name: "Bridge", prefMinutes: 2 },
  { id: "ls-scissor", name: "Scissor sweep", prefMinutes: 5 },
  { id: "ls-mount", name: "Mount escape", prefMinutes: 2 },
];

const moved = P.reorderSectionItems("lesson", lesson, "ls-scissor", "ls-bridge", "before");
assert.deepStrictEqual(
  moved.map((item) => item.id),
  ["ls-shrimp", "ls-scissor", "ls-bridge", "ls-mount"]
);
assert.strictEqual(moved[1].name, "Scissor sweep");
assert.strictEqual(moved[1].prefMinutes, 5);

const up = P.reorderSectionItems("lesson", moved, "ls-scissor", "ls-shrimp", "before");
assert.deepStrictEqual(up.map((item) => item.id)[0], "ls-scissor");
const down = P.reorderSectionItems("lesson", up, "ls-scissor", "ls-shrimp", "after");
assert.deepStrictEqual(down.map((item) => item.id).slice(0, 2), ["ls-shrimp", "ls-scissor"]);

const prayer = [
  { id: "opening-prayer", name: "Opening prayer" },
  { id: "amen", name: "Amen" },
];
const stuck = P.reorderSectionItems("prayer", prayer, "amen", "opening-prayer", "before");
assert.deepStrictEqual(stuck.map((item) => item.id), ["opening-prayer", "amen"]);
const opening = P.reorderSectionItems("opening", prayer, "amen", "opening-prayer", "before");
assert.deepStrictEqual(opening.map((item) => item.id), ["opening-prayer", "amen"]);

const sparring = [
  { id: "positions", name: "Positional drilling" },
  { id: "live", name: "Live sparring" },
];
const sparMoved = P.reorderSectionItems("sparring", sparring, "live", "positions", "before");
assert.deepStrictEqual(sparMoved.map((item) => item.id), ["live", "positions"]);

const same = P.moveWithinList(["a", "b", "c"], "b", "b", "before");
assert.deepStrictEqual(same, ["a", "b", "c"]);
const missing = P.moveWithinList(["a", "b"], "a", "nope", "after");
assert.deepStrictEqual(missing, ["a", "b"]);

const startMinutes = 17 * 60 + 30;
const beforeClocks = P.stampItemClocks(lesson, 11 * 60, 20 * 60, startMinutes);
const afterClocks = P.stampItemClocks(moved, 11 * 60, 20 * 60, startMinutes);
const beforeScissor = beforeClocks.find((item) => item.id === "ls-scissor");
const afterScissor = afterClocks.find((item) => item.id === "ls-scissor");
assert.notStrictEqual(beforeScissor.when, afterScissor.when);
assert.ok(afterScissor.start < beforeScissor.start);
assert.strictEqual(
  beforeClocks.reduce((sum, item) => sum + item.duration, 0),
  20 * 60
);
assert.strictEqual(
  afterClocks.reduce((sum, item) => sum + item.duration, 0),
  20 * 60
);

const sections = [
  { id: "lesson", duration: 20 * 60, items: moved },
  { id: "sparring", duration: 6 * 60, items: [] },
  { id: "games", duration: 5 * 60, items: [{ id: "gm-sweep-stand", name: "Sweep or stand", prefMinutes: 5 }] },
];
const stamped = P.restampPlanSections(sections, 11 * 60, startMinutes);
assert.strictEqual(stamped.reduce((sum, block) => sum + block.duration, 0), 31 * 60);
assert.strictEqual(stamped[0].items[1].id, "ls-scissor");
assert.strictEqual(stamped[1].start, stamped[0].start + stamped[0].duration);
assert.strictEqual(stamped[2].start, stamped[1].start + stamped[1].duration);
assert.strictEqual(stamped[2].start + stamped[2].duration, 11 * 60 + 31 * 60);

const saved = JSON.parse(JSON.stringify({ lesson: { items: moved } }));
assert.deepStrictEqual(
  saved.lesson.items.map((item) => item.id),
  ["ls-shrimp", "ls-scissor", "ls-bridge", "ls-mount"]
);
const grouped = P.planPickerGroups(
  lesson,
  saved.lesson.items.map((item) => item.id),
  ""
);
assert.deepStrictEqual(
  grouped.inPlan.map((item) => item.id),
  ["ls-shrimp", "ls-scissor", "ls-bridge", "ls-mount"]
);

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
assert.ok(app.includes('aria-label="Reorder ${esc(name)}"'));
assert.ok(app.includes("Move up"));
assert.ok(app.includes("Move down"));
assert.ok(app.includes("moved to position"));
assert.ok(app.includes("REORDER_SLOP"));
assert.ok(app.includes("pointerdown"));
assert.ok(app.includes("pointermove"));
assert.ok(app.includes("pointerup"));
assert.ok(app.includes("requestAnimationFrame(scrollReorderEdge)"));
assert.ok(app.includes("ArrowUp"));
assert.ok(app.includes("reorderSectionItems"));
assert.ok(app.includes("retimePlan()"));
assert.ok(app.includes('renderItem(item, "prayer")'));
assert.ok(!app.includes('renderItem(item, "prayer",'));
const spar = app.slice(app.indexOf("function sparringSection"), app.indexOf("function waterBlock"));
assert.ok(!spar.includes("reorder-handle"));
assert.ok(!spar.includes("data-reorder"));
const prayerAt = app.indexOf('placeItems("prayer"');
const openingAt = app.indexOf('placeItems("opening"');
assert.ok(prayerAt > 0 && prayerAt < openingAt);
const handleRule = css.slice(css.indexOf(".reorder-handle,"), css.indexOf(".reorder-handle {"));
assert.ok(handleRule.includes("min-height: 44px"));
assert.ok(handleRule.includes("min-width: 44px"));
assert.ok(css.includes(".item.drop-before::before"));
assert.ok(css.includes("touch-action: none"));

console.log("reorder checks passed");
