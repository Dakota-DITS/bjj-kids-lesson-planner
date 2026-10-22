/* Saved plans, reprint, and role buttons stay wired to the server checks. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server/httpapp.py"), "utf8");

assert.ok(html.includes("Reprint unused blank cards"), "reprint action is in the blank-card area");
assert.ok(html.includes('id="savePlanBtn"'), "save plan button is in the planner");
assert.ok(html.includes("Start a new plan"), "a saved plan can be left for a new one");
assert.ok(html.includes('id="savedPlans"'), "saved plans list is on the page");
assert.ok(app.includes('card.status === "unclaimed"'), "reprint lists only unused cards");
assert.ok(app.includes("renderBlankCards(cards, layout)"), "reprint uses the blank-card renderer");
assert.ok(!app.includes("POST\", \"/api/cards\"") || app.includes("printBlankCards"), "new codes stay on the print action");
const reprint = app.slice(app.indexOf("async function showReprintBlanks"), app.indexOf("function reprintSelected"));
assert.ok(!reprint.includes('"/api/cards"') || reprint.includes('send("GET", "/api/cards")'), "reprint reads cards");
assert.ok(!reprint.includes("POST"), "reprint does not create codes");
assert.ok(app.includes(">Make admin</button>"), "existing logins can be made admin");
assert.ok(app.includes(">Make teacher</button>"), "existing logins can be made teacher");
assert.ok(app.includes("PATCH\", `/api/users/${roleBtn.dataset.roleUser}`"), "role buttons call the user route");
assert.ok(server.includes('if role not in ("admin", "teacher")'), "server accepts only admin or teacher");
assert.ok(server.includes("Keep at least one admin who can still sign in."), "last admin cannot be demoted");
assert.ok(server.includes("CREATE TABLE IF NOT EXISTS lesson_plans") === false, "table is created in db.migrate");
assert.ok(fs.readFileSync(path.join(root, "server/db.py"), "utf8").includes("CREATE TABLE IF NOT EXISTS lesson_plans"));
assert.ok(server.includes('method == "PUT"') && server.includes("def save_plan"), "staff can save a plan");
assert.ok(server.includes("An admin removes saved plans."), "delete stays admin-only on the server");

const load = app.slice(app.indexOf("async function loadSavedPlan"), app.indexOf("function startNewPlan"));
assert.ok(load.includes("retimePlan()"), "loading a plan retimes it, which keeps prayer first");
assert.ok(load.includes("state.editingPlanId"), "edit stays on the same saved plan");
const clean = app.slice(app.indexOf("function cleanItem"), app.indexOf("function cleanItems"));
assert.ok(clean.includes("ageOverride: !!item.ageOverride"), "age override tags survive a reload");
assert.ok(clean.includes("...item"), "item order is the saved list order");
const prayer = app.indexOf('placeItems("prayer"');
const opening = app.indexOf('placeItems("opening"');
assert.ok(prayer > 0 && opening > prayer, "opening prayer stays before the line-up");

console.log("saved plan checks passed");
