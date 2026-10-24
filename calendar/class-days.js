/* Class days for the public welcome pages. The kids program is the 2nd and
   4th Tuesday, on or after October 27, 2026. The adult program is every
   Tuesday and Thursday. Both use America/Los_Angeles. Skips and make-up
   dates come from class_exceptions and are applied on top of that schedule.
   The default export is the kids program, so existing pages keep working. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GRACE_CLASS_DAYS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TIME_ZONE = "America/Los_Angeles";
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

  function monthIndex(year, month) {
    return year * 12 + (month - 1);
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

  function createProgram(spec) {
    const notBefore = spec.notBefore;
    const windowStart = spec.windowStart;
    const defaultStart = spec.start;
    const defaultEnd = spec.end;

    function isClassDay(year, month, day) {
      if (!isRealDay(year, month, day)) return false;
      const date = utcDate(year, month, day);
      if (spec.weekdays.indexOf(date.getUTCDay()) === -1) return false;
      if (spec.nth) {
        const which = Math.floor((day - 1) / 7) + 1;
        if (spec.nth.indexOf(which) === -1) return false;
      }
      if (notBefore && compare({ year, month, day }, notBefore) < 0) return false;
      return true;
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
          start: item.start || item.start_time || defaultStart,
          end: item.end || item.end_time || defaultEnd,
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
        return { meets: true, skipped: false, extra: false, reason: "", start: defaultStart, end: defaultEnd };
      }
      return { meets: false, skipped: false, extra: false, reason: "", start: "", end: "" };
    }

    function nextClass(from, exceptions) {
      let cursor = laParts(from);
      const list = cleanExceptions(exceptions);
      if (notBefore && compare(cursor, notBefore) < 0) {
        const early = list.find((item) => {
          if (item.kind !== "extra") return false;
          const date = fromIso(item.date);
          return date && compare(date, cursor) >= 0 && compare(date, notBefore) < 0;
        });
        cursor = early ? fromIso(early.date) : { year: notBefore.year, month: notBefore.month, day: notBefore.day };
      }
      for (let i = 0; i < 400; i += 1) {
        if (meeting(cursor.year, cursor.month, cursor.day, list).meets) {
          return { year: cursor.year, month: cursor.month, day: cursor.day };
        }
        cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
      }
      if (notBefore) return { year: notBefore.year, month: notBefore.month, day: notBefore.day };
      return cursor;
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
      return { year: windowStart.year, month: windowStart.month };
    }

    function latestMonth(from) {
      const today = laParts(from);
      return addMonths(today.year, today.month, FORWARD_MONTHS);
    }

    function canShowMonth(year, month, from) {
      const index = monthIndex(year, month);
      const first = earliestMonth();
      const last = latestMonth(from);
      return index >= monthIndex(first.year, first.month) && index <= monthIndex(last.year, last.month);
    }

    function clampMonth(year, month, from) {
      if (monthIndex(year, month) < monthIndex(windowStart.year, windowStart.month)) return earliestMonth();
      const last = latestMonth(from);
      if (monthIndex(year, month) > monthIndex(last.year, last.month)) return last;
      return { year, month };
    }

    function esc(value) {
      return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    function mountCalendar(options) {
      const opts = options || {};
      const calendarRoot = opts.root;
      const calendarNotes = opts.notes || null;
      const nextEl = opts.next || null;
      const now = opts.now instanceof Date ? opts.now : new Date();
      let classExceptions = Array.isArray(opts.exceptions) ? opts.exceptions : [];
      let view = clampMonth(laParts(now).year, laParts(now).month, now);
      if (!calendarRoot) {
        return { setExceptions() {}, render() {} };
      }

      function paintNextClass() {
        if (!nextEl) return;
        const upcoming = nextClass(now, classExceptions);
        const info = meeting(upcoming.year, upcoming.month, upcoming.day, classExceptions);
        const when = longDate(upcoming.year, upcoming.month, upcoming.day);
        const clock = info.extra && info.start && info.end ? " · " + info.start + "–" + info.end + " PT" : "";
        nextEl.textContent = "Next class: " + when + clock;
      }

      function renderCalendar() {
        const today = laParts(now);
        const next = nextClass(now, classExceptions);
        const notes = [];
        view = clampMonth(view.year, view.month, now);
        const prev = addMonths(view.year, view.month, -1);
        const following = addMonths(view.year, view.month, 1);
        const prevOk = canShowMonth(prev.year, prev.month, now);
        const nextOk = canShowMonth(following.year, following.month, now);
        const title = monthTitle(view.year, view.month);
        const cells = monthCells(view.year, view.month);
        const weeks = [];
        for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
        if (!calendarRoot.querySelector("table")) {
          const head = WEEKDAYS.map((name) => `<th scope="col" abbr="${esc(name)}">${esc(name.slice(0, 3))}</th>`).join("");
          calendarRoot.innerHTML = `
          <div class="cal-nav">
            <button type="button" data-cal="prev" aria-label="Previous month">Prev</button>
            <h3 id="calHeading" aria-live="polite"></h3>
            <button type="button" data-cal="next" aria-label="Next month">Next</button>
          </div>
          <table class="month-grid">
            <caption class="visually-hidden"></caption>
            <thead><tr>${head}</tr></thead>
            <tbody></tbody>
          </table>`;
        }
        calendarRoot.querySelector("[data-cal=prev]").disabled = !prevOk;
        calendarRoot.querySelector("[data-cal=next]").disabled = !nextOk;
        calendarRoot.querySelector("#calHeading").textContent = title;
        calendarRoot.querySelector("caption").textContent = "Class days in " + title;
        const body = weeks
          .map((week) => {
            const row = week
              .map((cell) => {
                if (!cell.inMonth) return `<td class="is-out"><span aria-hidden="true">${cell.day}</span></td>`;
                const info = meeting(cell.year, cell.month, cell.day, classExceptions);
                const classDay = info.meets;
                const isNext = classDay && cell.year === next.year && cell.month === next.month && cell.day === next.day;
                const isToday = cell.year === today.year && cell.month === today.month && cell.day === today.day;
                const classes = ["day"];
                if (classDay) classes.push("is-class");
                if (info.extra) classes.push("is-extra");
                if (info.skipped) classes.push("is-skip");
                if (isNext) classes.push("is-next");
                if (isToday) classes.push("is-today");
                const label = dayLabel(cell.year, cell.month, cell.day, { classDay, next: isNext, today: isToday });
                let tag = "";
                if (info.skipped) {
                  tag = `<span class="day-tag">No class</span>`;
                  const why = info.reason ? ` (${info.reason})` : "";
                  notes.push(`<li>${esc(longDate(cell.year, cell.month, cell.day))}: No class${esc(why)}</li>`);
                } else if (isNext) {
                  tag = `<span class="day-tag">Next class</span>`;
                } else if (info.extra) {
                  tag = `<span class="day-tag">Make-up</span>`;
                  if (info.reason) notes.push(`<li>${esc(longDate(cell.year, cell.month, cell.day))}: ${esc(info.reason)}</li>`);
                }
                const skipLabel = info.skipped ? `, no class${info.reason ? ", " + info.reason : ""}` : "";
                return `<td class="${classes.join(" ")}" aria-label="${esc(label + skipLabel)}"><span class="day-num">${cell.day}</span>${tag}</td>`;
              })
              .join("");
            return `<tr>${row}</tr>`;
          })
          .join("");
        calendarRoot.querySelector("tbody").innerHTML = body;
        if (calendarNotes) calendarNotes.innerHTML = notes.join("");
      }

      calendarRoot.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-cal]");
        if (!btn || btn.disabled) return;
        const step = btn.dataset.cal === "next" ? 1 : -1;
        view = addMonths(view.year, view.month, step);
        renderCalendar();
      });
      paintNextClass();
      renderCalendar();
      return {
        setExceptions(list) {
          classExceptions = Array.isArray(list) ? list : [];
          paintNextClass();
          renderCalendar();
        },
        render: renderCalendar,
      };
    }

    return {
      program: spec.program,
      TIME_ZONE,
      FIRST: spec.first,
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
      mountCalendar,
    };
  }

  const kids = createProgram({
    program: "kids",
    weekdays: [2],
    nth: [2, 4],
    notBefore: { year: 2026, month: 10, day: 27 },
    first: { year: 2026, month: 10, day: 27 },
    windowStart: { year: 2026, month: 10 },
    start: "17:30",
    end: "18:15",
  });

  const adult = createProgram({
    program: "adult",
    weekdays: [2, 4],
    nth: null,
    notBefore: null,
    first: { year: 2026, month: 10, day: 1 },
    windowStart: { year: 2026, month: 10 },
    start: "18:30",
    end: "20:00",
  });

  function forProgram(name) {
    return name === "adult" ? adult : kids;
  }

  kids.forProgram = forProgram;
  adult.forProgram = forProgram;
  return kids;
});
