/* Privacy page stays tied to what the site actually does. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const policy = read("privacy/index.html");
const home = read("index.html");
const kids = read("kids/index.html");
const adult = read("waiver/index.html");
const kidsWaiver = read("kids/waiver/index.html");

assert.ok(policy.includes('src="/img/logo/grace-logo-mark-transparent.png"'));
assert.ok(policy.includes("4197 State St, Salem, OR 97301"));
assert.ok(policy.includes("dits%2Bbjj@mail.grokbot.com"));
assert.ok(policy.includes("bjj_session"));
assert.ok(policy.includes("14 days"));
assert.ok(policy.includes("2 hours"));
assert.ok(policy.includes("youtube-nocookie.com"));
assert.ok(policy.includes("https://help.acst.com/en/trust-center/policies/privacy-policy"));
assert.equal(policy.includes("waiverSubmissionsEnabled"), false);
assert.ok(policy.includes("Saving a submission is turned off."));
assert.ok(policy.includes("We do not knowingly collect information directly from children under 13."));
assert.ok(policy.includes("does not sell personal information"));
assert.equal(/google analytics|facebook pixel|we encrypt the database/i.test(policy), false);

const placeholders = [
  "[Dakota to confirm: effective date]",
  "[Dakota to confirm: retention period]",
  "[Dakota to confirm: who can request deletion]",
  "[Dakota to confirm: how we will tell people when this policy changes]",
];
placeholders.forEach((mark) => assert.ok(policy.includes(mark), mark));

assert.ok(home.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(kids.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(adult.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(kidsWaiver.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(adult.includes("By submitting you agree to our"));
assert.ok(kidsWaiver.includes("By submitting you agree to our"));

console.log("privacy checks passed");
