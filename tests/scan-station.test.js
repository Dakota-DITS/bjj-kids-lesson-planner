/* Check-in station page: staff only, same scan helpers, no iframe, no roster cache. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "app/scan/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const staff = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const nginx = fs.readFileSync(path.join(root, "deploy/nginx-bjj.conf"), "utf8");

assert.ok(page.includes('content="noindex, nofollow, noarchive, nosnippet"'));
assert.ok(page.includes('href="/app/manifest.webmanifest"'));
assert.ok(page.includes('content="Grace BJJ Staff"'));
assert.ok(page.includes('data-station="scan"'));
assert.ok(page.includes('id="checkinVideo"'));
assert.ok(page.includes('id="kidsWaiverBtn"'));
assert.ok(page.includes('id="adultWaiverBtn"'));
assert.ok(page.includes('id="scanTable"'));
assert.ok(page.includes('id="checkinDate"'));
assert.ok(page.includes("Checked in today"));
assert.ok(page.includes('data-scan-filter="kids"'));
assert.ok(page.includes('data-scan-filter="adults"'));
assert.equal(page.includes("<iframe"), false);
assert.equal(page.includes('"/app/scan'), false);

assert.ok(staff.includes('href="/app/scan/"'));
assert.ok(app.includes("function handleScans"));
assert.ok(app.includes("function resolveScan"));
assert.ok(app.includes("async function scanVideoFrame"));
assert.ok(app.includes("function showScanResult"));
assert.ok(app.includes("function waiverWarning"));
assert.ok(app.includes("function adultScanNote"));
assert.ok(app.includes("async function startScanStation"));
assert.ok(app.includes('dataset.station === "scan"'));
assert.ok(app.includes('"/kids/waiver/"'));
assert.ok(app.includes('"/waiver/"'));
assert.ok(app.includes("/waiver/waiver.js?station="));
assert.ok(app.includes("data-station-undo"));
assert.ok(app.includes("Remove the check-in for"));
assert.equal(app.includes("frame-ancestors"), false);

const staffList = sw.split("const STAFF_ASSETS")[1].split("const PUBLIC_APP")[0];
const publicList = sw.split("const PUBLIC_ASSETS")[1].split("const STAFF_ASSETS")[0];
assert.equal(staffList.includes("/app/scan"), false);
assert.equal(publicList.includes("/app/scan"), false);
assert.ok(nginx.includes("frame-src https://www.youtube-nocookie.com"));
assert.equal(nginx.includes("frame-src 'self'"), false);

console.log("scan station checks passed");
