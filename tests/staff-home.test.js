/* Staff home summary, CSV links, and the one-page class print. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");

assert.ok(html.includes('id="homeSummary"'));
assert.ok(html.includes('href="/api/export/roster.csv"'));
assert.ok(html.includes('href="/api/export/attendance.csv"'));
assert.ok(html.includes('id="printLessonBtn"'));
assert.ok(js.includes("function renderHome()"));
assert.ok(js.includes("Close to a stripe"));
assert.ok(js.includes("The head instructor decides."));
assert.ok(js.includes('document.body.dataset.print = "lesson"'));
assert.ok(css.includes('body[data-print="lesson"]'));
assert.ok(css.includes("font-size: 22pt"));

console.log("staff home checks passed");
