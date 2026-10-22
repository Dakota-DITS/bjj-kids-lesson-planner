/* Sweeps theme, scissor sweep for every age, and search. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/data.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/curriculum.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/plan-math.js"), "utf8"), sandbox);

const DATA = sandbox.window.BJJ_DATA;
const P = sandbox.window.BJJ_PLAN || sandbox.BJJ_PLAN;
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");

function lessonThemes(item) {
  const ids = [];
  if (item.theme) ids.push(item.theme);
  (Array.isArray(item.themes) ? item.themes : []).forEach((id) => {
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

function inTheme(item, themeId) {
  return lessonThemes(item).includes(themeId);
}

const theme = DATA.themes.find((item) => item.id === "sweeps");
assert.ok(theme, "Sweeps theme is missing");
assert.strictEqual(theme.label, "Sweeps");

const lessons = DATA.activities.filter((item) => item.category === "lesson");
const ids = lessons.map((item) => item.id);
assert.strictEqual(new Set(ids).size, ids.length, "duplicate technique ids");

const sweeps = lessons.filter((item) => inTheme(item, "sweeps"));
const byId = Object.fromEntries(sweeps.map((item) => [item.id, item]));
["ls-scissor-prep", "ls-scissor", "ls-hip-bump", "ls-seated-bump", "ls-flower", "ls-butterfly", "ls-tripod", "ls-sickle"].forEach((id) => {
  assert.ok(byId[id], id);
});
assert.ok(!sweeps.some((item) => item.id === "ls-kimura"), "kimura is not a sweep");

const ages = {
  "ls-scissor-prep": ["mite", "upper"],
  "ls-scissor": ["mite", "upper"],
  "ls-seated-bump": ["mite", "upper"],
  "ls-hip-bump": ["mite", "upper"],
  "ls-flower": ["mite", "upper"],
  "ls-butterfly": ["mite", "upper"],
  "ls-tripod": ["mite", "upper"],
  "ls-sickle": ["upper"],
};
Object.entries(ages).forEach(([id, expect]) => {
  assert.deepStrictEqual(Array.from(byId[id].ages), expect, id);
  assert.strictEqual(Array.from(byId[id].steps).length, 3, id);
  assert.ok(byId[id].safety && byId[id].safety.length > 20, id);
  assert.ok(!/submission/.test(byId[id].name), id);
  assert.ok(P.matchesPlanQuery(byId[id], "sweep"), id);
});

const scissor = byId["ls-scissor"];
assert.strictEqual(scissor.theme, "guard");
assert.ok(inTheme(scissor, "guard"));
assert.ok(inTheme(scissor, "sweeps"));
assert.ok(scissor.safety.includes("No gi grips required"));
assert.ok(scissor.safety.includes("teacher does the chop"));
assert.ok(scissor.say.includes("Chop like scissors"));
assert.ok(byId["ls-scissor-prep"].order < scissor.order);
assert.ok(byId["ls-butterfly"].theme === "open-guard" && inTheme(byId["ls-butterfly"], "open-guard"));
assert.strictEqual(lessons.filter((item) => item.name === "Scissor sweep").length, 1);

const game = DATA.activities.find((item) => item.id === "gm-sweep-stand");
assert.ok(game);
assert.strictEqual(game.category, "game");
assert.ok(game.themes.includes("sweeps"));
assert.deepStrictEqual(Array.from(game.ages), ["mite", "upper"]);
assert.ok(P.matchesPlanQuery(game, "sweep"));
assert.ok(game.how.includes("reset right away"));
assert.ok(!/no submissions/i.test(game.how));

["mite", "upper"].forEach((age) => {
  assert.ok(scissor.ages.includes(age), age);
  const forAge = sweeps.filter((item) => item.ages.includes(age)).map((item) => item.id);
  assert.ok(forAge.includes("ls-scissor"), age);
  assert.ok(forAge.includes("ls-scissor-prep"), age);
});
assert.ok(!byId["ls-sickle"].ages.includes("mite"));
assert.ok(byId["ls-tripod"].ages.includes("mite"));

assert.ok(app.includes("function lessonInTheme"));
assert.ok(app.includes("lessonInTheme(item, choice.id)"));
assert.ok(app.includes('placeItems("prayer"'));

console.log("sweeps checks passed");
