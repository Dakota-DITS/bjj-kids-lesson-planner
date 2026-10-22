/* Class days for the public welcome page. 2nd and 4th Tuesday, on or after
   October 27, 2026, in America/Los_Angeles. No holiday skips. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GRACE_CLASS_DAYS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TIME_ZONE = "America/Los_Angeles";
  const FIRST = { year: 2026, month: 10, day: 27 };
  const FORWARD_MONTHS = 12;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function compare(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  }

  function laParts(date) {
    const when = date instanceof Date ? date : new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(when);
    const pick = (type) => Number(parts.find((part) => part.type === type).value);
    return { year: pick("year"), month: pick("month"), day: pick("day") };
  }

  function utcDate(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isRealDay(year, month, day) {
    const date = utcDate(year, month, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function isClassDay(year, month, day) {
    if (!isRealDay(year, month, day)) return false;
    const date = utcDate(year, month, day);
    if (date.getUTCDay() !== 2) return false;
    const which = Math.floor((day - 1) / 7) + 1;
    if (which !== 2 && which !== 4) return false;
    return compare({ year, month, day }, FIRST) >= 0;
  }

  function addDays(year, month, day, count) {
    const date = utcDate(year, month, day + count);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function addMonths(year, month, count) {
    const index = year * 12 + (month - 1) + count;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  }

  function nextClass(from) {
    let cursor = laParts(from);
    if (compare(cursor, FIRST) < 0) cursor = { year: FIRST.year, month: FIRST.month, day: FIRST.day };
    for (let i = 0; i < 400; i += 1) {
      if (isClassDay(cursor.year, cursor.month, cursor.day)) return cursor;
      cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
    }
    return { year: FIRST.year, month: FIRST.month, day: FIRST.day };
  }

  function earliestMonth() {
    return { year: FIRST.year, month: FIRST.month };
  }

  function latestMonth(from) {
    const today = laParts(from);
    return addMonths(today.year, today.month, FORWARD_MONTHS);
  }

  function monthIndex(year, month) {
    return year * 12 + (month - 1);
  }

  function canShowMonth(year, month, from) {
    const index = monthIndex(year, month);
    const first = earliestMonth();
    const last = latestMonth(from);
    return index >= monthIndex(first.year, first.month) && index <= monthIndex(last.year, last.month);
  }

  function clampMonth(year, month, from) {
    if (monthIndex(year, month) < monthIndex(FIRST.year, FIRST.month)) return earliestMonth();
    const last = latestMonth(from);
    if (monthIndex(year, month) > monthIndex(last.year, last.month)) return last;
    return { year, month };
  }

  function monthTitle(year, month) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(utcDate(year, month, 1));
  }

  function longDate(year, month, day) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(utcDate(year, month, day));
  }

  function dayLabel(year, month, day, flags) {
    const bits = [longDate(year, month, day)];
    if (flags && flags.classDay) bits.push("class day");
    if (flags && flags.next) bits.push("next class");
    if (flags && flags.today) bits.push("today");
    return bits.join(", ");
  }

  function monthCells(year, month) {
    const firstDow = utcDate(year, month, 1).getUTCDay();
    const count = utcDate(year, month + 1, 0).getUTCDate();
    const cells = [];
    for (let i = 0; i < firstDow; i += 1) {
      cells.push(Object.assign({ inMonth: false }, addDays(year, month, 1, i - firstDow)));
    }
    for (let day = 1; day <= count; day += 1) cells.push({ year, month, day, inMonth: true });
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1];
      cells.push(Object.assign({ inMonth: false }, addDays(last.year, last.month, last.day, 1)));
    }
    return cells;
  }

  return {
    TIME_ZONE,
    FIRST,
    FORWARD_MONTHS,
    WEEKDAYS,
    laParts,
    isClassDay,
    addDays,
    addMonths,
    nextClass,
    earliestMonth,
    latestMonth,
    canShowMonth,
    clampMonth,
    monthTitle,
    longDate,
    dayLabel,
    monthCells,
  };
});
