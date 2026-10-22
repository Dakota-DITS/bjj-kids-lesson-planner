/* Adult home page, kids move, and the single adult-class config. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const kids = fs.readFileSync(path.join(root, "kids/index.html"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(root, "adult-class.json"), "utf8"));
const plan = require("../js/plan-math.js");

assert.equal(data.instructor, "Master Pierre Rosa");
assert.equal(data.schedule.days, "Tuesdays and Thursdays");
assert.equal(data.schedule.time, "6:30 – ~8:00 PM");
assert.equal(data.schedule.timezone, "PT");
assert.ok(data.schedule.location.includes("4197 State St"));
assert.equal(
  data.audience,
  "Ages 11 and up (teens 11–18 and adults). All are welcome, women and men. Beginners are welcome."
);
assert.ok(data.kidsNote.includes("2nd and 4th Tuesday, 5:30–6:15 PM"));
assert.ok(data.kidsNote.includes("right before the Tuesday adult class"));
assert.equal(data.giving.heading, "Free, because grace is free.");
assert.equal(data.giving.minimum, "a suggested minimum of $5 each class");
assert.equal(data.giving.url, "https://onrealm.org/GBCSalem/-/form/give/BJJ");
assert.equal(/kids|famil/i.test(data.giving.lead + data.giving.tail), false);
assert.equal(/black belt|coral belt/i.test(data.instructor + "\n" + home), false);
assert.ok(data.schedule.placeholder.includes("coming soon"));

assert.ok(home.includes('fetch("/adult-class.json"'));
assert.ok(home.includes('id="classes"'));
assert.ok(home.includes('id="schedule"'));
assert.ok(home.includes('id="affiliation"'));
assert.ok(home.includes('id="contact"'));
assert.ok(home.includes('id="grace"'));
assert.ok(home.includes("Brazilian jiu-jitsu at Grace Baptist Church in Salem."));
assert.ok(home.includes("Grace BJJ is an official affiliate of Lebre Jiu-Jitsu Academy in San Diego. Our head instructor, Master Pierre Rosa, trains under Professor Regis Lebre."));
assert.ok(home.includes('href="https://lebrejiujitsu.com" target="_blank" rel="noopener noreferrer"'));
assert.equal(/<img[^>]+lebre/i.test(home), false);
assert.ok(home.includes('class="kids-pill" href="/kids/">Grace BJJ Kids</a>'));
assert.ok(kids.includes('class="home-pill" href="/">Grace BJJ</a>'));
assert.ok(home.includes('href="/kids/"'));
assert.ok(home.includes('href="/login/"'));
assert.ok(home.includes('"whats-grace": 1'));
assert.ok(home.includes('cost: 1'));
assert.ok(home.includes('location.replace("/kids/#" + id)'));
assert.equal(home.includes("tel:"), false);
assert.equal(/venmo|paypal/i.test(home), false);
assert.ok(home.includes('href="mailto:dits%2Bbjj@mail.grokbot.com?subject=Grace%20BJJ"'));
assert.equal(/mailto:[^"']*\+/.test(home), false);
assert.ok(home.includes("That's why our program is named Grace."));
assert.equal(home.includes("<h1>Strong kids, kind hearts.</h1>"), false);

assert.ok(kids.includes("<h1>Strong kids, kind hearts.</h1>"));
assert.ok(kids.includes("Kids ages 3–6 must be fully potty trained to join class."));
assert.ok(kids.includes('href="/calendar/grace-bjj-kids.ics"'));
assert.ok(kids.includes('content="https://bjj.bettrbook.com/kids/"'));
assert.ok(kids.includes('href="/">Home</a>'));
assert.equal(plan.qrPayload("card1").startsWith("GBJJ1|"), true);
assert.equal(plan.qrPayload("card1").includes("http"), false);

console.log("adult home checks passed");
