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
assert.strictEqual(P.kidCanSpar({ stripes: 4 }, "mite", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 0 }, "mite", true), false);
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
globalThis.BJJ_BASE = "/demo";
assert.strictEqual(P.safeSrc("sheets/comic/bow-1.png?v=1"), "/demo/sheets/comic/bow-1.png?v=1");
assert.strictEqual(P.safeSrc("/demo/img/logo/grace-logo-mark-transparent.png"), "/demo/img/logo/grace-logo-mark-transparent.png");
assert.strictEqual(P.safeSrc("javascript:alert(1)"), "");
delete globalThis.BJJ_BASE;
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
assert.strictEqual(extra.seconds.prayer, 0);

const shape = {
  opening: 120,
  warmup: 180,
  base: 240,
  lesson: 1200,
  water: 60,
  sparring: 360,
  game: 300,
  finish: 120,
};
const fresh = P.coverOpeningPrayer(shape, 45 * 60);
assert.strictEqual(fresh.prayer, P.PRAYER_SECONDS);
assert.strictEqual(fresh.warmup, 180);
assert.strictEqual(fresh.lesson, 1200);
const freshFit = P.fitClassTimes(fresh, 45 * 60);
assert.strictEqual(freshFit.sum, 45 * 60);
assert.strictEqual(freshFit.seconds.lesson, 1200);
assert.strictEqual(freshFit.seconds.prayer, 120);
assert.strictEqual(freshFit.seconds.warmup, 180);
assert.strictEqual(freshFit.squeezed, false);

const savedWarmup = P.coverOpeningPrayer({ ...shape, warmup: 300 }, 45 * 60);
assert.strictEqual(savedWarmup.warmup, 180);
assert.strictEqual(savedWarmup.prayer, 120);
assert.strictEqual(savedWarmup.lesson, 1200);
const savedFit = P.fitClassTimes(savedWarmup, 45 * 60);
assert.strictEqual(savedFit.sum, 45 * 60);
assert.strictEqual(savedFit.seconds.lesson, 1200);
assert.strictEqual(savedFit.squeezed, false);

const longer = P.coverOpeningPrayer(shape, 50 * 60);
assert.strictEqual(longer.warmup, 180);
assert.strictEqual(longer.prayer, 120);
const roomyFit = P.fitClassTimes(longer, 50 * 60);
assert.strictEqual(roomyFit.seconds.lesson, 1200 + 5 * 60);
assert.strictEqual(roomyFit.seconds.prayer, 120);
assert.strictEqual(roomyFit.squeezed, false);

const funded = P.fundOpeningPrayer({ warmup: 400, lesson: 1200, games: 300, opening: 480 });
assert.strictEqual(funded.prayer, 120);
assert.strictEqual(funded.warmup, 280);
assert.strictEqual(funded.lesson, 1200);
assert.strictEqual(funded.games, 300);
assert.strictEqual(funded.opening, 480);
const thinWarmup = P.fundOpeningPrayer({ warmup: 60, games: 300, lesson: 900 });
assert.strictEqual(thinWarmup.warmup, 0);
assert.strictEqual(thinWarmup.games, 240);
assert.strictEqual(thinWarmup.lesson, 900);
assert.strictEqual(thinWarmup.prayer, 120);
const lessonOnly = P.fundOpeningPrayer({ lesson: 1200 });
assert.strictEqual(lessonOnly.lesson, 1200);
assert.strictEqual(lessonOnly.prayer, 120);

const withPrayer = P.fitClassTimes(
  { prayer: 120, opening: 120, warmup: 0, base: 240, lesson: 1200, water: 60, sparring: 360, game: 300, finish: 120 },
  20 * 60
);
assert.strictEqual(withPrayer.sum, 20 * 60);
assert.strictEqual(withPrayer.seconds.prayer, 120);
assert.ok(withPrayer.seconds.lesson > withPrayer.seconds.game);

