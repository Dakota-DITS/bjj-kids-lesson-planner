/* Adult white-to-blue tracker stays on the one check-in card. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const curriculum = JSON.parse(read("adult-curriculum-blue.json"));
const app = read("js/app.js");
const html = read("app/index.html");
const plan = require("../js/plan-math.js");

assert.ok(Array.isArray(curriculum.levels));
assert.ok(curriculum.levels.length >= 1);
const level = curriculum.levels[0];
assert.strictEqual(level.classes.length, 23);
level.classes.forEach((item, index) => {
  assert.strictEqual(item.number, index + 1);
  assert.ok(item.techniques.length > 0);
  item.techniques.forEach((name) => {
    assert.equal(String(name).includes("[unclear]"), false);
  });
});
const flat = level.classes.map((item) => item.techniques.join(" | ")).join("\n");
["Leverage Principle", "Kata Hajime", "Ippon Seio Nage", "Ezekiel", "Amassa Pao", "American (Side Control)", "Kimura (guard)"].forEach(
  (phrase) => assert.ok(flat.includes(phrase), phrase)
);

assert.ok(html.includes('data-program="kids"'));
assert.ok(html.includes('data-program="adult"'));
assert.ok(html.includes(">Kids<"));
assert.ok(html.includes(">Adults<"));
assert.ok(app.includes('state.program === "adult"'));
assert.ok(app.includes("kidQrText(person)"));
assert.equal(app.includes("adultQr"), false);
assert.ok(app.includes('String(parsed).startsWith("parent:")'));
assert.ok(app.includes("program: \"adult\""));
assert.ok(app.includes("/api/adult-progress"));
assert.ok(app.includes("/api/adult-attendance"));
assert.ok(app.includes("not have a signed waiver"));
assert.ok(app.includes("Check-in is still saved."));

const token = "abcDEF123_-xyzABCDE98765";
assert.strictEqual(plan.parseQr("https://bjj.bettrbook.com/p/#" + token), "parent:" + token);
assert.strictEqual(plan.parseQr(plan.qrPayload("s-abcdef01")), "s-abcdef01");
assert.strictEqual(plan.parentQrText(token), "/p/#" + token);
assert.equal(plan.qrPayload("b-card").startsWith("GBJJ1|"), true);

console.log("adult tracker checks passed");
