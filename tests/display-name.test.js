/* Display names: a login copied into the staff roster is capitalized on screen only. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const P = require("../js/plan-math.js");

const login = "dakota";
assert.strictEqual(P.displayStaffName("dakota", "dakota"), "Dakota");
assert.strictEqual(P.displayStaffName("Dakota", "dakota"), "Dakota");
assert.strictEqual(P.displayStaffName("Coach Dak", "dakota"), "Coach Dak");
assert.strictEqual(P.displayStaffName("", "alex"), "Alex");
assert.strictEqual(P.displayStaffName("   ", "jordan"), "Jordan");
assert.strictEqual(P.displayStaffName("sam", ""), "sam");
assert.strictEqual(P.displayStaffName("Riley", ""), "Riley");
assert.strictEqual(P.displayStaffName(login, login), "Dakota");
assert.strictEqual(login, "dakota");

const app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../app/index.html"), "utf8");
assert.ok(app.includes("P.displayStaffName"), "app uses displayStaffName");
assert.ok(app.includes("function shownStaffName"), "staff labels go through one helper");
assert.ok(app.includes("function instructorName()"), "line-up script still asks instructorName");
assert.ok(app.includes('replaceAll("{instructor}", instructor)'), "line-up token is still filled");
assert.ok(app.includes("Teacher ${esc(displayInstructor(s))}"), "plan header uses the display name");
assert.ok(app.includes("Teacher ${esc(instructorName() || \"the teacher\")}"), "home, review, and class log show the display name");
assert.ok(app.includes("function staffLabel"), "a stale plan-math still has a display fallback");
assert.ok(app.includes("Opens with a short prayer."), "home card still mentions the prayer");
assert.ok(!app.includes("who.textContent = `${state.session.username}"), "account line is not the raw login");
assert.ok(app.includes("sessionDisplayName()"), "account menu uses the display name");
assert.ok(app.includes("login ${esc(user.username)}"), "admin list still shows the login");
assert.ok(app.includes('data-username="${esc(user.username)}"'), "password reset keeps the login username");
assert.ok(app.includes('aria-label="Name on the plan"'), "staff roster names the plan field");
assert.ok(app.includes('value="${esc(person.name)}"'), "staff editor keeps the stored name");
assert.ok(html.includes("The login itself stays as typed."), "account hint says the login is unchanged");
assert.ok(html.includes('id="username"') === false, "staff page does not host the login field");
assert.ok(app.includes('const username = $("newUsername").value.trim()'), "new logins are saved as typed");

const prayer = app.indexOf('placeItems("prayer"');
const opening = app.indexOf('placeItems("opening"');
assert.ok(prayer > 0 && opening > prayer, "opening prayer stays before the line-up");

const loginPage = fs.readFileSync(path.join(__dirname, "../login/index.html"), "utf8");
assert.ok(loginPage.includes('id="username"'), "login field stays the username");
assert.ok(!loginPage.includes("displayStaffName"), "login page does not rewrite the username");