const logs = [
  { taught: true, ageGroup: "peewee", theme: "mount" },
  { taught: true, ageGroup: "peewee", theme: "side" },
  { taught: true, ageGroup: "peewee", theme: "guard" },
  { taught: true, ageGroup: "junior", theme: "mount" },
];
assert.strictEqual(P.themeStaleness("mount", logs, "peewee"), 0);
const withCombo = logs.concat([{ taught: true, ageGroup: "mite+peewee", theme: "back" }]);
assert.strictEqual(P.themeStaleness("back", withCombo, "peewee"), 0);
assert.strictEqual(P.themeStaleness("back", withCombo, "mite"), 0);
assert.strictEqual(P.themeStaleness("back", withCombo, "junior"), 0);
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
assert.strictEqual(P.parseQr("1"), "");
assert.strictEqual(P.parseQr("https://bjj.bettrbook.com/p/#1"), "");
const parentToken = "abcDEF123_-xyzABCDE98765";
assert.strictEqual(P.parseQr("https://bjj.bettrbook.com/p/#" + parentToken), "parent:" + parentToken);
assert.strictEqual(P.parseQr("https://bjj.bettrbook.com/demo/p/#" + parentToken), "parent:" + parentToken);
assert.strictEqual(P.parentQrText(parentToken), "/p/#" + parentToken);
assert.strictEqual(P.parentQrText("1"), "");
assert.equal(P.parentQrText(parentToken).includes("http"), false);
assert.strictEqual(P.qrPayload("card1").startsWith("GBJJ1|"), true);
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
const mapped = P.sanitizeProgress({
  levels: { "c-sam01": { "ls-a": "introduced", "ls-b": "practicing", "ls-c": "help", "ls-d": "own" } },
});
assert.deepStrictEqual(P.LEVELS, ["introduced", "drilled", "rolling", "mastered"]);
assert.deepStrictEqual(P.LEVEL_LABELS, {
  introduced: "Introduced",
  drilled: "Drilled",
  rolling: "Applied in rolling",
  mastered: "Mastered",
});
assert.deepStrictEqual(mapped.levels["c-sam01"], {
  "ls-a": "introduced",
  "ls-b": "drilled",
  "ls-c": "rolling",
  "ls-d": "mastered",
});
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

assert.strictEqual(P.normalizeAgeKey("peewee+mite"), "mite+upper");
assert.strictEqual(P.normalizeAgeKey("junior"), "upper");
assert.strictEqual(P.normalizeAgeKey("teen"), "upper");
assert.strictEqual(P.normalizeAgeKey("toddler"), "toddler");
assert.strictEqual(P.normalizeAgeKey("nope"), "mite");
assert.strictEqual(P.normalizeAgeKey("mite+toddler"), "mite");
assert.deepStrictEqual(P.canonicalTechniqueAges(["mite", "peewee"]), ["mite", "upper"]);
assert.deepStrictEqual(P.canonicalTechniqueAges(["junior", "teen"]), ["upper"]);
assert.deepStrictEqual(P.canonicalTechniqueAges(["teen"]), ["teen"]);
assert.deepStrictEqual(P.canonicalTechniqueAges(["mite"]), ["mite"]);
assert.strictEqual(P.kidGroupId(3), "mite");
assert.strictEqual(P.kidGroupId(6), "mite");
assert.strictEqual(P.kidGroupId(7), "upper");
assert.strictEqual(P.kidGroupId(10), "upper");
assert.strictEqual(P.kidGroupId(2), "");
assert.strictEqual(P.kidGroupId(11), "");
assert.strictEqual(P.isCombo("mite+peewee"), true);
assert.strictEqual(P.isCombo("teen"), false);
assert.strictEqual(P.isCombo("junior+teen"), false);
assert.strictEqual(P.youngestAge("junior+teen"), "upper");
assert.strictEqual(P.comboLabel("mite+peewee"), "Combo class: 3–6 + 7–10");
assert.strictEqual(P.comboLabel("mite"), "");
assert.strictEqual(P.ageKey(["teen", "mite"]), "mite+upper");
assert.strictEqual(P.kidFitsClass(14, "mite"), true);
assert.strictEqual(P.kidFitsClass(5, "mite+peewee"), true);
assert.strictEqual(P.kidFitsClass(7, "mite+upper"), true);
assert.strictEqual(P.kidFitsClass(8, "peewee+mite"), true);
assert.strictEqual(P.kidFitsClass(10, "mite+peewee"), true);
assert.strictEqual(P.kidFitsClass(3, "mite+peewee"), true);
assert.strictEqual(P.kidFitsClass(11, "mite+peewee"), false);
assert.strictEqual(P.kidFitsClass(16, "mite+upper"), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 5 }, "mite", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 8 }, "upper", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 0, age: 8 }, "upper", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 8 }, "upper", false), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 5 }, "junior", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 5 }, "mite+peewee", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 1, age: 8 }, "mite+peewee", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 10 }, "mite+peewee", true), true);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 11 }, "mite+peewee", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 16 }, "mite+upper", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 0, age: 14 }, "junior+teen", true), false);
assert.strictEqual(P.kidCanSpar({ stripes: 2, age: 14 }, "junior+teen", true), true);
assert.ok(P.COMBO_SPARRING_SAFETY.includes("Never pair a 3–6 with a 7–10."));
assert.strictEqual(
  P.olderVariationNote("mite", ["mite", "peewee"], [
    { name: "Hold mount", ages: ["mite", "peewee", "junior", "teen"] },
    { name: "Americana from mount", ages: ["peewee", "junior", "teen"] },
    { name: "Knee cut", ages: ["junior", "teen"] },
  ]),
  "Older kids: 7–10: Knee cut."
);
assert.strictEqual(
  P.olderVariationNote("mite", ["mite", "junior"], [{ name: "Hold mount", ages: ["mite", "junior"] }]),
  "Older kids: 7–10: use the 3–6 version."
);
assert.strictEqual(P.olderVariationNote("mite", ["mite"], [{ name: "Invented", ages: ["teen"] }]), "");
const comboSaved = P.sanitizeProgress({
  classes: [{ date: "2027-06-09", ageGroup: "peewee+mite", taught: true, attended: ["c-sam01"] }],
});
assert.strictEqual(comboSaved.classes[0].ageGroup, "mite+upper");
const singleSaved = P.sanitizeProgress({
  classes: [{ date: "2027-08-11", ageGroup: "junior", taught: true, attended: ["c-sam01"] }],
});
assert.strictEqual(singleSaved.classes[0].ageGroup, "upper");

