/* Kids waitlist copy, closed flag, privacy, and the admin page. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const form = read("kids/waiver/index.html");
const script = read("waiver/waiver.js");
const staff = read("app/index.html");
const app = read("js/app.js");
const api = read("server/httpapp.py");
const page = read("app/waitlist/index.html");
const policy = read("privacy/index.html");
const config = JSON.parse(read("waiver-config.json"));
const sentence = "Kids class is full right now. Join the waitlist and we'll reach out when a spot opens.";

assert.equal(config.waiverSubmissionsEnabled, false);
assert.equal(config.waitlistEnabled, false);
assert.ok(form.includes(sentence));
assert.ok(form.includes('id="waitlistBox"'));
assert.ok(form.includes('id="waitlistForm"'));
assert.ok(form.includes('id="waitParent"'));
assert.ok(form.includes('id="waitEmail"'));
assert.ok(form.includes('id="waitPhone"'));
assert.ok(form.includes('id="waitChild"'));
assert.ok(form.includes('id="waitAge"'));
assert.ok(form.includes('id="waitDob"'));
assert.ok(form.includes('id="waitAgeGroup"'));
assert.ok(form.includes('id="waitNote"'));
assert.ok(form.includes("Join the waitlist"));
assert.ok(form.includes('value="mite"'));
assert.ok(form.includes('value="upper"'));
assert.ok(script.includes(sentence));
assert.ok(script.includes("waitlistEnabled"));
assert.ok(script.includes("/api/public/waitlist"));
assert.ok(script.includes("You're on the waitlist."));
assert.equal(script.includes("smtplib"), false);
assert.ok(staff.includes('href="/app/waitlist/"'));
assert.ok(staff.includes('id="waitlistBanner"'));
assert.ok(app.includes("This does not email or text them."));
assert.ok(app.includes("waitlistSpotOpen"));
assert.ok(api.includes("The waitlist is not open."));
assert.ok(api.includes("An admin manages the waitlist."));
assert.ok(api.includes("This child is already on the waitlist."));
assert.ok(api.includes("A spot is open right now. Use the enrollment form."));
assert.equal(api.includes("smtplib"), false);
assert.ok(page.includes("An admin manages the waitlist."));
assert.ok(page.includes("No one is on the waitlist."));
assert.ok(page.includes("This page does not email or text families."));
assert.ok(page.includes("/api/waitlist.csv"));
assert.ok(page.includes("Contacted"));
assert.ok(page.includes("Enrolled"));
assert.ok(page.includes("Remove"));
assert.ok(page.includes("min-height: 44px"));
assert.ok(page.includes("#fff7ed"));
assert.ok(page.includes("#9b2a12"));
assert.ok(policy.includes("Joining the kids waitlist is turned off."));
assert.ok(policy.includes("parent or guardian's name, email, and phone"));
assert.ok(policy.includes("child's first name"));
assert.ok(policy.includes("does not email or text"));
assert.ok(policy.includes("admin only"));
assert.equal(policy.includes("waiverSubmissionsEnabled"), false);
assert.equal(policy.includes("waitlistEnabled"), false);
assert.ok(read("css/styles.css").includes(".waitlist-banner"));
assert.ok(read("css/waiver.css").includes(".waitlist[hidden]"));

console.log("waitlist checks passed");
