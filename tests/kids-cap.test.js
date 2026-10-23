/* Kids enrollment cap copy, default, and the closed-submission flag. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const kids = read("kids/index.html");
const form = read("kids/waiver/index.html");
const script = read("waiver/waiver.js");
const staff = read("app/index.html");
const app = read("js/app.js");
const api = read("server/httpapp.py");
const config = JSON.parse(read("waiver-config.json"));
const full = "Kids class is full right now. Email dits+bjj@mail.grokbot.com to ask about the next opening.";

assert.equal(config.waiverSubmissionsEnabled, true);
assert.equal(config.waitlistEnabled, false);
assert.ok(kids.includes('id="spotsLine"'));
assert.ok(kids.includes("spots open"));
assert.ok(kids.includes("/api/public/kids-enrollment"));
assert.ok(kids.includes("submissionsEnabled"));
assert.ok(form.includes("Kids class is full right now. Email "));
assert.ok(form.includes(">dits+bjj@mail.grokbot.com</a> to ask about the next opening."));
assert.ok(form.includes('id="fullNote"'));
assert.ok(form.includes("mailto:dits%2Bbjj@mail.grokbot.com"));
assert.ok(script.includes(full));
assert.ok(script.includes("submitBtn.hidden"));
assert.ok(staff.includes('id="kidsEnrolled"'));
assert.ok(staff.includes('id="planEnrolled"'));
assert.ok(staff.includes('id="kidsCap"'));
assert.ok(staff.includes("Save class size"));
assert.ok(app.includes("confirmOverCap"));
assert.ok(app.includes(" of "));
assert.ok(app.includes(" enrolled"));
assert.ok(api.includes("DEFAULT_KIDS_CAP = 12"));
assert.ok(api.includes(full));
assert.ok(api.includes("BEGIN IMMEDIATE"));
assert.ok(api.includes("An admin sets the kids class size."));
assert.ok(api.includes("needsConfirm"));
assert.equal(read("waiver/index.html").includes("fullNote"), false);

console.log("kids cap checks passed");
