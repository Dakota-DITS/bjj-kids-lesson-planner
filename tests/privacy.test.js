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
  "[Dakota to confirm: period after the student stops attending]",
  "[Dakota to confirm: waitlist cleanup period]",
];
placeholders.forEach((mark) => assert.ok(policy.includes(mark), mark));
assert.equal(policy.includes("[Dakota to confirm: how we will tell people when this policy changes]"), false);
assert.ok(policy.includes("If we change this policy, we'll update the date at the top of this page and let families know at the next class."));
assert.equal(policy.includes("[Dakota to confirm: who can request deletion]"), false);
assert.ok(policy.includes("Only the parent or guardian who signed the enrollment and waiver form (or the adult student who signed their own form) can ask us to view, correct, or delete that information."));
assert.ok(policy.includes('href="mailto:dits%2Bbjj@mail.grokbot.com?subject=Grace%20BJJ%20privacy">dits+bjj@mail.grokbot.com</a> from the address on the form, and we may ask you to confirm who you are before making changes.'));
assert.ok(policy.includes("For a waitlist entry, the parent who submitted the entry can ask us to view, correct, or delete that information."));
assert.equal(/mailto:[^"']*\+/.test(policy), false);
assert.equal(policy.includes("[Dakota to confirm: retention period]"), false);
assert.ok(policy.includes("We keep signed enrollment and waiver forms for as long as the student is active in the program, and for [Dakota to confirm: period after the student stops attending] after that."));
assert.ok(policy.includes("We keep waitlist entries until the family is enrolled, asks to be removed, or [Dakota to confirm: waitlist cleanup period]."));
assert.ok(policy.includes("The software does not delete enrollment forms or waitlist entries on a schedule."));

assert.ok(home.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(kids.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(adult.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(kidsWaiver.includes('href="/privacy/">Privacy Policy</a>'));
assert.ok(adult.includes("By submitting you agree to our"));
assert.ok(kidsWaiver.includes("By submitting you agree to our"));

console.log("privacy checks passed");
