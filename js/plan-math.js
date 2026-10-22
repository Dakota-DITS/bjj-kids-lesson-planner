/* Pure helpers for the Grace BJJ Kids planner. No DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BJJ_PLAN = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FIRST_CLASS_ISO = "2026-10-27";
  const RATIO_LIMIT = 4;
  const AGE_IDS = ["mite", "upper", "toddler"];
  const GRACE_AGES = ["mite", "upper"];
  const AGE_RANGES = {
    mite: "3–6",
    upper: "7–10",
    toddler: "3–5",
  };
  // Old class keys still appear on saved plans and technique tags.
  const CLASS_AGE_MAP = {
    mite: "mite",
    upper: "upper",
    peewee: "upper",
    junior: "upper",
    teen: "upper",
  };
  const COMBO_SPARRING_SAFETY =
    "Partner kids within their own age group and similar size. Never pair a 3–6 with a 7–10.";
  const CATEGORIES = ["warmup", "lesson", "game", "base"];
  const BELT_ORDER = [
    "white",
    "grey-white",
    "grey",
    "grey-black",
    "yellow-white",
    "yellow",
    "yellow-black",
    "orange-white",
    "orange",
    "orange-black",
    "green-white",
    "green",
    "green-black",
  ];
  const BELT_LABELS = {
    white: "White",
    "grey-white": "Grey-white",
    grey: "Grey",
    "grey-black": "Grey-black",
    "yellow-white": "Yellow-white",
    yellow: "Yellow",
    "yellow-black": "Yellow-black",
    "orange-white": "Orange-white",
    orange: "Orange",
    "orange-black": "Orange-black",
    "green-white": "Green-white",
    green: "Green",
    "green-black": "Green-black",
  };

  const STANDARD_WARMUP = [
    "wu-run-circles",
    "wu-jacks-pt",
    "wu-pushups",
    "wu-situps",
    "wu-bear",
    "wu-gorilla",
    "wu-jackrabbit",
  ];
  const STANDARD_PLAY = ["gm-dodgeball", "gm-tug-of-war"];
  const BASE_ORDER = ["base-forward-roll", "base-backward-roll", "base-hip-escape"];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function cleanId(value) {
    const id = String(value == null ? "" : value).trim();
    return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : "";
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function isoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseISODate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isoDate(date) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
    return date;
  }

  function isClassTuesday(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    if (date.getDay() !== 2) return false;
    const which = Math.floor((date.getDate() - 1) / 7) + 1;
    return which === 2 || which === 4;
  }

  function nextClassDate(from) {
    const start = parseISODate(FIRST_CLASS_ISO);
    let cursor = from instanceof Date ? new Date(from.getFullYear(), from.getMonth(), from.getDate()) : parseISODate(from);
    if (!cursor) cursor = new Date();
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    if (cursor < start) cursor = new Date(start);
    for (let i = 0; i < 400; i += 1) {
      if (cursor >= start && isClassTuesday(cursor)) return isoDate(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    return FIRST_CLASS_ISO;
  }

  function parseStartMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
    if (!m) return 17 * 60 + 30;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return 17 * 60 + 30;
    return h * 60 + min;
  }

  function formatClock(totalMinutes) {
    return formatClockFromSeconds(Math.round((Number(totalMinutes) || 0) * 60));
  }

  function formatClockFromSeconds(totalSeconds) {
    let secs = Math.round(Number(totalSeconds) || 0);
    secs = ((secs % (24 * 3600)) + 24 * 3600) % (24 * 3600);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const h12 = h % 12 || 12;
    const hm = `${h12}:${String(m).padStart(2, "0")}`;
    return s ? `${hm}:${String(s).padStart(2, "0")}` : hm;
  }

  function clockRange(startMinutes, offsetSec, durSec) {
    const a = startMinutes * 60 + offsetSec;
    const b = a + durSec;
    return `${formatClockFromSeconds(a)}–${formatClockFromSeconds(b)}`;
  }

  function classSpan(startMinutes, totalMinutes) {
    const end = startMinutes + totalMinutes;
    const endH = Math.floor((((Math.round(end) % (24 * 60)) + 24 * 60) % (24 * 60)) / 60);
    const suffix = endH >= 12 ? "PM" : "AM";
    return `${formatClock(startMinutes)}–${formatClock(end)} ${suffix} PT`;
  }

  function scaleTo(weights, target) {
    target = Math.max(0, Math.round(Number(target) || 0));
    const n = weights.length;
    if (!n) return [];
    if (target === 0) return Array(n).fill(0);
    const w = weights.map((x) => Math.max(0, Number(x) || 0));
    const sum = w.reduce((a, b) => a + b, 0);
    const base = sum > 0 ? w : Array(n).fill(1);
    const baseSum = base.reduce((a, b) => a + b, 0);
    const raw = base.map((x) => (x / baseSum) * target);
    const out = raw.map((x) => Math.floor(x));
    let used = out.reduce((a, b) => a + b, 0);
    const frac = raw
      .map((x, i) => ({ i, f: x - Math.floor(x) }))
      .sort((a, b) => b.f - a.f || a.i - b.i);
    let k = 0;
    while (used < target && k < target + n + 5) {
      out[frac[k % n].i] += 1;
      used += 1;
      k += 1;
    }
    return out;
  }

  function withMinimum(times, min, target) {
    const n = times.length;
    if (!n) return [];
    if (min * n > target) return times.slice();
    const out = times.slice();
    let debt = 0;
    for (let i = 0; i < n; i += 1) {
      if (out[i] < min) {
        debt += min - out[i];
        out[i] = min;
      }
    }
    let guard = 0;
    while (debt > 0 && guard < 100000) {
      let idx = -1;
      let best = min;
      for (let i = 0; i < n; i += 1) {
        if (out[i] > best) {
          best = out[i];
          idx = i;
        }
      }
      if (idx < 0) break;
      out[idx] -= 1;
      debt -= 1;
      guard += 1;
    }
    return out;
  }

  function sum(nums) {
    return nums.reduce((a, b) => a + b, 0);
  }

  /**
   * Split budgetSec across items. The returned seconds always add up to budgetSec.
   * A 30s floor is used only when every item can have it without passing the budget.
   */
  function allocateItemTimes(prefMinutesList, budgetSec) {
    const n = prefMinutesList.length;
    budgetSec = Math.max(0, Math.round(Number(budgetSec) || 0));
    if (!n) return [];
    const weights = prefMinutesList.map((m) => Math.max(0.25, Number(m) || 1));
    if (budgetSec % 60 === 0 && budgetSec >= n * 60) {
      const minutes = withMinimum(scaleTo(weights, budgetSec / 60), 1, budgetSec / 60);
      return minutes.map((m) => m * 60);
    }
    if (budgetSec % 30 === 0 && budgetSec >= n * 30) {
      const chunks = withMinimum(scaleTo(weights, budgetSec / 30), 1, budgetSec / 30);
      return chunks.map((c) => c * 30);
    }
    return scaleTo(weights, budgetSec);
  }

  /**
   * parts: [{ id, flex, seconds, weight }]
   * Fixed parts keep their seconds when they fit. Flex parts share what is left.
   * If fixed seconds run past the class, every part is scaled so the sum is exact.
   */
  function allocateParts(parts, totalSec) {
    totalSec = Math.max(0, Math.round(Number(totalSec) || 0));
    if (!parts.length) return { seconds: [], squeezed: false, ids: [] };
    const fixed = parts.map((p) =>
      p.flex ? 0 : Math.max(0, Math.round(Number(p.seconds) || 0))
    );
    const fixedSum = sum(fixed);
    const flexIdx = [];
    parts.forEach((p, i) => {
      if (p.flex) flexIdx.push(i);
    });
    if (fixedSum > totalSec || (flexIdx.length === 0 && fixedSum !== totalSec)) {
      const weights = parts.map((p) =>
        p.flex ? Math.max(0, Number(p.weight) || 0) : Math.max(0, Math.round(Number(p.seconds) || 0))
      );
      return {
        ids: parts.map((p) => p.id),
        seconds: scaleTo(weights, totalSec),
        squeezed: fixedSum > totalSec,
      };
    }
    const remain = totalSec - fixedSum;
    const flexWeights = flexIdx.map((i) => Math.max(0, Number(parts[i].weight) || 0));
    const flexSeconds = scaleTo(flexWeights, remain);
    const seconds = fixed.slice();
    flexIdx.forEach((i, k) => {
      seconds[i] = flexSeconds[k];
    });
    return { ids: parts.map((p) => p.id), seconds, squeezed: false };
  }

  function prefMinutes(catalogMinutes, catalogReps, reps) {
    const c = Math.max(0.25, Number(catalogMinutes) || 2);
    const cr = Math.max(1, Number(catalogReps) || 1);
    const r = Math.max(1, Number(reps) || cr);
    return c * (r / cr);
  }

  function rankScore(kid) {
    const belt = BELT_ORDER.indexOf(kid && kid.belt);
    const stripes = clampInt(kid && kid.stripes, 0, 4, 0);
    return (belt < 0 ? 0 : belt) * 5 + stripes;
  }

  function sortByRank(roster) {
    return (Array.isArray(roster) ? roster.slice() : []).sort((a, b) => {
      const diff = rankScore(b) - rankScore(a);
      if (diff) return diff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  const ADULT_BELTS = ["white", "blue", "purple", "brown", "black"];
  const ADULT_BELT_LABELS = {
    white: "White",
    blue: "Blue",
    purple: "Purple",
    brown: "Brown",
    black: "Black",
  };

  function beltLabel(belt) {
    return BELT_LABELS[belt] || ADULT_BELT_LABELS[belt] || "White";
  }

  // IBJJF General System of Graduation, Article 2: minimum age for each kids color group.
  // White is any age. Four stripes is the degree count on a kids belt (Article 1 and the degree system).
  const STRIPES_ON_BELT = 4;
  const BELT_GROUP_MIN_AGE = { grey: 4, yellow: 7, orange: 10, green: 13 };

  function beltColorGroup(belt) {
    const group = String(belt || "").split("-")[0];
    return Object.prototype.hasOwnProperty.call(BELT_GROUP_MIN_AGE, group) ? group : "";
  }

  function promotionHint(kid) {
    const stripes = clampInt(kid && kid.stripes, 0, STRIPES_ON_BELT, 0);
    if (stripes < STRIPES_ON_BELT) return null;
    const idx = BELT_ORDER.indexOf(kid && kid.belt);
    if (idx < 0 || idx + 1 >= BELT_ORDER.length) return null;
    const next = BELT_ORDER[idx + 1];
    const minAge = BELT_GROUP_MIN_AGE[beltColorGroup(next)];
    const age = Math.round(Number(kid && kid.age));
    const ready = Number.isFinite(age) && age >= minAge;
    const label = BELT_LABELS[next];
    return {
      ready,
      belt: next,
      label,
      text: ready
        ? `Ready for next belt: ${label}. The head instructor decides.`
        : `4 stripes, waiting on age for ${label}. The head instructor decides.`,
    };
  }

  function canHeadClass(person) {
    if (!person) return false;
    return ADULT_BELTS.indexOf(person.belt) >= 1;
  }

  function canAssistClass(person) {
    if (!person) return false;
    const rank = ADULT_BELTS.indexOf(person.belt);
    if (rank >= 1) return true;
    return person.belt === "white" && clampInt(person.stripes, 0, 4, 0) >= 2;
  }

  function ratioStatus(kids, adults) {
    const k = Math.max(0, Math.round(Number(kids) || 0));
    const a = Math.max(0, Math.round(Number(adults) || 0));
    if (k <= 0) {
      return { ok: true, ratio: 0, kids: k, adults: a, text: "Add a kid count to check the 4:1 ratio." };
    }
    if (a <= 0) {
      return {
        ok: false,
        ratio: Infinity,
        kids: k,
        adults: a,
        text: `Warning: ${k} kids and no adults on the mat. The limit is 4 kids per adult.`,
      };
    }
    const ratio = k / a;
    if (ratio > RATIO_LIMIT) {
      return {
        ok: false,
        ratio,
        kids: k,
        adults: a,
        text: `Warning: ${k} kids / ${a} adults is ${ratio.toFixed(1)}:1. The limit is 4:1. Add adults before class.`,
      };
    }
    return {
      ok: true,
      ratio,
      kids: k,
      adults: a,
      text: `${k} kids / ${a} adults is within the 4:1 ratio.`,
    };
  }

  function parseAgeKey(value) {
    const raw = String(value == null ? "" : value).trim().toLowerCase();
    if (raw === "toddler") return ["toddler"];
    const out = [];
    raw.split("+").forEach((part) => {
      const mapped = CLASS_AGE_MAP[part.trim()];
      if (mapped && !out.includes(mapped)) out.push(mapped);
    });
    out.sort((a, b) => GRACE_AGES.indexOf(a) - GRACE_AGES.indexOf(b));
    return out;
  }

  /**
   * Young-group tags stay on Mighty Mites. Older-group tags stay on Pee Wees.
   * A tag that was only 13–15 stays out of both groups.
   */
  function canonicalTechniqueAges(ages) {
    const list = Array.isArray(ages) ? ages : [];
    if (!list.length) return [];
    const has = (id) => list.includes(id);
    const out = [];
    if (has("mite") || has("peewee")) out.push("mite");
    if (has("peewee") || has("junior") || has("upper")) out.push("upper");
    if (has("toddler")) out.push("toddler");
    if (has("teen") && !out.length) out.push("teen");
    return out;
  }

  function normalizeAgeKey(value) {
    const raw = String(value == null ? "" : value).trim().toLowerCase();
    if (raw === "toddler") return "toddler";
    const ids = parseAgeKey(raw);
    return ids.length ? ids.join("+") : "mite";
  }

  function ageKey(ids) {
    return normalizeAgeKey(Array.isArray(ids) ? ids.join("+") : ids);
  }

  function isCombo(value) {
    return parseAgeKey(value).length > 1;
  }

  function youngestAge(value) {
    const ids = parseAgeKey(value);
    return ids[0] || "mite";
  }

  function comboLabel(value) {
    const ids = parseAgeKey(value);
    if (ids.length < 2) return "";
    return `Combo class: ${ids.map((id) => AGE_RANGES[id] || id).join(" + ")}`;
  }

  function ageKeyIncludes(entryAge, age) {
    const wantRaw = String(age == null ? "" : age).trim().toLowerCase();
    if (!wantRaw) return false;
    const entryParts = parseAgeKey(entryAge);
    const wantParts = parseAgeKey(wantRaw);
    if (!entryParts.length || !wantParts.length) return false;
    if (entryParts.join("+") === wantParts.join("+")) return true;
    if (wantParts.length === 1) return entryParts.includes(wantParts[0]);
    return entryParts.some((part) => wantParts.includes(part));
  }

  function kidGroupId(ageNumber) {
    const n = Number(ageNumber);
    if (n >= 3 && n <= 6) return "mite";
    if (n >= 7 && n <= 10) return "upper";
    return "";
  }

  function kidFitsClass(ageNumber, value) {
    if (!isCombo(value)) return true;
    const group = kidGroupId(ageNumber);
    return !!group && parseAgeKey(value).includes(group);
  }

  function olderVariationNote(youngest, groups, items) {
    const young = GRACE_AGES.includes(youngest) ? youngest : youngestAge(youngest);
    const ids = Array.isArray(groups) ? parseAgeKey(groups.join("+")) : parseAgeKey(groups);
    const older = ids.filter((id) => id !== young);
    if (!older.length) return "";
    const list = Array.isArray(items) ? items : [];
    const youngRange = AGE_RANGES[young] || young;
    const bits = older.map((id) => {
      const names = [];
      list.forEach((item) => {
        const ages = canonicalTechniqueAges(item && item.ages);
        if (!ages.includes(id) || ages.includes(young)) return;
        const name = String((item && (item.name || item.label)) || "").trim();
        if (name && !names.includes(name) && names.length < 3) names.push(name);
      });
      const range = AGE_RANGES[id] || id;
      if (names.length) return `${range}: ${names.join(", ")}`;
      return `${range}: use the ${youngRange} version`;
    });
    return `Older kids: ${bits.join(". ")}.`;
  }

  function kidCanSpar(kid, ageGroup, ratioOk) {
    if (!ratioOk) return false;
    const stripes = clampInt(kid && kid.stripes, 0, 4, 0);
    if (stripes < 1) return false;
    if (isCombo(ageGroup)) {
      const group = kidGroupId(kid && kid.age);
      if (!group) return false;
      return parseAgeKey(ageGroup).includes(group);
    }
    return true;
  }

  function sanitizeIdList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((id) => {
      const clean = cleanId(id);
      if (clean && !out.includes(clean)) out.push(clean);
    });
    return out;
  }

  function sanitizeText(value, max) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
  }

  function sanitizeSay(value) {
    if (Array.isArray(value)) {
      return value.map((line) => sanitizeText(line, 400)).filter(Boolean).slice(0, 12);
    }
    return sanitizeText(value, 800);
  }

  function sanitizeAges(value) {
    if (!Array.isArray(value)) return [];
    const known = ["mite", "upper", "peewee", "junior", "teen", "toddler"];
    const out = [];
    value.forEach((age) => {
      if (known.includes(age) && !out.includes(age)) out.push(age);
    });
    return canonicalTechniqueAges(out);
  }

  function newId() {
    return `c-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sanitizeTheme(value) {
    return sanitizeText(value, 32).toLowerCase().replace(/[^a-z0-9-]/g, "");
  }

  function sanitizeThemeList(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    value.forEach((theme) => {
      const clean = sanitizeTheme(theme);
      if (clean && !out.includes(clean)) out.push(clean);
    });
    return out.slice(0, 6);
  }

  function sanitizeSteps(value) {
    const lines = Array.isArray(value) ? value : String(value || "").split("\n");
    return lines.map((line) => sanitizeText(line, 160)).filter(Boolean).slice(0, 4);
  }

  const CLASS_KEYS = ["prayer", "opening", "warmup", "base", "lesson", "water", "sparring", "game", "finish"];
  const PRAYER_SECONDS = 120;
  const PRAYER_FUND_ORDER = ["warmup", "games", "game", "base", "sparring", "opening", "finish", "water", "water1", "water2"];

  /**
   * Move 2 minutes into a fixed opening prayer.
   * Warm-up gives the time first. The lesson is never shortened here.
   * Used after a plan has already been scaled to the class length.
   */
  function fundOpeningPrayer(secondsById) {
    const seconds = {};
    const source = secondsById && typeof secondsById === "object" ? secondsById : {};
    Object.keys(source).forEach((key) => {
      if (key === "prayer") return;
      seconds[key] = Math.max(0, Math.round(Number(source[key]) || 0));
    });
    let left = PRAYER_SECONDS;
    PRAYER_FUND_ORDER.forEach((key) => {
      if (left <= 0 || seconds[key] == null) return;
      const cut = Math.min(seconds[key], left);
      seconds[key] -= cut;
      left -= cut;
    });
    seconds.prayer = PRAYER_SECONDS;
    return seconds;
  }

  /**
   * Ask for a 2 minute prayer. If that makes the class long, take the
   * overage from warm-up before the fitter runs, so a normal 45 minute
   * plan is not marked as squeezed.
   */
  function coverOpeningPrayer(requested, totalSec) {
    const seconds = {};
    CLASS_KEYS.forEach((key) => {
      seconds[key] = Math.max(0, Math.round(Number(requested && requested[key]) || 0));
    });
    seconds.prayer = PRAYER_SECONDS;
    const total = Math.max(0, Math.round(Number(totalSec) || 0));
    let used = sum(CLASS_KEYS.map((key) => seconds[key]));
    if (used > total && seconds.warmup > 0) {
      seconds.warmup -= Math.min(seconds.warmup, used - total);
    }
    return seconds;
  }

  /**
   * Fit a 45-minute shape into totalSec.
   * Extra time goes to the lesson. When the clock is short, warm-up and base
   * shrink first. The game can fall to 3 minutes and is not removed.
   * The opening prayer keeps the minutes it was given.
   * The lesson is the last block that gives time up.
   */
  function fitClassTimes(requested, totalSec) {
    totalSec = Math.max(0, Math.round(Number(totalSec) || 0));
    const seconds = {};
    CLASS_KEYS.forEach((key) => {
      seconds[key] = Math.max(0, Math.round(Number(requested && requested[key]) || 0));
    });
    const gameFloor = seconds.game > 0 ? Math.min(180, seconds.game) : 0;
    const floors = {
      prayer: seconds.prayer,
      opening: 0,
      warmup: 0,
      base: 0,
      lesson: 0,
      water: 0,
      sparring: 0,
      game: gameFloor,
      finish: 0,
    };
    let used = sum(CLASS_KEYS.map((key) => seconds[key]));
    let squeezed = false;
    const trimOrder = ["warmup", "base", "sparring", "opening", "finish", "water", "game", "lesson"];
    if (used > totalSec) {
      squeezed = true;
      trimOrder.forEach((key) => {
        if (used <= totalSec) return;
        const room = seconds[key] - floors[key];
        if (room <= 0) return;
        const cut = Math.min(room, used - totalSec);
        seconds[key] -= cut;
        used -= cut;
      });
    } else if (used < totalSec) {
      seconds.lesson += totalSec - used;
      used = totalSec;
    }
    return { seconds, squeezed, sum: used };
  }

  function themeStaleness(themeId, logs, ageGroup) {
    const relevant = (Array.isArray(logs) ? logs : []).filter(
      (entry) => entry && entry.taught && ageKeyIncludes(entry.ageGroup, ageGroup)
    );
    let last = -1;
    relevant.forEach((entry, index) => {
      if (entry.theme === themeId) last = index;
    });
    if (last < 0) return Infinity;
    return relevant.length - 1 - last;
  }

  function themeReason(label, since) {
    if (!Number.isFinite(since)) return `${label}: not taught yet`;
    if (since <= 0) return `${label}: taught last class`;
    return `${label}: not taught in ${since} class${since === 1 ? "" : "es"}`;
  }

function chooseTheme(themes, logs, ageGroup, lock, skip) {
  const list = (Array.isArray(themes) ? themes : []).filter((theme) => theme && theme.id);
  if (!list.length) return null;
  const locked = lock && list.find((theme) => theme.id === lock);
  const ranked = list
    .map((theme) => ({ theme, since: themeStaleness(theme.id, logs, ageGroup) }))
    .sort((a, b) => b.since - a.since || (a.theme.order || 0) - (b.theme.order || 0));
  const offset = ((Math.round(Number(skip) || 0) % ranked.length) + ranked.length) % ranked.length;
  const pick = locked ? locked : ranked[offset].theme;
  const since = themeStaleness(pick.id, logs, ageGroup);
  return {
    id: pick.id,
    label: pick.label || pick.id,
    position: pick.position || pick.label || pick.id,
    reason: themeReason(pick.label || pick.id, since),
    locked: !!locked,
  };
}

function qrChecksum(id) {
  let n = 0;
  const text = String(id || "");
  for (let i = 0; i < text.length; i += 1) n = (n * 33 + text.charCodeAt(i)) >>> 0;
  return (n % 10000).toString(36);
}

function qrPayload(id) {
  const clean = cleanId(id);
  if (!clean) return "";
  return `GBJJ1|${clean}|${qrChecksum(clean)}`;
}

function parseQr(value) {
  const match = /^GBJJ1\|([A-Za-z0-9_-]{1,40})\|([a-z0-9]+)$/.exec(String(value || "").trim());
  if (!match) return "";
  if (qrChecksum(match[1]) !== match[2]) return "";
  return match[1];
}

const LEVELS = ["introduced", "practicing", "help", "own"];

function sanitizeProgress(raw) {
  const progress = { classes: [], levels: {}, notes: {}, stripe: { own: 6, attend: 8 } };
  if (!raw || typeof raw !== "object") return progress;
  const seen = new Set();
  (Array.isArray(raw.classes) ? raw.classes : []).slice(0, 400).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    let id = cleanId(entry.id);
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const techniques = (Array.isArray(entry.techniques) ? entry.techniques : [])
      .slice(0, 12)
      .map((tech) => ({
        id: cleanId(tech && tech.id),
        name: sanitizeText(tech && tech.name, 80),
        position: sanitizeText(tech && tech.position, 40),
        theme: sanitizeTheme(tech && tech.theme),
      }))
      .filter((tech) => tech.id && tech.name);
    progress.classes.push({
      id,
      date: parseISODate(entry.date) ? entry.date : "",
      ageGroup: normalizeAgeKey(entry.ageGroup),
      theme: sanitizeTheme(entry.theme),
      themeLabel: sanitizeText(entry.themeLabel, 48),
      techniques,
      game: sanitizeText(entry.game, 80),
      attended: sanitizeIdList(entry.attended),
      taught: !!entry.taught,
    });
  });
  if (raw.levels && typeof raw.levels === "object") {
    Object.entries(raw.levels).forEach(([kidId, levels]) => {
      const kid = cleanId(kidId);
      if (!kid || !levels || typeof levels !== "object") return;
      const next = {};
      Object.entries(levels).forEach(([techId, level]) => {
        const tech = cleanId(techId);
        if (tech && LEVELS.includes(level)) next[tech] = level;
      });
      if (Object.keys(next).length) progress.levels[kid] = next;
    });
  }
  if (raw.notes && typeof raw.notes === "object") {
    Object.entries(raw.notes).forEach(([kidId, note]) => {
      const kid = cleanId(kidId);
      const text = sanitizeText(note, 800);
      if (kid && text) progress.notes[kid] = text;
    });
  }
  progress.stripe.own = clampInt(raw.stripe && raw.stripe.own, 1, 40, 6);
  progress.stripe.attend = clampInt(raw.stripe && raw.stripe.attend, 1, 40, 8);
  return progress;
}

  function activitySearchText(activity) {
    if (!activity || typeof activity !== "object") return "";
    const parts = [];
    const push = (value) => {
      if (value == null || value === false) return;
      if (Array.isArray(value)) {
        value.forEach(push);
        return;
      }
      if (typeof value === "object") return;
      parts.push(String(value));
    };
    ["name", "how", "say", "extra", "equipment", "position", "drill", "safety", "theme", "themes", "steps", "tags", "after", "sayAfter"].forEach(
      (key) => push(activity[key])
    );
    return parts.join("\n").toLowerCase();
  }

  function matchesPlanQuery(activity, query) {
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return true;
    return activitySearchText(activity).includes(q);
  }

  function ageLimitLabel(ages) {
    const list = canonicalTechniqueAges(ages);
    if (list.length === 1 && list[0] === "teen") return "For ages 13–15";
    if (list.length === 1 && list[0] === "toddler") return "For ages 3–5";
    const have = ["mite", "upper"].filter((id) => list.includes(id));
    if (!have.length) return "";
    if (have.length === 1) return `For ages ${AGE_RANGES[have[0]]}`;
    return `For ages ${AGE_RANGES.mite} and ${AGE_RANGES.upper}`;
  }

  function keepAgeOverrides(picked, previous) {
    const chosen = (Array.isArray(picked) ? picked : []).filter((item) => item && item.id != null);
    const seen = new Set(chosen.map((item) => String(item.id)));
    const extras = [];
    (Array.isArray(previous) ? previous : []).forEach((item) => {
      if (!item || !item.ageOverride || item.id == null) return;
      const id = String(item.id);
      if (seen.has(id)) return;
      seen.add(id);
      extras.push({ ...item, ageOverride: true });
    });
    return extras.concat(chosen);
  }

  function ageOverrideGroups(inAgeLibrary, outOfAgeLibrary, inPlanIds, query) {
    const grouped = planPickerGroups(inAgeLibrary, inPlanIds, query);
    const q = String(query == null ? "" : query).trim();
    if (!q) {
      return { inPlan: grouped.inPlan, rest: grouped.rest, outOfAge: [], inPlanCount: grouped.inPlanCount };
    }
    const outside = planPickerGroups(outOfAgeLibrary, inPlanIds, query);
    const shown = new Set(
      grouped.rest.map((item) => String(item.id)).concat(grouped.inPlan.map((item) => String(item.id)))
    );
    return {
      inPlan: grouped.inPlan,
      rest: grouped.rest,
      outOfAge: outside.rest.filter((item) => !shown.has(String(item.id))),
      inPlanCount: grouped.inPlanCount,
    };
  }

  function planPickerGroups(library, inPlanIds, query) {
    const items = Array.isArray(library) ? library.filter((item) => item && item.id != null) : [];
    const ids = Array.isArray(inPlanIds) ? inPlanIds.map((id) => String(id)) : [];
    const byId = new Map();
    items.forEach((item) => {
      const id = String(item.id);
      if (!byId.has(id)) byId.set(id, item);
    });
    const inPlan = [];
    ids.forEach((id) => {
      const item = byId.get(id);
      if (item && matchesPlanQuery(item, query)) inPlan.push(item);
    });
    const used = new Set(ids);
    const rest = items.filter((item) => !used.has(String(item.id)) && matchesPlanQuery(item, query));
    return { inPlan, rest, inPlanCount: ids.length };
  }

  function togglePlanIds(inPlanIds, id) {
    const ids = Array.isArray(inPlanIds) ? inPlanIds.map((value) => String(value)) : [];
    const key = String(id);
    if (ids.includes(key)) return ids.filter((value) => value !== key);
    return ids.concat(key);
  }

  const REORDER_SECTIONS = ["warmup", "base", "lesson", "game", "sparring"];

  function moveWithinList(ids, fromId, toId, placement) {
    const list = (Array.isArray(ids) ? ids : []).map((id) => String(id));
    const fromKey = String(fromId);
    const toKey = String(toId);
    const from = list.indexOf(fromKey);
    const to = list.indexOf(toKey);
    if (from < 0 || to < 0 || fromKey === toKey) return list;
    const next = list.slice();
    next.splice(from, 1);
    let dest = next.indexOf(toKey);
    if (dest < 0) return list;
    if (placement === "after") dest += 1;
    next.splice(dest, 0, fromKey);
    return next;
  }

  function reorderSectionItems(section, items, fromId, toId, placement) {
    const list = (Array.isArray(items) ? items : []).filter((item) => item && item.id != null);
    if (!REORDER_SECTIONS.includes(section)) return list.slice();
    const order = moveWithinList(
      list.map((item) => item.id),
      fromId,
      toId,
      placement
    );
    const byId = new Map(list.map((item) => [String(item.id), item]));
    return order.map((id) => byId.get(id)).filter(Boolean);
  }

  function stampItemClocks(items, startSec, budgetSec, startMinutes) {
    const list = (Array.isArray(items) ? items : []).filter((item) => item && typeof item === "object");
    const times = allocateItemTimes(
      list.map((item) => item.prefMinutes || item.catalogMinutes || 2),
      budgetSec
    );
    let cursor = Math.max(0, Math.round(Number(startSec) || 0));
    return list.map((item, index) => {
      const duration = times[index] || 0;
      const stamped = {
        ...item,
        start: cursor,
        duration,
        when: clockRange(startMinutes, cursor, duration),
      };
      cursor += duration;
      return stamped;
    });
  }

  function restampPlanSections(sections, startSec, startMinutes) {
    let cursor = Math.max(0, Math.round(Number(startSec) || 0));
    return (Array.isArray(sections) ? sections : []).map((section) => {
      const duration = Math.max(0, Math.round(Number(section && section.duration) || 0));
      const items = stampItemClocks(section && section.items, cursor, duration, startMinutes);
      const block = {
        id: section && section.id,
        start: cursor,
        duration,
        when: clockRange(startMinutes, cursor, duration),
        items,
      };
      cursor += duration;
      return block;
    });
  }

  function takeSequence(items, count, offset) {
    const list = Array.isArray(items) ? items : [];
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (!list.length || !n) return [];
    const start = ((Math.round(Number(offset) || 0) % list.length) + list.length) % list.length;
    const rotated = list.slice(start).concat(list.slice(0, start));
    return rotated.slice(0, Math.min(n, list.length));
  }

  function sanitizeActivity(raw, builtinIds) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, reason: "Activity was not an object." };
    }
    const name = sanitizeText(raw.name, 80);
    if (!name) return { ok: false, reason: "Activity is missing a name." };
    if (!CATEGORIES.includes(raw.category)) {
      return { ok: false, reason: `“${name}” has a category the planner does not use.` };
    }
    const builtins = builtinIds instanceof Set ? builtinIds : new Set(builtinIds || []);
    let id = cleanId(raw.id);
    let remapped = false;
    if (!id || builtins.has(id)) {
      id = newId();
      remapped = true;
    }
    return {
      ok: true,
      remapped,
      activity: {
        id,
        category: raw.category,
        name,
        reps: clampInt(raw.reps, 1, 20, 1),
        duration: clampNum(raw.duration, 0.5, 30, 2),
        how: sanitizeText(raw.how, 800),
        say: sanitizeSay(raw.say),
        extra: sanitizeText(raw.extra, 400),
        equipment: sanitizeText(raw.equipment, 120),
        ages: sanitizeAges(raw.ages),
        position: sanitizeText(raw.position, 40),
        theme: sanitizeTheme(raw.theme),
        themeLabel: sanitizeText(raw.themeLabel, 48),
        steps: sanitizeSteps(raw.steps),
        drill: sanitizeText(raw.drill, 180),
        safety: sanitizeText(raw.safety, 280),
        order: clampInt(raw.order, 0, 99, 50),
        themes: sanitizeThemeList(raw.themes),
      },
    };
  }

  function sanitizeRosterKid(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = sanitizeText(raw.name, 40);
    if (!name) return null;
    const belt = BELT_ORDER.includes(raw.belt) ? raw.belt : "white";
    let id = cleanId(raw.id);
    if (!id) id = newId();
    return {
      id,
      name,
      age: clampInt(raw.age, 3, 17, 8),
      belt,
      stripes: clampInt(raw.stripes, 0, 4, 0),
    };
  }

  function sanitizePins(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 8).map((pin, i) => {
      const ask = sanitizeText(pin && pin.ask, 80);
      const next = { n: clampInt(pin && pin.n, 1, 9, i + 1), ask };
      const from = coord(pin && pin.from);
      const to = coord(pin && pin.to);
      if (from && to) {
        next.from = from;
        next.to = to;
      }
      return next;
    }).filter((pin) => pin.ask);
  }

  function coord(pair) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 100 || y < 0 || y > 100) return null;
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  }

  function safeSrc(src) {
    const s = String(src || "").trim();
    const rawBase = typeof globalThis.BJJ_BASE === "string" ? globalThis.BJJ_BASE.replace(/\/$/, "") : "";
    const base = rawBase && rawBase.charAt(0) === "/" && rawBase.charAt(1) !== "/" ? rawBase : "";
    let path = s;
    if (base && (path === base || path.indexOf(base + "/") === 0)) path = path.slice(base.length) || "/";
    if (/^\/?(sheets|img)\/[A-Za-z0-9_./-]+(\?[A-Za-z0-9_.=-]{1,24})?$/.test(path)) {
      if (path.charAt(0) !== "/") path = "/" + path;
      return base ? base + path : path;
    }
    if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(s) && s.length < 8_000_000) {
      return s;
    }
    return "";
  }

  function displayStaffName(name, username) {
    const stored = String(name == null ? "" : name).trim();
    const login = String(username == null ? "" : username).trim();
    const source = stored || login;
    if (!source) return "";
    if (stored && (!login || stored.toLowerCase() !== login.toLowerCase())) return stored;
    return source.charAt(0).toLocaleUpperCase() + source.slice(1);
  }

  /**
   * Sparring starts off for a 3–6 class, when no kids are counted, or when
   * more than half of the counted kids have no stripes. Otherwise it starts on.
   * kids are {stripes} from check-in, or from the age-group roster.
   */
  function sparringDefault(ageGroup, kids) {
    const key = normalizeAgeKey(ageGroup);
    const list = Array.isArray(kids) ? kids : [];
    if (key === "mite") {
      return { enabled: false, reason: "Sparring off: 3–6 class" };
    }
    if (!list.length) {
      return { enabled: false, reason: "Sparring off: no kids yet" };
    }
    const zeros = list.filter((kid) => clampInt(kid && kid.stripes, 0, 4, 0) < 1).length;
    if (zeros * 2 > list.length) {
      return { enabled: false, reason: "Sparring off: most kids have no stripes yet" };
    }
    return { enabled: true, reason: "" };
  }

  /**
   * A saved plan with no choice uses the default. A hand choice stays as saved.
   */
  function resolveSparring(plan, ageGroup, kids) {
    const stored = plan && (plan.sparringChoice === "manual" || plan.sparringChoice === "default");
    const choice = stored ? plan.sparringChoice : "default";
    const def = sparringDefault(ageGroup, kids);
    if (choice === "manual") {
      return { enabled: !!(plan && plan.sparringEnabled), choice: "manual", reason: "" };
    }
    return { enabled: def.enabled, choice: "default", reason: def.reason };
  }

  /**
   * Sparring minutes move onto the game when sparring is off.
   * The class length does not change.
   */
  function applySparringTime(requested, enabled) {
    const seconds = {};
    CLASS_KEYS.forEach((key) => {
      seconds[key] = Math.max(0, Math.round(Number(requested && requested[key]) || 0));
    });
    if (!enabled) {
      seconds.game += seconds.sparring;
      seconds.sparring = 0;
    }
    return seconds;
  }

  function pacedReps(base, ageGroup) {
    const n = Math.max(1, Math.round(Number(base) || 1));
    const key = normalizeAgeKey(ageGroup);
    if (key === "mite") return Math.max(1, Math.round(n * 0.5));
    return Math.min(20, n);
  }

  const SHARE_FALLBACK_NOTE =
    "Your browser can't share files directly. The PDF was downloaded so you can attach it to a text or email.";

  function planPdfFilename(date, ageGroup) {
    const raw = String(date || "");
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "undated";
    const slug = String(ageGroup || "")
      .toLowerCase()
      .replace(/[^a-z0-9+_−–-]/g, "");
    return `grace-bjj-plan-${iso}-${slug || "class"}.pdf`;
  }

  /**
   * Share a plan PDF when the browser can share files. Otherwise download it.
   * AbortError is the share sheet being dismissed.
   */
  function deliverPlanPdf(file, env) {
    const options = env || {};
    const payload = {
      files: [file],
      title: options.title || "Grace BJJ Kids plan",
      text: options.text || "Grace BJJ Kids lesson plan",
    };
    let allowed = false;
    try {
      allowed = typeof options.canShare === "function" && !!options.canShare({ files: payload.files });
    } catch (err) {
      allowed = false;
    }
    if (!allowed) {
      if (typeof options.download === "function") options.download(file);
      return Promise.resolve({ downloaded: true, note: SHARE_FALLBACK_NOTE });
    }
    return Promise.resolve()
      .then(() => options.share(payload))
      .then(() => ({ shared: true }))
      .catch((err) => {
        if (err && err.name === "AbortError") return { cancelled: true };
        throw err;
      });
  }

  const PDF_HELV = {
    " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
    ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
    K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
    U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
    k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
    u: 556, v: 556, w: 722, x: 500, y: 500, z: 500,
  };

  function pdfCharUnits(ch) {
    return PDF_HELV[ch] || 556;
  }

  function pdfTextWidth(text, size, bold) {
    let units = 0;
    for (const ch of String(text)) units += pdfCharUnits(ch);
    return (units / 1000) * size * (bold ? 1.08 : 1);
  }

  function pdfWrap(text, size, bold, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const tokens = [];
    for (let i = 0; i < words.length; i += 1) {
      if (words[i] === "Age" && words[i + 1] === "override") {
        tokens.push("Age override");
        i += 1;
      } else tokens.push(words[i]);
    }
    const lines = [];
    let current = "";
    const pushHard = (word) => {
      let chunk = "";
      for (const ch of word) {
        const next = chunk + ch;
        if (pdfTextWidth(next, size, bold) <= maxWidth) chunk = next;
        else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    };
    tokens.forEach((word) => {
      const trial = current ? `${current} ${word}` : word;
      if (pdfTextWidth(trial, size, bold) <= maxWidth) current = trial;
      else {
        if (current) lines.push(current);
        if (pdfTextWidth(word, size, bold) > maxWidth) pushHard(word);
        else current = word;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  const PDF_WIN = {
    "\u2013": 0x96,
    "\u2014": 0x97,
    "\u2018": 0x91,
    "\u2019": 0x92,
    "\u201c": 0x93,
    "\u201d": 0x94,
    "\u2022": 0x95,
    "\u2026": 0x85,
    "\u00a0": 0x20,
    "\u2212": 0x2d,
  };

  function pdfEscape(text) {
    let out = "";
    for (const ch of String(text)) {
      let byte = ch.codePointAt(0);
      if (PDF_WIN[ch] != null) byte = PDF_WIN[ch];
      else if (byte > 255) byte = 0x3f;
      if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
      else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
      else out += String.fromCharCode(byte);
    }
    return out;
  }

  function pdfNum(n) {
    return String(Math.round(Number(n) * 100) / 100);
  }

  function pdfText(font, size, x, y, text) {
    return `BT /${font} ${pdfNum(size)} Tf 1 0 0 1 ${pdfNum(x)} ${pdfNum(y)} Tm (${pdfEscape(text)}) Tj ET`;
  }

  const PDF_STYLES = {
    title: { font: "F2", size: 18, leading: 22, before: 0, after: 8, bold: true },
    section: { font: "F2", size: 13, leading: 16, before: 12, after: 4, bold: true, rule: true },
    item: { font: "F2", size: 11, leading: 14, before: 8, after: 2, bold: true },
    body: { font: "F1", size: 10, leading: 13, before: 1, after: 1, bold: false, indent: 8 },
  };

  function layoutPlanPages(lines) {
    const pageW = 612;
    const pageH = 792;
    const margin = 54;
    const width = pageW - margin * 2;
    const source = Array.isArray(lines) ? lines : [];
    const items = [];
    source.forEach((line) => {
      if (!line || typeof line !== "object") return;
      if (line.kind === "break") {
        items.push({ kind: "break", text: "" });
        return;
      }
      const text = String(line.text || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      items.push({ kind: PDF_STYLES[line.kind] ? line.kind : "body", text });
    });
    if (!items.length) items.push({ kind: "body", text: "Grace BJJ Kids lesson plan" });

    const pages = [];
    let ops = [];
    let y = pageH - margin;

    function finish(index) {
      const foot = [
        "0 0 0 rg",
        pdfText("F1", 9, margin, 36, "Grace BJJ Kids"),
        pdfText("F1", 9, pageW - margin - 42, 36, `Page ${index + 1}`),
      ];
      return foot.concat(ops).join("\n");
    }

    function nextPage(continued) {
      if (ops.length) pages.push(finish(pages.length));
      ops = ["0 0 0 rg"];
      y = pageH - margin;
      if (continued) {
        ops.push(pdfText("F1", 9, margin, y - 9, "Grace BJJ Kids"));
        y -= 24;
      }
    }

    function ensure(need) {
      if (y - need >= margin) return;
      nextPage(true);
    }

    nextPage(false);
    items.forEach((item) => {
      if (item.kind === "break") {
        if (ops.length > 1) nextPage(false);
        return;
      }
      const style = PDF_STYLES[item.kind];
      const indent = style.indent || 0;
      const wrapped = pdfWrap(item.text, style.size, style.bold, width - indent);
      ensure(style.before + style.leading + (style.rule ? 6 : 0));
      y -= style.before;
      if (style.rule) {
        ops.push(`0.62 0.09 0.16 RG ${pdfNum(margin)} ${pdfNum(y)} m ${pdfNum(pageW - margin)} ${pdfNum(y)} l S 0 0 0 RG`);
        y -= 6;
      }
      wrapped.forEach((text) => {
        ensure(style.leading);
        ops.push(pdfText(style.font, style.size, margin + indent, y - style.size, text));
        y -= style.leading;
      });
      y -= style.after;
    });
    if (ops.length) pages.push(finish(pages.length));
    return pages.length ? pages : [finish(0)];
  }

  function buildPlanPdf(lines) {
    const streams = layoutPlanPages(lines);
    const n = streams.length;
    let next = 5;
    const kids = [];
    const pageObjs = [];
    for (let i = 0; i < n; i += 1) {
      const pageId = next;
      next += 1;
      const contentId = next;
      next += 1;
      kids.push(pageId);
      pageObjs.push({ pageId, contentId, stream: streams[i] });
    }
    const objs = new Array(next);
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[2] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`;
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    pageObjs.forEach(({ pageId, contentId, stream }) => {
      objs[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
      objs[contentId] = { stream };
    });
    let out = "%PDF-1.4\n";
    const offsets = [0];
    for (let i = 1; i < objs.length; i += 1) {
      offsets[i] = out.length;
      const obj = objs[i];
      if (obj && obj.stream != null) {
        out += `${i} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
      } else {
        out += `${i} 0 obj\n${obj}\nendobj\n`;
      }
    }
    const startxref = out.length;
    out += `xref\n0 ${objs.length}\n`;
    out += "0000000000 65535 f \n";
    for (let i = 1; i < objs.length; i += 1) {
      out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i);
    return bytes;
  }

  return {
    FIRST_CLASS_ISO,
    RATIO_LIMIT,
    AGE_IDS,
    GRACE_AGES,
    AGE_RANGES,
    COMBO_SPARRING_SAFETY,
    parseAgeKey,
    canonicalTechniqueAges,
    normalizeAgeKey,
    ageKey,
    isCombo,
    youngestAge,
    comboLabel,
    ageKeyIncludes,
    kidGroupId,
    kidFitsClass,
    olderVariationNote,
    CATEGORIES,
    BELT_ORDER,
    BELT_LABELS,
    STANDARD_WARMUP,
    STANDARD_PLAY,
    BASE_ORDER,
    escapeHtml,
    displayStaffName,
    cleanId,
    clampInt,
    clampNum,
    isoDate,
    parseISODate,
    isClassTuesday,
    nextClassDate,
    parseStartMinutes,
    formatClock,
    clockRange,
    classSpan,
    scaleTo,
    allocateItemTimes,
    allocateParts,
    prefMinutes,
    rankScore,
    sortByRank,
    ADULT_BELTS,
    beltLabel,
    STRIPES_ON_BELT,
    BELT_GROUP_MIN_AGE,
    beltColorGroup,
    promotionHint,
    canHeadClass,
    canAssistClass,
    ratioStatus,
    kidCanSpar,
    sparringDefault,
    resolveSparring,
    applySparringTime,
    sanitizeIdList,
    sanitizeActivity,
    sanitizeRosterKid,
    sanitizePins,
    safeSrc,
    pacedReps,
    sum,
    fitClassTimes,
    PRAYER_SECONDS,
    fundOpeningPrayer,
    coverOpeningPrayer,
    themeStaleness,
    themeReason,
    chooseTheme,
    activitySearchText,
    matchesPlanQuery,
    planPickerGroups,
    ageLimitLabel,
    keepAgeOverrides,
    ageOverrideGroups,
    togglePlanIds,
    moveWithinList,
    reorderSectionItems,
    stampItemClocks,
    restampPlanSections,
    REORDER_SECTIONS,
    takeSequence,
    CLASS_KEYS,
    qrChecksum,
    qrPayload,
    parseQr,
    LEVELS,
    sanitizeProgress,
    SHARE_FALLBACK_NOTE,
    planPdfFilename,
    deliverPlanPdf,
    buildPlanPdf,
  };
});
