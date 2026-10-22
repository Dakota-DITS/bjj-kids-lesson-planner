/* Class days: 2nd and 4th Tuesday on or after October 27, 2026. */
const assert = require("assert");
const Days = require("../calendar/class-days.js");

const laEvening = new Date("2026-10-22T01:00:00Z");

assert.strictEqual(Days.isClassDay(2026, 10, 27), true);
assert.strictEqual(Days.isClassDay(2026, 10, 13), false);
assert.strictEqual(Days.isClassDay(2026, 10, 6), false);
assert.strictEqual(Days.isClassDay(2026, 10, 20), false);
assert.strictEqual(Days.isClassDay(2026, 11, 10), true);
assert.strictEqual(Days.isClassDay(2026, 11, 24), true);
assert.strictEqual(Days.isClassDay(2026, 11, 3), false);
assert.strictEqual(Days.isClassDay(2026, 11, 17), false);

const december = [1, 8, 15, 22, 29];
december.forEach((day) => {
  const on = Days.isClassDay(2026, 12, day);
  assert.strictEqual(on, day === 8 || day === 22, "December " + day);
});
const highlighted = Days.monthCells(2026, 12)
  .filter((cell) => cell.inMonth && Days.isClassDay(cell.year, cell.month, cell.day))
  .map((cell) => cell.day);
assert.deepStrictEqual(highlighted, [8, 22]);

assert.strictEqual(Days.dayLabel(2026, 11, 10, { classDay: true }), "Tuesday, November 10, 2026, class day");

assert.deepStrictEqual(Days.nextClass(laEvening), { year: 2026, month: 10, day: 27 });
assert.deepStrictEqual(Days.nextClass(new Date("2026-10-27T20:00:00Z")), { year: 2026, month: 10, day: 27 });
assert.deepStrictEqual(Days.nextClass(new Date("2026-10-28T18:00:00Z")), { year: 2026, month: 11, day: 10 });
assert.deepStrictEqual(Days.laParts(laEvening), { year: 2026, month: 10, day: 21 });

assert.strictEqual(Days.canShowMonth(2026, 9, laEvening), false);
assert.strictEqual(Days.canShowMonth(2026, 10, laEvening), true);
assert.deepStrictEqual(Days.clampMonth(2026, 9, laEvening), { year: 2026, month: 10 });
assert.deepStrictEqual(Days.earliestMonth(), { year: 2026, month: 10 });
assert.deepStrictEqual(Days.latestMonth(laEvening), { year: 2027, month: 10 });
assert.strictEqual(Days.canShowMonth(2027, 10, laEvening), true);
assert.strictEqual(Days.canShowMonth(2027, 11, laEvening), false);

const october = Days.monthCells(2026, 10);
assert.strictEqual(october.length % 7, 0);
assert.strictEqual(october[0].inMonth, false);
assert.deepStrictEqual(
  october.filter((cell) => cell.inMonth).map((cell) => cell.day),
  Array.from({ length: 31 }, (_, i) => i + 1)
);

console.log("class day checks passed");
