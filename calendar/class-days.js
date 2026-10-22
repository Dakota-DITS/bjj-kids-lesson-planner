/* Class days for the public welcome page. 2nd and 4th Tuesday, on or after
   October 27, 2026, in America/Los_Angeles. Skips and make-up dates come
   from class_exceptions and are applied on top of that schedule. */
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

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toIso(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function fromIso(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isRealDay(year, month, day)) return null;
    return { year, month, day };
  }

  function cleanExceptions(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item || (item.kind !== "skip" && item.kind !== "extra")) return;
      const date = fromIso(item.date);
      if (!date) return;
      out.push({
        date: toIso(date.year, date.month, date.day),
        kind: item.kind,
        reason: String(item.reason || "").slice(0, 160),
        start: item.start || item.start_time || "17:30",
        end: item.end || item.end_time || "18:15",
      });
    });
    return out;
  }

  function exceptionOn(year, month, day, exceptions) {
    const iso = toIso(year, month, day);
    return cleanExceptions(exceptions).find((item) => item.date === iso) || null;
  }

  function meeting(year, month, day, exceptions) {
    const hit = exceptionOn(year, month, day, exceptions);
    const regular = isClassDay(year, month, day);
    if (hit && hit.kind === "skip" && regular) {
      return { meets: false, skipped: true, extra: false, reason: hit.reason, start: hit.start, end: hit.end };
    }
    if (hit && hit.kind === "extra" && !regular) {
      return { meets: true, skipped: false, extra: true, reason: hit.reason, start: hit.start, end: hit.end };
    }
    if (regular) {
      return { meets: true, skipped: false, extra: false, reason: "", start: "17:30", end: "18:15" };
    }
    return { meets: false, skipped: false, extra: false, reason: "", start: "", end: "" };
  }

  function nextClass(from, exceptions) {
    let cursor = laParts(from);
    const list = cleanExceptions(exceptions);
    if (compare(cursor, FIRST) < 0) {
      const early = list.find((item) => {
        if (item.kind !== "extra") return false;
        const date = fromIso(item.date);
        return date && compare(date, cursor) >= 0 && compare(date, FIRST) < 0;
      });
      cursor = early ? fromIso(early.date) : { year: FIRST.year, month: FIRST.month, day: FIRST.day };
    }
    for (let i = 0; i < 400; i += 1) {
      if (meeting(cursor.year, cursor.month, cursor.day, list).meets) {
        return { year: cursor.year, month: cursor.month, day: cursor.day };
      }
      cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
    }
    return { year: FIRST.year, month: FIRST.month, day: FIRST.day };
  }

  function upcomingMeetings(from, horizonDays, exceptions) {
    const start = laParts(from);
    const days = Math.max(1, Math.min(400, Number(horizonDays) || 184));
    const out = [];
    let cursor = { year: start.year, month: start.month, day: start.day };
    for (let i = 0; i < days; i += 1) {
      const info = meeting(cursor.year, cursor.month, cursor.day, exceptions);
      if (info.meets || info.skipped) {
        out.push({
          year: cursor.year,
          month: cursor.month,
          day: cursor.day,
          iso: toIso(cursor.year, cursor.month, cursor.day),
          meets: info.meets,
          skipped: info.skipped,
          extra: info.extra,
          reason: info.reason,
          start: info.start,
          end: info.end,
        });
      }
      cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
    }
    return out;
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
    toIso,
    fromIso,
    cleanExceptions,
    meeting,
    upcomingMeetings,
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
