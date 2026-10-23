/* Enrollment forms keep the source document and stay closed. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adult = fs.readFileSync(path.join(root, "waiver/index.html"), "utf8");
const kids = fs.readFileSync(path.join(root, "kids/waiver/index.html"), "utf8");
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const kidsHome = fs.readFileSync(path.join(root, "kids/index.html"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "waiver-config.json"), "utf8"));
const staff = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/waiver.css"), "utf8");
const script = fs.readFileSync(path.join(root, "waiver/waiver.js"), "utf8");
assert.ok(script.includes("applyCopy"));
assert.ok(script.includes("bjj-parent-sign"));

assert.equal(config.waiverSubmissionsEnabled, true);
assert.equal(config.waitlistEnabled, false);
assert.ok(config.copy.kids.hygiene.includes("I consent on behalf of my minor child."));
assert.ok(config.copy.adult.release.includes("I indemnify and hold harmless"));
assert.ok(adult.includes('src="/img/logo/grace-logo-mark-transparent.png"'));
assert.ok(kids.includes('src="/img/logo/grace-logo-mark-transparent.png"'));
assert.ok(adult.includes("sit in seiza"));
assert.equal(adult.includes("seizea"), false);
assert.equal(adult.includes("fellows students"), false);
assert.ok(adult.includes("rather than fellow students"));
assert.ok(adult.includes("Grace Baptist Church of Salem, Oregon"));
assert.ok(adult.includes("I indemnify and hold harmless"));
assert.ok(adult.includes("Name of parent (if minor)"));
assert.ok(adult.includes("Please print name"));
assert.ok(adult.includes('id="signaturePad"'));
assert.ok(adult.includes('id="submitBtn" disabled'));
assert.ok(adult.includes("Do not submit yet. Enrollment is not open."));
assert.ok(adult.includes("Print / Save as PDF"));
assert.ok(adult.includes('value="Bully-proofing"'));
assert.ok(adult.includes('value="Meet new friends"'));
assert.ok(home.includes('href="/waiver/"'));

assert.ok(kids.includes("Kids call instructors"));
assert.ok(kids.includes("Kids ages 3–6 must be fully potty trained to join class."));
assert.ok(kids.includes("I consent on behalf of my minor child."));
assert.ok(kids.includes("keep cell phones and mobile devices put away"));
assert.equal(kids.includes("locker room"), false);
assert.equal(/Pastor Pierre/i.test(kids + adult), false);
assert.ok(kids.includes('id="signaturePad"'));
assert.ok(kids.includes('id="submitBtn" disabled'));
assert.ok(kidsHome.includes('href="/kids/waiver/"'));
assert.ok(staff.includes('href="/app/waivers/"'));
assert.ok(staff.includes("admin-only"));
assert.ok(css.includes("break-inside: avoid"));
assert.ok(css.includes("@media print"));

console.log("waiver checks passed");