const storedReview = P.sanitizeProgress({
  classes: [
    {
      id: "k-review",
      date: "2026-10-27",
      ageGroup: "mite",
      taught: true,
      techniques: [
        { id: "ls-upa", name: "Upa", position: "Guard", theme: "Guard", skipped: true, skipReason: "time", skipNote: "ignore" },
        { id: "ls-bridge", name: "Bridge", skipped: true, skipReason: "other" },
        { id: "ls-arm", name: "Armbar", skipped: true, skipReason: "other", skipNote: "They rolled away" },
        { id: "off-shrimp", name: "Shrimp", offScript: true, note: "Extra" },
        { id: "ls-upa", name: "Dup", offScript: true },
      ],
    },
    {
      id: "k-next",
      date: "2026-11-10",
      ageGroup: "mite",
      taught: true,
      techniques: [{ id: "ls-trap", name: "Trap", skipped: true, skipReason: "needed" }],
    },
    {
      id: "k-upper",
      date: "2026-11-24",
      ageGroup: "upper",
      taught: true,
      techniques: [{ id: "ls-pass", name: "Pass", skipped: true, skipReason: "different" }],
    },
  ],
});
const reviewed = storedReview.classes.find((entry) => entry.date === "2026-10-27");
assert.strictEqual(reviewed.techniques.find((tech) => tech.id === "ls-upa").skipReason, "time");
assert.strictEqual(reviewed.techniques.find((tech) => tech.id === "ls-upa").skipNote, undefined);
assert.strictEqual(reviewed.techniques.find((tech) => tech.id === "ls-bridge").skipped, undefined);
assert.strictEqual(reviewed.techniques.find((tech) => tech.id === "ls-arm").skipNote, "They rolled away");
assert.strictEqual(reviewed.techniques.find((tech) => tech.id === "off-shrimp").note, "Extra");
assert.strictEqual(reviewed.techniques.filter((tech) => tech.offScript && tech.id === "ls-upa").length, 0);
assert.deepStrictEqual(P.skippedLastClassIds(storedReview.classes, "mite", "2026-11-10"), ["ls-upa", "ls-arm"]);
assert.deepStrictEqual(P.skippedLastClassIds(storedReview.classes, "mite", "2026-11-24"), ["ls-trap"]);
assert.deepStrictEqual(P.skippedLastClassIds(storedReview.classes, "upper", ""), ["ls-pass"]);
assert.deepStrictEqual(P.skippedLastClassIds(storedReview.classes, "mite", "2026-10-27"), []);
assert.strictEqual(P.levelAfterSkip("introduced", "", false), "");
assert.strictEqual(P.levelAfterSkip("mastered", "drilled", false), "drilled");
assert.strictEqual(P.levelAfterSkip("introduced", "introduced", false), "");
assert.strictEqual(P.levelAfterSkip("introduced", "introduced", true), "introduced");
assert.strictEqual(P.levelAfterSkip("drilled", "drilled", false), "drilled");
assert.strictEqual(P.techniqueCountsForProgress({ id: "ls-upa", skipped: true }), false);
assert.strictEqual(P.techniqueCountsForProgress({ id: "off-shrimp", offScript: true }), false);
assert.strictEqual(P.techniqueCountsForProgress({ id: "ls-upa" }), true);
assert.strictEqual(P.skipReasonLabel("needed"), "Kids needed something else");

console.log("plan-math tests passed");
