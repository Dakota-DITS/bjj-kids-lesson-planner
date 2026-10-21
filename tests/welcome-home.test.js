/* Public welcome page: cost, first class, FAQ, calendar, and share tags. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ics = fs.readFileSync(path.join(root, "calendar/grace-bjj-kids.ics"), "utf8").replace(/\r\n/g, "\n");

assert.ok(html.includes("Classes are free. We suggest a $5 donation per class to help cover cleaning supplies and similar costs."));
assert.ok(html.includes("The donation is optional. Classes stay free either way."));
assert.ok(html.includes('href="https://onrealm.org/GBCSalem/-/form/give/BJJ" target="_blank" rel="noopener"'));
assert.ok(html.includes(">Give online</a>"));
assert.equal(html.includes("venmo"), false);
assert.equal(html.includes("paypal"), false);
assert.equal(html.includes("qr"), false);

assert.ok(html.includes("What to expect at the first class"));
assert.ok(html.includes("Arrive about 10 minutes early."));
assert.ok(html.includes("A loaner gi is available the first week."));
assert.ok(html.includes("trimmed nails"));
assert.ok(html.includes("no jewelry"));
assert.ok(html.includes("line up by rank"));
assert.ok(html.includes("Sparring is only for kids with at least one stripe."));
assert.ok(html.includes("Location and contact are coming soon."));
assert.ok(html.includes('location: ""'));

assert.ok(html.includes("Ages 4–15, in four groups"));
assert.ok(html.includes("4:1 kid-to-adult ratio"));
assert.ok(html.includes("don't size up"));

assert.ok(html.includes('href="/calendar/grace-bjj-kids.ics"'));
assert.ok(ics.includes("DTSTART;TZID=America/Los_Angeles:20261027T173000"));
assert.ok(ics.includes("DTEND;TZID=America/Los_Angeles:20261027T181500"));
assert.ok(ics.includes("RRULE:FREQ=MONTHLY;BYDAY=2TU,4TU"));
assert.ok(ics.includes("SUMMARY:Grace BJJ Kids"));

assert.ok(html.includes('property="og:title" content="Grace BJJ Kids"'));
assert.ok(html.includes('property="og:image" content="https://bjj.bettrbook.com/img/logo/grace-logo-mark-transparent.png"'));
assert.ok(html.includes('name="description"'));

console.log("welcome home checks passed");
