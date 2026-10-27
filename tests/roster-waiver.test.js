/* Staff roster waiver view and kids name edit. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
const privacy = fs.readFileSync(path.join(root, "privacy/index.html"), "utf8");
const api = fs.readFileSync(path.join(root, "server/httpapp.py"), "utf8");

assert.ok(!app.includes("window.open"));
assert.ok(!app.includes("noopener,noreferrer"));
assert.ok(!app.includes("Allow pop-ups to print the form."));
assert.ok(app.includes('data-roster="waiver"'));
assert.ok(app.includes('data-roster="rename"'));
assert.ok(app.includes('maxlength="40"'));
assert.ok(app.includes("Add the student's name."));
assert.ok(app.includes("/name"));
assert.ok(app.includes('document.body.dataset.print = "waiver"'));
assert.ok(app.includes("window.print()"));
assert.ok(app.includes("function printStaffWaiver"));
assert.ok(app.includes("signatureSrc"));
assert.ok(app.includes('detail.kind === "adult"'));
assert.ok(app.includes('Object.prototype.hasOwnProperty.call(value, "name")'));

assert.ok(html.includes('id="waiverView"'));
assert.ok(html.includes('id="waiverPrintSheet"'));
assert.ok(html.includes('id="waiverPrintBtn"'));
assert.ok(html.includes('content="noindex, nofollow, noarchive, nosnippet"'));

assert.ok(css.includes('body[data-print="waiver"]'));
assert.ok(css.includes("size: letter"));
assert.ok(css.includes("margin: 0.5in"));
assert.ok(css.includes(".waiver-print-sheet"));
assert.ok(css.includes("max-height: 10in"));

assert.ok(api.includes("def rename_student"));
assert.ok(api.includes("/name$"));
assert.ok(api.includes('"rename"'));
assert.ok(api.includes("That name edit is for a kids student."));
assert.ok(privacy.includes("a kid's name"));

console.log("roster waiver checks passed");
