const assert = require("assert");
const P = require("../js/plan-math.js");

function sum(nums) {
  return nums.reduce((a, b) => a + b, 0);
}

assert.strictEqual(P.nextClassDate(new Date(2026, 9, 20)), "2026-10-27");
assert.strictEqual(P.nextClassDate("2026-10-27"), "2026-10-27");
assert.strictEqual(P.nextClassDate(new Date(2026, 9, 28)), "2026-11-10");
assert.strictEqual(P.nextClassDate(new Date(2026, 10, 10)), "2026-11-10");
assert.strictEqual(P.nextClassDate(new Date(2026, 10, 11)), "2026-11-24");
assert.strictEqual(P.isClassTuesday(new Date(2026, 9, 13)), true);
assert.strictEqual(P.isClassTuesday(new Date(2026, 9, 20)), false);
assert.strictEqual(P.isClassTuesday(new Date(2026, 9, 6)), false);

assert.strictEqual(P.formatClock(17 * 60 + 30), "5:30");
assert.strictEqual(P.formatClock(18 * 60 + 15), "6:15");
assert.strictEqual(P.clockRange(17 * 60 + 30, 0, 5 * 60), "5:30–5:35");
assert.strictEqual(P.clockRange(17 * 60 + 30, 5 * 60, 30), "5:35–5:35:30");
assert.strictEqual(P.formatClock(17 * 60 + 35), "5:35");
assert.strictEqual(P.classSpan(17 * 60 + 30, 45), "5:30–6:15 PM PT");

const tight = P.allocateItemTimes(Array(12).fill(2), 120);
assert.strictEqual(sum(tight), 120);
assert.ok(tight.every((t) => t >= 0));
assert.ok(Math.max(...tight) < 120);

const roomy = P.allocateItemTimes([2, 2, 2], 360);
assert.strictEqual(sum(roomy), 360);
assert.ok(roomy.every((t) => t >= 30));

const shifted = P.allocateItemTimes([4, 1], 300);
const even = P.allocateItemTimes([1, 1], 300);
assert.strictEqual(sum(shifted), 300);
assert.strictEqual(sum(even), 300);
assert.ok(shifted[0] > even[0], "more reps must take more of the section");

const parts = P.allocateParts(
  [
    { id: "opening", flex: false, seconds: 180 },
    { id: "warmup", flex: false, seconds: 300 },
    { id: "water1", flex: false, seconds: 60 },
    { id: "base", flex: true, weight: 360 },
    { id: "lesson", flex: true, weight: 720 },
    { id: "water2", flex: false, seconds: 60 },
    { id: "games", flex: false, seconds: 300 },
    { id: "sparring", flex: true, weight: 360 },
    { id: "finish", flex: false, seconds: 180 },
  ],
  45 * 60
);
assert.strictEqual(sum(parts.seconds), 45 * 60);
assert.strictEqual(parts.squeezed, false);
assert.strictEqual(parts.seconds[1], 300);
assert.strictEqual(parts.seconds[6], 300);

const overflow = P.allocateParts(
  [
    { id: "opening", flex: false, seconds: 20 * 60 },
    { id: "warmup", flex: false, seconds: 10 * 60 },
    { id: "finish", flex: false, seconds: 10 * 60 },
  ],
  15 * 60
);
assert.strictEqual(sum(overflow.seconds), 15 * 60);
assert.strictEqual(overflow.squeezed, true);
assert.ok(overflow.seconds.every((s) => s < 20 * 60));

let seed = 7;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}
for (let i = 0; i < 200; i += 1) {
  const n = 1 + Math.floor(rnd() * 12);
  const budget = Math.floor(rnd() * 2000);
  const prefs = Array.from({ length: n }, () => 0.5 + rnd() * 8);
  const times = P.allocateItemTimes(prefs, budget);
  assert.strictEqual(times.length, n);
  assert.strictEqual(sum(times), budget);
}

