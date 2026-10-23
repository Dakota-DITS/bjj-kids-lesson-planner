/* Public welcome page: cost, first class, FAQ, calendar, and share tags. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "kids/index.html"), "utf8");
const ics = fs.readFileSync(path.join(root, "calendar/grace-bjj-kids.ics"), "utf8").replace(/\r\n/g, "\n");

assert.ok(html.includes('id="whats-grace"'));
assert.ok(html.includes("<h2>What's grace?</h2>"));
assert.ok(html.includes("Grace is God's kindness to us that we could never earn."));
assert.ok(html.includes("That's why our program is named Grace."));
assert.ok(html.includes("Want to know more? Ask any of our teachers."));
const graceSection = html.slice(html.indexOf('id="whats-grace"'), html.indexOf('id="cost"'));
assert.equal(graceSection.includes("Grace Baptist Church"), false);
assert.ok(html.indexOf('id="whats-grace"') < html.indexOf('id="cost"'));
assert.ok(html.includes("<h2>Free, because grace is free.</h2>"));
assert.ok(html.includes("Grace Kids BJJ costs nothing, just like God's grace."));
assert.ok(html.includes('<strong class="donate-ask">a suggested minimum of $5 each class</strong>'));
assert.ok(html.includes("We ask that you give what you feel called to give, with "));
assert.ok(html.includes("Every dollar goes toward mat care, equipment, and even helping keep the lights on, so we can serve your kids better. The more we receive, the more we're able to do."));
assert.equal((html.match(/Every dollar goes toward mat care, equipment, and even helping keep the lights on, so we can serve your kids better\. The more we receive, the more we're able to do\./g) || []).length, 2);
assert.equal(html.includes("new mats and equipment"), false);
assert.equal(html.includes("we suggest a $5 donation each class"), false);
assert.equal((html.match(/a suggested minimum of \$5 each class/g) || []).length, 3);
assert.ok(html.includes('name="description" content="Grace BJJ Kids meets on the 2nd and 4th Tuesday, 5:30–6:15 PM. Classes are free for ages 3–10. Give what you feel called to give, with a suggested minimum of $5 each class."'));
assert.ok(html.includes("If you can't give, that's completely fine. Your family is just as welcome here."));
assert.ok(html.includes('href="https://onrealm.org/GBCSalem/-/form/give/BJJ" target="_blank" rel="noopener noreferrer"'));
assert.ok(html.includes(">Give online</a>"));
assert.ok(fs.readFileSync(path.join(root, "css/splash.css"), "utf8").includes(".donate-ask"));
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
assert.equal(html.includes("Location and contact are coming soon."), false);
assert.ok(html.includes("Grace Baptist Church, 4197 State St, Salem, OR 97301"));
assert.ok(html.includes('href="https://www.google.com/maps/search/?api=1&amp;query=Grace+Baptist+Church+4197+State+St+Salem+OR+97301" target="_blank" rel="noopener noreferrer"'));
assert.ok(html.includes(">Get directions</a>"));
assert.equal(html.includes("Contact info is coming soon."), false);
assert.equal(html.includes("coming soon"), false);
assert.ok(html.includes('href="mailto:dits%2Bbjj@mail.grokbot.com?subject=Grace%20BJJ%20Kids">Questions? Email us at dits+bjj@mail.grokbot.com</a>'));
assert.equal(/mailto:[^"']*\+/.test(html), false);
assert.equal(html.includes("tel:"), false);
assert.equal(html.includes("<iframe"), false);
assert.equal(html.includes("maps.google.com/maps"), false);
assert.ok(html.includes('location: ""'));
assert.ok(html.includes('phone: ""'));
assert.ok(html.includes('email: ""'));
["app/index.html", "login/index.html", "coloring/index.html", "offline.html", "js/app.js", "js/data.js"].forEach((rel) => {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  assert.equal(text.includes("mail.grokbot.com"), false, rel);
  assert.equal(text.includes("dits+bjj"), false, rel);
});
assert.ok(html.includes('src="/calendar/class-days.js?v=20261023-41"'));
assert.ok(html.includes("GRACE_CLASS_DAYS"));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('aria-label="Previous month"'));
assert.ok(html.includes('aria-label="Next month"'));
assert.ok(html.includes("Class: 5:30–6:15 PM at Grace Baptist Church"));
assert.equal(html.includes("which === 2"), false);

assert.ok(html.includes("Ages 3–10, in two groups: 3–6 Mighty Mites and 7–10 Pee Wees."));
assert.ok(html.includes("<b>3–6</b>"));
assert.ok(html.includes("<b>7–10</b>"));
assert.ok(html.includes("Pee Wees. Partner drills"));
assert.ok(html.includes("Kids ages 3–6 must be fully potty trained to join class."));
assert.ok(html.includes("/api/public/class-exceptions"));
assert.ok(html.includes("4:1 kid-to-adult ratio"));
assert.ok(html.includes("don't size up"));

assert.ok(html.includes('href="/calendar/grace-bjj-kids.ics"'));
assert.ok(ics.includes("DTSTART;TZID=America/Los_Angeles:20261027T173000"));
assert.ok(ics.includes("DTEND;TZID=America/Los_Angeles:20261027T181500"));
assert.ok(ics.includes("RRULE:FREQ=MONTHLY;BYDAY=2TU,4TU"));
assert.ok(ics.includes("SUMMARY:Grace BJJ Kids"));
assert.ok(ics.includes("LOCATION:Grace Baptist Church\\, 4197 State St\\, Salem\\, OR 97301"));
assert.ok(ics.includes("X-LIC-LOCATION:America/Los_Angeles"));

assert.ok(html.includes("<title>Grace BJJ Kids</title>"));
assert.ok(html.includes('<p class="eyebrow">Grace BJJ Kids</p>'));
assert.ok(html.includes("<h1>Strong kids, kind hearts.</h1>"));
assert.ok(html.includes("Jiu-jitsu that grows confidence, respect, and friendship, built on God's grace."));
assert.equal(html.includes("<h1>Kids class</h1>"), false);
assert.equal(html.includes("Welcome to Grace BJJ Kids."), false);
assert.equal(html.includes("how to be part of the room."), false);
assert.ok(html.includes('property="og:title" content="Grace BJJ Kids"'));
assert.ok(html.includes('property="og:image" content="https://bjj.bettrbook.com/img/logo/grace-logo-mark-transparent.png"'));
assert.ok(html.includes('name="description"'));

console.log("welcome home checks passed");
