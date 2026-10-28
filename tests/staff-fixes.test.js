/* Staff fixes: adult cards, banner, scan camera, linked forms, skip, nav, review, ratio, contrast. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const app = read("js/app.js");
const css = read("css/styles.css");
const pwa = read("pwa.js");
const staff = read("app/index.html");
const scan = read("app/scan/index.html");
const waivers = read("app/waivers/index.html");
const waitlist = read("app/waitlist/index.html");
const buttons = read("css/button-groups.css");
const math = read("js/plan-math.js");

assert.ok(app.includes("function cardRoster()"));
assert.ok(app.includes('state.program === "adult"'));
assert.ok(app.includes('adult ? "Adult class"'));
assert.ok(app.includes("data-close-cards"));
assert.ok(app.includes('if (cardsOpen) setView("checkin")'));
assert.ok(app.includes('if (view !== "cards" && $("cardView"))'));
assert.ok(app.includes("Grace BJJ Staff"));
assert.equal(staff.includes("Grace BJJ Kids · Staff"), false);
assert.ok(staff.includes("<title>Grace BJJ Staff</title>"));
assert.ok(staff.includes('class="staff-link admin-only kids-only" href="/app/waitlist/"'));
assert.ok(staff.includes('class="staff-link" href="/app/scan/"'));
assert.ok(staff.includes('class="staff-link admin-only" href="/app/waivers/"'));

assert.ok(pwa.includes('className = "dismiss"'));
assert.ok(pwa.includes('aria-label", "Dismiss"'));
assert.ok(pwa.includes("localStorage.setItem(dismissKey"));
assert.ok(pwa.includes("pwa-tip-bar"));
assert.ok(pwa.includes(".pwa-tip-bar{position:relative"));
assert.ok(pwa.includes("insertBefore(tip, document.body.firstChild)"));

assert.equal(scan.includes("photoFile"), false);
assert.equal(scan.includes("Upload"), false);
assert.ok(scan.includes('class="back-staff" href="/app/">Back to staff</a>'));
assert.ok(waivers.includes('class="back-staff" href="/app/">Back to staff</a>'));
assert.ok(waitlist.includes('class="back-staff" href="/app/">Back to staff</a>'));
assert.ok(buttons.includes("a.back-staff"));
assert.ok(scan.includes("Class date"));
assert.ok(scan.includes("scan-day"));
assert.ok(app.includes("No class today"));
assert.ok(app.includes("The camera is unavailable. This page needs https"));
assert.ok(app.includes("The camera is unavailable in this browser."));
assert.ok(app.includes("Allow the camera for this site, or use a device with a camera."));

assert.ok(waivers.includes('card.classList.add("is-linked")'));
assert.ok(waivers.includes('linked.textContent = "Linked to "'));
assert.ok(waivers.includes("if (!open.length && !done.length)"));
assert.ok(app.includes("data-mark-all"));
assert.ok(app.includes("Mark all "));
assert.ok(app.includes('class="who-here"'));
assert.ok(css.includes("#reviewView .who-here"));
assert.ok(app.includes("Skip class on"));
assert.ok(app.includes('class="danger skip-class"'));
assert.ok(app.includes("<textarea"));
assert.ok(css.includes("min-height: 96px"));
assert.ok(app.includes('id="glanceRatio"'));
assert.ok(app.includes('class="callout warn no-print"'));
assert.ok(math.includes("limit is 4:1."));
assert.ok(css.includes("--ui-muted: #d6d3d1"));
assert.ok(css.includes("background: #fecdd3"));

console.log("staff fixes checks passed");
