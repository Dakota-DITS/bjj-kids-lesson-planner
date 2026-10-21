/* Pure helpers for the Grace BJJ Kids planner. No DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BJJ_PLAN = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FIRST_CLASS_ISO = "2026-10-27";
  const RATIO_LIMIT = 4;
  const AGE_IDS = ["mite", "peewee", "junior", "teen", "toddler"];
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

  function kidCanSpar(kid, ageGroup, ratioOk) {
    if (ageGroup === "mite" || ageGroup === "toddler") return false;
    if (!ratioOk) return false;
    return clampInt(kid && kid.stripes, 0, 4, 0) >= 1;
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
    const out = [];
    value.forEach((age) => {
      if (AGE_IDS.includes(age) && !out.includes(age)) out.push(age);
    });
    return out;
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

  const CLASS_KEYS = ["opening", "warmup", "base", "lesson", "water", "sparring", "game", "finish"];

  /**
   * Fit a 45-minute shape into totalSec.
   * Extra time goes to the lesson. When the clock is short, warm-up and base
   * shrink first. The game can fall to 3 minutes and is not removed.
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
      (entry) => entry && entry.taught && entry.ageGroup === ageGroup
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
      ageGroup: AGE_IDS.includes(entry.ageGroup) ? entry.ageGroup : "mite",
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
    if (/^\/?(sheets|img)\/[A-Za-z0-9_./-]+(\?[A-Za-z0-9_.=-]{1,24})?$/.test(s)) {
      return s.charAt(0) === "/" ? s : `/${s}`;
    }
    if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(s) && s.length < 8_000_000) {
      return s;
    }
    return "";
  }

  function pacedReps(base, ageGroup) {
    const n = Math.max(1, Math.round(Number(base) || 1));
    if (ageGroup === "mite") return Math.max(1, Math.round(n * 0.5));
    if (ageGroup === "junior") return Math.min(20, Math.max(1, Math.round(n * 1.5)));
    if (ageGroup === "teen") return Math.min(20, n * 2);
    return Math.min(20, n);
  }

  return {
    FIRST_CLASS_ISO,
    RATIO_LIMIT,
    AGE_IDS,
    CATEGORIES,
    BELT_ORDER,
    BELT_LABELS,
    STANDARD_WARMUP,
    STANDARD_PLAY,
    BASE_ORDER,
    escapeHtml,
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
    sanitizeIdList,
    sanitizeActivity,
    sanitizeRosterKid,
    sanitizePins,
    safeSrc,
    pacedReps,
    sum,
    fitClassTimes,
    themeStaleness,
    themeReason,
    chooseTheme,
    takeSequence,
    CLASS_KEYS,
    qrChecksum,
    qrPayload,
    parseQr,
    LEVELS,
    sanitizeProgress,
  };
});
