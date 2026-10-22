/* Sparring rules follow stripes, not an age ban. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const data = fs.readFileSync(path.join(root, "js/data.js"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

assert.equal(data.includes("rulesNoRolling"), false);
assert.equal(data.includes("No live rolling."), false);
assert.equal(data.includes("No waiting in line for turns during games."), false);
assert.ok(data.includes("Live rolling is only for kids with at least one stripe, and only when enough adults are supervising."));
assert.ok(data.includes("Kids with no stripes do not spar."));
assert.ok(data.includes("Teach them to tap, and don't wait for the tap."));
assert.ok(data.includes("If one child needs a break, the assistant takes them. You keep the others moving."));

const rulesBlock = data.split("rules: [")[1].split("],")[0];
assert.equal(rulesBlock.includes("No live rolling."), false);
assert.equal(rulesBlock.includes("No submissions."), false);
assert.equal(rulesBlock.includes("No tap."), false);
assert.ok(rulesBlock.includes("at least one stripe"));
assert.ok(rulesBlock.includes("assistant takes them"));

assert.equal(app.includes("rulesNoRolling"), false);
assert.equal(app.includes("Mighty Mites stay on position and movement."), false);
assert.ok(app.includes("rules.push(...DATA.rulesSparring)") || app.includes("DATA.rulesCommon.concat(DATA.rulesSparring)"));
assert.ok(app.includes("No one can spar yet. Only kids with at least one stripe spar, with enough adults."));
assert.equal(/key === "mite"/.test(app), false);

assert.equal(readme.includes("No submissions and no live sparring"), false);
assert.ok(readme.includes("including 3–6"));
assert.ok(readme.includes("at least one stripe"));

console.log("class rule checks passed");
