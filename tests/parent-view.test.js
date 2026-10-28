/* Parent card page, token parsing, and the closed list of public fields. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const page = read("p/index.html");
const app = read("js/app.js");
const api = read("server/httpapp.py");
const sw = read("sw.js");
const privacy = read("privacy/index.html");
const plan = require("../js/plan-math.js");

assert.ok(page.includes('name="robots" content="noindex, nofollow, noarchive, nosnippet"'));
assert.ok(page.includes('name="googlebot" content="noindex, nofollow"'));
assert.ok(page.includes('content="no-store"'));
assert.ok(page.includes('name="bjj-base" content=""'));
assert.ok(page.includes('src="/bjj-base.js?v=20261028-60"'));
assert.ok(page.includes("Birth month"));
assert.ok(page.includes("Birth day"));
assert.ok(page.includes("View / print my signed waiver"));
assert.ok(page.includes("Sign the enrollment form"));
assert.ok(page.includes('fetch("/api/public/parent"'));
assert.equal(page.includes("injuries"), false);
assert.equal(page.includes("medical"), false);
assert.equal(page.includes("waitlist"), false);
assert.ok(app.includes('text.startsWith("parent:")'));
assert.ok(app.includes("not have a signed waiver"));
assert.ok(app.includes("Check-in is still saved."));
assert.ok(app.includes("New parent code"));
assert.ok(app.includes("No signed waiver"));
assert.ok(sw.includes('"/p/index.html"'));
assert.ok(privacy.includes("bjj_parent"));
assert.ok(privacy.includes("The card code is not part of that path."));
assert.ok(api.includes("PARENT_MISS"));
assert.ok(api.includes("Those details don't match."));
assert.equal(api.includes("attach_new_waiver"), false);
const token = "abcDEF123_-xyzABCDE98765";
assert.strictEqual(plan.parseQr("https://bjj.bettrbook.com/p/#" + token), "parent:" + token);
assert.strictEqual(plan.parseQr("1"), "");
assert.strictEqual(plan.parseQr(plan.qrPayload("b-card")), "b-card");

console.log("parent view checks passed");