assert.strictEqual(P.prefMinutes(2, 2, 4), 4);
assert.ok(P.rankScore({ belt: "green", stripes: 0 }) > P.rankScore({ belt: "white", stripes: 4 }));
const lined = P.sortByRank([
  { name: "Ada", belt: "white", stripes: 4 },
  { name: "Bea", belt: "grey", stripes: 1 },
  { name: "Cam", belt: "grey", stripes: 1 },
]);
assert.deepStrictEqual(lined.map((k) => k.name), ["Bea", "Cam", "Ada"]);

assert.strictEqual(P.canHeadClass({ belt: "blue", stripes: 0 }), true);
assert.strictEqual(P.canHeadClass({ belt: "purple", stripes: 0 }), true);
assert.strictEqual(P.canHeadClass({ belt: "black", stripes: 2 }), true);
assert.strictEqual(P.canHeadClass({ belt: "white", stripes: 4 }), false);
assert.strictEqual(P.canHeadClass({ belt: "grey", stripes: 4 }), false);
assert.strictEqual(P.canAssistClass({ belt: "white", stripes: 1 }), false);
assert.strictEqual(P.canAssistClass({ belt: "white", stripes: 2 }), true);
assert.strictEqual(P.canAssistClass({ belt: "blue", stripes: 0 }), true);
assert.strictEqual(P.canAssistClass({ belt: "brown", stripes: 0 }), true);
assert.strictEqual(P.ratioStatus(8, 2).ok, true);
assert.strictEqual(P.ratioStatus(9, 2).ok, false);
assert.strictEqual(P.ratioStatus(5, 0).ok, false);
assert.strictEqual(P.kidCanSpar({ stripes: 0 }, "peewee", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 1 }, "peewee", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 4 }, "mite", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2 }, "teen", false), false);

const builtins = new Set(["wu-bear"]);
const badCat = P.sanitizeActivity({ name: "Nope", category: "attack", id: "c-ok" }, builtins);
assert.strictEqual(badCat.ok, false);
const clash = P.sanitizeActivity({ name: "Bear", category: "warmup", id: "wu-bear" }, builtins);
assert.strictEqual(clash.ok, true);
assert.notStrictEqual(clash.activity.id, "wu-bear");
assert.ok(P.cleanId(clash.activity.id));
const nasty = P.sanitizeActivity(
  { name: "Ok", category: "game", id: '"><img src=x>', how: "<script>" },
  builtins
);
assert.strictEqual(nasty.ok, true);
assert.ok(!nasty.activity.id.includes("<"));
assert.ok(P.escapeHtml(nasty.activity.how).includes("&lt;"));
assert.ok(!P.escapeHtml(`a"b'c`).includes('"'));
assert.strictEqual(P.safeSrc("sheets/comic/bow-1.png?v=1"), "/sheets/comic/bow-1.png?v=1");
assert.strictEqual(P.safeSrc("javascript:alert(1)"), "");
assert.deepStrictEqual(P.sanitizeIdList(["ok", "<bad>", "wu-bear", "ok"]), ["ok", "wu-bear"]);

const kid = P.sanitizeRosterKid({ name: "Sam", age: 99, belt: "not-a-belt", stripes: 9 });
assert.strictEqual(kid.belt, "white");
assert.strictEqual(kid.stripes, 4);
assert.strictEqual(kid.age, 17);

const fit = P.fitClassTimes(
  { opening: 120, warmup: 300, base: 240, lesson: 1200, water: 60, sparring: 360, game: 300, finish: 120 },
  45 * 60
);
assert.strictEqual(fit.sum, 45 * 60);
assert.strictEqual(fit.seconds.lesson, 1200);
assert.strictEqual(fit.seconds.game, 300);
assert.strictEqual(fit.squeezed, false);

const tightFit = P.fitClassTimes(
  { opening: 120, warmup: 300, base: 300, lesson: 1200, water: 60, sparring: 360, game: 300, finish: 120 },
  45 * 60
);
assert.strictEqual(tightFit.sum, 45 * 60);
assert.strictEqual(tightFit.seconds.lesson, 1200);
assert.strictEqual(tightFit.seconds.warmup, 240);
assert.strictEqual(tightFit.squeezed, true);

