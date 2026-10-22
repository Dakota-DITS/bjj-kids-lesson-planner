(() => {
  const DATA = window.BJJ_DATA;
  const P = window.BJJ_PLAN;
  const STORAGE_KEY = "bjj-grace-kids-planner-v2";
  const OLD_STORAGE_KEY = "bjj-kids-lesson-planner-v1";
  const IMPORT_KEY = "bjj-grace-import-v1";
  const LOGO = P.safeSrc(DATA.logo) || "/img/logo/grace-logo-mark-transparent.png";

  const FIRST_CLASS_IDS = {
    warmup: ["wu-light-jog", "wu-gorilla", "wu-bear", "wu-frog", "wu-worm", "wu-mat-slaps"],
    lesson: ["ls-burrito", "ls-race-stand", "ls-capture-flag"],
    game: ["gm-grab-donuts", "gm-protect-donuts"],
  };

  const state = {
    custom: [],
    disabled: [],
    pinned: [],
    reps: {},
    roster: [],
    plan: null,
    libCat: "warmup",
    showItemShuffle: false,
    preset: "grace",
    ageGroup: "mite",
    sheetId: "first-gi",
    uploads: [],
    progress: { classes: [], levels: {}, notes: {}, stripe: { own: 6, attend: 8 } },
    view: "plan",
    themeOffset: 0,
    themeSkip: 0,
    cardPick: {},
    cardLayout: "wallet",
    cards: [],
    pendingCard: "",
    session: null,
    featured: { sheetId: "", caption: "" },
    serverSheets: [],
    staff: [],
    instructorId: "",
    instructorName: "",
    assistantIds: [],
    pendingHelperNames: [],
    hadInstructor: false,
    staffDefaulted: false,
    helpersApplied: false,
    freeHelperNames: [],
    ratioSource: "roster",
    levelDrafts: {},
    planQuery: { warmup: "", base: "", lesson: "", game: "", sparring: "" },
    planFocus: null,
  };

  let cameraStream = null;
  let cameraTimer = 0;
  let noteTimer = 0;
  let claimOpen = false;

  const $ = (id) => document.getElementById(id);
  const esc = P.escapeHtml;
  const ADULT_BELT_IDS = ["white", "blue", "purple", "brown", "black"];

  function listen(id, type, handler) {
    const el = $(id);
    if (!el) return null;
    el.addEventListener(type, handler);
    return el;
  }

  function adultBelts() {
    return Array.isArray(P.ADULT_BELTS) && P.ADULT_BELTS.length ? P.ADULT_BELTS : ADULT_BELT_IDS;
  }

  function canHead(person) {
    if (!person) return false;
    if (typeof P.canHeadClass === "function") return P.canHeadClass(person);
    return adultBelts().indexOf(person.belt) >= 1;
  }

  function canAssist(person) {
    if (!person) return false;
    if (typeof P.canAssistClass === "function") return P.canAssistClass(person);
    const rank = adultBelts().indexOf(person.belt);
    if (rank >= 1) return true;
    return person.belt === "white" && P.clampInt(person.stripes, 0, 4, 0) >= 2;
  }

  function runPanel(label, fn) {
    try {
      return fn();
    } catch (err) {
      reportPanel(label, err);
      return undefined;
    }
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function passwordChangeError(current, next) {
    if (!current) return "Enter the current password.";
    if (next.length < 10) return "Use at least 10 characters.";
    if (next === current) return "Choose a different password.";
    return "";
  }

  function generateTemporaryPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const limit = 256 - (256 % alphabet.length);
    let out = "";
    while (out.length < 20) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < bytes.length && out.length < 20; i += 1) {
        if (bytes[i] < limit) out += alphabet[bytes[i] % alphabet.length];
      }
    }
    return out;
  }

  function setFormNote(id, message, ok) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("ok", !!ok && !!message);
    el.classList.toggle("bad", !!message && !ok);
  }

  function staffById(id) {
    return staffList().find((person) => person.id === id) || null;
  }

  function normalizeStaff(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = P.cleanId(raw.id);
    const name = String(raw.name || "").trim().slice(0, 40);
    if (!id || !name) return null;
    return {
      id,
      name,
      belt: adultBelts().includes(raw.belt) ? raw.belt : "white",
      stripes: P.clampInt(raw.stripes, 0, 4, 0),
      userId: P.cleanId(raw.userId) || "",
      login: !!(raw.login || raw.userId),
    };
  }

  function staffList() {
    return Array.isArray(state.staff) ? state.staff : [];
  }

  function assistantIdList() {
    if (!Array.isArray(state.assistantIds)) state.assistantIds = [];
    return state.assistantIds;
  }

  function personNames(value) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return list
      .map((item) => {
        if (item && typeof item === "object") return String(item.name || "").trim();
        return String(item == null ? "" : item).trim();
      })
      .filter(Boolean);
  }

  function reportPanel(label, err) {
    console.error(label, err);
  }

  function instructorName() {
    const person = staffById(state.instructorId);
    if (person) {
      if (state.instructorName && state.instructorName.toLowerCase() === person.name.toLowerCase()) return state.instructorName;
      return person.name;
    }
    return state.instructorName || "";
  }

  function assistantPeople() {
    return assistantIdList().map((id) => staffById(id)).filter(Boolean);
  }

  function helperNames() {
    const names = assistantPeople().map((person) => person.name);
    const pending = Array.isArray(state.pendingHelperNames) ? state.pendingHelperNames : [];
    if (!state.helpersApplied && pending.length) return pending.slice();
    const free = Array.isArray(state.freeHelperNames) ? state.freeHelperNames : [];
    return names.concat(
      free.filter((name) => !names.some((have) => have.toLowerCase() === String(name).toLowerCase()))
    );
  }

  function fill(str, extra = {}) {
    if (!str) return "";
    const instructor = instructorName() || "the teacher";
    const helperName = helperNames().join(", ");
    let text = String(str);
    if (!helperName) {
      text = text.replaceAll("Teacher {helper}", "our assistant");
      text = text.replaceAll("Assistant {helper}", "Assistant");
    }
    const reps = extra.reps != null ? extra.reps : extra.item?.reps;
    return text
      .replaceAll("{instructor}", instructor)
      .replaceAll("{helper}", helperName || "________")
      .replaceAll("{role}", "Teacher")
      .replaceAll("{lead}", `Teacher ${instructor}`)
      .replaceAll("{name}", extra.name || "this friend")
      .replaceAll("{reps}", String(reps != null ? reps : ""));
  }

  function asList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function uid() {
    return `c-${Math.random().toString(36).slice(2, 10)}`;
  }

  function builtinIds() {
    return new Set(DATA.activities.map((activity) => activity.id));
  }

  function stashImport(parsed) {
    if (!parsed || typeof parsed !== "object" || localStorage.getItem(IMPORT_KEY)) return;
    const roster = Array.isArray(parsed.roster) ? parsed.roster : [];
    const progress = parsed.progress && typeof parsed.progress === "object" ? parsed.progress : null;
    const hasProgress =
      progress &&
      ((Array.isArray(progress.classes) && progress.classes.length) ||
        (progress.levels && Object.keys(progress.levels).length) ||
        (progress.notes && Object.keys(progress.notes).length));
    if (!roster.length && !hasProgress) return;
    localStorage.setItem(IMPORT_KEY, JSON.stringify({ roster, progress: progress || {} }));
  }

  function load() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      const legacy = localStorage.getItem(OLD_STORAGE_KEY);
      const raw = current || legacy;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      stashImport(parsed);
      const imported = importLibrary(parsed, {
        replace: true,
        silent: true,
        fromLegacy: !current && !!legacy,
        skipAttendance: true,
      });
      if (!imported.ok && current) console.warn(imported.reason);
    } catch (err) {
      console.warn("Could not load saved library", err);
    }
  }

  function save() {
    pruneReps();
    const payload = {
      version: 2,
      custom: state.custom,
      disabled: state.disabled,
      pinned: state.pinned,
      reps: state.reps,
      settings: readSettings(),
      plan: state.plan,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Could not save planner", err);
      toast("This browser could not store the plan.");
    }
  }

  function pruneReps() {
    const ids = new Set(allActivities().map((activity) => activity.id));
    Object.keys(state.reps).forEach((id) => {
      if (!ids.has(id)) delete state.reps[id];
    });
  }

  function applySettings(s) {
    if (!s || typeof s !== "object") return;
    const text = {
      title: "title",
      ages: "ages",
      date: "date",
      startTime: "startTime",
    };
    if (typeof s.instructor === "string" && s.instructor.trim()) {
      state.hadInstructor = true;
      state.instructorName = s.instructor.trim();
    }
    if (P.cleanId(s.instructorId)) state.instructorId = P.cleanId(s.instructorId);
    if (Array.isArray(s.assistantIds) && s.assistantIds.length) {
      state.assistantIds = s.assistantIds.map((id) => P.cleanId(id)).filter(Boolean);
      state.helpersApplied = true;
    }
    const fromAssistants = personNames(s.assistants);
    state.pendingHelperNames = fromAssistants.length ? fromAssistants : personNames(s.helper);
    Object.entries(text).forEach(([key, id]) => {
      const el = $(id);
      if (el && typeof s[key] === "string") el.value = s[key];
    });
    const nums = {
      totalMin: [15, 120],
      openingMin: [0, 30],
      waterMin: [0, 10],
      finishMin: [0, 20],
      warmupCount: [0, 12],
      lessonCount: [0, 12],
      gameCount: [0, 12],
      kidCount: [0, 40],
      adultCount: [0, 20],
      warmupMin: [0, 20],
      baseMin: [0, 20],
      lessonMin: [0, 60],
      sparringMin: [0, 30],
      gameMin: [0, 20],
    };
    Object.entries(nums).forEach(([key, range]) => {
      if (s[key] == null || s[key] === "") return;
      const n = Number(s[key]);
      if (!Number.isFinite(n)) return;
      const el = $(key);
      if (el) el.value = String(P.clampNum(n, range[0], range[1], n));
    });
    const firstClass = $("firstClass");
    if (firstClass && typeof s.firstClass === "boolean") firstClass.checked = s.firstClass;
    if (typeof s.themeLock === "string") state.pendingTheme = s.themeLock;
    if (s.preset === "toddler" || s.preset === "grace") state.preset = s.preset;
    if (typeof s.ageGroup === "string") setAgeGroup(s.ageGroup, false);
  }

  function readSettings() {
    const num = (id, min, max, fallback) => P.clampNum($(id).value, min, max, fallback);
    const group = P.normalizeAgeKey(state.ageGroup);
    const names = helperNames();
    return {
      title: $("title").value.trim() || "GRACE BJJ KIDS",
      instructor: instructorName() || "the teacher",
      instructorId: state.instructorId,
      helper: names.join(", "),
      assistants: names,
      assistantIds: state.assistantIds.slice(),
      ages: $("ages").value.trim() || classLabel(group),
      kidCount: num("kidCount", 0, 40, 8),
      adultCount: num("adultCount", 0, 20, 2),
      date: $("date").value,
      startTime: /^\d{2}:\d{2}$/.test($("startTime").value) ? $("startTime").value : "17:30",
      firstClass: $("firstClass").checked,
      preset: state.preset === "toddler" ? "toddler" : "grace",
      ageGroup: group,
      totalMin: num("totalMin", 15, 120, 45),
      openingMin: num("openingMin", 0, 30, 2),
      warmupMin: num("warmupMin", 0, 20, 3),
      baseMin: num("baseMin", 0, 20, 4),
      lessonMin: num("lessonMin", 0, 60, 20),
      waterMin: num("waterMin", 0, 10, 1),
      sparringMin: num("sparringMin", 0, 30, 6),
      gameMin: num("gameMin", 0, 20, 5),
      finishMin: num("finishMin", 0, 20, 2),
      warmupCount: Math.round(num("warmupCount", 0, 12, 7)),
      lessonCount: Math.round(num("lessonCount", 0, 12, 3)),
      gameCount: Math.round(num("gameCount", 0, 12, 1)),
      themeLock: $("themeLock") ? $("themeLock").value : "",
      sheetId: state.sheetId,
    };
  }

  function ageLabel(id) {
    const group = DATA.ageGroups[id];
    return group ? `${group.range} ${group.label}` : "4–6 Mighty Mite";
  }

  function classLabel(id) {
    const key = P.normalizeAgeKey(id);
    if (P.isCombo(key)) return P.comboLabel(key);
    if (key === "toddler") return "Toddler 3–5";
    return ageLabel(key);
  }

  function curriculumAge(ageGroup, mode) {
    if (mode === "toddler" || ageGroup === "toddler") return "toddler";
    return P.youngestAge(ageGroup);
  }

  function syncAgeButtons() {
    const ids = P.parseAgeKey(state.ageGroup);
    if (!ids.length) {
      state.ageGroup = "mite";
      ids.push("mite");
    }
    document.querySelectorAll("#ageGroup button").forEach((btn) => {
      const on = ids.includes(btn.dataset.group);
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const blurb = $("ageBlurb");
    if (!blurb) return;
    if (ids.length > 1) {
      const young = DATA.ageGroups[ids[0]];
      blurb.textContent = `${P.comboLabel(state.ageGroup)}. Technique and games use the ${young.range} ${young.label} level.`;
    } else {
      const group = DATA.ageGroups[ids[0]] || DATA.ageGroups.mite;
      blurb.textContent = group.focus;
    }
  }

  function applyAgeSelection() {
    state.preset = "grace";
    state.themeOffset = 0;
    state.themeSkip = 0;
    if ($("themeLock")) $("themeLock").value = "";
    const key = state.ageGroup;
    const young = DATA.ageGroups[P.youngestAge(key)] || DATA.ageGroups.mite;
    $("ages").value = P.isCombo(key) ? P.comboLabel(key) : ageLabel(young.id);
    if ($("title").value === "FIRST BJJ CLASS") $("title").value = "GRACE BJJ KIDS";
    fillThemeLock();
    writeClassCounts();
    buildPlan({ mode: "grace" });
    renderHome();
    toast(P.isCombo(key) ? P.comboLabel(key) : `${young.range} ${young.label}. ${young.pace}`);
  }

  function setAgeGroup(id, rebuild) {
    const key = P.normalizeAgeKey(id);
    state.ageGroup = key === "toddler" ? "mite" : key;
    syncAgeButtons();
    fillThemeLock();
    if (rebuild) applyAgeSelection();
  }

  function toggleAgeGroup(id) {
    if (!DATA.ageGroups[id]) return;
    const ids = P.parseAgeKey(state.ageGroup);
    const next = ids.includes(id) ? ids.filter((item) => item !== id) : ids.concat(id);
    if (!next.length) return;
    state.ageGroup = P.ageKey(next);
    syncAgeButtons();
    applyAgeSelection();
  }

  function defaultReps(activity) {
    const n = Number(activity?.reps);
    return Number.isFinite(n) && n >= 1 ? Math.min(20, Math.round(n)) : 1;
  }

  function repsOf(activity) {
    if (!activity) return 1;
    if (state.reps[activity.id] != null) {
      const n = Number(state.reps[activity.id]);
      if (Number.isFinite(n) && n >= 1) return Math.min(20, Math.round(n));
    }
    return defaultReps(activity);
  }

  function displayName(item) {
    const name = fill(item.name || "", item);
    const n = Number(item.reps) || repsOf(item);
    return n > 1 ? `${name} x${n}` : name;
  }

  function allActivities() {
    const builtin = DATA.activities.map((activity) => ({
      ...activity,
      builtin: true,
      reps: defaultReps(activity),
    }));
    return builtin.concat(
      state.custom.map((activity) => ({ ...activity, builtin: false, reps: defaultReps(activity) }))
    );
  }

  function ageAllows(activity, ageGroup) {
    if (!ageGroup) return true;
    if (!activity.ages || !activity.ages.length) return true;
    return activity.ages.includes(ageGroup);
  }

  function lessonThemes(item) {
    const ids = [];
    if (!item || typeof item !== "object") return ids;
    if (item.theme) ids.push(item.theme);
    (Array.isArray(item.themes) ? item.themes : []).forEach((id) => {
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  }

  function lessonInTheme(item, themeId) {
    if (!themeId) return true;
    return lessonThemes(item).includes(themeId);
  }

  function pool(category, ageGroup) {
    return allActivities().filter(
      (activity) =>
        activity.category === category &&
        !state.disabled.includes(activity.id) &&
        ageAllows(activity, ageGroup)
    );
  }

  function withCurrentReps(activity, ageGroup) {
    const catalogReps = defaultReps(activity);
    const stored = repsOf(activity);
    const reps =
      activity.category === "warmup" || activity.category === "base"
        ? P.pacedReps(stored, ageGroup)
        : stored;
    const catalogMinutes = Number(activity.duration) || 2;
    return {
      ...activity,
      catalogMinutes,
      catalogReps,
      baseReps: stored,
      reps,
      prefMinutes: P.prefMinutes(catalogMinutes, catalogReps, reps),
    };
  }

  function pick(category, count, ageGroup, opts = {}) {
    const keepIds = opts.keep || [];
    const exclude = new Set(opts.exclude || []);
    const prefer = opts.prefer || [];
    const items = pool(category, ageGroup).filter((activity) => !exclude.has(activity.id));
    const byId = Object.fromEntries(items.map((activity) => [activity.id, activity]));
    const chosen = [];
    const used = new Set();
    const take = (id) => {
      if (byId[id] && !used.has(id) && chosen.length < count) {
        chosen.push(withCurrentReps(byId[id], ageGroup));
        used.add(id);
      }
    };
    keepIds.forEach(take);
    prefer.forEach(take);
    state.pinned.forEach(take);
    const rest = items.filter((activity) => !used.has(activity.id));
    shuffle(rest);
    while (chosen.length < count && rest.length) chosen.push(withCurrentReps(rest.shift(), ageGroup));
    return chosen;
  }

  function baseItems(ageGroup, keepIds) {
    const items = pool("base", ageGroup);
    const byId = Object.fromEntries(items.map((activity) => [activity.id, activity]));
    if (keepIds) {
      return keepIds.filter((id) => byId[id]).map((id) => withCurrentReps(byId[id], ageGroup));
    }
    const chosen = [];
    P.BASE_ORDER.forEach((id) => {
      if (byId[id]) chosen.push(withCurrentReps(byId[id], ageGroup));
    });
    items.forEach((activity) => {
      if (!chosen.some((item) => item.id === activity.id)) chosen.push(withCurrentReps(activity, ageGroup));
    });
    return chosen;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function prayerItems() {
    const src = DATA.openingPrayer;
    if (!src || typeof src !== "object") return [];
    return [
      {
        ...src,
        catalogMinutes: 2,
        catalogReps: 1,
        reps: 1,
        prefMinutes: 2,
      },
    ];
  }

  function openingItems(settings) {
    const toddler = settings.preset === "toddler";
    const src = toddler
      ? settings.firstClass
        ? DATA.firstClassOpening
        : DATA.regularOpening
      : settings.firstClass
        ? DATA.graceFirstOpening
        : DATA.graceOpening;
    return (Array.isArray(src) ? src : []).map((item) => ({
      ...item,
      catalogMinutes: item.weight || 3,
      catalogReps: 1,
      reps: 1,
      prefMinutes: item.weight || 3,
    }));
  }

  function prefSum(items) {
    return items.reduce(
      (total, item) => total + Math.max(30, Math.round((Number(item.prefMinutes) || 2) * 60)),
      0
    );
  }

  function sectionParts(content, settings) {
    content = content || {};
    settings = settings || {};
    const warmup = Array.isArray(content.warmup) ? content.warmup : [];
    const base = Array.isArray(content.base) ? content.base : [];
    const lesson = Array.isArray(content.lesson) ? content.lesson : [];
    const games = Array.isArray(content.games) ? content.games : [];
    const waterSec = Math.round(P.clampNum(settings.waterMin, 0, 10, 1) * 60);
    const parts = [{ id: "opening", flex: false, seconds: Math.round(settings.openingMin * 60) }];
    const grace = content.mode === "grace";
    const wantWater1 = warmup.length > 0 && waterSec > 0;
    const wantWater2 =
      waterSec > 0 &&
      (grace
        ? lesson.length + base.length > 0 && (games.length > 0 || content.sparring)
        : lesson.length > 0 && games.length > 0);
    if (warmup.length) {
      parts.push(
        grace
          ? { id: "warmup", flex: false, seconds: 5 * 60 }
          : { id: "warmup", flex: true, weight: prefSum(warmup) }
      );
    }
    if (wantWater1) parts.push({ id: "water1", flex: false, seconds: waterSec });
    if (grace && base.length) parts.push({ id: "base", flex: true, weight: prefSum(base) });
    if (lesson.length) parts.push({ id: "lesson", flex: true, weight: prefSum(lesson) });
    if (wantWater2) parts.push({ id: "water2", flex: false, seconds: waterSec });
    if (games.length) {
      parts.push(
        grace
          ? { id: "games", flex: false, seconds: 5 * 60 }
          : { id: "games", flex: true, weight: prefSum(games) }
      );
    }
    if (content.sparring) parts.push({ id: "sparring", flex: true, weight: 6 * 60 });
    parts.push({ id: "finish", flex: false, seconds: Math.round(settings.finishMin * 60) });
    return parts;
  }

  function stampItems(items, start, budget, startMinutes) {
    return P.stampItemClocks(items, start, budget, startMinutes);
  }

  function gameMeta(games, mode) {
    if (mode === "grace") return { title: "Game", note: DATA.playNote };
    const coneish = games.length && games.every((game) => /donut|cone|shark|treasure|superhero save/i.test(game.name));
    return {
      title: coneish ? "Cone games" : "Games",
      note: games.some((game) => /donut|cone/i.test(game.name)) ? "Scatter 8–10 small cones." : "",
    };
  }

function assembleGrace(content, settings) {
  settings = settings || {};
  content = content || {};
  const total = Math.round(P.clampNum(settings.totalMin, 15, 120, 45) * 60);
  const startMinutes = P.parseStartMinutes(settings.startTime);
  const sec = (min) => Math.max(0, Math.round(Number(min) * 60));
  const opening = Array.isArray(content.opening) ? content.opening : [];
  const warmup = Array.isArray(content.warmup) ? content.warmup : [];
  const base = Array.isArray(content.base) ? content.base : [];
  const lesson = Array.isArray(content.lesson) ? content.lesson : [];
  const games = Array.isArray(content.games) ? content.games : [];
  const prayer = prayerItems();
  const requested = {
    prayer: prayer.length ? Number(P.PRAYER_SECONDS) || 120 : 0,
    opening: opening.length ? sec(settings.openingMin) : 0,
    warmup: warmup.length ? sec(settings.warmupMin) : 0,
    base: base.length ? sec(settings.baseMin) : 0,
    lesson: lesson.length ? sec(settings.lessonMin) : 0,
    water: sec(settings.waterMin),
    sparring: sec(settings.sparringMin),
    game: games.length ? sec(settings.gameMin) : 0,
    finish: sec(settings.finishMin),
  };
  const covered = typeof P.coverOpeningPrayer === "function" ? P.coverOpeningPrayer(requested, total) : requested;
  const fit = P.fitClassTimes(covered, total);
  const byId = { ...fit.seconds };
  if (prayer.length && byId.prayer == null) byId.prayer = Number(P.PRAYER_SECONDS) || 120;
  if (!lesson.length && byId.lesson) {
    byId.game += byId.lesson;
    byId.lesson = 0;
  }
  let cursor = 0;
  const plan = {
    mode: "grace",
    settings: { ...settings, preset: "grace" },
    startMinutes,
    squeezed: fit.squeezed,
    headerTitle: "Grace BJJ Kids Lesson Plan",
    theme: content.theme || null,
    sessionId: content.sessionId || uid(),
    liveSparring: !!content.liveSparring,
  };
  const placeItems = (id, items, extra, budgetKey) => {
    const dur = byId[budgetKey || id] || 0;
    if (!dur || !items || !items.length) return;
    plan[id] = {
      start: cursor,
      duration: dur,
      when: P.clockRange(startMinutes, cursor, dur),
      items: stampItems(items, cursor, dur, startMinutes),
      ...extra,
    };
    cursor += dur;
  };
  const placeMark = (id, extra) => {
    const dur = byId[id] || 0;
    if (!dur) return;
    plan[id] = {
      start: cursor,
      duration: dur,
      when: P.clockRange(startMinutes, cursor, dur),
      ...extra,
    };
    cursor += dur;
  };
  placeItems("prayer", prayer);
  placeItems("opening", opening);
  placeItems("warmup", warmup);
  placeItems("base", base);
  placeItems("lesson", lesson);
  placeMark("water");
  placeMark("sparring");
  placeItems("games", games, gameMeta(games, "grace"), "game");
  placeMark("finish");
  if (cursor !== total && plan.lesson) {
    const extra = total - cursor;
    plan.lesson.duration += extra;
    plan.lesson.when = P.clockRange(startMinutes, plan.lesson.start, plan.lesson.duration);
    plan.lesson.items = stampItems(lesson, plan.lesson.start, plan.lesson.duration, startMinutes);
    cursor = plan.lesson.start + plan.lesson.duration;
    ["water", "sparring", "games", "finish"].forEach((id) => {
      if (!plan[id]) return;
      const dur = plan[id].duration;
      plan[id].start = cursor;
      plan[id].when = P.clockRange(startMinutes, cursor, dur);
      if (plan[id].items) plan[id].items = stampItems(plan[id].items, cursor, dur, startMinutes);
      cursor += dur;
    });
  }
  plan.end = cursor;
  return plan;
}

function assemble(content, settings) {
  if (content.mode === "grace") return assembleGrace(content, settings);
  const total = Math.round(P.clampNum(settings.totalMin, 15, 120, 45) * 60);
    const startMinutes = P.parseStartMinutes(settings.startTime);
    const allocated = P.allocateParts(sectionParts(content, settings), total);
    const byId = {};
    allocated.ids.forEach((id, index) => {
      byId[id] = allocated.seconds[index];
    });
    if (typeof P.fundOpeningPrayer === "function") {
      const funded = P.fundOpeningPrayer(byId);
      Object.keys(byId).forEach((key) => {
        delete byId[key];
      });
      Object.assign(byId, funded);
    } else if (prayerItems().length) {
      byId.prayer = Number(P.PRAYER_SECONDS) || 120;
    }
    let cursor = 0;
    const plan = {
      mode: content.mode,
      settings: { ...settings, preset: content.mode },
      startMinutes,
      squeezed: allocated.squeezed,
      headerTitle:
        content.mode === "toddler"
          ? settings.firstClass
            ? "First Class Lesson Plan"
            : "Toddler Class Lesson Plan"
          : "Grace BJJ Kids Lesson Plan",
    };
    const placeItems = (id, items, extra) => {
      const dur = byId[id] || 0;
      if (!dur || !items || !items.length) return;
      plan[id] = {
        start: cursor,
        duration: dur,
        when: P.clockRange(startMinutes, cursor, dur),
        items: stampItems(items, cursor, dur, startMinutes),
        ...extra,
      };
      cursor += dur;
    };
    const placeMark = (id, extra) => {
      const dur = byId[id] || 0;
      if (!dur) return;
      plan[id] = {
        start: cursor,
        duration: dur,
        when: P.clockRange(startMinutes, cursor, dur),
        ...extra,
      };
      cursor += dur;
    };
    placeItems("prayer", prayerItems());
    placeItems("opening", content.opening);
    placeItems("warmup", content.warmup);
    placeMark("water1");
    if (content.mode === "grace") placeItems("base", content.base);
    placeItems("lesson", content.lesson);
    placeMark("water2");
    placeItems("games", content.games, gameMeta(content.games, content.mode));
    if (content.sparring) placeMark("sparring");
    placeMark("finish");
    if (cursor !== total && plan.finish) {
      const next = plan.finish.duration + (total - cursor);
      if (next >= 0) {
        plan.finish.duration = next;
        plan.finish.when = P.clockRange(startMinutes, plan.finish.start, plan.finish.duration);
        cursor = total;
      }
    }
    plan.end = cursor;
    return plan;
  }

function liveSparring(settings, mode) {
  if (mode !== "grace") return false;
  const key = settings.ageGroup;
  const ratio = P.ratioStatus(settings.kidCount, settings.adultCount);
  if (!ratio.ok) return false;
  return state.roster.some((kid) => P.kidCanSpar(kid, key, true));
}

function themesForAge(age) {
    return (DATA.themes || []).filter((theme) => pool("lesson", age).some((item) => lessonInTheme(item, theme.id)));
}

function fillThemeLock() {
  const select = $("themeLock");
  if (!select) return;
  const current = state.pendingTheme || select.value;
  state.pendingTheme = "";
  const themes = themesForAge(curriculumAge(state.ageGroup));
  select.innerHTML = [`<option value="">Auto — least recently taught</option>`]
    .concat(themes.map((theme) => `<option value="${esc(theme.id)}">${esc(theme.label)}</option>`))
    .join("");
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  const formSelect = $("actTheme");
  if (formSelect) {
    const keep = formSelect.value;
    formSelect.innerHTML =
      `<option value="">None</option>` +
      (DATA.themes || []).map((theme) => `<option value="${esc(theme.id)}">${esc(theme.label)}</option>`).join("");
    if ([...formSelect.options].some((option) => option.value === keep)) formSelect.value = keep;
  }
}

function pickGraceLessons(age, count) {
  const choice = P.chooseTheme(
    themesForAge(age),
    state.progress.classes,
    age,
    $("themeLock") ? $("themeLock").value : "",
    state.themeSkip
  );
  if (!choice) return { items: [], theme: null };
  const themed = pool("lesson", age)
    .filter((item) => lessonInTheme(item, choice.id))
    .sort((a, b) => (Number(a.order) || 50) - (Number(b.order) || 50) || a.name.localeCompare(b.name));
  const already = new Set();
  state.progress.classes.forEach((entry) => {
    if (!entry.taught || !P.ageKeyIncludes(entry.ageGroup, age) || entry.theme !== choice.id) return;
    (entry.techniques || []).forEach((tech) => already.add(tech.id));
  });
  const resume = themed.length ? already.size % themed.length : 0;
  const seq = P.takeSequence(themed, count, resume + state.themeOffset);
  const pinned = state.pinned
    .map((id) => pool("lesson", age).find((item) => item.id === id))
    .filter((item) => item && (!lessonThemes(item).length || lessonInTheme(item, choice.id)));
  const items = [];
  const used = new Set();
  pinned.forEach((item) => {
    items.push(withCurrentReps(item, age));
    used.add(item.id);
  });
  seq.forEach((item) => {
    if (used.has(item.id) || items.length >= count) return;
    items.push(withCurrentReps(item, age));
    used.add(item.id);
  });
  return { items, theme: choice };
}

function themeGamePrefer(themeId, age) {
  const themed = pool("game", age)
    .filter((item) => (item.themes || []).includes(themeId))
    .map((item) => item.id);
  return themed.concat(P.STANDARD_PLAY.filter((id) => !themed.includes(id)));
}

  function cleanItem(item) {
    if (!item || typeof item !== "object") return null;
    const catalogMinutes = Number(item.catalogMinutes) || Number(item.prefMinutes) || 2;
    const catalogReps = Math.max(1, Number(item.catalogReps) || 1);
    const reps = Math.max(1, Math.min(20, Number(item.reps) || catalogReps));
    return {
      ...item,
      catalogMinutes,
      catalogReps,
      reps,
      prefMinutes: P.prefMinutes(catalogMinutes, catalogReps, reps),
      ageOverride: !!item.ageOverride,
    };
  }

  function cleanItems(items) {
    return (Array.isArray(items) ? items : []).map(cleanItem).filter(Boolean);
  }

  function overrideCarryCount(key) {
    const previous = state.plan && state.plan[key] && state.plan[key].items;
    return (Array.isArray(previous) ? previous : []).filter((item) => item && item.ageOverride && item.id != null).length;
  }

  function carryAgeOverrides(picked, key, age) {
    const previous = state.plan && state.plan[key] && state.plan[key].items;
    const expected = key === "games" ? "game" : key;
    return P.keepAgeOverrides(picked, previous)
      .filter((item) => item && !state.disabled.includes(item.id))
      .map((item) => {
        if (!item.ageOverride) return item;
        const activity = findActivity(item.id);
        if (!activity || activity.category !== expected) return { ...item, ageOverride: true };
        return { ...withCurrentReps(activity, age), ageOverride: !ageAllows(activity, age) };
      });
  }

function buildPlan(opts = {}) {
  const mode = opts.mode || state.preset || "grace";
  state.preset = mode;
  const settings = readSettings();
  settings.preset = mode;
  const age = curriculumAge(settings.ageGroup, mode);
  const keep = opts.keep || {};
  const exclude = opts.exclude || {};
  const prefer = opts.prefer || {};
  const warmupPrefer =
    prefer.warmup !== undefined ? prefer.warmup : mode === "grace" && !keep.warmup ? P.STANDARD_WARMUP : [];
  let lesson = [];
  let theme = null;
  const lessonPick = Math.max(0, settings.lessonCount - overrideCarryCount("lesson"));
  if (lessonPick > 0) {
    if (mode === "grace" && !keep.lesson) {
      const picked = pickGraceLessons(age, lessonPick);
      lesson = picked.items;
      theme = picked.theme;
    } else {
      lesson = pick("lesson", lessonPick, age, {
        keep: keep.lesson,
        exclude: exclude.lesson,
        prefer: prefer.lesson || [],
      });
      theme = opts.keepSession ? state.plan?.theme || null : null;
    }
  } else if (overrideCarryCount("lesson") > 0) {
    theme = state.plan?.theme || null;
  }
  const gamePrefer =
    prefer.game !== undefined
      ? prefer.game
      : mode === "grace" && !keep.game
        ? themeGamePrefer(theme && theme.id, age)
        : [];
  const warmupPick = Math.max(0, settings.warmupCount - overrideCarryCount("warmup"));
  const gamePick = Math.max(0, settings.gameCount - overrideCarryCount("games"));
  const content = {
    mode,
    opening: openingItems(settings),
    warmup: carryAgeOverrides(
      warmupPick > 0
        ? pick("warmup", warmupPick, age, {
            keep: keep.warmup,
            exclude: exclude.warmup,
            prefer: warmupPrefer,
          })
        : [],
      "warmup",
      age
    ),
    base: carryAgeOverrides(mode === "grace" ? baseItems(age, keep.base) : [], "base", age),
    lesson: carryAgeOverrides(lesson, "lesson", age),
    games: carryAgeOverrides(
      gamePick > 0
        ? pick("game", gamePick, age, {
            keep: keep.game,
            exclude: exclude.game,
            prefer: gamePrefer,
          })
        : [],
      "games",
      age
    ),
    sparring: false,
    liveSparring: liveSparring(settings, mode),
    theme,
    sessionId: opts.keepSession && state.plan?.sessionId ? state.plan.sessionId : uid(),
  };
  state.plan = assemble(content, settings);
  $("warmupCount").value = String(content.warmup.length);
  $("lessonCount").value = String(content.lesson.length);
  $("gameCount").value = String(content.games.length);
  save();
  renderPlan();
  updateMeta();
}

  function retimePlan() {
    if (!state.plan) return;
    const settings = readSettings();
    const mode = state.plan.mode === "toddler" ? "toddler" : "grace";
    settings.preset = mode;
    state.preset = mode;
    const content = {
      mode,
      opening: cleanItems(state.plan.opening?.items || openingItems(settings)),
      warmup: cleanItems(state.plan.warmup?.items),
      base: cleanItems(state.plan.base?.items),
      lesson: cleanItems(state.plan.lesson?.items),
      games: cleanItems(state.plan.games?.items),
      sparring: false,
      liveSparring: liveSparring(settings, mode),
      theme: state.plan.theme || null,
      sessionId: state.plan.sessionId || uid(),
    };
    state.plan = assemble(content, settings);
    save();
    renderPlan();
    updateMeta();
  }

  function resizeSection(section, count) {
    if (!state.plan) {
      updateTimeSum();
      save();
      return;
    }
    const key = section === "game" ? "games" : section;
    const cat = section === "game" ? "game" : section;
    const age = curriculumAge(readSettings().ageGroup, state.plan.mode);
    const current = cleanItems(state.plan[key]?.items);
    let next = current;
    if (count < current.length) next = current.slice(0, count);
    else if (count > current.length) {
      if (cat === "lesson" && state.plan.mode === "grace" && state.plan.theme) {
        const more = pool("lesson", age)
          .filter((item) => lessonInTheme(item, state.plan.theme.id) && !current.some((have) => have.id === item.id))
          .sort((a, b) => (Number(a.order) || 50) - (Number(b.order) || 50));
        next = current.concat(more.slice(0, count - current.length).map((item) => withCurrentReps(item, age)));
      } else {
        next = current.concat(
          pick(cat, count - current.length, age, {
            exclude: current.map((item) => item.id),
            prefer: [],
          })
        );
      }
    }
    if (next.length !== count) {
      toast(`The ${catLabel(cat).toLowerCase()} pool has ${next.length}.`);
    }
    const inputId = section === "game" ? "gameCount" : section === "lesson" ? "lessonCount" : "warmupCount";
    $(inputId).value = String(next.length);
    if (next.length) state.plan[key] = { ...(state.plan[key] || {}), items: next };
    else delete state.plan[key];
    retimePlan();
  }

  function setSectionItems(section, ids, opts = {}) {
    if (!state.plan) return;
    const key = blockKey(section);
    const cat = key === "games" ? "game" : key;
    const age = curriculumAge(state.plan.settings.ageGroup, state.plan.mode);
    const current = cleanItems(state.plan[key]?.items);
    const have = new Map(current.map((item) => [item.id, item]));
    const overrideId = opts.overrideId != null ? String(opts.overrideId) : "";
    const next = [];
    ids.forEach((id) => {
      if (have.has(id)) {
        next.push(have.get(id));
        return;
      }
      const activity = findActivity(id);
      if (!activity || activity.category !== cat) return;
      if (state.disabled.includes(id)) return;
      const allowed = ageAllows(activity, age);
      if (!allowed && String(id) !== overrideId) return;
      const item = withCurrentReps(activity, age);
      if (!allowed) item.ageOverride = true;
      next.push(item);
    });
    if (next.length) state.plan[key] = { ...(state.plan[key] || {}), items: next };
    else delete state.plan[key];
    const inputId = section === "game" ? "gameCount" : section === "lesson" ? "lessonCount" : section === "warmup" ? "warmupCount" : "";
    if (inputId && $(inputId)) $(inputId).value = String(next.length);
    retimePlan();
  }

  function sayHtml(value, extra) {
    return asList(value)
      .filter(Boolean)
      .map((line) => `<p class="say">“${esc(fill(line, extra))}”</p>`)
      .join("");
  }

  function extraHtml(text, extra) {
    if (!text) return "";
    return `<p class="extra">${esc(fill(text, extra)).replaceAll("\n", "<br>")}</p>`;
  }

  function howHtml(text, extra) {
    if (!text) return "";
    return `<p>${esc(fill(text, extra)).replaceAll("\n", "<br>")}</p>`;
  }

  function repsCtrl(item, section) {
    if (!item?.id || section === "opening" || section === "prayer") return "";
    const n = Number(item.reps) || 1;
    const id = esc(item.id);
    const sec = esc(section);
    return `<span class="reps-ctrl" title="How many">
      <button type="button" data-reps="-1" data-id="${id}" data-section="${sec}">−</button>
      <span>x${n}</span>
      <button type="button" data-reps="1" data-id="${id}" data-section="${sec}">+</button>
    </span>`;
  }

  function shuffleBtn(section, id) {
    if (!state.showItemShuffle || !id || section === "prayer") return "";
    return `<button class="reroll" type="button" data-swap="${esc(section)}" data-id="${esc(id)}">shuffle</button>`;
  }

  function lineupHtml() {
    const ordered = P.sortByRank(state.roster);
    if (!ordered.length) return "<p>Highest belt in front. Add the roster to print the order.</p>";
    return `<ol class="lineup">${ordered
      .map((kid) => {
        const stripes = P.clampInt(kid.stripes, 0, 4, 0);
        const stripeText = stripes === 0 ? "no stripes" : `${stripes} stripe${stripes === 1 ? "" : "s"}`;
        return `<li><strong>${esc(kid.name)}</strong> — ${esc(P.beltLabel(kid.belt))}, ${stripeText}, age ${esc(kid.age)}</li>`;
      })
      .join("")}</ol>`;
  }

function techniqueHtml(item) {
  const steps = Array.isArray(item.steps) ? item.steps.filter(Boolean) : [];
  if (!item.position && !steps.length && !item.drill && !item.safety) return "";
  return (
    (item.position ? `<p class="position">From ${esc(item.position)}.</p>` : "") +
    (steps.length ? `<ol class="steps">${steps.map((step) => `<li>${esc(fill(step, item))}</li>`).join("")}</ol>` : "") +
    (item.drill ? `<p class="drill">${esc(fill(item.drill, item))}</p>` : "") +
    (item.safety ? `<p class="safety">${esc(fill(item.safety, item))}</p>` : "")
  );
}

function bodyHtml(item) {
  if (item.parts) {
    return item.parts
      .map((part) => (part.say != null ? sayHtml(part.say, item) : howHtml(part.p, item)))
      .join("");
  }
  const steps = Array.isArray(item.steps) && item.steps.length;
  return (
    (steps ? "" : howHtml(item.how, item)) +
    techniqueHtml(item) +
    (steps ? "" : sayHtml(item.say, item)) +
    extraHtml(item.extra, item) +
    howHtml(item.after, item) +
    sayHtml(item.sayAfter, item) +
    (item.lineup ? lineupHtml() : "")
  );
}

  const PICK = {
    warmup: { cat: "warmup", search: "Search warmups", clear: "Clear warmup search" },
    base: { cat: "base", search: "Search base movements", clear: "Clear base search" },
    lesson: { cat: "lesson", search: "Search techniques", clear: "Clear technique search" },
    game: { cat: "game", search: "Search games", clear: "Clear game search" },
    sparring: { cat: "", search: "Search sparring", clear: "Clear sparring search" },
  };

  function planQuery(section) {
    return state.planQuery[section] || "";
  }

  function countMark(n) {
    const count = Math.max(0, Number(n) || 0);
    return `<span class="in-plan-count no-print">${count} in plan</span>`;
  }

  function searchField(section) {
    const meta = PICK[section];
    const value = planQuery(section);
    return `<div class="plan-search no-print">
      <input id="planSearch-${esc(section)}" type="search" data-plan-search="${esc(section)}" aria-label="${esc(meta.search)}" placeholder="${esc(meta.search)}" value="${esc(value)}" />
      <button type="button" class="plan-clear" data-plan-clear="${esc(section)}" aria-label="${esc(meta.clear)}"${value.trim() ? "" : " disabled"}>Clear</button>
    </div>`;
  }

  function planToggleButton(section, id, name, inPlan) {
    const verb = inPlan ? "Remove from plan" : "Add to plan";
    return `<button type="button" class="plan-toggle no-print${inPlan ? " is-on" : ""}" data-plan-toggle="${esc(section)}" data-id="${esc(id)}" aria-pressed="${inPlan ? "true" : "false"}" aria-label="${esc(verb)}: ${esc(name || "item")}">${verb}</button>`;
  }

  function libraryFor(cat) {
    const age = state.plan ? curriculumAge(state.plan.settings.ageGroup, state.plan.mode) : curriculumAge(state.ageGroup, state.preset);
    const key = blockKey(cat);
    const inIds = new Set((state.plan?.[key]?.items || []).map((item) => item && item.id).filter(Boolean));
    return allActivities().filter((activity) => {
      if (activity.category !== cat) return false;
      if (inIds.has(activity.id)) return true;
      return !state.disabled.includes(activity.id) && ageAllows(activity, age);
    });
  }

  function libraryOutOfAge(cat) {
    const age = state.plan ? curriculumAge(state.plan.settings.ageGroup, state.plan.mode) : curriculumAge(state.ageGroup, state.preset);
    const key = blockKey(cat);
    const inIds = new Set((state.plan?.[key]?.items || []).map((item) => item && item.id).filter(Boolean));
    return allActivities().filter((activity) => {
      if (activity.category !== cat) return false;
      if (inIds.has(activity.id) || state.disabled.includes(activity.id)) return false;
      return !ageAllows(activity, age);
    });
  }

  function sectionGroups(section, query) {
    const cat = PICK[section].cat;
    const key = blockKey(section);
    const ids = (state.plan?.[key]?.items || []).map((item) => item && item.id).filter(Boolean);
    return P.ageOverrideGroups(libraryFor(cat), libraryOutOfAge(cat), ids, query);
  }

  function byPlanName(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  }

  function blurbOf(activity) {
    const raw = activity.how || (Array.isArray(activity.say) ? activity.say[0] : activity.say) || activity.extra || "";
    return fill(String(raw).split("\n")[0], { ...activity, reps: repsOf(activity) });
  }

  function pickerRest(section) {
    const cat = PICK[section].cat;
    if (!cat) return "";
    const groups = sectionGroups(section, planQuery(section));
    const inAge = groups.rest
      .slice()
      .sort(byPlanName)
      .map((activity) => {
        return `<article class="pick-row">
          <div class="pick-copy">
            <strong>${esc(activity.name || "")}</strong>
            <p>${esc(blurbOf(activity))}</p>
          </div>
          ${planToggleButton(section, activity.id, activity.name, false)}
        </article>`;
      });
    const outOfAge = groups.outOfAge
      .slice()
      .sort(byPlanName)
      .map((activity) => {
        const name = activity.name || "item";
        return `<article class="pick-row is-out-of-age">
          <div class="pick-copy">
            <strong>${esc(activity.name || "")}</strong>
            <p>${esc(blurbOf(activity))}</p>
            <p class="age-limit">${esc(P.ageLimitLabel(activity.ages))}</p>
          </div>
          <button type="button" class="danger plan-override no-print" data-plan-override="${esc(section)}" data-id="${esc(activity.id)}" aria-label="Override age limit and add ${esc(name)} to plan">Override</button>
        </article>`;
      });
    return `<div class="plan-rest no-print">${inAge.concat(outOfAge).join("")}</div>`;
  }

  function pickerEmpty(section) {
    const query = planQuery(section).trim();
    if (!query) return "";
    if (section === "sparring") {
      const on = state.plan && state.plan.sparring;
      const record = {
        name: "Sparring",
        how: DATA.sparring.how,
        tags: DATA.sparring.points,
      };
      if (on && P.matchesPlanQuery(record, query)) return "";
      return `<p class="pick-empty no-print">No matches</p>`;
    }
    const key = blockKey(section);
    const items = (state.plan?.[key]?.items || []).filter((item) => item && typeof item === "object");
    const shown = items.filter((item) => P.matchesPlanQuery(item, query)).length;
    const groups = sectionGroups(section, query);
    if (shown + groups.rest.length + groups.outOfAge.length > 0) return "";
    return `<p class="pick-empty no-print">No matches</p>`;
  }

  function builderShell(section, title) {
    if (section === "base" && state.plan && state.plan.mode !== "grace") return "";
    const key = blockKey(section);
    const n = (state.plan?.[key]?.items || []).length;
    return `<section class="block plan-build no-print" data-build="${esc(section)}">
      <h2 class="block-title">${esc(title)} ${countMark(n)}</h2>
      ${searchField(section)}
      ${pickerEmpty(section)}
      ${pickerRest(section)}
    </section>`;
  }

  function restorePlanFocus() {
    const focus = state.planFocus;
    state.planFocus = null;
    if (!focus) return;
    if (focus.kind === "search") {
      const el = document.getElementById(`planSearch-${focus.section}`);
      if (!el) return;
      el.focus();
      const pos = Number(focus.pos);
      if (Number.isFinite(pos)) {
        try { el.setSelectionRange(pos, pos); } catch (err) { /* search inputs can reject a range */ }
      }
      return;
    }
    if (focus.kind === "toggle") {
      const buttons = document.querySelectorAll("#plan [data-plan-toggle]");
      const el = [...buttons].find((btn) => btn.dataset.planToggle === focus.section && btn.dataset.id === focus.id);
      if (el) el.focus();
    }
    if (focus.kind === "reorder") {
      const handles = document.querySelectorAll("#plan .reorder-handle");
      const el = [...handles].find((btn) => btn.dataset.reorder === focus.section && btn.dataset.id === focus.id);
      if (el) el.focus();
    }
  }

  function reorderTools(item, section, index, count) {
    if (!item || item.id == null) return "";
    if (!["warmup", "base", "lesson", "game"].includes(section)) return "";
    if (!Number.isInteger(index) || !(count > 0)) return "";
    const name = fill(item.name || "", item) || "item";
    const upOff = index <= 0 ? " disabled" : "";
    const downOff = index >= count - 1 ? " disabled" : "";
    return `<div class="reorder-tools no-print">
      <button type="button" class="reorder-handle" data-reorder="${esc(section)}" data-id="${esc(item.id)}" aria-label="Reorder ${esc(name)}" aria-keyshortcuts="ArrowUp ArrowDown"><span aria-hidden="true">≡</span></button>
      <button type="button" class="reorder-step" data-move="up" data-reorder="${esc(section)}" data-id="${esc(item.id)}" aria-label="Move ${esc(name)} up"${upOff}>Move up</button>
      <button type="button" class="reorder-step" data-move="down" data-reorder="${esc(section)}" data-id="${esc(item.id)}" aria-label="Move ${esc(name)} down"${downOff}>Move down</button>
    </div>`;
  }

  function announceReorder(name, position, total) {
    const el = $("reorderStatus");
    if (!el) return;
    el.textContent = "";
    el.textContent = `${name} moved to position ${position} of ${total}`;
  }

  function applyReorder(section, fromId, toId, placement) {
    if (!state.plan || !P.REORDER_SECTIONS.includes(section)) return;
    const key = blockKey(section);
    const current = state.plan[key] && state.plan[key].items;
    if (!Array.isArray(current) || current.length < 2) return;
    const next = P.reorderSectionItems(section, current, fromId, toId, placement);
    const before = current.map((item) => String(item.id)).join("\n");
    const after = next.map((item) => String(item.id)).join("\n");
    if (before === after) return;
    state.plan[key] = { ...state.plan[key], items: next };
    const position = next.findIndex((item) => String(item.id) === String(fromId)) + 1;
    const moved = next[position - 1];
    const name = (moved && moved.name) || "Item";
    state.planFocus = { kind: "reorder", section, id: String(fromId) };
    retimePlan();
    announceReorder(name, position, next.length);
  }

  function applyReorderStep(section, id, dir) {
    const key = blockKey(section);
    const items = (state.plan?.[key]?.items || []).filter((item) => item && item.id != null);
    const index = items.findIndex((item) => String(item.id) === String(id));
    const target = index + dir;
    if (index < 0 || target < 0 || target >= items.length) return;
    applyReorder(section, id, items[target].id, dir < 0 ? "before" : "after");
  }

  function renderItem(item, section, index, count) {
    if (!item || typeof item !== "object") return "";
    const picker = !!PICK[section] && section !== "sparring";
    const hidden = picker && planQuery(section).trim() && !P.matchesPlanQuery(item, planQuery(section));
    const name = fill(item.name || "", item);
    const equip = item.equipment ? `<p>Equipment: ${esc(fill(item.equipment, item))}</p>` : "";
    return `
      <div class="item${hidden ? " is-search-hidden" : ""}" data-plan-section="${esc(section)}" data-id="${esc(item.id || "")}">
        ${reorderTools(item, section, index, count)}
        <h3 class="item-title">
          <span class="when">${esc(item.when || "")}</span>
          <strong class="name-live">${esc(name)}</strong>
          <strong class="name-print">${esc(displayName(item))}</strong>
          ${item.ageOverride ? `<span class="age-override">Age override</span>` : ""}
          ${picker ? `<span class="in-plan-mark no-print">In plan</span>` : ""}
          ${repsCtrl(item, section)}
          ${shuffleBtn(section, item.id)}
        </h3>
        ${picker ? planToggleButton(section, item.id, name, true) : ""}
        ${bodyHtml(item)}
        ${equip}
      </div>`;
  }

  function staffRows(settings) {
    settings = settings || {};
    if (settings.preset === "toddler") {
      const rows = settings.firstClass ? DATA.staffFirst : DATA.staffRegular;
      return rows
        .map(
          (row) => `
        <tr>
          <td>${esc(fill(row.role))}</td>
          <td>${esc(fill(row.job))}</td>
        </tr>`
        )
        .join("");
    }
    const teacher = typeof settings.instructor === "string" && settings.instructor.trim() ? settings.instructor.trim() : "the teacher";
    const namedAssistants = personNames(settings.assistants);
    const assistants = namedAssistants.length ? namedAssistants : personNames(settings.helper);
    const job =
      "Must be a two-stripe white belt or above. Help run drills, supervise sparring, and stay with a child who needs a break.";
    const rows = [
      {
        role: `Teacher ${teacher}`,
        job: "Head instructor. Must be a blue belt or above. Line the class up by rank, lead every drill, and praise by name.",
      },
    ];
    if (!assistants.length) rows.push({ role: "Assistant", job });
    assistants.forEach((name) => rows.push({ role: `Assistant ${name}`, job }));
    rows.push({
      role: "Parent",
      job: "Help with a loaner gi the first week. After that, stay at the edge unless the teacher asks. Kids ask the teacher before they leave for the bathroom.",
    });
    return rows
      .map(
        (row) => `
        <tr>
          <td>${esc(row.role)}</td>
          <td>${esc(row.job)}</td>
        </tr>`
      )
      .join("");
  }

  function rulesFor(plan) {
    if (plan.mode === "toddler") return DATA.rules.slice();
    const key = plan.settings.ageGroup;
    const rules = DATA.rulesCommon.concat(DATA.rulesSparring);
    if (P.isCombo(key)) rules.push(P.COMBO_SPARRING_SAFETY);
    return rules;
  }

  function comboNoteHtml(text) {
    if (!text) return "";
    return `<div class="combo-note">${esc(text)}</div>`;
  }

  function comboPlanNotes(plan) {
    if (!plan || plan.mode !== "grace" || !P.isCombo(plan.settings.ageGroup)) return { lesson: "", game: "" };
    const groups = P.parseAgeKey(plan.settings.ageGroup);
    const young = groups[0];
    const themeId = plan.theme && plan.theme.id;
    const lessons = allActivities().filter(
      (item) => item.category === "lesson" && lessonInTheme(item, themeId)
    );
    const games = allActivities().filter((item) => {
      if (item.category !== "game") return false;
      const themes = Array.isArray(item.themes) ? item.themes : [];
      return themeId ? themes.includes(themeId) : true;
    });
    return {
      lesson: P.olderVariationNote(young, groups, lessons),
      game: P.olderVariationNote(young, groups, games),
    };
  }

function sparringSection(plan) {
  if (!plan.sparring) return "";
  const ratio = P.ratioStatus(plan.settings.kidCount, plan.settings.adultCount);
  const roster = P.sortByRank(state.roster);
  const wait = roster.length
    ? "Live sparring waits for a kid with at least one stripe and enough adults."
    : "Add the roster before anyone spars. An empty roster drills positions.";
  if (!plan.liveSparring) {
    const theme = plan.theme ? plan.theme.label : "the lesson";
    const copy = {
      name: "Positional drilling",
      how: `No live sparring this class. Use this block to drill ${theme}. No submissions. Reset often and keep the same partners as the lesson. ${wait}`,
    };
    const hidden = planQuery("sparring").trim() && !P.matchesPlanQuery(copy, planQuery("sparring"));
    return `
      <section class="block">
        <h2 class="block-title"><span class="when">${esc(plan.sparring.when)}</span> Positional drilling ${countMark(1)}</h2>
        ${searchField("sparring")}
        ${hidden ? `<p class="pick-empty no-print">No matches</p>` : ""}
        <div class="item${hidden ? " is-search-hidden" : ""}">
          <p>No live sparring this class. Use this block to drill ${esc(theme)}. No submissions. Reset often and keep the same partners as the lesson.</p>
          <p>${esc(wait)}</p>
        </div>
        ${comboNoteHtml(P.isCombo(plan.settings.ageGroup) ? P.COMBO_SPARRING_SAFETY : "")}
      </section>`;
  }
  const points = DATA.sparring.points.map((point) => `<li>${esc(point)}</li>`).join("");
  const who = roster
    .filter((kid) => P.kidFitsClass(kid.age, plan.settings.ageGroup))
    .map((kid) => {
      const ok = P.kidCanSpar(kid, plan.settings.ageGroup, ratio.ok);
      const stripes = P.clampInt(kid.stripes, 0, 4, 0);
      return `<li>${esc(kid.name)} — ${esc(P.beltLabel(kid.belt))}, ${stripes} stripe${stripes === 1 ? "" : "s"} — ${
        ok ? "sparring" : "no sparring yet"
      }</li>`;
    })
    .join("");
  const liveCopy = {
    name: "Sparring",
    how: DATA.sparring.how,
    tags: DATA.sparring.points.concat(roster.map((kid) => kid.name)),
  };
  const liveHidden = planQuery("sparring").trim() && !P.matchesPlanQuery(liveCopy, planQuery("sparring"));
  return `
    <section class="block">
      <h2 class="block-title"><span class="when">${esc(plan.sparring.when)}</span> Sparring ${countMark(1)}</h2>
      ${searchField("sparring")}
      ${liveHidden ? `<p class="pick-empty no-print">No matches</p>` : ""}
      <div class="item${liveHidden ? " is-search-hidden" : ""}">
        <p>${esc(DATA.sparring.how)}</p>
        <ul>${points}</ul>
        <ul>${who}</ul>
      </div>
      ${comboNoteHtml(P.isCombo(plan.settings.ageGroup) ? P.COMBO_SPARRING_SAFETY : "")}
    </section>`;
}

  function waterBlock(block, mode) {
    if (!block) return "";
    const say = mode === "grace" && DATA.water.sayGrace ? DATA.water.sayGrace : DATA.water.say;
    return `
      <section class="block">
        <h2 class="block-title"><span class="when">${esc(block.when)}</span> Water Break!</h2>
        <div class="item">
          <h3 class="item-title"><span class="when">${esc(block.when)}</span> <strong>${esc(DATA.water.name)}</strong></h3>
          ${howHtml(DATA.water.how)}
          ${sayHtml(say)}
        </div>
      </section>`;
  }

  function blockItems(block) {
    const items = block && Array.isArray(block.items) ? block.items : [];
    return items.filter((item) => item && typeof item === "object");
  }

  function renderPlan() {
    const plan = state.plan;
    if (!plan || !plan.settings) return;
    const s = plan.settings;
    const ratio = P.ratioStatus(s.kidCount, s.adultCount);
    const span = P.classSpan(plan.startMinutes, s.totalMin);
    const dateBit = s.date
      ? `  ·  ${new Date(`${s.date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}`
      : "";
    const youngId = curriculumAge(s.ageGroup, plan.mode);
    const group = DATA.ageGroups[youngId];
    const notes = comboPlanNotes(plan);
    const kicker =
      plan.mode === "toddler"
        ? "Toddler intro"
        : P.isCombo(s.ageGroup)
          ? P.comboLabel(s.ageGroup)
          : group
            ? `${group.range} ${group.label}`
            : "Grace BJJ Kids";
    const paceNote =
      plan.mode === "toddler"
        ? DATA.ageNotes.toddler
        : DATA.ageNotes[youngId] || DATA.ageNotes.mite;
    $("plan").dataset.editing = state.showItemShuffle ? "true" : "false";
    $("plan").dataset.mode = plan.mode;
    $("plan").dataset.group = s.ageGroup || "";
    $("plan").dataset.end = String(plan.end || "");
    $("plan").innerHTML = `
      <div class="plan-running-header">
        <img class="plan-logo" src="${esc(LOGO)}" alt="Grace Jiu-Jitsu" />
        <span class="plan-kicker">Grace BJJ Kids · ${esc(kicker)}</span>
        <span class="right">Teacher ${esc(s.instructor || "the teacher")}</span>
      </div>
      <h1 class="title">${esc(s.title)}</h1>
      <p class="class-meta">${esc(s.ages)}<span class="sep"></span>|<span class="sep"></span>${esc(
        String(s.totalMin)
      )} Minutes<span class="sep"></span>|<span class="sep"></span>${esc(
        String(s.kidCount)
      )} Kids${esc(dateBit)}<span class="sep"></span>|<span class="sep"></span>${esc(span)}</p>
      <p class="coaching">${esc(DATA.coaching)}</p>
      ${
        plan.mode === "toddler"
          ? `<p class="callout">Toddler intro preset, ages 3–5. Pick an age group, or press Generate, for a Grace BJJ Kids plan.</p>`
          : ""
      }
      ${
        plan.squeezed
          ? `<p class="callout warn">Times were shortened so this plan still ends at ${esc(
              P.formatClock(plan.startMinutes + s.totalMin)
            )}.</p>`
          : ""
      }
      ${ratio.ok ? "" : `<p class="callout warn">${esc(ratio.text)}</p>`}

      <h2 class="section-name">Staff</h2>
      ${
        plan.mode === "grace"
          ? `<p class="req">${esc(DATA.staffRequirements.head)} ${esc(DATA.staffRequirements.assistant)}</p>`
          : ""
      }
      <table class="staff-table">
        <thead><tr><th>Role</th><th>Job</th></tr></thead>
        <tbody>${staffRows(s)}</tbody>
      </table>

      ${
        plan.prayer
          ? `<section class="block prayer-block">
              <h2 class="block-title"><span class="when">${esc(plan.prayer.when)}</span> Opening prayer <span class="always-first">Always first</span></h2>
              ${blockItems(plan.prayer).map((item) => renderItem(item, "prayer")).join("")}
            </section>`
          : ""
      }
      ${
        plan.opening
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${esc(plan.opening.when)}</span> ${
                plan.mode === "grace" ? "Line up and come on the mat" : "Get ready and come on the mat"
              }</h2>
              ${blockItems(plan.opening).map((item) => renderItem(item, "opening")).join("")}
            </section>`
          : ""
      }
      ${
        plan.warmup
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${esc(plan.warmup.when)}</span> ${
                plan.mode === "grace" ? "Fun warm-up" : "Warm-up"
              } ${countMark(blockItems(plan.warmup).length)}</h2>
              <p class="callout">${esc(paceNote)}</p>
              ${searchField("warmup")}
              ${blockItems(plan.warmup).map((item, index, list) => renderItem(item, "warmup", index, list.length)).join("")}
              ${pickerEmpty("warmup")}
              <div class="item"><p>If they get wild:</p>${sayHtml(DATA.wildReset)}</div>
              ${pickerRest("warmup")}
            </section>`
          : builderShell("warmup", plan.mode === "grace" ? "Fun warm-up" : "Warm-up")
      }
      ${waterBlock(plan.water1, plan.mode)}
      ${
        plan.base
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${esc(plan.base.when)}</span> Base ${countMark(blockItems(plan.base).length)}</h2>
              ${searchField("base")}
              ${blockItems(plan.base).map((item, index, list) => renderItem(item, "base", index, list.length)).join("")}
              ${pickerEmpty("base")}
              ${pickerRest("base")}
            </section>`
          : builderShell("base", "Base")
      }
      ${
        plan.lesson
          ? `<section class="block${plan.mode === "grace" ? " lesson-block" : ""}">
              <h2 class="block-title"><span class="when">${esc(plan.lesson.when)}</span> ${
                plan.mode === "grace"
                  ? `Technique${plan.theme ? ` — ${esc(plan.theme.label)}` : ""}`
                  : "Lesson"
              } ${countMark(blockItems(plan.lesson).length)}</h2>
              ${
                plan.mode === "grace" && plan.theme
                  ? `<p class="focus">${esc(plan.theme.reason)}. ${esc(group ? group.focus : "")}</p>`
                  : ""
              }
              ${comboNoteHtml(notes.lesson)}
              ${searchField("lesson")}
              ${blockItems(plan.lesson).map((item, index, list) => renderItem(item, "lesson", index, list.length)).join("")}
              ${pickerEmpty("lesson")}
              ${pickerRest("lesson")}
            </section>`
          : builderShell("lesson", plan.mode === "grace" ? "Technique" : "Lesson")
      }
      ${waterBlock(plan.water, plan.mode)}
      ${waterBlock(plan.water2, plan.mode)}
      ${sparringSection(plan)}
      ${
        plan.games
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${esc(plan.games.when)}</span> ${esc(
                plan.games.title || "Games"
              )} ${countMark(blockItems(plan.games).length)}</h2>
              ${plan.games.note ? `<p>${esc(plan.games.note)}</p>` : ""}
              ${comboNoteHtml(notes.game)}
              ${searchField("game")}
              ${blockItems(plan.games).map((item, index, list) => renderItem(item, "game", index, list.length)).join("")}
              ${pickerEmpty("game")}
              ${pickerRest("game")}
            </section>`
          : builderShell("game", "Play time")
      }
      ${
        plan.finish
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${esc(plan.finish.when)}</span> Finish</h2>
              <div class="item">
                <ul>${DATA.finish.bullets.map((bullet) => `<li>${esc(fill(bullet))}</li>`).join("")}</ul>
                ${sayHtml(DATA.finish.say)}
                <p>${esc(DATA.finish.after)}</p>
              </div>
            </section>`
          : ""
      }
      <section class="block">
        <h2 class="block-title">Class rules</h2>
        <div class="item">
          <ul>${rulesFor(plan).map((rule) => `<li>${esc(rule)}</li>`).join("")}</ul>
          ${plan.mode === "grace" ? `<p class="${ratio.ok ? "" : "warn-text"}">${esc(ratio.text)}</p>` : ""}
        </div>
      </section>
      <div class="plan-running-footer">
        ${esc(s.ages)} · ${esc(span)} · ${esc(String(s.kidCount))} kids · ${esc(String(s.adultCount))} adults
      </div>`;
    if ($("themeReason")) $("themeReason").textContent = plan.theme ? plan.theme.reason : "";
    restorePlanFocus();
  }

  function catLabel(cat) {
    if (cat === "warmup") return "Warm-up";
    if (cat === "base") return "Base";
    if (cat === "lesson") return "Technique";
    return "Play";
  }

  function ageTags(activity) {
    if (!activity.ages || !activity.ages.length) return "all ages";
    return activity.ages
      .map((id) => (id === "toddler" ? "3–5" : DATA.ageGroups[id]?.range || id))
      .join(" ");
  }

  const SHEET_DB = "bjj-kids-sheets-v1";

  function openSheetDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SHEET_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("uploads")) db.createObjectStore("uploads", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadUploads() {
    try {
      const db = await openSheetDb();
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction("uploads", "readonly");
        const req = tx.objectStore("uploads").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      state.uploads = rows.map(sanitizeUpload).filter(Boolean);
    } catch (err) {
      console.warn("Could not load uploaded sheets", err);
      state.uploads = [];
    }
  }

  function sheetIds() {
    return new Set((DATA.sheets || []).map((sheet) => sheet.id));
  }

  function sanitizeUpload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const src = P.safeSrc(raw.src);
    if (!src) return null;
    let id = P.cleanId(raw.id);
    if (!id || sheetIds().has(id)) id = uid();
    return {
      id,
      name: String(raw.name || "Uploaded sheet").slice(0, 80),
      src,
      title: String(raw.title || raw.name || "Uploaded sheet").slice(0, 80),
      pins: P.sanitizePins(raw.pins),
    };
  }

  async function saveUpload(sheet) {
    const db = await openSheetDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("uploads", "readwrite");
      tx.objectStore("uploads").put(sheet);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function deleteUpload(id) {
    try {
      const db = await openSheetDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("uploads", "readwrite");
        tx.objectStore("uploads").delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn(err);
    }
    state.uploads = state.uploads.filter((sheet) => sheet.id !== id);
  }

  function allSheets() {
    return (DATA.sheets || [])
      .map((sheet) => ({ ...sheet, builtin: true }))
      .concat(state.uploads.map((sheet) => ({ ...sheet, builtin: false })));
  }

  function currentSheet() {
    return allSheets().find((sheet) => sheet.id === state.sheetId) || allSheets()[0];
  }

  function sheetThumb(sheet) {
    return (
      P.safeSrc(sheet.src) ||
      P.safeSrc(sheet.panels && sheet.panels[0] && sheet.panels[0].src) ||
      ""
    );
  }

  function randomSheetId(except) {
    const available = allSheets().filter((sheet) => !sheet.firstClass && sheet.id !== except);
    const list = available.length ? available : allSheets().filter((sheet) => sheet.id !== except);
    if (!list.length) return state.sheetId;
    return list[Math.floor(Math.random() * list.length)].id;
  }

  function setSheet(id, silent = false) {
    const sheet = allSheets().find((item) => item.id === id);
    if (!sheet) return;
    state.sheetId = id;
    save();
    renderSheet();
    renderSheetList();
    if (!silent) toast(`Coloring sheet: ${sheet.name}`);
  }

  function pickSheetForClass() {
    if (readSettings().firstClass) setSheet("first-gi", true);
    else setSheet(randomSheetId(), true);
  }

  const GI_PINS = [
    { n: 1, ask: "This is a", from: [10, 28], to: [40, 40] },
    { n: 2, ask: "I can", from: [10, 52], to: [40, 54] },
    { n: 3, ask: "Today I", from: [10, 74], to: [40, 72] },
  ];

  function pinsOf(sheet) {
    if (Array.isArray(sheet.pins)) return sheet.pins;
    if (sheet.builtin && !sheet.bakedIn && sheet.type !== "comic") return GI_PINS;
    return [];
  }

  function questionRow(pin, index) {
    const n = pin.n != null ? pin.n : index + 1;
    return `<li>
      <span class="n">${esc(String(n))}</span>
      <span class="ask">${esc(pin.ask || "")}</span>
      <span class="blank"></span>
    </li>`;
  }

  function outlinedArrow(fromPct, toPct) {
    const [fx, fy] = fromPct;
    const [tx, ty] = toPct;
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const half = 2.3;
    const headLen = 11;
    const headHalf = 5.6;
    const sx = fx + ux * 7;
    const sy = fy + uy * 7;
    const bx = tx - ux * headLen;
    const by = ty - uy * headLen;
    const pts = [
      [sx + px * half, sy + py * half],
      [bx + px * half, by + py * half],
      [bx + px * headHalf, by + py * headHalf],
      [tx, ty],
      [bx - px * headHalf, by - py * headHalf],
      [bx - px * half, by - py * half],
      [sx - px * half, sy - py * half],
    ]
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    return `<polygon points="${pts}" fill="#ffffff" stroke="#111111" stroke-width="0.7" stroke-linejoin="round" />`;
  }

  function arrowLayer(pins) {
    const marks = pins
      .filter((pin) => pin.from && pin.to)
      .map((pin) => outlinedArrow(pin.from, pin.to))
      .join("");
    const nums = pins
      .filter((pin) => pin.from)
      .map((pin) => {
        const [x, y] = pin.from;
        return `<span class="sheet-num" style="left:${Number(x)}%;top:${Number(y)}%">${esc(String(pin.n))}</span>`;
      })
      .join("");
    return `<svg class="sheet-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${marks}</svg>${nums}`;
  }

  function sheetBrand() {
    return `<div class="sheet-brand"><img class="sheet-logo" src="${esc(LOGO)}" alt="Grace Jiu-Jitsu"></div>`;
  }

  function renderSheet() {
    const sheet = currentSheet();
    const el = $("sheet");
    if (!sheet || !el) return;
    if ($("sheetMeta")) {
      $("sheetMeta").textContent = sheet.firstClass
        ? "Using the first class sheet: My First Gi"
        : `This class: ${sheet.name} — color at home, bring back next class`;
    }
    if (sheet.bakedIn) {
      el.classList.add("baked");
      el.innerHTML = `${sheetBrand()}<img class="sheet-full" src="${esc(P.safeSrc(sheet.src))}" alt="${esc(sheet.name)}">`;
      return;
    }
    el.classList.remove("baked");
    if (sheet.type === "comic") {
      const panels = (sheet.panels || [])
        .map((panel, index) => {
          const src = P.safeSrc(panel.src);
          return `
          <figure class="comic-panel">
            ${src ? `<img src="${esc(src)}" alt="Panel ${index + 1}">` : ""}
            ${panel.bubble ? `<figcaption class="bubble">${esc(panel.bubble)}</figcaption>` : ""}
          </figure>`;
        })
        .join("");
      const extraQs =
        sheet.layout === "six"
          ? `<ol class="sheet-qs">
              <li><span class="n">1</span><span class="ask">My favorite position is</span><span class="blank"></span></li>
              <li><span class="n">2</span><span class="ask">The one on top is</span><span class="blank"></span></li>
            </ol>`
          : "";
      el.innerHTML = `
        ${sheetBrand()}
        <h1 class="sheet-title">${esc(sheet.title || sheet.name)}</h1>
        <p class="sheet-sub">Grace BJJ Kids Comic</p>
        <div class="comic-grid${sheet.layout === "six" ? " six" : ""}">${panels}</div>
        ${extraQs}
        <div class="sheet-name">My name is <span class="line"></span></div>
        <p class="sheet-foot">Bring this back next class for a special surprise.</p>`;
      return;
    }
    const pins = pinsOf(sheet);
    const src = P.safeSrc(sheet.src);
    const sub = sheet.subtitle ? `<p class="sheet-sub">${esc(sheet.subtitle)}</p>` : "";
    el.innerHTML = `
      ${sheetBrand()}
      <h1 class="sheet-title">${esc(sheet.title || sheet.name)}</h1>
      ${sub}
      <div class="sheet-stage">
        ${src ? `<img class="sheet-art" src="${esc(src)}" alt="${esc(sheet.name)}">` : ""}
        ${arrowLayer(pins)}
      </div>
      ${pins.length ? `<ol class="sheet-qs">${pins.map(questionRow).join("")}</ol>` : ""}
      <div class="sheet-name">My name is <span class="line"></span></div>
      <p class="sheet-foot">Bring this back next class for a special surprise.</p>`;
  }

  function renderSheetList() {
    const list = $("sheetList");
    if (!list) return;
    list.innerHTML = allSheets()
      .map((sheet) => {
        const on = sheet.id === state.sheetId;
        const thumb = sheetThumb(sheet);
        const art = thumb
          ? `<img class="sheet-list-art" src="${esc(thumb)}" alt="">`
          : `<div class="sheet-list-art sheet-list-empty">${sheet.type === "comic" ? "Comic" : "Sheet"}</div>`;
        return `<article class="card ${on ? "using" : ""}" data-sheet="${esc(sheet.id)}">
          <header>
            <h3>${esc(sheet.name)}</h3>
            <span class="badge ${sheet.builtin ? "" : "custom"}">${
              sheet.firstClass ? "first class" : sheet.builtin ? "built-in" : "yours"
            }</span>
          </header>
          ${art}
            <div class="card-actions">
            <button type="button" data-act="use">${on ? "Using" : "Use this"}</button>
            ${
              sheet.builtin
                ? ""
                : `<button type="button" data-act="edit-sheet">Edit prompts</button>
                   <button type="button" data-act="clear-sheet">Clear prompts</button>
                   <button type="button" class="danger" data-act="delete-sheet">Delete</button>
                   <button type="button" class="admin-only" data-act="publish-sheet">${
                     state.serverSheets.some((row) => row.clientId === sheet.id && row.published)
                       ? "Published"
                       : "Publish for parents"
                   }</button>`
            }
          </div>
        </article>`;
      })
      .join("");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSheetUpload(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast("Pick a PNG, JPEG, or WebP.");
      return;
    }
    const src = P.safeSrc(await fileToDataUrl(file));
    if (!src) {
      toast("That picture could not be used.");
      return;
    }
    const name = String(file.name || "Uploaded sheet").replace(/\.[^.]+$/, "").slice(0, 80) || "Uploaded sheet";
    const sheet = { id: uid(), name, src, title: name, pins: [] };
    state.uploads.push(sheet);
    try {
      await saveUpload(sheet);
    } catch (err) {
      console.warn(err);
    }
    setSheet(sheet.id);
    toast(`Added “${name}”. Add prompts if you want them, or leave the art clear.`);
  }

  function renderLibrary() {
    const list = $("libraryList");
    if (!list) return;
    const cat = state.libCat;
    const items = allActivities()
      .filter((activity) => activity.category === cat)
      .sort((a, b) => {
        if (!!a.builtin !== !!b.builtin) return a.builtin ? 1 : -1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    list.innerHTML = items
      .map((activity) => {
        const off = state.disabled.includes(activity.id);
        const pin = state.pinned.includes(activity.id);
        const id = esc(activity.id);
        return `
          <article class="card ${off ? "off" : ""}" data-id="${id}">
            <header>
              <h3>${esc(displayName({ ...activity, reps: repsOf(activity) }))}</h3>
              <span class="badge ${activity.builtin ? "" : "custom"}">${
                activity.builtin ? "built-in" : "yours"
              } · ${esc(ageTags(activity))}</span>
            </header>
            <p>${esc(
              fill(String(activity.how || activity.say || "").split("\n")[0], {
                ...activity,
                reps: repsOf(activity),
              })
            )}</p>
            <div class="reps-ctrl" title="How many">
              <button type="button" data-act="reps" data-delta="-1">−</button>
              <span>x${repsOf(activity)}</span>
              <button type="button" data-act="reps" data-delta="1">+</button>
            </div>
            <div class="card-actions">
              <button type="button" data-act="pin">${pin ? "Unpin" : "Always include"}</button>
              <button type="button" data-act="toggle">${off ? "Use in randomizer" : "Leave out"}</button>
              ${
                activity.builtin
                  ? `<button type="button" data-act="copy">Copy &amp; edit</button>`
                  : `<button type="button" data-act="edit">Edit</button>
                     <button type="button" class="danger" data-act="delete">Delete</button>`
              }
            </div>
          </article>`;
      })
      .join("");
  }

  function renderRoster() {
    const list = $("rosterList");
    if (!list) return;
    const ordered = P.sortByRank(state.roster);
    if (!ordered.length) {
      list.innerHTML = `<p class="hint">No kids yet. Highest rank will line up first.</p>`;
      renderHome();
      return;
    }
    const beltOptions = DATA.belts
      .map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`)
      .join("");
    list.innerHTML = ordered
      .map((kid) => {
        const id = esc(kid.id);
        return `<article class="card roster-card" data-id="${id}">
          <header>
            <h3>${esc(kid.name)}</h3>
            <span class="badge">age ${esc(kid.age)}</span>
          </header>
          <div class="roster-edit">
            <select data-roster="belt" aria-label="Belt for ${esc(kid.name)}">${beltOptions}</select>
            <select data-roster="stripes" aria-label="Stripes for ${esc(kid.name)}">
              ${[0, 1, 2, 3, 4].map((n) => `<option value="${n}">${n} stripe${n === 1 ? "" : "s"}</option>`).join("")}
            </select>
            <button type="button" class="danger" data-roster="delete">Remove</button>
            <label class="check"><input type="checkbox" data-card-kid="${id}" ${state.cardPick[kid.id] === false ? "" : "checked"} /> Card</label>
          </div>
        </article>`;
      })
      .join("");
    list.querySelectorAll(".roster-card").forEach((card) => {
      const kid = state.roster.find((item) => item.id === card.dataset.id);
      if (!kid) return;
      card.querySelector('[data-roster="belt"]').value = kid.belt;
      card.querySelector('[data-roster="stripes"]').value = String(kid.stripes);
    });
    renderHome();
  }

  function renderHome() {
    const root = $("homeSummary");
    if (!root) return;
    const iso = P.nextClassDate(new Date());
    const when = new Date(`${iso}T00:00:00`);
    const nextLabel = Number.isNaN(when.getTime())
      ? iso
      : when.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const groups = ["mite", "peewee", "junior", "teen"].map((id) => {
      const group = DATA.ageGroups[id];
      const count = state.roster.filter((kid) => {
        const match = groupForAge(kid.age);
        return match && match.id === id;
      }).length;
      return `${group.range}: ${count}`;
    });
    const outside = state.roster.filter((kid) => !groupForAge(kid.age)).length;
    const close = [];
    const belts = [];
    state.roster.forEach((kid) => {
      const hint = stripeHint(kid);
      const ownLeft = Math.max(0, hint.needOwn - hint.own);
      const classLeft = Math.max(0, hint.needAttend - hint.attended);
      if (!hint.ready && ownLeft <= 2 && classLeft <= 2 && (ownLeft > 0 || classLeft > 0)) close.push(kid.name);
      const belt = P.promotionHint(kid);
      if (belt && belt.ready) belts.push(kid.name);
    });
    const closeText = close.length
      ? close.map((name) => esc(name)).join(", ")
      : "Nobody is one or two steps from a stripe.";
    const beltText = belts.length
      ? `${belts.map((name) => esc(name)).join(", ")}. The head instructor decides.`
      : "Nobody is ready for a belt hint.";
    root.innerHTML = `
      <h2>At a glance</h2>
      <div class="home-cards">
        <article class="home-card"><strong>Next class</strong><p>${esc(nextLabel)}, 5:30–6:15 PM</p><p>Opens with a short prayer.</p>${
          P.isCombo(state.ageGroup) ? `<p>${esc(P.comboLabel(state.ageGroup))}</p>` : ""
        }</article>
        <article class="home-card"><strong>Roster</strong><p>${esc(groups.join(" · "))}${outside ? esc(` · Other ages: ${outside}`) : ""}</p></article>
        <article class="home-card"><strong>Close to a stripe</strong><p>${closeText}</p></article>
        <article class="home-card"><strong>Belt hint</strong><p>${beltText}</p></article>
      </div>`;
  }

  function updateMeta() {
    const age = state.preset === "toddler" ? "toddler" : curriculumAge(state.ageGroup);
    const counts = ["warmup", "base", "lesson", "game"].map((cat) => {
      const n = pool(cat, age).length;
      const custom = state.custom.filter((activity) => activity.category === cat).length;
      return `${n} ${catLabel(cat).toLowerCase()}${custom ? ` (${custom} yours)` : ""}`;
    });
    const meta = $("poolMeta");
    if (meta) meta.textContent = "Pool: " + counts.join(" · ");
    updateTimeSum();
    updateScheduleHint();
  }

  function updateTimeSum() {
    const s = readSettings();
    const el = $("timeSum");
    if (!el) return;
    const ratio = P.ratioStatus(s.kidCount, s.adultCount);
    const ratioEl = $("ratioNote");
    if (ratioEl) {
      let source = "";
      if (state.ratioSource === "attendance") source = " Kids are who checked in for this date and class.";
      else if (state.ratioSource === "roster") {
        source = P.isCombo(state.ageGroup)
          ? " Kids are everyone on the roster in the selected age groups. Nobody is checked in for this date and class."
          : " Kids are everyone on the roster. Nobody is checked in for this date and class.";
      }
      else if (state.ratioSource === "edited") source = " The kid count was typed in.";
      ratioEl.className = ratio.ok ? "hint" : "hint warn";
      ratioEl.textContent = ratio.text + source;
    }
    const span = P.classSpan(P.parseStartMinutes(s.startTime), s.totalMin);
    if (!state.plan) {
      el.className = "time-sum ok";
      el.textContent = `${span}. Generate a class to fill it.`;
      return;
    }
    const target = Math.round(s.totalMin * 60);
    if (state.plan.squeezed) {
      el.className = "time-sum over";
      el.textContent = `${span}. Some blocks were shortened so the plan still ends on time.`;
      return;
    }
    if (state.plan.end === target) {
      el.className = "time-sum ok";
      el.textContent = `${span}. The plan on the page matches this clock.`;
      return;
    }
    el.className = "time-sum over";
    el.textContent = `The plan is ${Math.round((state.plan.end || 0) / 60)} min and the class is ${s.totalMin} min.`;
  }

  function prettyDate(iso) {
    const date = P.parseISODate(iso);
    if (!date) return iso;
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function updateScheduleHint() {
    const el = $("scheduleHint");
    if (!el) return;
    const next = P.nextClassDate(new Date());
    const picked = $("date").value;
    let text = `2nd and 4th Tuesday, 5:30–6:15 PM PT. First class ${prettyDate(P.FIRST_CLASS_ISO)}. Next on the schedule: ${prettyDate(next)}.`;
    if (picked && picked !== next) {
      const when = P.parseISODate(picked);
      text +=
        when && P.isClassTuesday(when) && when >= P.parseISODate(P.FIRST_CLASS_ISO)
          ? " This date is also a class Tuesday."
          : " This date overrides the schedule.";
    }
    el.textContent = text;
  }

  function writeClassCounts() {
    const date = $("date") && $("date").value;
    const entry = date ? classFor(date, state.ageGroup) : null;
    const attended = entry && Array.isArray(entry.attended) ? entry.attended : [];
    const fromAttendance = attended.length > 0;
    state.ratioSource = fromAttendance ? "attendance" : "roster";
    const rosterKids = (Array.isArray(state.roster) ? state.roster : []).filter((kid) =>
      P.kidFitsClass(kid.age, state.ageGroup)
    );
    const kids = fromAttendance ? attended.length : rosterKids.length;
    const adults = (state.instructorId || state.instructorName ? 1 : 0) + assistantIdList().length;
    if ($("kidCount")) $("kidCount").value = String(P.clampInt(kids, 0, 40, 0));
    if ($("adultCount")) $("adultCount").value = String(P.clampInt(adults, 0, 20, 0));
  }

  function syncPlanCounts() {
    writeClassCounts();
    if (state.plan) retimePlan();
    else updateTimeSum();
  }

  function adultBeltOptions(selected) {
    return adultBelts().map(
      (id) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(P.beltLabel(id))}</option>`
    ).join("");
  }

  function stripeOptions(selected) {
    return [0, 1, 2, 3, 4]
      .map((n) => `<option value="${n}"${Number(selected) === n ? " selected" : ""}>${n}</option>`)
      .join("");
  }

  function beltStripeLabel(person) {
    const stripes = P.clampInt(person.stripes, 0, 4, 0);
    const stripeText = stripes === 1 ? "1 stripe" : `${stripes} stripes`;
    return `${P.beltLabel(person.belt)} · ${stripeText}`;
  }

  function settleStaffSelection() {
    const people = staffList();
    if (!state.hadInstructor && !state.staffDefaulted) {
      const mine = people.find((person) => person.userId && state.session && person.userId === state.session.id);
      if (mine) {
        state.instructorId = mine.id;
        state.instructorName = mine.name;
      }
      state.staffDefaulted = true;
    } else if (state.instructorName && !staffById(state.instructorId)) {
      const wanted = String(state.instructorName).toLowerCase();
      const match = people.find((person) => String(person.name || "").toLowerCase() === wanted);
      if (match) state.instructorId = match.id;
    }
    const pending = Array.isArray(state.pendingHelperNames) ? state.pendingHelperNames : [];
    if (!state.helpersApplied && !assistantIdList().length && pending.length) {
      const matched = [];
      const free = [];
      pending.forEach((name) => {
        const wanted = String(name).toLowerCase();
        const match = people.find((person) => String(person.name || "").toLowerCase() === wanted);
        if (match && !matched.includes(match.id)) matched.push(match.id);
        else if (!match) free.push(name);
      });
      state.assistantIds = matched;
      state.freeHelperNames = free;
      state.helpersApplied = true;
    }
    state.assistantIds = assistantIdList().filter((id, index, list) => {
      const person = staffById(id);
      return person && canAssist(person) && id !== state.instructorId && list.indexOf(id) === index;
    });
  }

  function renderStaffPickers() {
    const head = $("instructorPick");
    const assist = $("assistantPick");
    if (!head || !assist) return;
    settleStaffSelection();
    const current = staffById(state.instructorId);
    const headOptions = [`<option value="">Choose head instructor</option>`];
    if (state.instructorName && !current) {
      headOptions.push(`<option value="__saved__">${esc(state.instructorName)}</option>`);
    }
    staffList().forEach((person) => {
      const eligible = canHead(person);
      const disabled = !eligible && (!current || current.id !== person.id) ? " disabled" : "";
      const flag = eligible ? "" : " · below blue";
      headOptions.push(
        `<option value="${esc(person.id)}"${disabled}>${esc(person.name)} · ${esc(beltStripeLabel(person))}${flag}</option>`
      );
    });
    head.innerHTML = headOptions.join("");
    if (current) head.value = current.id;
    else if (state.instructorName) head.value = "__saved__";
    else head.value = "";
    const choices = staffList().filter(
      (person) => canAssist(person) && person.id !== state.instructorId && !assistantIdList().includes(person.id)
    );
    assist.innerHTML = choices.length
      ? [`<option value="">Add an assistant</option>`]
          .concat(choices.map((person) => `<option value="${esc(person.id)}">${esc(person.name)} · ${esc(beltStripeLabel(person))}</option>`))
          .join("")
      : `<option value="">No one else is a two-stripe white or higher</option>`;
    const list = $("assistantList");
    if (list) {
      list.innerHTML = assistantPeople()
        .map(
          (person) =>
            `<li><span>${esc(person.name)} · ${esc(beltStripeLabel(person))}</span> <button class="ghost" type="button" data-remove-assistant="${esc(person.id)}">Remove</button></li>`
        )
        .join("");
    }
    const note = $("staffBeltNote");
    if (note) {
      note.textContent =
        current && !canHead(current)
          ? `${current.name} is below a blue belt. A head instructor is a blue belt or higher.`
          : "";
    }
  }

  function renderStaffAdmin() {
    const root = $("staffList");
    if (!root) return;
    if (!isAdmin()) {
      root.innerHTML = "";
      return;
    }
    if ($("helperBelt") && !$("helperBelt").options.length) $("helperBelt").innerHTML = adultBeltOptions("white");
    if ($("helperStripes") && !$("helperStripes").options.length) $("helperStripes").innerHTML = stripeOptions(0);
    root.innerHTML = staffList()
      .map((person) => {
        const remove = person.login
          ? `<span class="hint">Login</span>`
          : `<button class="ghost" type="button" data-staff-remove="${esc(person.id)}">Remove</button>`;
        return `<div class="staff-row" data-staff-id="${esc(person.id)}">
          <input data-staff-name="${esc(person.id)}" value="${esc(person.name)}" maxlength="40" aria-label="Name" />
          <select data-staff-belt="${esc(person.id)}" aria-label="Belt">${adultBeltOptions(person.belt)}</select>
          <select data-staff-stripes="${esc(person.id)}" aria-label="Stripes">${stripeOptions(person.stripes)}</select>
          ${remove}
        </div>`;
      })
      .join("");
  }

  async function refreshStaff() {
    const body = await window.BJJ_API.send("GET", "/api/staff");
    state.staff = (body.staff || []).map(normalizeStaff).filter(Boolean);
    renderStaffAdmin();
    renderStaffPickers();
    syncPlanCounts();
  }

  function openModal(activity) {
    $("modalTitle").textContent = activity && activity.id ? "Edit activity" : "Add activity";
    $("actId").value = activity && activity.id && !activity.builtin ? activity.id : "";
    $("actCategory").value = activity?.category || state.libCat;
    $("actName").value = activity?.name || "";
    $("actReps").value = activity ? repsOf(activity) : 2;
    $("actDuration").value = activity?.duration || 2;
    $("actHow").value = activity?.how || "";
    $("actSay").value = asList(activity?.say).join("\n") || "";
    $("actExtra").value = activity?.extra || "";
    $("actEquip").value = activity?.equipment || "";
    if ($("actPosition")) $("actPosition").value = activity?.position || "";
    if ($("actTheme")) $("actTheme").value = activity?.theme || "";
    if ($("actSteps")) $("actSteps").value = asList(activity?.steps).join("\n");
    if ($("actDrill")) $("actDrill").value = activity?.drill || "";
    if ($("actSafety")) $("actSafety").value = activity?.safety || "";
    const selected = new Set(activity?.ages || []);
    document.querySelectorAll("#actAges input").forEach((box) => {
      box.checked = selected.has(box.value);
    });
    $("modalBack").classList.add("open");
    $("actName").focus();
  }

  function closeModal() {
    $("modalBack").classList.remove("open");
    $("activityForm").reset();
    $("actId").value = "";
  }

  function formActivity() {
    const sayRaw = $("actSay").value.trim();
    const say = sayRaw.includes("\n") ? sayRaw.split("\n").map((line) => line.trim()).filter(Boolean) : sayRaw;
    const ages = [...document.querySelectorAll("#actAges input:checked")].map((box) => box.value);
    const id = P.cleanId($("actId").value);
    return {
      id: id && !builtinIds().has(id) ? id : uid(),
      category: P.CATEGORIES.includes($("actCategory").value) ? $("actCategory").value : "warmup",
      name: $("actName").value.trim().slice(0, 80),
      reps: P.clampInt($("actReps").value, 1, 20, 1),
      duration: P.clampNum($("actDuration").value, 0.5, 20, 2),
      how: $("actHow").value.trim().slice(0, 800),
      say,
      extra: $("actExtra").value.trim().slice(0, 400),
      equipment: $("actEquip").value.trim().slice(0, 120),
      ages: ages.filter((age) => P.AGE_IDS.includes(age)),
      position: $("actPosition") ? $("actPosition").value : "",
      theme: $("actTheme") ? $("actTheme").value : "",
      steps: $("actSteps") ? $("actSteps").value.split("\n") : [],
      drill: $("actDrill") ? $("actDrill").value : "",
      safety: $("actSafety") ? $("actSafety").value : "",
    };
  }

  function findActivity(id) {
    return allActivities().find((activity) => activity.id === id);
  }

  function blockKey(section) {
    return section === "game" || section === "games" ? "games" : section;
  }

  function idsOf(section) {
    const key = blockKey(section);
    return (state.plan?.[key]?.items || []).map((item) => item.id);
  }

  function swapOne(section, id) {
    const key = blockKey(section);
    const block = state.plan?.[key];
    if (!block) return;
    const age = curriculumAge(state.plan.settings.ageGroup, state.plan.mode);
    const cat = key === "games" ? "game" : key;
    let replacement = [];
    if (cat === "lesson" && state.plan.mode === "grace" && state.plan.theme) {
      const next = pool("lesson", age)
        .filter((item) => lessonInTheme(item, state.plan.theme.id) && !block.items.some((have) => have.id === item.id))
        .sort((a, b) => (Number(a.order) || 50) - (Number(b.order) || 50));
      if (next[0]) replacement = [withCurrentReps(next[0], age)];
    } else {
      replacement = pick(cat, 1, age, {
        exclude: block.items.map((item) => item.id),
        prefer: [],
      });
    }
    if (!replacement.length) {
      toast("Nothing else in that pool.");
      return;
    }
    block.items = block.items.map((item) => (item.id === id ? replacement[0] : cleanItem(item)));
    retimePlan();
  }

  function bumpReps(id, delta, section, fromPlan = false) {
    const current = fromPlan
      ? Number(state.plan?.[blockKey(section)]?.items?.find((item) => item.id === id)?.reps) || repsOf(findActivity(id) || { id, reps: 1 })
      : repsOf(findActivity(id) || { id, reps: 1 });
    const next = Math.max(1, Math.min(20, current + delta));
    state.reps[id] = next;
    if (state.custom.some((activity) => activity.id === id)) {
      state.custom = state.custom.map((activity) => (activity.id === id ? { ...activity, reps: next } : activity));
    }
    const age = state.plan?.mode === "toddler" ? "toddler" : curriculumAge(state.ageGroup);
    ["warmup", "base", "lesson", "games"].forEach((key) => {
      const item = state.plan?.[key]?.items?.find((entry) => entry.id === id);
      if (!item) return;
      const paced =
        !fromPlan && (key === "warmup" || key === "base") ? P.pacedReps(next, age) : next;
      item.reps = fromPlan ? next : paced;
      item.baseReps = next;
      item.prefMinutes = P.prefMinutes(item.catalogMinutes || 2, item.catalogReps || 1, item.reps);
    });
    if (state.plan) retimePlan();
    else save();
    renderLibrary();
  }

  function loadFirstClass(silent = false) {
    $("title").value = "FIRST BJJ CLASS";
    $("firstClass").checked = true;
    $("totalMin").value = 45;
    $("openingMin").value = 13;
    $("waterMin").value = 1;
    $("finishMin").value = 3;
    $("warmupCount").value = 6;
    $("lessonCount").value = 3;
    $("gameCount").value = 2;
    $("ages").value = "3–5";
    $("kidCount").value = 4;
    $("adultCount").value = 1;
    state.preset = "toddler";
    buildPlan({
      mode: "toddler",
      keep: FIRST_CLASS_IDS,
      prefer: { warmup: [], lesson: [], game: [] },
    });
    setSheet("first-gi", true);
    if (!silent) toast("Loaded the toddler first-class plan.");
  }

  function fillBeltSelect() {
    const options = DATA.belts.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("");
    $("rosterBelt").innerHTML = options;
    if ($("claimBelt")) $("claimBelt").innerHTML = options;
  }

  function isAdmin() {
    return state.session && state.session.role === "admin";
  }

  function replaceClass(saved) {
    if (!saved || !saved.date) return;
    const idx = state.progress.classes.findIndex((entry) => entry.date === saved.date && entry.ageGroup === saved.ageGroup);
    if (idx >= 0) state.progress.classes[idx] = saved;
    else state.progress.classes.push(saved);
    renderHome();
  }

  async function pushClass(entry, merge) {
    const saved = await window.BJJ_API.send(merge ? "POST" : "PUT", merge ? "/api/attendance" : "/api/classes", entry);
    replaceClass(saved);
    syncPlanCounts();
    return saved;
  }

  async function resync() {
    const body = await window.BJJ_API.bootstrap();
    applyBootstrap(body);
    renderRoster();
    renderStaffPickers();
    renderStaffAdmin();
    if (state.view === "review") renderReview();
    if (state.view === "progress") renderProgress();
    if (state.view === "checkin") renderCheckinList();
    syncPlanCounts();
  }

  function applyBootstrap(body) {
    state.session = body.user || null;
    state.roster = (body.students || []).map((kid) => P.sanitizeRosterKid(kid)).filter(Boolean);
    state.progress = P.sanitizeProgress({
      classes: body.classes,
      levels: body.levels,
      notes: body.notes,
      stripe: body.stripe,
    });
    state.featured = body.featured || { sheetId: "", caption: "" };
    state.serverSheets = body.sheets || [];
    state.cards = (Array.isArray(body.cards) ? body.cards : []).map(normalizeCard).filter(Boolean);
    state.staff = (Array.isArray(body.staff) ? body.staff : []).map(normalizeStaff).filter(Boolean);
    document.body.classList.toggle("role-admin", isAdmin());
    const who = $("whoami");
    if (who && state.session) who.textContent = `${state.session.username} · ${state.session.role}`;
    const banner = $("importBanner");
    if (banner) banner.classList.toggle("hidden", !localStorage.getItem(IMPORT_KEY));
  }

  function fillFeatured() {
    const select = $("featuredSheet");
    if (!select) return;
    const options = [{ id: "", name: "None" }].concat(
      (DATA.sheets || []).map((sheet) => ({ id: sheet.id, name: sheet.name })),
      state.uploads.map((sheet) => ({ id: sheet.id, name: sheet.name }))
    );
    select.innerHTML = options.map((option) => `<option value="${esc(option.id)}">${esc(option.name)}</option>`).join("");
    select.value = state.featured.sheetId || "";
    if (!select.value) select.value = "";
    if ($("featuredCaption")) $("featuredCaption").value = state.featured.caption || "";
  }

  async function addKid() {
    const name = $("rosterName").value.trim().slice(0, 40);
    if (!name) {
      toast("Add the kid's name.");
      return;
    }
    if (!isAdmin()) {
      toast("An admin adds students.");
      return;
    }
    const kid = P.sanitizeRosterKid({
      id: uid(),
      name,
      age: $("rosterAge").value,
      belt: $("rosterBelt").value,
      stripes: $("rosterStripes").value,
    });
    if (!kid) return;
    try {
      const saved = await window.BJJ_API.send("POST", "/api/students", kid);
      state.roster.push(P.sanitizeRosterKid(saved));
      $("rosterName").value = "";
      renderRoster();
      syncPlanCounts();
      toast(`${saved.name} is on the roster.`);
    } catch (err) {
      toast(err.message || "Could not add that student.");
    }
  }

  function openSheetEditor(id) {
    const sheet = state.uploads.find((item) => item.id === id);
    if (!sheet) return;
    $("sheetEditId").value = sheet.id;
    $("sheetEditTitle").value = sheet.title || sheet.name;
    $("sheetEditPrompts").value = (sheet.pins || []).map((pin) => pin.ask).join("\n");
    $("sheetModal").classList.add("open");
  }

  function closeSheetEditor() {
    $("sheetModal").classList.remove("open");
  }

  async function writeSheetPrompts(id, title, lines) {
    const sheet = state.uploads.find((item) => item.id === id);
    if (!sheet) return;
    const old = sheet.pins || [];
    sheet.title = String(title || sheet.name).trim().slice(0, 80) || sheet.name;
    sheet.pins = P.sanitizePins(
      lines.map((ask, index) => {
        const pin = { n: index + 1, ask };
        if (old[index] && old[index].from && old[index].to) {
          pin.from = old[index].from;
          pin.to = old[index].to;
        }
        return pin;
      })
    );
    await saveUpload(sheet);
    renderSheet();
    renderSheetList();
  }

  async function exportBackup() {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      custom: state.custom,
      disabled: state.disabled,
      pinned: state.pinned,
      reps: state.reps,
      settings: readSettings(),
      plan: state.plan,
      uploads: state.uploads,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grace-bjj-kids-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Exported a full backup.");
  }

  function importLibrary(data, opts = {}) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, reason: "That file is not a planner backup." };
    }
    const incoming = Array.isArray(data.custom) ? data.custom : [];
    const builtins = builtinIds();
    const seen = new Set(opts.replace ? [] : state.custom.map((activity) => activity.id));
    const nextCustom = opts.replace ? [] : state.custom.slice();
    let kept = 0;
    let skipped = 0;
    let remapped = 0;
    let firstSkip = "";
    incoming.forEach((raw) => {
      if (!raw || typeof raw !== "object") {
        skipped += 1;
        return;
      }
      let id = P.cleanId(raw.id);
      let force = false;
      if (!id || builtins.has(id) || seen.has(id)) force = true;
      const result = P.sanitizeActivity(force ? { ...raw, id: "" } : raw, builtins);
      if (!result.ok) {
        skipped += 1;
        if (!firstSkip) firstSkip = result.reason;
        return;
      }
      if (force || result.remapped) remapped += 1;
      seen.add(result.activity.id);
      const idx = nextCustom.findIndex((activity) => activity.id === result.activity.id);
      if (idx >= 0) nextCustom[idx] = result.activity;
      else nextCustom.push(result.activity);
      kept += 1;
    });
    state.custom = nextCustom;
    if (opts.replace || data.disabled) state.disabled = P.sanitizeIdList(data.disabled);
    if (opts.replace || data.pinned) state.pinned = P.sanitizeIdList(data.pinned);
    if (data.reps && typeof data.reps === "object") {
      const reps = opts.replace ? {} : { ...state.reps };
      Object.entries(data.reps).forEach(([id, value]) => {
        const clean = P.cleanId(id);
        const n = Number(value);
        if (!clean || !Number.isFinite(n)) return;
        reps[clean] = P.clampInt(n, 1, 20, 1);
      });
      state.reps = reps;
    } else if (opts.replace) state.reps = {};
    if (!opts.skipAttendance && Array.isArray(data.roster)) {
      const roster = [];
      const rosterSeen = new Set();
      data.roster.forEach((raw) => {
        const kid = P.sanitizeRosterKid(raw);
        if (!kid || rosterSeen.has(kid.id)) return;
        rosterSeen.add(kid.id);
        roster.push(kid);
      });
      state.roster = roster;
    } else if (opts.replace && !opts.skipAttendance) state.roster = [];
    if (data.settings && typeof data.settings === "object" && !opts.fromLegacy) applySettings(data.settings);
    if (!opts.skipAttendance && data.progress && !opts.fromLegacy) state.progress = P.sanitizeProgress(data.progress);
    else if (opts.replace && !opts.skipAttendance && !opts.fromLegacy) state.progress = P.sanitizeProgress(null);
    if (data.plan && !opts.fromLegacy) {
      const plan = sanitizePlan(data.plan);
      if (plan) {
        state.plan = plan;
        state.preset = plan.mode === "toddler" ? "toddler" : "grace";
        if (plan.settings) applySettings(plan.settings);
      }
    }
    pruneReps();
    return { ok: true, kept, skipped, remapped, firstSkip };
  }

  function sanitizePlan(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.mode !== "grace" && raw.mode !== "toddler") return null;
    if (!raw.settings || typeof raw.settings !== "object") return null;
    const plan = {
      mode: raw.mode,
      settings: raw.settings,
      startMinutes: P.clampInt(raw.startMinutes, 0, 24 * 60 - 1, 17 * 60 + 30),
      squeezed: !!raw.squeezed,
      headerTitle: String(raw.headerTitle || "").slice(0, 80),
      end: Number(raw.end) || 0,
      sessionId: P.cleanId(raw.sessionId) || "",
      liveSparring: !!raw.liveSparring,
      theme: raw.theme && typeof raw.theme === "object"
        ? {
            id: String(raw.theme.id || "").slice(0, 32),
            label: String(raw.theme.label || "").slice(0, 48),
            reason: String(raw.theme.reason || "").slice(0, 80),
            position: String(raw.theme.position || "").slice(0, 40),
            locked: !!raw.theme.locked,
          }
        : null,
    };
    ["opening", "warmup", "base", "lesson", "games", "water", "water1", "water2", "sparring", "finish"].forEach((key) => {
      if (raw[key] && typeof raw[key] === "object") plan[key] = raw[key];
    });
    return plan;
  }

  async function importUploads(rows) {
    if (!Array.isArray(rows)) return 0;
    let count = 0;
    for (const raw of rows) {
      const sheet = sanitizeUpload(raw);
      if (!sheet) continue;
      const existing = state.uploads.findIndex((item) => item.id === sheet.id);
      if (existing >= 0) state.uploads[existing] = sheet;
      else state.uploads.push(sheet);
      try {
        await saveUpload(sheet);
      } catch (err) {
        console.warn(err);
      }
      count += 1;
    }
    return count;
  }

  function groupForAge(age) {
    const n = Number(age);
    if (!Number.isFinite(n)) return null;
    if (n >= 4 && n <= 6) return DATA.ageGroups.mite || null;
    if (n >= 7 && n <= 9) return DATA.ageGroups.peewee || null;
    if (n >= 10 && n <= 12) return DATA.ageGroups.junior || null;
    if (n >= 13 && n <= 15) return DATA.ageGroups.teen || null;
    return null;
  }

  function groupText(group, age) {
    if (group && group.range && group.label) return `${group.range} ${group.label}`;
    if (age != null && age !== "") return `Age ${age}`;
    return "";
  }

  function stripeText(kid) {
    const stripes = P.clampInt(kid.stripes, 0, 4, 0);
    return stripes === 0 ? "no stripes" : `${stripes} stripe${stripes === 1 ? "" : "s"}`;
  }

  function techniquesOf(plan) {
    return (plan?.lesson?.items || [])
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: item.id,
        name: item.name,
        position: item.position || "",
        theme: item.theme || plan.theme?.id || "",
      }))
      .filter((item) => item.id && item.name);
  }

  function gameName(plan) {
    return (plan?.games?.items || [])
      .filter((item) => item && item.name)
      .map((item) => item.name)
      .join(", ");
  }

  function blankClass(date, age) {
    const plan = state.plan;
    const match = plan && plan.mode === "grace" && plan.settings.date === date && plan.settings.ageGroup === age;
    return {
      id: match && plan.sessionId ? plan.sessionId : uid(),
      date,
      ageGroup: age,
      theme: match ? plan.theme?.id || "" : "",
      themeLabel: match ? plan.theme?.label || "" : "",
      techniques: match ? techniquesOf(plan) : [],
      game: match ? gameName(plan) : "",
      attended: [],
      taught: false,
    };
  }

  function classFor(date, age) {
    return state.progress.classes.find((entry) => entry.date === date && entry.ageGroup === age) || null;
  }

  function ensureClass(date, age) {
    let entry = classFor(date, age);
    if (!entry) {
      entry = blankClass(date, age);
      state.progress.classes.push(entry);
    }
    return entry;
  }

  function setLevel(kidId, techId, level) {
    if (!P.LEVELS.includes(level)) return;
    state.progress.levels[kidId] = state.progress.levels[kidId] || {};
    state.progress.levels[kidId][techId] = level;
    renderHome();
  }

  function applyIntroduced(entry) {
    (entry.techniques || []).forEach((tech) => {
      entry.attended.forEach((kidId) => {
        const have = state.progress.levels[kidId] && state.progress.levels[kidId][tech.id];
        if (!have) setLevel(kidId, tech.id, "introduced");
      });
    });
  }

  function stripeHint(kid) {
    const levels = state.progress.levels[kid.id] || {};
    const own = Object.values(levels).filter((level) => level === "own").length;
    const attended = state.progress.classes.filter(
      (entry) => entry.taught && Array.isArray(entry.attended) && entry.attended.includes(kid.id)
    ).length;
    const needOwn = state.progress.stripe.own;
    const needAttend = state.progress.stripe.attend;
    return {
      own,
      attended,
      needOwn,
      needAttend,
      ready: own >= needOwn && attended >= needAttend,
    };
  }

  const LEVEL_LABEL = {
    introduced: "Introduced",
    practicing: "Practicing",
    help: "With help",
    own: "On their own",
  };

  function setView(view) {
    if (view !== "checkin") stopCamera();
    state.view = view;
    document.body.classList.remove("menu-open");
    if ($("menuToggle")) $("menuToggle").setAttribute("aria-expanded", "false");
    document.querySelectorAll("#viewSwitch button").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.view === view);
    });
    $("planWrap").classList.toggle("hidden", view !== "plan");
    if ($("homeSummary")) $("homeSummary").classList.toggle("hidden", view !== "plan");
    const toolbar = document.querySelector(".toolbar");
    if (toolbar) toolbar.classList.toggle("hidden", view !== "plan");
    $("reviewView").classList.toggle("hidden", view !== "review");
    $("progressView").classList.toggle("hidden", view !== "progress");
    $("checkinView").classList.toggle("hidden", view !== "checkin");
    $("cardView").classList.toggle("hidden", view !== "cards");
    if ($("printTheseBtn")) $("printTheseBtn").classList.toggle("hidden", view !== "cards");
    if (view === "review") runPanel("Review", () => renderReview());
    if (view === "progress") runPanel("Progress", () => renderProgress());
    if (view === "checkin") {
      if (!$("checkinDate").value) $("checkinDate").value = $("date").value || P.nextClassDate(new Date());
      cameraHelp();
      renderCheckinList();
      renderCardRecords();
      refreshCards();
    }
  }

  function normalizeCard(raw) {
    const code = P.cleanId(raw && raw.code);
    if (!code) return null;
    const status = ["unclaimed", "claimed", "retired"].includes(raw.status) ? raw.status : "unclaimed";
    return { code, status, studentId: P.cleanId(raw.studentId) || "" };
  }

  function rememberCard(card) {
    const next = normalizeCard(card);
    if (!next) return;
    const idx = state.cards.findIndex((item) => item.code === next.code);
    if (idx >= 0) state.cards[idx] = next;
    else state.cards.push(next);
  }

  async function refreshCards() {
    try {
      const body = await window.BJJ_API.send("GET", "/api/cards");
      state.cards = (body.cards || []).map(normalizeCard).filter(Boolean);
      renderCardRecords();
    } catch (err) {
      /* keep the cards from the last load */
    }
  }

  function renderReview(attendOverride) {
    const root = $("reviewView");
    const plan = state.plan;
    if (!root) return;
    if (!plan || plan.mode !== "grace" || !plan.settings) {
      root.innerHTML = `<h2>Review class</h2><p>Generate a Grace class, then mark who was here and where each technique landed.</p>`;
      return;
    }
    const date = plan.settings.date || "";
    const entry = classFor(date, plan.settings.ageGroup);
    const attendedIds = entry && Array.isArray(entry.attended) ? entry.attended : [];
    const classKids = P.sortByRank(state.roster).filter(
      (kid) => attendedIds.includes(kid.id) || P.kidFitsClass(kid.age, plan.settings.ageGroup)
    );
    const attended =
      attendOverride || new Set(attendedIds.length ? attendedIds : classKids.map((kid) => kid.id));
    const techs = techniquesOf(plan);
    const chips = classKids.length
      ? classKids
          .map((kid) => {
            const on = attended.has(kid.id) ? " on" : "";
            return `<button type="button" class="chip${on}" data-attend="${esc(kid.id)}">${esc(kid.name)}</button>`;
          })
          .join("")
      : `<p>Add the roster, then check them in or tap who was here.</p>`;
    const blocks = techs
      .map((tech) => {
        const rows = classKids
          .map((kid) => {
            const level = (state.progress.levels[kid.id] || {})[tech.id] || "";
            const buttons = P.LEVELS.map(
              (id) =>
                `<button type="button" class="${level === id ? "on" : ""}" data-level="${id}" data-kid="${esc(
                  kid.id
                )}" data-tech="${esc(tech.id)}">${esc(LEVEL_LABEL[id])}</button>`
            ).join("");
            return `<div class="kid-block"><strong>${esc(kid.name)}</strong><div class="level-row">${buttons}</div></div>`;
          })
          .join("");
        return `<h3>${esc(tech.name)}${tech.position ? ` · ${esc(tech.position)}` : ""}</h3>${rows}`;
      })
      .join("");
    root.innerHTML = `
      <h2>Review class</h2>
      <p>${esc(classLabel(plan.settings.ageGroup))}${plan.theme ? ` · ${esc(plan.theme.reason)}` : ""}${date ? ` · ${esc(date)}` : ""}</p>
      <h3>Who was here</h3>
      <div class="chip-row">${chips}</div>
      ${blocks}
      <div class="btn-row" style="margin-top:16px">
        <button class="primary tap" type="button" id="saveClassBtn">Save class</button>
      </div>
      <p class="hint">Save marks the class taught and sets Introduced for anyone still blank. A higher level you already tapped stays.</p>`;
  }

  async function saveReviewedClass() {
    const plan = state.plan;
    if (!plan || plan.mode !== "grace") return;
    const date = plan.settings.date || $("date").value;
    if (!date) {
      toast("Put a date on the class first.");
      return;
    }
    const entry = ensureClass(date, plan.settings.ageGroup);
    entry.id = plan.sessionId || entry.id;
    entry.theme = plan.theme?.id || "";
    entry.themeLabel = plan.theme?.label || "";
    entry.techniques = techniquesOf(plan);
    entry.game = gameName(plan);
    entry.taught = true;
    entry.attended = [...document.querySelectorAll("#reviewView .chip.on")].map((btn) => btn.dataset.attend);
    applyIntroduced(entry);
    try {
      await pushClass(entry, false);
      (entry.techniques || []).forEach((tech) => {
        entry.attended.forEach((kidId) => {
          const level = state.progress.levels[kidId] && state.progress.levels[kidId][tech.id];
          if (level === "introduced") {
            window.BJJ_API.send("PUT", "/api/levels", { studentId: kidId, techId: tech.id, level: "introduced" }).catch(() => {});
          }
        });
      });
      toast("Class saved. Attended techniques are at least Introduced.");
      renderReview();
    } catch (err) {
      toast(err.message || "Could not save that class.");
      resync().catch(() => {});
    }
  }

  const PAST_AGES = [
    ["mite", "Mighty Mite 4–6"],
    ["peewee", "Pee Wee 7–9"],
    ["junior", "Junior 10–12"],
    ["teen", "Teen 13–15"],
    ["toddler", "Toddler 3–5"],
  ];

  function pastAgeLabel(id) {
    if (P.isCombo(id)) return P.comboLabel(id);
    const found = PAST_AGES.find((pair) => pair[0] === id);
    return found ? found[1] : id;
  }

  function selectedPastAgeKey() {
    const boxes = [...document.querySelectorAll('#pastAge input[name="pastAge"]:checked')].map((box) => box.value);
    if (boxes.length === 1 && boxes[0] === "toddler") return "toddler";
    const grace = boxes.filter((id) => id !== "toddler");
    if (!grace.length) return boxes.includes("toddler") ? "toddler" : P.normalizeAgeKey(state.ageGroup);
    return P.ageKey(grace);
  }

  function pastCurriculumAge() {
    const key = selectedPastAgeKey();
    return curriculumAge(key);
  }

  function refreshPastClassFields() {
    const box = document.activeElement;
    if (box && box.name === "pastAge") {
      if (box.value === "toddler" && box.checked) {
        document.querySelectorAll('#pastAge input[name="pastAge"]').forEach((input) => {
          if (input !== box) input.checked = false;
        });
      } else if (box.checked) {
        const toddler = document.querySelector('#pastAge input[value="toddler"]');
        if (toddler) toddler.checked = false;
      }
      const checked = [...document.querySelectorAll('#pastAge input[name="pastAge"]:checked')];
      if (!checked.length) box.checked = true;
    }
    const age = pastCurriculumAge();
    const themes = themesForAge(age);
    const current = $("pastTheme") ? $("pastTheme").value : "";
    if ($("pastTheme")) {
      $("pastTheme").innerHTML =
        `<option value="">No theme</option>` +
        themes.map((theme) => `<option value="${esc(theme.id)}">${esc(theme.label)}</option>`).join("");
      if ([...$("pastTheme").options].some((option) => option.value === current)) $("pastTheme").value = current;
    }
    if ($("pastTechs")) $("pastTechs").innerHTML = pastTechMarkup(age, $("pastTheme") ? $("pastTheme").value : "");
    if ($("pastAttend")) {
      const on = [...document.querySelectorAll("#pastAttend .chip.on")]
        .map((btn) => btn.getAttribute("data-past-kid"))
        .filter(Boolean);
      $("pastAttend").innerHTML = attendanceChips(on, (kid) => `data-past-kid="${esc(kid.id)}"`, selectedPastAgeKey());
    }
  }

  function progressLevelButtons(kidId, techId, level) {
    return P.LEVELS.map(
      (id) =>
        `<button type="button" class="${level === id ? "on" : ""}" data-prog-level="${id}" data-prog-kid="${esc(
          kidId
        )}" data-prog-tech="${esc(techId)}">${esc(LEVEL_LABEL[id])}</button>`
    ).join("");
  }

  function pastTechMarkup(age, themeId) {
    if (!themeId) return `<p class="hint">Choose a theme to list techniques, or save the date and who was here.</p>`;
    const items = pool("lesson", age).filter((item) => lessonInTheme(item, themeId));
    if (!items.length) return `<p class="hint">No techniques for that theme in this class.</p>`;
    return `<div class="tech-checks">${items
      .map((item) => `<label class="check"><input type="checkbox" value="${esc(item.id)}" /> ${esc(item.name)}</label>`)
      .join("")}</div>`;
  }

  function attendanceChips(attended, attrFor, ageKey) {
    if (!state.roster.length) return `<p>Add the roster, then mark who was here.</p>`;
    const on = new Set(attended || []);
    const kids = P.sortByRank(state.roster).filter((kid) => on.has(kid.id) || P.kidFitsClass(kid.age, ageKey || ""));
    return `<div class="chip-row">${kids
      .map((kid) => {
        const selected = on.has(kid.id) ? " on" : "";
        const attrs = attrFor(kid);
        return `<button type="button" class="chip${selected}" ${attrs}>${esc(kid.name)}</button>`;
      })
      .join("")}</div>`;
  }

  function loggedClassesHtml() {
    const classes = state.progress.classes
      .filter((entry) => entry.date)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ageGroup.localeCompare(b.ageGroup)));
    if (!classes.length) return `<p>No classes logged yet.</p>`;
    return classes
      .map((entry) => {
        const names = (entry.techniques || []).map((tech) => tech.name).filter(Boolean);
        const count = entry.taught ? "Counts toward the stripe hint." : "Checked in, not marked taught yet.";
        return `<article class="past-log">
          <h3>${esc(entry.date)} · ${esc(pastAgeLabel(entry.ageGroup))}${entry.themeLabel ? ` · ${esc(entry.themeLabel)}` : ""}</h3>
          <p>${esc(count)}${names.length ? ` ${esc(names.join(", "))}` : ""}</p>
          ${attendanceChips(entry.attended, (kid) => `data-class-kid="${esc(kid.id)}" data-class-id="${esc(entry.id)}"`, entry.ageGroup)}
          <div class="btn-row">
            <button class="primary" type="button" data-save-attend="${esc(entry.id)}">Save attendance</button>
            <button class="ghost" type="button" data-remove-class="${esc(entry.id)}">Remove class</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function kidLevelEditor(kid) {
    const levels = state.progress.levels[kid.id] || {};
    const drafts = state.levelDrafts[kid.id] || [];
    const techIds = [...new Set(Object.keys(levels).concat(drafts))];
    const rows = techIds
      .map((techId) => {
        const act = findActivity(techId);
        const name = act?.name || techId;
        const where = act?.position || "";
        return `<div class="kid-block"><strong>${esc(name)}${where ? ` · ${esc(where)}` : ""}</strong><div class="level-row">${progressLevelButtons(
          kid.id,
          techId,
          levels[techId] || ""
        )}</div></div>`;
      })
      .join("");
    const grouped = groupForAge(kid.age);
    const age = grouped && grouped.id ? grouped.id : "mite";
    const known = new Set(techIds);
    const choices = pool("lesson", age).filter((item) => !known.has(item.id));
    const picker = choices.length
      ? `<div class="assistant-add"><select data-add-tech="${esc(kid.id)}" aria-label="Add a technique for ${esc(kid.name)}"><option value="">Add a technique</option>${choices
          .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
          .join("")}</select><button class="ghost" type="button" data-add-tech-btn="${esc(kid.id)}">Add</button></div>`
      : "";
    return `${rows || "<p>No techniques logged yet.</p>"}${picker}<p class="hint">Tap a level to save it. Tap the highlighted level again to clear it.</p>`;
  }

  async function savePastClass() {
    const date = $("pastDate") && $("pastDate").value;
    const age = $("pastAge") ? selectedPastAgeKey() : state.ageGroup;
    if (!date) {
      setFormNote("pastNote", "Add the date of the class.");
      return;
    }
    const themeId = ($("pastTheme") && $("pastTheme").value) || "";
    const theme = (DATA.themes || []).find((item) => item.id === themeId);
    const techIds = [...document.querySelectorAll("#pastTechs input:checked")].map((input) => input.value);
    const techniques = techIds
      .map((id) => {
        const act = findActivity(id);
        if (!act) return null;
        return { id: act.id, name: act.name, position: act.position || "", theme: act.theme || themeId };
      })
      .filter(Boolean);
    const attended = [...document.querySelectorAll("#pastAttend .chip.on")].map((btn) => btn.getAttribute("data-past-kid"));
    const entry = ensureClass(date, age);
    entry.theme = themeId;
    entry.themeLabel = theme ? theme.label : "";
    entry.techniques = techniques;
    entry.game = entry.game || "";
    entry.taught = true;
    entry.attended = attended.filter(Boolean);
    try {
      await pushClass(entry, false);
      setFormNote("pastNote", "Past class saved. It counts toward attendance.", true);
      toast("Past class saved.");
      renderProgress();
    } catch (err) {
      setFormNote("pastNote", err.message || "Could not save that class.");
      resync().catch(() => {});
    }
  }

  async function saveLoggedAttendance(classId) {
    const entry = state.progress.classes.find((item) => item.id === classId);
    if (!entry) return;
    entry.attended = [...document.querySelectorAll(`#progressView .chip.on[data-class-id="${classId}"]`)].map((btn) =>
      btn.getAttribute("data-class-kid")
    );
    try {
      await pushClass(entry, false);
      toast("Attendance updated.");
      renderProgress();
    } catch (err) {
      toast(err.message || "Could not update that class.");
      resync().catch(() => {});
    }
  }

  async function removeLoggedClass(classId) {
    const entry = state.progress.classes.find((item) => item.id === classId);
    if (!entry) return;
    if (!window.confirm(`Remove the class on ${entry.date}?`)) return;
    try {
      await window.BJJ_API.send("DELETE", `/api/classes/${classId}`);
      state.progress.classes = state.progress.classes.filter((item) => item.id !== classId);
      syncPlanCounts();
      toast("Class removed.");
      renderProgress();
    } catch (err) {
      toast(err.message || "Could not remove that class.");
      resync().catch(() => {});
    }
  }

  async function setProgressLevel(kidId, techId, level) {
    const current = (state.progress.levels[kidId] || {})[techId];
    try {
      if (current === level) {
        if (state.progress.levels[kidId]) delete state.progress.levels[kidId][techId];
        await window.BJJ_API.send("DELETE", "/api/levels", { studentId: kidId, techId });
      } else {
        setLevel(kidId, techId, level);
        await window.BJJ_API.send("PUT", "/api/levels", { studentId: kidId, techId, level });
      }
      if (state.levelDrafts[kidId]) {
        state.levelDrafts[kidId] = state.levelDrafts[kidId].filter((id) => id !== techId);
      }
      renderProgress();
    } catch (err) {
      toast(err.message || "Could not save that level.");
      resync().catch(() => {});
    }
  }

  function renderProgress() {
    const root = $("progressView");
    const classKey = P.normalizeAgeKey(state.ageGroup);
    const age = curriculumAge(classKey);
    const group = DATA.ageGroups[age];
    const heading = P.isCombo(classKey) ? P.comboLabel(classKey) : group ? `${group.range} ${group.label}` : "";
    const coverage = themesForAge(age)
      .map((theme) => {
        const since = P.themeStaleness(theme.id, state.progress.classes, age);
        const hits = state.progress.classes.filter(
          (entry) => entry.taught && P.ageKeyIncludes(entry.ageGroup, age) && entry.theme === theme.id
        );
        const taughtIds = new Set();
        hits.forEach((entry) => (entry.techniques || []).forEach((tech) => tech && taughtIds.add(tech.id)));
        const missing = pool("lesson", age)
          .filter((item) => lessonInTheme(item, theme.id) && !taughtIds.has(item.id))
          .map((item) => item.name);
        const last = hits.length ? hits[hits.length - 1].date : "";
        return `<li><strong>${esc(P.themeReason(theme.label, since))}</strong>${last ? ` · last ${esc(last)}` : ""}${
          missing.length ? `<br>Not covered yet: ${esc(missing.join(", "))}` : `<br>Every technique in this theme has been in a class.`
        }</li>`;
      })
      .join("");
    const kids = P.sortByRank(state.roster)
      .map((kid) => {
        const hint = stripeHint(kid);
        const hintText = hint.ready
          ? `Stripe hint: meets ${hint.needOwn} on their own and ${hint.needAttend} classes. The teacher still decides.`
          : `Stripe hint: ${hint.own} of ${hint.needOwn} on their own, ${hint.attended} of ${hint.needAttend} classes. The teacher decides.`;
        const dates = state.progress.classes
          .filter((entry) => entry.taught && entry.attended.includes(kid.id))
          .map((entry) => entry.date)
          .filter(Boolean);
        const promo = typeof P.promotionHint === "function" ? P.promotionHint(kid) : null;
        const promoHtml = promo
          ? `<p class="belt-promo${promo.ready ? " ready" : ""}">${esc(promo.text)}</p>`
          : "";
        return `<article class="kid-block">
          <h3>${esc(kid.name)}</h3>
          <p>Age ${esc(kid.age)} · ${esc(P.beltLabel(kid.belt))} · ${esc(stripeText(kid))}</p>
          ${promoHtml}
          <p>${esc(hintText)}</p>
          <p>${dates.length ? `${dates.length} taught class${dates.length === 1 ? "" : "es"}: ${esc(dates.join(", "))}` : "No taught classes logged yet."}</p>
          ${kidLevelEditor(kid)}
          <label>Teacher notes</label>
          <textarea class="note" data-note="${esc(kid.id)}">${esc(state.progress.notes[kid.id] || "")}</textarea>
          <div class="btn-row"><button type="button" class="ghost" data-print-kid="${esc(kid.id)}">Print progress sheet</button></div>
        </article>`;
      })
      .join("");
    const pastIds = classKey === "toddler" ? ["toddler"] : P.parseAgeKey(classKey);
    const themes = themesForAge(age);
    const stripeSettings = isAdmin()
      ? `<div class="grid-2">
        <div class="field"><label for="stripeOwn">On their own before a stripe hint</label><input id="stripeOwn" type="number" min="1" max="40" value="${esc(state.progress.stripe.own)}" /></div>
        <div class="field"><label for="stripeAttend">Classes before a stripe hint</label><input id="stripeAttend" type="number" min="1" max="40" value="${esc(state.progress.stripe.attend)}" /></div>
      </div>`
      : `<p class="stripe-hint-readonly">Stripe hint: ${esc(state.progress.stripe.own)} techniques on their own + ${esc(state.progress.stripe.attend)} classes (set by admin)</p>`;
    root.innerHTML = `
      <h2>Progress · ${esc(heading)}</h2>
      ${stripeSettings}
      <h3>Log a past class</h3>
      <div class="past-class">
        <div class="field"><label for="pastDate">Date</label><input id="pastDate" type="date" /></div>
        <div class="field"><span id="pastAgeLabel">Class</span><div class="age-checks" id="pastAge" role="group" aria-labelledby="pastAgeLabel">${PAST_AGES.map(
          ([id, label]) =>
            `<label class="check"><input type="checkbox" name="pastAge" value="${esc(id)}"${
              pastIds.includes(id) ? " checked" : ""
            } /> ${esc(label)}</label>`
        ).join("")}</div></div>
        <div class="field"><label for="pastTheme">Theme</label><select id="pastTheme"><option value="">No theme</option>${themes
          .map((theme) => `<option value="${esc(theme.id)}">${esc(theme.label)}</option>`)
          .join("")}</select></div>
        <div id="pastTechs">${pastTechMarkup(age, "")}</div>
        <div id="pastAttend">${attendanceChips([], (kid) => `data-past-kid="${esc(kid.id)}"`, classKey)}</div>
        <div class="btn-row"><button class="primary" type="button" id="pastSaveBtn">Save past class</button></div>
        <p class="form-note" id="pastNote" role="alert"></p>
        <p class="hint">Saving the same date and class updates that class. Taught classes count toward the stripe hint.</p>
      </div>
      <h3>Logged classes</h3>
      ${loggedClassesHtml()}
      <h3>Curriculum</h3>
      <ul>${coverage}</ul>
      <h3>Kids</h3>
      ${kids || "<p>Add the roster to track kids.</p>"}`;
  }

  function progressSheetHtml(kid) {
    const hint = stripeHint(kid);
    const group = groupForAge(kid.age);
    const levels = state.progress.levels[kid.id] || {};
    const groups = {};
    Object.entries(levels).forEach(([techId, level]) => {
      const act = findActivity(techId);
      const position = act?.position || "Other";
      groups[position] = groups[position] || [];
      groups[position].push(`<li>${esc(act?.name || techId)} — ${esc(LEVEL_LABEL[level] || level)}</li>`);
    });
    const body = Object.entries(groups)
      .map(([position, lines]) => `<h3>${esc(position)}</h3><ul>${lines.join("")}</ul>`)
      .join("");
    const dates = state.progress.classes
      .filter((entry) => Array.isArray(entry.attended) && entry.attended.includes(kid.id) && entry.date)
      .map((entry) => entry.date);
    return `<article class="progress-sheet card-page">
      <img class="sheet-logo" src="${esc(LOGO)}" alt="Grace Jiu-Jitsu" />
      <h2>${esc(kid.name)}</h2>
      <p>${esc(groupText(group, kid.age))} · ${esc(P.beltLabel(kid.belt))} · ${esc(stripeText(kid))}</p>
      <p>${dates.length} classes${dates.length ? `: ${esc(dates.join(", "))}` : ""}</p>
      <p>${esc(
        hint.ready
          ? "Stripe hint: the numbers you set are met. The teacher decides."
          : `Stripe hint: ${hint.own} of ${hint.needOwn} on their own, ${hint.attended} of ${hint.needAttend} classes.`
      )}</p>
      ${body || "<p>No techniques logged yet.</p>"}
      ${state.progress.notes[kid.id] ? `<p><strong>Notes.</strong> ${esc(state.progress.notes[kid.id])}</p>` : ""}
    </article>`;
  }

  function qrDataUrl(text, pixels) {
    if (typeof qrcode !== "function" || !text) return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const scale = Math.max(2, Math.floor(pixels / (count + margin * 2)));
    const size = (count + margin * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
    return canvas.toDataURL("image/png");
  }

  function kidsForCards() {
    return P.sortByRank(state.roster).filter((kid) => state.cardPick[kid.id] !== false);
  }

  function cardInner(kid, qrSize) {
    const group = groupForAge(kid.age);
    const src = qrDataUrl(P.qrPayload(kid.id), qrSize);
    return `<img class="qr" alt="QR code for ${esc(kid.name)}" src="${src}" />
      <div>
        <img class="mini-logo card-logo" src="${esc(LOGO)}" alt="" />
        <h2>${esc(kid.name)}</h2>
        <p>${esc(groupText(group, kid.age))}</p>
        <p>${esc(P.beltLabel(kid.belt))} · ${esc(stripeText(kid))}</p>
      </div>`;
  }

  function renderCardSurface(layout) {
    state.cardLayout = layout;
    const root = $("cardView");
    const date = ($("checkinDate") && $("checkinDate").value) || $("date").value || "";
    if (layout === "progress") return;
    const picks = P.sortByRank(state.roster)
      .map((kid) => {
        const on = state.cardPick[kid.id] === false ? "" : "checked";
        return `<label class="check"><input type="checkbox" data-card-kid="${esc(kid.id)}" ${on} /> ${esc(kid.name)}</label>`;
      })
      .join("");
    let body = "";
    if (!state.roster.length) body = `<p>Add students before printing cards.</p>`;
    else if (layout === "signin") {
      const rows = P.sortByRank(state.roster)
        .map((kid) => {
          const src = qrDataUrl(P.qrPayload(kid.id), 180);
          return `<div class="signin-row"><span class="box"></span><div><strong>${esc(kid.name)}</strong><br>${esc(
            P.beltLabel(kid.belt)
          )} · ${esc(stripeText(kid))}</div><img class="qr" alt="" src="${src}" /></div>`;
        })
        .join("");
      body = `<article class="signin-sheet"><img class="sheet-logo" src="${esc(LOGO)}" alt="Grace Jiu-Jitsu" /><h2>Sign-in · ${esc(
        date || "class"
      )}</h2><p>${esc(classLabel(state.ageGroup))}. Check the box, or scan the code.</p>${rows}</article>`;
    } else if (layout === "full") {
      body = kidsForCards()
        .map((kid) => `<article class="card-page">${cardInner(kid, 480)}</article>`)
        .join("");
    } else {
      const cards = kidsForCards()
        .map((kid) => `<article class="wallet-card">${cardInner(kid, 220)}</article>`)
        .join("");
      body = `<div class="wallet-grid">${cards}</div>`;
    }
    root.innerHTML = `<div class="no-print"><h2>${
      layout === "signin" ? "Sign-in sheet" : layout === "full" ? "Full-page cards" : "Wallet cards"
    }</h2><div class="pick-row">${layout === "signin" ? "" : picks}</div></div>${body}`;
  }

  function showCards(layout) {
    renderCardSurface(layout);
    setView("cards");
  }

  function printCards() {
    document.body.dataset.print = state.cardLayout === "progress" ? "progress" : "cards";
    window.print();
  }

  async function markPresent(ids, date) {
    const when = date || ($("checkinDate") && $("checkinDate").value) || $("date").value;
    const known = [];
    const dup = [];
    const unknown = [];
    const outside = [];
    if (!when) return { known, dup, unknown, outside, date: "" };
    const age = P.normalizeAgeKey(state.ageGroup);
    ids.forEach((id) => {
      const kid = state.roster.find((item) => item.id === id);
      if (!kid) {
        unknown.push(id);
        return;
      }
      if (!P.kidFitsClass(kid.age, age)) {
        outside.push(kid);
        return;
      }
      const entry = ensureClass(when, age);
      if (entry.attended.includes(id)) dup.push(kid);
      else {
        entry.attended.push(id);
        known.push(kid);
      }
    });
    if (known.length) {
      const entry = ensureClass(when, age);
      try {
        await pushClass(entry, true);
      } catch (err) {
        known.forEach((kid) => {
          entry.attended = entry.attended.filter((id) => id !== kid.id);
        });
        known.length = 0;
        toast(err.message || "Could not check that student in.");
      }
    }
    if ($("checkinStatus") && (known.length || dup.length || outside.length)) {
      const parts = [];
      if (known.length) {
        parts.push(`${known.map((kid) => kid.name).join(", ")} ${known.length === 1 ? "is" : "are"} here.`);
      }
      if (dup.length) parts.push(`${dup.map((kid) => kid.name).join(", ")} already checked in.`);
      if (outside.length) parts.push(outsideSentence(outside));
      $("checkinStatus").textContent = parts.join(" ");
      $("checkinStatus").className = known.length ? "checkin-status ok" : "checkin-status dup";
    }
    return { known, dup, unknown, outside, date: when };
  }

  function resolveScan(id) {
    const kid = state.roster.find((item) => item.id === id);
    if (kid) return { type: "student", id: kid.id };
    const card = state.cards.find((item) => item.code === id);
    if (!card) return { type: "unknown", message: "That code is not a Grace card." };
    if (card.status === "retired") return { type: "retired", message: "That card was retired." };
    if (card.status === "claimed") {
      const linked = state.roster.find((item) => item.id === card.studentId);
      if (!linked) return { type: "missing", message: "That card's student is no longer on the roster." };
      return { type: "student", id: linked.id };
    }
    return { type: "unclaimed", code: card.code };
  }

  async function handleScans(ids) {
    const studentIds = [];
    const messages = [];
    const unclaimed = [];
    ids.forEach((id) => {
      const found = resolveScan(id);
      if (found.type === "student") {
        if (!studentIds.includes(found.id)) studentIds.push(found.id);
        return;
      }
      if (found.type === "unclaimed") {
        if (!unclaimed.includes(found.code)) unclaimed.push(found.code);
        return;
      }
      if (found.message && !messages.includes(found.message)) messages.push(found.message);
    });
    const result = studentIds.length ? await markPresent(studentIds) : null;
    if (unclaimed.length && !claimOpen) {
      openClaim(unclaimed[0]);
      if (unclaimed.length > 1) {
        $("checkinStatus").textContent = "More than one new card. Add this student, then scan the next card.";
        $("checkinStatus").className = "checkin-status";
      }
      return;
    }
    if (result && (result.known.length || result.dup.length)) {
      showScanResult(result);
      return;
    }
    if (messages.length) {
      $("checkinStatus").textContent = messages[0];
      $("checkinStatus").className = "checkin-status dup";
      beep(false);
      return;
    }
    if (result) showScanResult(result);
  }

  function openClaim(code) {
    claimOpen = true;
    state.pendingCard = code;
    const form = $("claimForm");
    if (!form) return;
    form.classList.remove("hidden");
    $("claimName").value = "";
    $("claimAge").value = "";
    $("claimGroup").value = "";
    $("claimBelt").value = "white";
    $("claimStripes").value = "0";
    setFormNote("claimNote", "");
    $("checkinStatus").textContent = "New card. Add this student.";
    $("checkinStatus").className = "checkin-status ok";
    form.scrollIntoView({ block: "nearest" });
    $("claimName").focus();
  }

  function closeClaim() {
    claimOpen = false;
    state.pendingCard = "";
    const form = $("claimForm");
    if (form) form.classList.add("hidden");
    setFormNote("claimNote", "");
  }

  async function submitClaim(event) {
    event.preventDefault();
    const code = state.pendingCard;
    const name = $("claimName").value.trim().slice(0, 40);
    const ageText = $("claimAge").value.trim();
    const ageGroup = $("claimGroup").value;
    if (!code) {
      setFormNote("claimNote", "Scan a blank card first.");
      return;
    }
    if (!name) {
      setFormNote("claimNote", "Add the student's name.");
      toast("Add the student's name.");
      return;
    }
    if (!ageText && !ageGroup) {
      setFormNote("claimNote", "Add an age or a class.");
      toast("Add an age or a class.");
      return;
    }
    if (ageText) {
      const age = Number(ageText);
      if (!Number.isInteger(age) || age < 3 || age > 17) {
        setFormNote("claimNote", "Age needs to be from 3 to 17.");
        toast("Age needs to be from 3 to 17.");
        return;
      }
    }
    const body = {
      name,
      belt: $("claimBelt").value,
      stripes: Number($("claimStripes").value),
    };
    if (ageText) body.age = Number(ageText);
    if (ageGroup) body.ageGroup = ageGroup;
    try {
      const saved = await window.BJJ_API.send("POST", `/api/cards/${code}/claim`, body);
      const kid = P.sanitizeRosterKid(saved.student);
      if (!kid) throw new Error("Could not add that student.");
      if (!state.roster.some((item) => item.id === kid.id)) state.roster.push(kid);
      if (saved.card) rememberCard(saved.card);
      closeClaim();
      renderRoster();
      renderCardRecords();
      const result = await markPresent([kid.id]);
      showScanResult(result);
      if (result.known.length) {
        $("checkinStatus").textContent = `${kid.name} is on the roster and checked in.`;
      }
      toast(`${kid.name} is on the roster.`);
      if (state.plan) renderPlan();
    } catch (err) {
      const message = err.message || "Could not add that student.";
      setFormNote("claimNote", message);
      toast(message);
    }
  }

  function renderCardRecords() {
    const list = $("cardRecordList");
    if (!list) return;
    if (!state.cards.length) {
      list.innerHTML = `<p class="hint">No blank cards printed yet.</p>`;
      return;
    }
    const options = [`<option value="">Link to a student</option>`]
      .concat(P.sortByRank(state.roster).map((kid) => `<option value="${esc(kid.id)}">${esc(kid.name)}</option>`))
      .join("");
    list.innerHTML = state.cards
      .map((card) => {
        const kid = state.roster.find((item) => item.id === card.studentId);
        const who = kid ? kid.name : card.status === "claimed" ? "Missing student" : "Not linked";
        return `<div class="card-record">
          <strong>${esc(who)}</strong>
          <span>${esc(card.status)} · ${esc(card.code.slice(0, 8))}…</span>
          <select data-relink="${esc(card.code)}" aria-label="Student for ${esc(who)}">${options}</select>
          <div class="btn-row">
            <button type="button" class="ghost" data-link-card="${esc(card.code)}">Re-link</button>
            <button type="button" class="danger" data-retire-card="${esc(card.code)}">Retire</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function blankCardInner(card, qrSize) {
    const src = qrDataUrl(P.qrPayload(card.code), qrSize);
    return `<img class="qr" alt="Blank check-in card" src="${src}" />
      <div class="blank-fields">
        <img class="mini-logo card-logo" src="${esc(LOGO)}" alt="" />
        <p class="write"><span>Name</span><span class="line"></span></p>
        <p class="write"><span>Class</span><span class="line"></span></p>
        <p class="write"><span>Belt</span><span class="line"></span></p>
      </div>`;
  }

  function renderBlankCards(cards, layout) {
    state.cardLayout = layout;
    const root = $("cardView");
    const title = layout === "blank-full" ? "Blank full-page cards" : "Blank wallet cards";
    const body =
      layout === "blank-full"
        ? cards.map((card) => `<article class="card-page blank-card" data-code="${esc(card.code)}">${blankCardInner(card, 480)}</article>`).join("")
        : `<div class="wallet-grid">${cards
            .map((card) => `<article class="wallet-card blank-card" data-code="${esc(card.code)}">${blankCardInner(card, 220)}</article>`)
            .join("")}</div>`;
    root.innerHTML = `<div class="no-print"><h2>${title}</h2><p>Write the name and class on a card, then scan it to add the student.</p></div>${body}`;
  }

  async function printBlankCards(layout) {
    if (!isAdmin()) {
      toast("An admin prints blank cards.");
      return;
    }
    const raw = Number($("blankCount").value);
    const count = Math.max(1, Math.min(24, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 8));
    $("blankCount").value = String(count);
    try {
      const body = await window.BJJ_API.send("POST", "/api/cards", { count });
      (body.cards || []).forEach(rememberCard);
      renderBlankCards(body.cards || [], layout);
      renderCardRecords();
      setView("cards");
      toast(count === 1 ? "Blank card is ready to print." : `${count} blank cards are ready to print.`);
    } catch (err) {
      toast(err.message || "Could not make blank cards.");
    }
  }

  function outsideSentence(kids) {
    if (!kids || !kids.length) return "";
    const names = kids.map((kid) => kid.name).join(", ");
    return `${names} ${kids.length === 1 ? "is" : "are"} not in this combo class.`;
  }

  function showScanResult(result) {
    const el = $("checkinStatus");
    if (!el) return;
    const leftOut = outsideSentence(result.outside);
    if (result.known.length) {
      const names = result.known.map((kid) => kid.name).join(", ");
      const extra = result.dup.length ? ` ${result.dup.map((kid) => kid.name).join(", ")} already checked in.` : "";
      el.textContent = `${names} ${result.known.length === 1 ? "is" : "are"} here.${extra}${leftOut ? ` ${leftOut}` : ""}`;
      el.className = "checkin-status ok";
      beep(true);
    } else if (result.dup.length) {
      el.textContent = `${result.dup.map((kid) => kid.name).join(", ")} already checked in.${leftOut ? ` ${leftOut}` : ""}`;
      el.className = "checkin-status dup";
      beep(false);
    } else if (leftOut) {
      el.textContent = leftOut;
      el.className = "checkin-status dup";
      beep(false);
    } else if (result.unknown.length) {
      el.textContent = "That code is not on this roster.";
      el.className = "checkin-status dup";
      beep(false);
    } else {
      el.textContent = "No Grace card in that photo.";
      el.className = "checkin-status";
    }
    renderCheckinList();
  }

  function renderCheckinList() {
    const list = $("checkinList");
    if (!list) return;
    const key = P.normalizeAgeKey(state.ageGroup);
    const note = $("checkinClass");
    if (note) {
      note.textContent = P.isCombo(key) ? `${P.comboLabel(key)}. Check-in accepts kids from any of these groups.` : "";
    }
    const date = $("checkinDate").value;
    const entry = classFor(date, key);
    const ids = new Set(entry ? entry.attended : []);
    if (!state.roster.length) {
      list.innerHTML = `<li>No students on the roster yet.</li>`;
      return;
    }
    const kids = P.sortByRank(state.roster).filter((kid) => ids.has(kid.id) || P.kidFitsClass(kid.age, key));
    list.innerHTML = kids
      .map((kid) => `<li class="${ids.has(kid.id) ? "here" : ""}">${esc(kid.name)} — ${ids.has(kid.id) ? "here" : "not yet"}</li>`)
      .join("");
  }

  function beep(ok) {
    try {
      const ctx = beep.ctx || (beep.ctx = new AudioContext());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = ok ? 880 : 220;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch (err) {
      /* sound is a bonus */
    }
  }

  function cameraHelp() {
    const el = $("cameraNote");
    if (!el) return;
    if (!window.isSecureContext) {
      el.textContent = "The camera needs https or localhost. Use a photo instead.";
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      el.textContent = "This browser has no camera access. Upload a photo of the cards instead.";
      return;
    }
    el.textContent = "Point the camera at one card. A photo of a printed page can check in every card it finds.";
  }

  function payloadsFromCanvas(canvas) {
    const found = [];
    if (typeof jsQR !== "function") return found;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const scan = (x, y, w, h) => {
      if (w < 48 || h < 48) return;
      const image = ctx.getImageData(x, y, w, h);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      if (!code || !code.data) return;
      const id = P.parseQr(code.data);
      if (id && !found.includes(id)) found.push(id);
    };
    scan(0, 0, canvas.width, canvas.height);
    [2, 3, 4].forEach((n) => {
      const tileW = Math.round((canvas.width / n) * 1.4);
      const tileH = Math.round((canvas.height / n) * 1.4);
      for (let row = 0; row < n; row += 1) {
        for (let col = 0; col < n; col += 1) {
          const x = Math.max(0, Math.min(canvas.width - 24, Math.round((col * canvas.width) / n - tileW * 0.12)));
          const y = Math.max(0, Math.min(canvas.height - 24, Math.round((row * canvas.height) / n - tileH * 0.12)));
          scan(x, y, Math.min(tileW, canvas.width - x), Math.min(tileH, canvas.height - y));
        }
      }
    });
    return found;
  }

  function canvasFromSource(source) {
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    const canvas = document.createElement("canvas");
    if (!width || !height) return canvas;
    const scale = Math.min(1, 1400 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function rotateCanvas(source, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(source.width * cos + source.height * sin);
    canvas.height = Math.round(source.width * sin + source.height * cos);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
  }

  async function decodeSource(source) {
    const ids = [];
    const add = (raw) => {
      const id = P.parseQr(raw);
      if (id && !ids.includes(id)) ids.push(id);
    };
    if (window.BarcodeDetector) {
      try {
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        const codes = await detector.detect(source);
        codes.forEach((code) => add(code.rawValue));
        if (ids.length) return ids;
      } catch (err) {
        /* fall through to jsQR */
      }
    }
    const canvas = canvasFromSource(source);
    payloadsFromCanvas(canvas).forEach((id) => add(`GBJJ1|${id}|${P.qrChecksum(id)}`));
    if (ids.length) return ids;
    [-8, 8, -16, 16].some((degrees) => {
      payloadsFromCanvas(rotateCanvas(canvas, degrees)).forEach((id) => add(`GBJJ1|${id}|${P.qrChecksum(id)}`));
      return ids.length > 0;
    });
    return ids;
  }

  async function scanVideoFrame() {
    const video = $("checkinVideo");
    if (!video || video.readyState < 2) return;
    const ids = await decodeSource(video);
    if (!ids.length) return;
    await handleScans(ids);
  }

  async function startCamera() {
    cameraHelp();
    if (!window.isSecureContext) {
      $("checkinStatus").textContent = "The camera needs https or localhost. Use a photo instead.";
      $("checkinStatus").className = "checkin-status dup";
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $("checkinStatus").textContent = "No camera on this browser. Upload a photo instead.";
      $("checkinStatus").className = "checkin-status dup";
      return;
    }
    try {
      stopCamera();
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = $("checkinVideo");
      video.srcObject = cameraStream;
      await video.play();
      cameraTimer = window.setInterval(() => {
        scanVideoFrame();
      }, 700);
      $("checkinStatus").textContent = "Looking for a card…";
      $("checkinStatus").className = "checkin-status";
    } catch (err) {
      $("checkinStatus").textContent = "The camera is not available. Upload a photo of the cards instead.";
      $("checkinStatus").className = "checkin-status dup";
    }
  }

  function stopCamera() {
    if (cameraTimer) window.clearInterval(cameraTimer);
    cameraTimer = 0;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    const video = $("checkinVideo");
    if (video) video.srcObject = null;
  }

  async function decodePhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const ids = await decodeSource(image);
      if (!ids.length) {
        $("checkinStatus").textContent = "No Grace card in that photo.";
        $("checkinStatus").className = "checkin-status";
        return;
      }
      await handleScans(ids);
    } catch (err) {
      toast("Could not read that photo.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function bind() {
    syncAgeButtons();
    bindResetPassword();
    document.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = $(btn.dataset.for);
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 12);
        input.value = String(Math.max(min, Math.min(max, Number(input.value) + Number(btn.dataset.step))));
        onClassField(input.id);
      });
    });

    [
      "title",
      "ages",
      "date",
      "startTime",
      "totalMin",
      "openingMin",
      "waterMin",
      "finishMin",
      "warmupCount",
      "lessonCount",
      "gameCount",
      "kidCount",
      "adultCount",
      "firstClass",
      "warmupMin",
      "baseMin",
      "lessonMin",
      "sparringMin",
      "gameMin",
      "themeLock",
    ].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", () => onClassField(id));
      el.addEventListener("change", () => onClassField(id));
    });

    listen("ageGroup", "click", (event) => {
      const btn = event.target.closest("button[data-group]");
      if (!btn) return;
      toggleAgeGroup(btn.dataset.group);
    });

    listen("instructorPick", "change", () => {
      const value = $("instructorPick").value;
      state.hadInstructor = true;
      if (value === "__saved__") state.instructorId = "";
      else {
        state.instructorId = value;
        const person = staffById(value);
        state.instructorName = person ? person.name : "";
      }
      state.assistantIds = assistantIdList().filter((id) => id !== state.instructorId);
      renderStaffPickers();
      syncPlanCounts();
    });
    listen("addAssistantBtn", "click", () => {
      const pick = $("assistantPick");
      if (!pick) return;
      const id = pick.value;
      const person = staffById(id);
      if (!person || !canAssist(person) || id === state.instructorId || assistantIdList().includes(id)) return;
      state.assistantIds.push(id);
      state.helpersApplied = true;
      state.freeHelperNames = [];
      renderStaffPickers();
      syncPlanCounts();
    });
    listen("assistantList", "click", (event) => {
      const btn = event.target.closest("[data-remove-assistant]");
      if (!btn) return;
      state.assistantIds = assistantIdList().filter((id) => id !== btn.dataset.removeAssistant);
      state.helpersApplied = true;
      state.freeHelperNames = [];
      renderStaffPickers();
      syncPlanCounts();
    });

    $("suggestDateBtn").addEventListener("click", () => {
      $("date").value = P.nextClassDate(new Date());
      onClassField("date");
      toast("Date set to the next class.");
    });
    $("rosterCountBtn").addEventListener("click", () => {
      $("kidCount").value = String(state.roster.length);
      onClassField("kidCount");
    });
    $("addKidBtn").addEventListener("click", addKid);
    $("rosterName").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addKid();
      }
    });
    $("rosterList").addEventListener("change", async (event) => {
      if (event.target.dataset.cardKid) {
        state.cardPick[event.target.dataset.cardKid] = event.target.checked;
        return;
      }
      const card = event.target.closest(".roster-card");
      if (!card) return;
      const kid = state.roster.find((item) => item.id === card.dataset.id);
      if (!kid) return;
      if (!isAdmin()) {
        toast("An admin edits belts and stripes.");
        renderRoster();
        return;
      }
      if (event.target.dataset.roster === "belt" && P.BELT_ORDER.includes(event.target.value)) kid.belt = event.target.value;
      if (event.target.dataset.roster === "stripes") kid.stripes = P.clampInt(event.target.value, 0, 4, 0);
      try {
        const saved = await window.BJJ_API.send("PATCH", `/api/students/${kid.id}`, kid);
        Object.assign(kid, P.sanitizeRosterKid(saved));
      } catch (err) {
        toast(err.message || "Could not update that student.");
        resync().catch(() => {});
        return;
      }
      renderRoster();
      if (state.plan) renderPlan();
    });
    $("rosterList").addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-roster='delete']");
      if (!btn) return;
      if (!isAdmin()) {
        toast("An admin removes students.");
        return;
      }
      const card = btn.closest(".roster-card");
      const id = card.dataset.id;
      try {
        await window.BJJ_API.send("DELETE", `/api/students/${id}`);
      } catch (err) {
        toast(err.message || "Could not remove that student.");
        return;
      }
      state.roster = state.roster.filter((kid) => kid.id !== id);
      renderRoster();
      syncPlanCounts();
    });

    $("generateBtn").addEventListener("click", () => {
      state.preset = "grace";
      state.themeOffset = 0;
      state.themeSkip = 0;
      buildPlan({ mode: "grace" });
      pickSheetForClass();
      toast("New Grace class generated.");
    });
    $("firstPlanBtn").addEventListener("click", () => loadFirstClass(false));
    $("rerollWarmBtn").addEventListener("click", () => {
      buildPlan({
        mode: state.plan?.mode || state.preset,
        keep: { lesson: idsOf("lesson"), game: idsOf("game"), base: idsOf("base") },
        prefer: { warmup: [] },
      });
      toast("Warm-ups shuffled.");
    });
    $("rerollLessonBtn").addEventListener("click", () => {
      const mode = state.plan?.mode || state.preset;
      if (mode === "grace" && $("themeLock").value) state.themeOffset += 1;
      else if (mode === "grace") state.themeSkip += 1;
      buildPlan({
        mode,
        keep: { warmup: idsOf("warmup"), game: idsOf("game"), base: idsOf("base") },
        prefer: { lesson: [], warmup: idsOf("warmup"), game: idsOf("game") },
        keepSession: true,
      });
      toast("Technique shuffled.");
    });
    $("rerollGameBtn").addEventListener("click", () => {
      buildPlan({
        mode: state.plan?.mode || state.preset,
        keep: { warmup: idsOf("warmup"), lesson: idsOf("lesson"), base: idsOf("base") },
        prefer: { game: [] },
      });
      toast("Play shuffled.");
    });

    $("printBtn").addEventListener("click", () => {
      delete document.body.dataset.print;
      setView("plan");
      window.print();
    });
    $("printLessonBtn").addEventListener("click", () => {
      document.body.dataset.print = "lesson";
      setView("plan");
      const finish = () => {
        delete document.body.dataset.print;
        window.removeEventListener("afterprint", finish);
      };
      window.addEventListener("afterprint", finish);
      window.print();
    });
    $("editToggle").addEventListener("click", () => {
      state.showItemShuffle = !state.showItemShuffle;
      $("editToggle").textContent = state.showItemShuffle ? "Hide shuffle on items" : "Show shuffle on items";
      renderPlan();
    });

    $("libTabs").addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-cat]");
      if (!btn) return;
      state.libCat = btn.dataset.cat;
      [...$("libTabs").children].forEach((child) => child.classList.toggle("on", child === btn));
      renderLibrary();
    });

    $("addBtn").addEventListener("click", () => openModal(null));
    $("cancelModal").addEventListener("click", closeModal);
    $("modalBack").addEventListener("click", (event) => {
      if (event.target === $("modalBack")) closeModal();
    });
    $("activityForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const activity = formActivity();
      if (!activity.name) {
        toast("Give it a name.");
        return;
      }
      const cleaned = P.sanitizeActivity(activity, builtinIds());
      if (!cleaned.ok) {
        toast(cleaned.reason);
        return;
      }
      const idx = state.custom.findIndex((item) => item.id === cleaned.activity.id);
      if (idx >= 0) state.custom[idx] = cleaned.activity;
      else state.custom.push(cleaned.activity);
      state.reps[cleaned.activity.id] = cleaned.activity.reps;
      state.libCat = cleaned.activity.category;
      [...$("libTabs").children].forEach((child) => {
        child.classList.toggle("on", child.dataset.cat === cleaned.activity.category);
      });
      save();
      renderLibrary();
      updateMeta();
      closeModal();
      toast(`Saved “${cleaned.activity.name}”.`);
    });

    $("libraryList").addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-act]");
      const card = event.target.closest(".card");
      if (!btn || !card) return;
      const id = card.dataset.id;
      const act = btn.dataset.act;
      const item = findActivity(id);
      if (act === "reps") {
        bumpReps(id, Number(btn.dataset.delta), state.libCat);
        return;
      }
      if (act === "pin") {
        state.pinned = state.pinned.includes(id)
          ? state.pinned.filter((value) => value !== id)
          : state.pinned.concat(id);
      }
      if (act === "toggle") {
        state.disabled = state.disabled.includes(id)
          ? state.disabled.filter((value) => value !== id)
          : state.disabled.concat(id);
      }
      if (act === "delete") {
        state.custom = state.custom.filter((activity) => activity.id !== id);
        state.pinned = state.pinned.filter((value) => value !== id);
        state.disabled = state.disabled.filter((value) => value !== id);
        delete state.reps[id];
        ["warmup", "base", "lesson", "games"].forEach((key) => {
          if (!state.plan?.[key]?.items) return;
          state.plan[key].items = state.plan[key].items.filter((entry) => entry.id !== id);
          if (!state.plan[key].items.length) delete state.plan[key];
        });
        toast("Removed from the library.");
        if (state.plan) retimePlan();
      }
      if (act === "edit") openModal(item);
      if (act === "copy") {
        openModal({ ...item, id: "", builtin: false, name: `${item.name} (yours)` });
        return;
      }
      save();
      renderLibrary();
      updateMeta();
    });

    $("plan").addEventListener("input", (event) => {
      const input = event.target.closest("[data-plan-search]");
      if (!input) return;
      state.planQuery[input.dataset.planSearch] = input.value;
      state.planFocus = { kind: "search", section: input.dataset.planSearch, pos: input.selectionStart };
      renderPlan();
    });

    const REORDER_SLOP = 8;
    let reorderDrag = null;
    let swallowPlanClick = false;

    function clearReorderMarks() {
      document.body.classList.remove("is-reordering");
      document.querySelectorAll("#plan .item.is-dragging, #plan .item.drop-before, #plan .item.drop-after").forEach((el) => {
        el.classList.remove("is-dragging", "drop-before", "drop-after");
      });
    }

    function sectionItems(section) {
      return [...document.querySelectorAll("#plan .item[data-plan-section]")].filter(
        (item) => item.dataset.planSection === section && !item.classList.contains("is-search-hidden") && item.dataset.id
      );
    }

    function markReorderDrop(clientY) {
      document.querySelectorAll("#plan .item.drop-before, #plan .item.drop-after").forEach((el) => {
        el.classList.remove("drop-before", "drop-after");
      });
      if (!reorderDrag) return;
      const items = sectionItems(reorderDrag.section).filter((item) => item.dataset.id !== reorderDrag.id);
      let choice = null;
      items.forEach((item) => {
        if (choice && choice.placement === "before") return;
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) choice = { id: item.dataset.id, placement: "before", el: item };
        else choice = { id: item.dataset.id, placement: "after", el: item };
      });
      reorderDrag.targetId = choice ? choice.id : "";
      reorderDrag.placement = choice ? choice.placement : "before";
      if (choice) choice.el.classList.add(choice.placement === "before" ? "drop-before" : "drop-after");
    }

    function scrollReorderEdge() {
      if (!reorderDrag || !reorderDrag.active) {
        if (reorderDrag) reorderDrag.frame = 0;
        return;
      }
      const edge = 72;
      const y = reorderDrag.clientY;
      let delta = 0;
      if (y < edge) delta = -Math.max(6, Math.ceil((edge - y) / 3));
      else if (y > window.innerHeight - edge) delta = Math.max(6, Math.ceil((y - (window.innerHeight - edge)) / 3));
      if (delta && document.scrollingElement) {
        document.scrollingElement.scrollTop += delta;
        markReorderDrop(y);
      }
      reorderDrag.frame = requestAnimationFrame(scrollReorderEdge);
    }

    function stopReorderDrag() {
      if (reorderDrag && reorderDrag.frame) cancelAnimationFrame(reorderDrag.frame);
      reorderDrag = null;
      clearReorderMarks();
    }

    $("plan").addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".reorder-handle");
      if (!handle || event.button > 0) return;
      if (!P.REORDER_SECTIONS.includes(handle.dataset.reorder)) return;
      handle.focus();
      reorderDrag = {
        pointerId: event.pointerId,
        section: handle.dataset.reorder,
        id: handle.dataset.id,
        startX: event.clientX,
        startY: event.clientY,
        clientY: event.clientY,
        active: false,
        targetId: "",
        placement: "before",
        frame: 0,
      };
      try { handle.setPointerCapture(event.pointerId); } catch (err) { /* the pointer can end before capture */ }
    });
    $("plan").addEventListener("pointermove", (event) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      const dx = event.clientX - reorderDrag.startX;
      const dy = event.clientY - reorderDrag.startY;
      if (!reorderDrag.active) {
        if (dx * dx + dy * dy < REORDER_SLOP * REORDER_SLOP) return;
        reorderDrag.active = true;
        swallowPlanClick = true;
        document.body.classList.add("is-reordering");
        const source = sectionItems(reorderDrag.section).find((item) => item.dataset.id === reorderDrag.id);
        if (source) source.classList.add("is-dragging");
        reorderDrag.frame = requestAnimationFrame(scrollReorderEdge);
      }
      event.preventDefault();
      reorderDrag.clientY = event.clientY;
      markReorderDrop(event.clientY);
    }, { passive: false });
    $("plan").addEventListener("pointerup", (event) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      if (reorderDrag.active) markReorderDrop(event.clientY);
      const pending = reorderDrag.active
        ? {
            section: reorderDrag.section,
            id: reorderDrag.id,
            targetId: reorderDrag.targetId,
            placement: reorderDrag.placement,
          }
        : null;
      stopReorderDrag();
      if (!pending || !pending.targetId) return;
      applyReorder(pending.section, pending.id, pending.targetId, pending.placement);
    });
    $("plan").addEventListener("pointercancel", (event) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      stopReorderDrag();
    });
    $("plan").addEventListener("keydown", (event) => {
      const handle = event.target.closest(".reorder-handle");
      if (!handle) return;
      if (event.key === "Escape" && reorderDrag) {
        event.preventDefault();
        stopReorderDrag();
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      applyReorderStep(handle.dataset.reorder, handle.dataset.id, event.key === "ArrowUp" ? -1 : 1);
    });
    document.addEventListener("keydown", (event) => {
      if (!reorderDrag || event.key !== "Escape") return;
      event.preventDefault();
      stopReorderDrag();
    });

    $("plan").addEventListener("click", (event) => {
      if (swallowPlanClick) {
        swallowPlanClick = false;
        event.preventDefault();
        return;
      }
      const step = event.target.closest("[data-move]");
      if (step) {
        if (step.disabled) return;
        applyReorderStep(step.dataset.reorder, step.dataset.id, step.dataset.move === "up" ? -1 : 1);
        return;
      }
      const clear = event.target.closest("[data-plan-clear]");
      if (clear) {
        if (clear.disabled) return;
        const section = clear.dataset.planClear;
        state.planQuery[section] = "";
        state.planFocus = { kind: "search", section, pos: 0 };
        renderPlan();
        return;
      }
      const override = event.target.closest("[data-plan-override]");
      if (override) {
        const section = override.dataset.planOverride;
        const id = override.dataset.id;
        const key = blockKey(section);
        const ids = (state.plan?.[key]?.items || []).map((item) => item.id);
        if (!ids.includes(id)) ids.unshift(id);
        state.planFocus = { kind: "toggle", section, id };
        setSectionItems(section, ids, { overrideId: id });
        return;
      }
      const toggle = event.target.closest("[data-plan-toggle]");
      if (toggle) {
        const section = toggle.dataset.planToggle;
        const id = toggle.dataset.id;
        const key = blockKey(section);
        const ids = (state.plan?.[key]?.items || []).map((item) => item.id);
        state.planFocus = { kind: "toggle", section, id };
        setSectionItems(section, P.togglePlanIds(ids, id));
        return;
      }
      const repsBtn = event.target.closest("[data-reps]");
      if (repsBtn) {
        bumpReps(repsBtn.dataset.id, Number(repsBtn.dataset.reps), repsBtn.dataset.section, true);
        return;
      }
      const btn = event.target.closest("[data-swap]");
      if (!btn) return;
      swapOne(btn.dataset.swap, btn.dataset.id);
    });

    $("exportBtn").addEventListener("click", () => exportBackup());
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        stashImport(data);
        const result = importLibrary(data, { replace: false, skipAttendance: true });
        if (!result.ok) {
          toast(result.reason);
          return;
        }
        const sheets = await importUploads(data.uploads);
        save();
        renderLibrary();
        renderRoster();
        updateMeta();
        if (state.plan) renderPlan();
        renderSheet();
        renderSheetList();
        const skip = result.skipped ? ` Skipped ${result.skipped}.` : "";
        const remap = result.remapped ? ` Remapped ${result.remapped} id${result.remapped === 1 ? "" : "s"}.` : "";
        toast(`Imported ${result.kept} activities${sheets ? ` and ${sheets} sheets` : ""}.${skip}${remap}`);
        const banner = $("importBanner");
        if (banner) banner.classList.toggle("hidden", !localStorage.getItem(IMPORT_KEY));
      } catch {
        toast("Could not read that file.");
      }
    });

    $("firstSheetBtn").addEventListener("click", () => setSheet("first-gi"));
    $("randomSheetBtn").addEventListener("click", () => setSheet(randomSheetId(state.sheetId)));
    $("uploadSheetBtn").addEventListener("click", () => $("sheetFile").click());
    $("sheetFile").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (file) await handleSheetUpload(file);
    });
    $("sheetList").addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-act]");
      const card = event.target.closest("[data-sheet]");
      if (!btn || !card) return;
      const id = card.dataset.sheet;
      if (btn.dataset.act === "use") setSheet(id);
      if (btn.dataset.act === "edit-sheet") openSheetEditor(id);
      if (btn.dataset.act === "clear-sheet") {
        await writeSheetPrompts(id, state.uploads.find((sheet) => sheet.id === id)?.title, []);
        toast("Cleared prompts and arrows.");
      }
      if (btn.dataset.act === "delete-sheet") {
        await deleteUpload(id);
        if (state.sheetId === id) setSheet(randomSheetId(id), true);
        else {
          renderSheetList();
          save();
        }
        toast("Removed that coloring sheet.");
      }
      if (btn.dataset.act === "publish-sheet") {
        const sheet = state.uploads.find((item) => item.id === id);
        if (!sheet || !isAdmin()) return;
        try {
          const saved = await window.BJJ_API.send("POST", "/api/sheets", {
            clientId: sheet.id,
            title: sheet.title || sheet.name,
            theme: "custom",
            caption: "",
            image: sheet.src,
            published: true,
          });
          const idx = state.serverSheets.findIndex((row) => row.id === saved.id || row.clientId === sheet.id);
          if (idx >= 0) state.serverSheets[idx] = saved;
          else state.serverSheets.push(saved);
          renderSheetList();
          toast("Parents can open that sheet from the coloring page.");
        } catch (err) {
          toast(err.message || "Could not publish that sheet.");
        }
      }
    });
    $("sheetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $("sheetEditId").value;
      const lines = $("sheetEditPrompts").value.split("\n").map((line) => line.trim()).filter(Boolean);
      await writeSheetPrompts(id, $("sheetEditTitle").value, lines);
      closeSheetEditor();
      toast("Saved coloring prompts.");
    });
    $("clearSheetPrompts").addEventListener("click", async () => {
      const id = $("sheetEditId").value;
      await writeSheetPrompts(id, $("sheetEditTitle").value, []);
      closeSheetEditor();
      toast("Cleared prompts and arrows.");
    });
    $("cancelSheetModal").addEventListener("click", closeSheetEditor);
    $("sheetModal").addEventListener("click", (event) => {
      if (event.target === $("sheetModal")) closeSheetEditor();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
        closeSheetEditor();
        document.body.classList.remove("menu-open");
        if ($("menuToggle")) $("menuToggle").setAttribute("aria-expanded", "false");
      }
    });

    $("viewSwitch").addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-view]");
      if (btn) setView(btn.dataset.view);
    });
    $("reviewView").addEventListener("click", (event) => {
      const attend = event.target.closest("[data-attend]");
      if (attend) {
        attend.classList.toggle("on");
        return;
      }
      const level = event.target.closest("[data-level]");
      if (level) {
        const keep = new Set(
          [...document.querySelectorAll("#reviewView .chip.on")].map((btn) => btn.dataset.attend)
        );
        setLevel(level.dataset.kid, level.dataset.tech, level.dataset.level);
        window.BJJ_API.send("PUT", "/api/levels", {
          studentId: level.dataset.kid,
          techId: level.dataset.tech,
          level: level.dataset.level,
        }).catch((err) => {
          toast(err.message || "Could not save that level.");
          resync().catch(() => {});
        });
        renderReview(keep);
        return;
      }
      if (event.target.closest("#saveClassBtn")) saveReviewedClass();
    });
    $("progressView").addEventListener("change", (event) => {
      if (event.target.name === "pastAge") {
        refreshPastClassFields();
        return;
      }
      if (event.target.id === "pastTheme") {
        $("pastTechs").innerHTML = pastTechMarkup(pastCurriculumAge(), event.target.value);
        return;
      }
      if (event.target.id !== "stripeOwn" && event.target.id !== "stripeAttend") return;
      state.progress.stripe.own = P.clampInt($("stripeOwn").value, 1, 40, 6);
      state.progress.stripe.attend = P.clampInt($("stripeAttend").value, 1, 40, 8);
      window.BJJ_API.send("PUT", "/api/stripe", state.progress.stripe).catch((err) => {
        toast(err.message || "Could not save the stripe hint.");
      });
      renderProgress();
    });
    $("progressView").addEventListener("input", (event) => {
      if (!event.target.dataset.note) return;
      state.progress.notes[event.target.dataset.note] = event.target.value.slice(0, 800);
      const studentId = event.target.dataset.note;
      const note = state.progress.notes[studentId];
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        window.BJJ_API.send("PUT", "/api/notes", { studentId, note }).catch((err) => {
          toast(err.message || "Could not save that note.");
        });
      }, 400);
    });
    $("progressView").addEventListener("click", (event) => {
      const pastKid = event.target.closest("[data-past-kid]");
      if (pastKid) {
        pastKid.classList.toggle("on");
        return;
      }
      const classKid = event.target.closest("[data-class-kid]");
      if (classKid) {
        classKid.classList.toggle("on");
        return;
      }
      if (event.target.closest("#pastSaveBtn")) {
        savePastClass();
        return;
      }
      const saveAttend = event.target.closest("[data-save-attend]");
      if (saveAttend) {
        saveLoggedAttendance(saveAttend.dataset.saveAttend);
        return;
      }
      const removeClass = event.target.closest("[data-remove-class]");
      if (removeClass) {
        removeLoggedClass(removeClass.dataset.removeClass);
        return;
      }
      const levelBtn = event.target.closest("[data-prog-level]");
      if (levelBtn) {
        setProgressLevel(levelBtn.dataset.progKid, levelBtn.dataset.progTech, levelBtn.dataset.progLevel);
        return;
      }
      const addTech = event.target.closest("[data-add-tech-btn]");
      if (addTech) {
        const kidId = addTech.dataset.addTechBtn;
        const select = document.querySelector(`#progressView [data-add-tech="${kidId}"]`);
        const techId = select && select.value;
        if (!techId) return;
        state.levelDrafts[kidId] = state.levelDrafts[kidId] || [];
        const have = (state.progress.levels[kidId] || {})[techId];
        if (!have && !state.levelDrafts[kidId].includes(techId)) state.levelDrafts[kidId].push(techId);
        renderProgress();
        return;
      }
      const btn = event.target.closest("[data-print-kid]");
      if (!btn) return;
      const kid = state.roster.find((item) => item.id === btn.dataset.printKid);
      if (!kid) return;
      state.cardLayout = "progress";
      $("cardView").innerHTML = progressSheetHtml(kid);
      setView("cards");
    });
    $("cardView").addEventListener("change", (event) => {
      if (!event.target.dataset.cardKid) return;
      state.cardPick[event.target.dataset.cardKid] = event.target.checked;
      renderCardSurface(state.cardLayout);
    });
    $("cameraBtn").addEventListener("click", () => startCamera());
    $("cameraStop").addEventListener("click", () => {
      stopCamera();
      $("checkinStatus").textContent = "Camera stopped.";
      $("checkinStatus").className = "checkin-status";
    });
    $("photoBtn").addEventListener("click", () => $("photoFile").click());
    $("photoFile").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (file) await decodePhoto(file);
    });
    $("checkinDate").addEventListener("change", () => renderCheckinList());
    $("printFullBtn").addEventListener("click", () => showCards("full"));
    $("printWalletBtn").addEventListener("click", () => showCards("wallet"));
    $("printSigninBtn").addEventListener("click", () => showCards("signin"));
    if ($("blankWalletBtn")) $("blankWalletBtn").addEventListener("click", () => printBlankCards("blank-wallet"));
    if ($("blankFullBtn")) $("blankFullBtn").addEventListener("click", () => printBlankCards("blank-full"));
    if ($("claimForm")) $("claimForm").addEventListener("submit", (event) => submitClaim(event));
    if ($("claimCancel")) $("claimCancel").addEventListener("click", () => {
      closeClaim();
      $("checkinStatus").textContent = "Card not linked.";
      $("checkinStatus").className = "checkin-status";
    });
    if ($("cardRecordList")) {
      $("cardRecordList").addEventListener("click", async (event) => {
        const retire = event.target.closest("[data-retire-card]");
        const link = event.target.closest("[data-link-card]");
        if (!retire && !link) return;
        const code = (retire || link).dataset.retireCard || (retire || link).dataset.linkCard;
        try {
          if (retire) {
            const saved = await window.BJJ_API.send("POST", `/api/cards/${code}/retire`);
            rememberCard(saved.card);
            toast("Card retired.");
          } else {
            const select = $("cardRecordList").querySelector(`[data-relink="${CSS.escape(code)}"]`);
            const studentId = select ? select.value : "";
            if (!studentId) {
              toast("Choose a student on the roster.");
              return;
            }
            const saved = await window.BJJ_API.send("PATCH", `/api/cards/${code}`, { studentId });
            rememberCard(saved.card);
            toast("Card linked.");
          }
          renderCardRecords();
        } catch (err) {
          toast(err.message || "Could not update that card.");
        }
      });
    }
    $("printTheseBtn").addEventListener("click", () => printCards());
    window.addEventListener("beforeprint", () => {
      if (state.view === "cards" && !document.body.dataset.print) {
        document.body.dataset.print = state.cardLayout === "progress" ? "progress" : "cards";
      }
    });
    window.addEventListener("afterprint", () => {
      delete document.body.dataset.print;
    });

    const menuToggle = $("menuToggle");
    const menuScrim = $("menuScrim");
    if (menuToggle) {
      menuToggle.addEventListener("click", () => {
        const open = !document.body.classList.contains("menu-open");
        document.body.classList.toggle("menu-open", open);
        menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open && $("sidebar")) $("sidebar").focus();
      });
    }
    if (menuScrim) menuScrim.addEventListener("click", () => {
      document.body.classList.remove("menu-open");
      if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    });

    $("logoutBtn").addEventListener("click", async () => {
      try {
        await window.BJJ_API.send("POST", "/api/logout");
      } catch (err) {
        /* still leave the page */
      }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "logout" });
      }
      if (window.caches) {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith("grace-staff-")).map((name) => caches.delete(name)));
      }
      window.location.href = "/";
    });
    $("passwordForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const current = $("currentPassword").value;
      const next = $("nextPassword").value;
      const problem = passwordChangeError(current, next);
      if (problem) {
        setFormNote("passwordNote", problem);
        toast(problem);
        return;
      }
      try {
        await window.BJJ_API.send("POST", "/api/password", { current, next });
        $("currentPassword").value = "";
        $("nextPassword").value = "";
        setFormNote("passwordNote", "Password changed.", true);
        toast("Password changed.");
      } catch (err) {
        const message = err.message || "Could not change the password.";
        setFormNote("passwordNote", message);
        toast(message);
      }
    });
    $("featuredSave").addEventListener("click", async () => {
      try {
        state.featured = await window.BJJ_API.send("PUT", "/api/featured", {
          sheetId: $("featuredSheet").value,
          caption: $("featuredCaption").value,
        });
        toast("Parents will see that sheet on the coloring page.");
      } catch (err) {
        toast(err.message || "Could not update this week's sheet.");
      }
    });
    $("importLocalBtn").addEventListener("click", async () => {
      const raw = localStorage.getItem(IMPORT_KEY);
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        const progress = { ...(data.progress || {}) };
        delete progress.stripe;
        await window.BJJ_API.send("POST", "/api/import", {
          roster: data.roster || [],
          progress,
        });
        localStorage.removeItem(IMPORT_KEY);
        await resync();
        toast("Imported the saved roster and attendance.");
      } catch (err) {
        toast(err.message || "Could not import that roster.");
      }
    });
    $("userForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = $("newUsername").value.trim();
      const password = $("newUserPassword").value;
      if (username.length < 3) {
        setFormNote("userNote", "Usernames are 3–32 letters, numbers, dots, or dashes.");
        toast("Usernames are 3–32 letters, numbers, dots, or dashes.");
        return;
      }
      if (password.length < 10) {
        setFormNote("userNote", "Use at least 10 characters.");
        toast("Use at least 10 characters.");
        return;
      }
      try {
        await window.BJJ_API.send("POST", "/api/users", {
          username,
          password,
          role: $("newUserRole").value,
        });
        $("newUsername").value = "";
        $("newUserPassword").value = "";
        setFormNote("userNote", "Login added.", true);
        toast("Login added.");
        await refreshUsers();
        await refreshStaff();
      } catch (err) {
        const message = err.message || "Could not add that login.";
        setFormNote("userNote", message);
        toast(message);
      }
    });
    $("exportServerBtn").addEventListener("click", async () => {
      try {
        const data = await window.BJJ_API.send("GET", "/api/export");
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "grace-bjj-attendance.json";
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (err) {
        toast(err.message || "Could not download the attendance backup.");
      }
    });
    $("userList").addEventListener("click", async (event) => {
      const reset = event.target.closest("button[data-reset]");
      if (reset) {
        openResetPassword(reset.dataset.reset, reset.dataset.username || "");
        return;
      }
      const btn = event.target.closest("button[data-user]");
      if (!btn) return;
      try {
        await window.BJJ_API.send("DELETE", `/api/users/${btn.dataset.user}`);
        toast("Login removed.");
        await refreshUsers();
        await refreshStaff();
      } catch (err) {
        toast(err.message || "Could not remove that login.");
      }
    });
    listen("helperForm", "submit", async (event) => {
      event.preventDefault();
      const name = $("helperName").value.trim();
      if (!name) {
        setFormNote("helperNote", "Add the person's name.");
        return;
      }
      try {
        await window.BJJ_API.send("POST", "/api/staff", {
          name,
          belt: $("helperBelt").value,
          stripes: Number($("helperStripes").value),
        });
        $("helperName").value = "";
        setFormNote("helperNote", "Helper added.", true);
        await refreshStaff();
      } catch (err) {
        setFormNote("helperNote", err.message || "Could not add that helper.");
      }
    });
    listen("staffList", "change", async (event) => {
      const row = event.target.closest("[data-staff-id]");
      if (!row) return;
      const id = row.dataset.staffId;
      const name = row.querySelector("[data-staff-name]").value.trim();
      const belt = row.querySelector("[data-staff-belt]").value;
      const stripes = Number(row.querySelector("[data-staff-stripes]").value);
      if (!name) {
        toast("Add the person's name.");
        renderStaffAdmin();
        return;
      }
      try {
        const saved = normalizeStaff(
          await window.BJJ_API.send("PATCH", `/api/staff/${id}`, { name, belt, stripes })
        );
        const idx = state.staff.findIndex((item) => item.id === id);
        if (saved && idx >= 0) state.staff[idx] = saved;
        renderStaffPickers();
        syncPlanCounts();
      } catch (err) {
        toast(err.message || "Could not update that person.");
        renderStaffAdmin();
      }
    });
    listen("staffList", "click", async (event) => {
      const btn = event.target.closest("[data-staff-remove]");
      if (!btn) return;
      try {
        await window.BJJ_API.send("DELETE", `/api/staff/${btn.dataset.staffRemove}`);
        state.staff = state.staff.filter((person) => person.id !== btn.dataset.staffRemove);
        state.assistantIds = state.assistantIds.filter((id) => id !== btn.dataset.staffRemove);
        if (state.instructorId === btn.dataset.staffRemove) {
          state.instructorId = "";
          state.instructorName = "";
        }
        renderStaffAdmin();
        renderStaffPickers();
        syncPlanCounts();
        toast("Helper removed.");
      } catch (err) {
        toast(err.message || "Could not remove that helper.");
      }
    });
  }

  function openResetPassword(userId, username) {
    const dialog = $("resetPasswordDialog");
    if (!dialog || !userId) return;
    dialog.dataset.userId = userId;
    $("resetPasswordWho").textContent = `Set a temporary password for ${username}.`;
    $("resetPasswordInput").value = "";
    $("resetPasswordReveal").hidden = true;
    $("resetPasswordValue").textContent = "";
    $("resetPasswordSubmit").hidden = false;
    setFormNote("resetPasswordNote", "");
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function closeResetPassword() {
    const dialog = $("resetPasswordDialog");
    if ($("resetPasswordInput")) $("resetPasswordInput").value = "";
    if ($("resetPasswordValue")) $("resetPasswordValue").textContent = "";
    if ($("resetPasswordReveal")) $("resetPasswordReveal").hidden = true;
    if (dialog && dialog.open) dialog.close();
    if (dialog) delete dialog.dataset.userId;
  }

  async function refreshUsers() {
    if (!isAdmin() || !$("userList")) return;
    const body = await window.BJJ_API.send("GET", "/api/users");
    const mine = state.session && state.session.id;
    $("userList").innerHTML = (body.users || [])
      .map((user) => {
        const pending = user.mustChangePassword ? " · temporary password" : "";
        const reset = user.id === mine
          ? ""
          : `<button class="ghost" type="button" data-reset="${esc(user.id)}" data-username="${esc(user.username)}">Reset password</button>`;
        return `<p><span>${esc(user.username)} · ${esc(user.role)}${pending}</span>${reset}<button class="ghost" type="button" data-user="${esc(user.id)}">Remove</button></p>`;
      })
      .join("");
  }

  function onClassField(id) {
    if (id === "date") {
      writeClassCounts();
      if (state.plan) retimePlan();
      else {
        updateScheduleHint();
        save();
      }
      return;
    }
    if (id === "kidCount") state.ratioSource = "edited";
    if (id === "firstClass" && state.plan) {
      const toddler = state.plan.mode === "toddler";
      $("openingMin").value = $("firstClass").checked ? (toddler ? "13" : "8") : toddler ? "8" : "2";
      const title = $("title");
      if ($("firstClass").checked && /GRACE BJJ KIDS|KIDS BJJ CLASS/.test(title.value)) {
        title.value = toddler ? "FIRST BJJ CLASS" : "FIRST GRACE CLASS";
      }
      if (!$("firstClass").checked && title.value.startsWith("FIRST ")) {
        title.value = toddler ? "KIDS BJJ CLASS" : "GRACE BJJ KIDS";
      }
      const settings = readSettings();
      settings.preset = toddler ? "toddler" : "grace";
      state.plan.opening = { items: openingItems(settings) };
    }
    if (id === "warmupCount" || id === "lessonCount" || id === "gameCount") {
      const section = id === "warmupCount" ? "warmup" : id === "lessonCount" ? "lesson" : "game";
      resizeSection(section, Math.round(Number($(id).value) || 0));
      return;
    }
    if (id === "themeLock") {
      state.themeOffset = 0;
      state.preset = "grace";
      buildPlan({ mode: "grace" });
      return;
    }
    if (["totalMin", "openingMin", "warmupMin", "baseMin", "lessonMin", "waterMin", "sparringMin", "gameMin", "finishMin", "startTime", "kidCount", "adultCount", "firstClass"].includes(id)) {
      if (state.plan) retimePlan();
      else {
        updateTimeSum();
        updateScheduleHint();
        save();
      }
      return;
    }
    if (state.plan) {
      const settings = readSettings();
      settings.preset = state.plan.mode === "toddler" ? "toddler" : "grace";
      state.plan.settings = settings;
      renderPlan();
    }
    updateScheduleHint();
    updateTimeSum();
    save();
  }

  async function startApp() {
    load();
    runPanel("Belt list", fillBeltSelect);
    runPanel("Theme list", fillThemeLock);
    runPanel("Controls", bind);
    runPanel("Camera help", cameraHelp);
    window.BJJ_APP = {
      decodeSource,
      markPresent,
      qrDataUrl,
      showCards,
      snapshot: () => ({
        roster: state.roster,
        progress: state.progress,
        plan: state.plan,
        view: state.view,
      }),
    };
    if ($("date") && !$("date").value) $("date").value = P.nextClassDate(new Date());
    runPanel("Staff", () => {
      renderStaffPickers();
      renderStaffAdmin();
      writeClassCounts();
    });
    try {
      await loadUploads();
    } catch (err) {
      reportPanel("Uploads", err);
    }
    runPanel("Library", renderLibrary);
    runPanel("Roster", renderRoster);
    runPanel("Class clock", updateMeta);
    runPanel("Plan", () => {
      if (state.plan) retimePlan();
      else buildPlan({ mode: "grace" });
    });
    runPanel("Coloring", () => {
      if (!allSheets().some((sheet) => sheet.id === state.sheetId)) state.sheetId = "first-gi";
      renderSheet();
      renderSheetList();
      fillFeatured();
    });
    runPanel("Schedule", updateScheduleHint);
    if (isAdmin()) refreshUsers().catch((err) => reportPanel("Logins", err));
    document.body.classList.add("authed");
    const gate = $("gate");
    if (gate) gate.hidden = true;
  }

  let mustChangeBound = false;

  function showMustChange(username) {
    document.body.classList.add("must-change");
    document.body.classList.remove("authed");
    const panel = $("mustChange");
    const gate = $("gate");
    if (gate) gate.hidden = true;
    if (panel) panel.hidden = false;
    const who = $("mustChangeWho");
    if (who) {
      who.textContent = username
        ? `${username} has a temporary password. Choose a new one before using the staff page.`
        : "This login has a temporary password. Choose a new one before using the staff page.";
    }
    if (mustChangeBound) return;
    mustChangeBound = true;
    $("mustChangeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const current = $("mustCurrent").value;
      const next = $("mustNext").value;
      const problem = passwordChangeError(current, next);
      if (problem) {
        setFormNote("mustChangeNote", problem);
        return;
      }
      try {
        await window.BJJ_API.send("POST", "/api/password", { current, next });
        $("mustCurrent").value = "";
        $("mustNext").value = "";
        if (panel) panel.hidden = true;
        document.body.classList.remove("must-change");
        await boot();
      } catch (err) {
        setFormNote("mustChangeNote", err.message || "Could not change the password.");
      }
    });
    $("mustChangeLogout").addEventListener("click", async () => {
      try {
        await window.BJJ_API.send("POST", "/api/logout");
      } catch (err) {
        /* still leave the page */
      }
      window.location.href = "/";
    });
  }

  function bindResetPassword() {
    const form = $("resetPasswordForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    $("generatePasswordBtn").addEventListener("click", () => {
      $("resetPasswordInput").value = generateTemporaryPassword();
      $("resetPasswordInput").focus();
      $("resetPasswordInput").select();
    });
    $("resetPasswordClose").addEventListener("click", closeResetPassword);
    $("resetPasswordDialog").addEventListener("close", () => {
      if ($("resetPasswordInput")) $("resetPasswordInput").value = "";
      if ($("resetPasswordValue")) $("resetPasswordValue").textContent = "";
      if ($("resetPasswordReveal")) $("resetPasswordReveal").hidden = true;
      if ($("resetPasswordSubmit")) $("resetPasswordSubmit").hidden = false;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const dialog = $("resetPasswordDialog");
      const password = $("resetPasswordInput").value;
      if (password.length < 10) {
        setFormNote("resetPasswordNote", "Use at least 10 characters.");
        return;
      }
      try {
        await window.BJJ_API.send("POST", `/api/users/${dialog.dataset.userId}/password`, { password });
        $("resetPasswordValue").textContent = password;
        $("resetPasswordInput").value = "";
        $("resetPasswordReveal").hidden = false;
        $("resetPasswordSubmit").hidden = true;
        setFormNote("resetPasswordNote", "Password reset.", true);
        await refreshUsers();
      } catch (err) {
        setFormNote("resetPasswordNote", err.message || "Could not reset that password.");
      }
    });
  }

  async function boot() {
    try {
      const body = await window.BJJ_API.bootstrap();
      applyBootstrap(body);
      await startApp();
    } catch (err) {
      console.error(err);
      if (err && err.status === 401) {
        window.location.replace("/login/");
        return;
      }
      if (err && err.status === 403 && err.mustChangePassword) {
        showMustChange(err.username || "");
        return;
      }
      const gate = $("gate");
      if (!gate) return;
      const detail = err && err.message ? String(err.message) : "Unknown error";
      gate.textContent =
        err && err.status
          ? `The attendance server could not load this page (${err.status}). ${detail}`
          : `The staff page could not finish loading. ${detail}`;
    }
  }

  boot();
})();