const short = P.fitClassTimes(
  { opening: 120, warmup: 300, base: 240, lesson: 1200, water: 60, sparring: 360, game: 300, finish: 120 },
  20 * 60
);
assert.strictEqual(short.sum, 20 * 60);
assert.strictEqual(short.seconds.warmup, 0);
assert.strictEqual(short.seconds.base, 0);
assert.strictEqual(short.seconds.game, 180);
assert.ok(short.seconds.lesson > short.seconds.game);

const extra = P.fitClassTimes(
  { opening: 120, warmup: 300, base: 240, lesson: 1200, water: 60, sparring: 360, game: 300, finish: 120 },
  50 * 60
);
assert.strictEqual(extra.seconds.lesson, 1200 + 5 * 60);

const logs = [
  { taught: true, ageGroup: "peewee", theme: "mount" },
  { taught: true, ageGroup: "peewee", theme: "side" },
  { taught: true, ageGroup: "peewee", theme: "guard" },
  { taught: true, ageGroup: "junior", theme: "mount" },
];
assert.strictEqual(P.themeStaleness("mount", logs, "peewee"), 2);
const withCombo = logs.concat([{ taught: true, ageGroup: "mite+peewee", theme: "back" }]);
assert.strictEqual(P.themeStaleness("back", withCombo, "peewee"), 0);
assert.strictEqual(P.themeStaleness("back", withCombo, "mite"), 0);
assert.strictEqual(P.themeStaleness("back", withCombo, "junior"), Infinity);
assert.strictEqual(P.themeReason("Mount", 2), "Mount: not taught in 2 classes");
assert.strictEqual(P.themeReason("Back", Infinity), "Back: not taught yet");
const chosen = P.chooseTheme(
  [
    { id: "mount", label: "Mount", order: 2 },
    { id: "back", label: "Back control", order: 7 },
  ],
  logs,
  "peewee",
  ""
);
assert.strictEqual(chosen.id, "back");
assert.strictEqual(P.chooseTheme([{ id: "mount", label: "Mount" }], logs, "peewee", "mount").locked, true);
assert.strictEqual(
  P.chooseTheme(
    [
      { id: "mount", label: "Mount", order: 2 },
      { id: "back", label: "Back control", order: 7 },
    ],
    logs,
    "peewee",
    "",
    1
  ).id,
  "mount"
);
const cardId = "c-sam01";
assert.strictEqual(P.parseQr(P.qrPayload(cardId)), cardId);
assert.strictEqual(P.parseQr("GBJJ1|c-sam01|zzzz"), "");
assert.strictEqual(P.parseQr("not-a-card"), "");
const progress = P.sanitizeProgress({
  classes: [{ id: "bad id", date: "2026-10-27", ageGroup: "mite", theme: "Mount!", taught: 1, attended: ["c-sam01", "<x>"] }],
  levels: { "c-sam01": { "ls-upa": "own", "ls-upa": "nope" } },
  stripe: { own: 99, attend: 0 },
});
assert.strictEqual(progress.classes[0].date, "2026-10-27");
assert.strictEqual(progress.classes[0].theme, "mount");
assert.deepStrictEqual(progress.classes[0].attended, ["c-sam01"]);
assert.strictEqual(progress.levels["c-sam01"], undefined);
assert.strictEqual(progress.stripe.own, 40);
assert.strictEqual(progress.stripe.attend, 1);
assert.strictEqual(P.STRIPES_ON_BELT, 4);
assert.deepStrictEqual(P.BELT_GROUP_MIN_AGE, { grey: 4, yellow: 7, orange: 10, green: 13 });
function promo(age, belt, stripes) {
  return P.promotionHint({ age, belt, stripes });
}
assert.strictEqual(promo(4, "white", 4).text, "Ready for next belt: Grey-white. The head instructor decides.");
assert.strictEqual(promo(3, "white", 4).text, "4 stripes, waiting on age for Grey-white. The head instructor decides.");
assert.strictEqual(promo(6, "grey-black", 4).text, "4 stripes, waiting on age for Yellow-white. The head instructor decides.");
assert.strictEqual(promo(7, "grey-black", 4).text, "Ready for next belt: Yellow-white. The head instructor decides.");
assert.strictEqual(promo(9, "yellow-black", 4).text, "4 stripes, waiting on age for Orange-white. The head instructor decides.");
assert.strictEqual(promo(10, "yellow-black", 4).text, "Ready for next belt: Orange-white. The head instructor decides.");
assert.strictEqual(promo(12, "orange-black", 4).text, "4 stripes, waiting on age for Green-white. The head instructor decides.");
assert.strictEqual(promo(13, "orange-black", 4).text, "Ready for next belt: Green-white. The head instructor decides.");
assert.strictEqual(promo(4, "grey-white", 4).ready, true);
assert.strictEqual(promo(15, "green-black", 4), null);
assert.strictEqual(promo(12, "grey", 3), null);
const seq = P.takeSequence([{ id: "a" }, { id: "b" }, { id: "c" }], 2, 1);
assert.deepStrictEqual(seq.map((item) => item.id), ["b", "c"]);

assert.strictEqual(P.normalizeAgeKey("peewee+mite"), "mite+peewee");
assert.strictEqual(P.normalizeAgeKey("junior"), "junior");
assert.strictEqual(P.normalizeAgeKey("toddler"), "toddler");
assert.strictEqual(P.normalizeAgeKey("nope"), "mite");
assert.strictEqual(P.normalizeAgeKey("mite+toddler"), "mite");
assert.strictEqual(P.isCombo("mite+peewee"), true);
assert.strictEqual(P.isCombo("teen"), false);
assert.strictEqual(P.youngestAge("junior+teen"), "junior");
assert.strictEqual(P.comboLabel("mite+peewee"), "Combo class: 4–6 + 7–9");
assert.strictEqual(P.comboLabel("mite"), "");
assert.strictEqual(P.ageKey(["teen", "mite"]), "mite+teen");
assert.strictEqual(P.kidFitsClass(14, "mite"), true);
assert.strictEqual(P.kidFitsClass(5, "mite+peewee"), true);
assert.strictEqual(P.kidFitsClass(8, "peewee+mite"), true);
assert.strictEqual(P.kidFitsClass(11, "mite+peewee"), false);
assert.strictEqual(P.kidFitsClass(3, "mite+peewee"), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 5 }, "mite", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 8 }, "peewee", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 0, age: 8 }, "peewee", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 8 }, "peewee", false), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 5 }, "junior", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 5 }, "mite+peewee", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 1, age: 8 }, "mite+peewee", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 11 }, "mite+peewee", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 0, age: 14 }, "junior+teen", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 14 }, "junior+teen", true), true);
assert.ok(P.COMBO_SPARRING_SAFETY.includes("Never pair a 4–6 with a 10–15."));
assert.strictEqual(
  P.olderVariationNote("mite", ["mite", "peewee"], [
    { name: "Hold mount", ages: ["mite", "peewee", "junior", "teen"] },
    { name: "Americana from mount", ages: ["peewee", "junior", "teen"] },
    { name: "Armbar from mount", ages: ["peewee", "junior", "teen"] },
  ]),
  "Older kids: 7–9: Americana from mount, Armbar from mount."
);
assert.strictEqual(
  P.olderVariationNote("mite", ["mite", "junior"], [{ name: "Hold mount", ages: ["mite", "junior"] }]),
  "Older kids: 10–12: use the 4–6 version."
);
assert.strictEqual(P.olderVariationNote("mite", ["mite"], [{ name: "Invented", ages: ["teen"] }]), "");
const comboSaved = P.sanitizeProgress({
  classes: [{ date: "2027-06-09", ageGroup: "peewee+mite", taught: true, attended: ["c-sam01"] }],
});
assert.strictEqual(comboSaved.classes[0].ageGroup, "mite+peewee");
const singleSaved = P.sanitizeProgress({
  classes: [{ date: "2027-08-11", ageGroup: "junior", taught: true, attended: ["c-sam01"] }],
});
assert.strictEqual(singleSaved.classes[0].ageGroup, "junior");

console.log("plan-math tests passed");
