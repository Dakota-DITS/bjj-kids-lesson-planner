(() => {
  const DATA = window.BJJ_DATA;
  const STORAGE_KEY = "bjj-kids-lesson-planner-v1";

  const FIRST_CLASS_IDS = {
    warmup: [
      "wu-light-jog",
      "wu-gorilla",
      "wu-bear",
      "wu-frog",
      "wu-worm",
      "wu-mat-slaps",
    ],
    lesson: ["ls-burrito", "ls-race-stand", "ls-capture-flag"],
    game: ["gm-grab-donuts", "gm-protect-donuts"],
  };

  const state = {
    custom: [],
    disabled: [],
    pinned: [],
    reps: {},
    plan: null,
    libCat: "warmup",
    showItemShuffle: false,
    leadRole: "Instructor",
    warmupPace: "mixed",
    sheetId: "first-gi",
    uploads: [],
  };

  const $ = (id) => document.getElementById(id);

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function leadRole() {
    return state.leadRole === "Coach" ? "Coach" : "Instructor";
  }

  function fill(str, extra = {}) {
    if (!str) return "";
    const instructor = $("instructor").value.trim() || "Dakota";
    const helper = $("helper").value.trim() || "________";
    const role = leadRole();
    const reps = extra.reps != null ? extra.reps : extra.item?.reps;
    return String(str)
      .replaceAll("{instructor}", instructor)
      .replaceAll("{helper}", helper)
      .replaceAll("{role}", role)
      .replaceAll("{lead}", `${role} ${instructor}`)
      .replaceAll("{name}", extra.name || "this friend")
      .replaceAll("{reps}", String(reps != null ? reps : ""));
  }

  function asList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function uid() {
    return "c-" + Math.random().toString(36).slice(2, 10);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.custom = Array.isArray(parsed.custom) ? parsed.custom : [];
      state.disabled = Array.isArray(parsed.disabled) ? parsed.disabled : [];
      state.pinned = Array.isArray(parsed.pinned) ? parsed.pinned : [];
      state.reps = parsed.reps && typeof parsed.reps === "object" ? parsed.reps : {};
      if (parsed.settings) applySettings(parsed.settings);
      if (parsed.settings?.sheetId) state.sheetId = parsed.settings.sheetId;
    } catch (err) {
      console.warn("Could not load saved library", err);
    }
  }

  function save() {
    const payload = {
      custom: state.custom,
      disabled: state.disabled,
      pinned: state.pinned,
      reps: state.reps,
      settings: readSettings(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function applySettings(s) {
    const map = {
      title: "title",
      instructor: "instructor",
      helper: "helper",
      ages: "ages",
      kids: "kids",
      date: "date",
      totalMin: "totalMin",
      openingMin: "openingMin",
      waterMin: "waterMin",
      finishMin: "finishMin",
      warmupCount: "warmupCount",
      lessonCount: "lessonCount",
      gameCount: "gameCount",
    };
    Object.entries(map).forEach(([k, id]) => {
      if (s[k] != null) $(id).value = s[k];
    });
    if (typeof s.firstClass === "boolean") $("firstClass").checked = s.firstClass;
    if (s.leadRole === "Coach" || s.leadRole === "Instructor") {
      setLeadRole(s.leadRole, true);
    }
    if (s.warmupPace === "younger" || s.warmupPace === "older" || s.warmupPace === "mixed") {
      setWarmupPace(s.warmupPace, true);
    }
  }

  function readSettings() {
    const num = (id) => Number($(id).value);
    return {
      title: $("title").value.trim() || "KIDS BJJ CLASS",
      leadRole: leadRole(),
      instructor: $("instructor").value.trim() || "Dakota",
      helper: $("helper").value.trim(),
      ages: $("ages").value.trim() || "3–5",
      kids: $("kids").value.trim() || "3–4",
      date: $("date").value,
      firstClass: $("firstClass").checked,
      warmupPace: warmupPace(),
      totalMin: num("totalMin") || 45,
      openingMin: num("openingMin") || 8,
      waterMin: num("waterMin") || 1,
      finishMin: num("finishMin") || 3,
      warmupCount: Math.max(0, Math.floor(num("warmupCount") || 0)),
      lessonCount: Math.max(0, Math.floor(num("lessonCount") || 0)),
      gameCount: Math.max(0, Math.floor(num("gameCount") || 0)),
      sheetId: state.sheetId,
    };
  }

  function warmupPace() {
    const p = state.warmupPace;
    return p === "younger" || p === "older" ? p : "mixed";
  }

  function pacedReps(base, pace) {
    const n = Math.max(1, Number(base) || 1);
    if (pace === "younger") return Math.max(1, Math.round(n * 0.5));
    if (pace === "older") return Math.min(20, n * 2);
    return n;
  }

  function defaultReps(activity) {
    const n = Number(activity?.reps);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  function repsOf(activity) {
    if (!activity) return 1;
    if (state.reps[activity.id] != null) {
      const n = Number(state.reps[activity.id]);
      if (Number.isFinite(n) && n >= 1) return n;
    }
    return defaultReps(activity);
  }

  function displayName(item) {
    const name = fill(item.name || "", item);
    const n = Number(item.reps) || repsOf(item);
    return n > 1 ? `${name} x${n}` : name;
  }

  function allActivities() {
    const builtin = DATA.activities.map((a) => ({
      ...a,
      builtin: true,
      reps: defaultReps(a),
    }));
    return builtin.concat(
      state.custom.map((a) => ({ ...a, builtin: false, reps: defaultReps(a) }))
    );
  }

  function pool(category) {
    return allActivities().filter(
      (a) => a.category === category && !state.disabled.includes(a.id)
    );
  }

  function pick(category, count, keepIds = [], excludeIds = []) {
    const items = pool(category).filter((a) => !excludeIds.includes(a.id));
    const byId = Object.fromEntries(items.map((a) => [a.id, a]));
    const chosen = [];
    const used = new Set();

    const withCurrentReps = (a) => {
      const baseReps = repsOf(a);
      const reps =
        category === "warmup" ? pacedReps(baseReps, warmupPace()) : baseReps;
      const typical = Math.max(1, defaultReps(a));
      const duration = Math.max(
        0.5,
        (Number(a.duration) || 2) * (reps / typical)
      );
      return { ...a, baseReps, reps, duration };
    };

    keepIds.forEach((id) => {
      if (byId[id] && chosen.length < count) {
        chosen.push(withCurrentReps(byId[id]));
        used.add(id);
      }
    });

    const pinned = state.pinned.filter((id) => byId[id] && !used.has(id));
    pinned.forEach((id) => {
      if (chosen.length < count) {
        chosen.push(withCurrentReps(byId[id]));
        used.add(id);
      }
    });

    const rest = items.filter((a) => !used.has(a.id));
    shuffle(rest);
    while (chosen.length < count && rest.length) {
      chosen.push(withCurrentReps(rest.shift()));
    }
    return chosen;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function snap(seconds) {
    return Math.max(30, Math.round(seconds / 30) * 30);
  }

  function clock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function range(start, dur) {
    return `${clock(start)}–${clock(start + dur)}`;
  }

  function allocate(items, budgetSec) {
    if (!items.length) return [];
    const prefs = items.map((a) => Math.max(30, (Number(a.duration) || 2) * 60));
    const sum = prefs.reduce((a, b) => a + b, 0);
    let times = prefs.map((p) => snap((p / sum) * budgetSec));
    let total = times.reduce((a, b) => a + b, 0);
    let i = 0;
    while (total > budgetSec && times.some((t) => t > 30)) {
      const idx = i % times.length;
      if (times[idx] > 30) {
        times[idx] -= 30;
        total -= 30;
      }
      i += 1;
      if (i > 400) break;
    }
    i = 0;
    while (total < budgetSec - 15) {
      times[i % times.length] += 30;
      total += 30;
      i += 1;
      if (i > 400) break;
    }
    return times;
  }

  function timedItems(items, start, budget) {
    const durs = allocate(items, budget);
    let t = start;
    return items.map((item, i) => {
      const duration = durs[i];
      const block = { ...item, start: t, duration, when: range(t, duration) };
      t += duration;
      return block;
    });
  }

  function openingBlocks(settings, start, budget) {
    const src = settings.firstClass ? DATA.firstClassOpening : DATA.regularOpening;
    const durs = allocate(
      src.map((s) => ({ duration: s.weight })),
      budget
    );
    let t = start;
    return src.map((item, i) => {
      const duration = durs[i];
      const block = { ...item, start: t, duration, when: range(t, duration) };
      t += duration;
      return block;
    });
  }

  function buildPlan(opts = {}) {
    const settings = readSettings();
    const total = settings.totalMin * 60;
    const opening = settings.openingMin * 60;
    const water = settings.waterMin * 60;
    const finish = settings.finishMin * 60;

    const hasWarm = settings.warmupCount > 0;
    const hasLesson = settings.lessonCount > 0;
    const hasGames = settings.gameCount > 0;
    const waterCount = (hasWarm ? 1 : 0) + (hasLesson && hasGames ? 1 : 0);
    const remaining = total - opening - finish - water * waterCount;

    const keep = opts.keep || {};
    const exclude = opts.exclude || {};
    const warmups = hasWarm
      ? pick("warmup", settings.warmupCount, keep.warmup || [], exclude.warmup || [])
      : [];
    const lessons = hasLesson
      ? pick("lesson", settings.lessonCount, keep.lesson || [], exclude.lesson || [])
      : [];
    const games = hasGames
      ? pick("game", settings.gameCount, keep.game || [], exclude.game || [])
      : [];

    const prefSum = (items) =>
      items.reduce((s, a) => s + Math.max(0.5, Number(a.duration) || 2), 0);
    const weights = [prefSum(warmups), prefSum(lessons), prefSum(games)];
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    let budgets = weights.map((w) => (w ? snap((w / wSum) * Math.max(remaining, 30)) : 0));

    let used = budgets.reduce((a, b) => a + b, 0);
    const target = Math.max(0, remaining);
    let guard = 0;
    while (used > target && budgets.some((b) => b > 30)) {
      const idx = budgets.findIndex((b) => b > 30);
      budgets[idx] -= 30;
      used -= 30;
      if (++guard > 400) break;
    }
    guard = 0;
    while (used + 30 <= target) {
      const idx = weights.findIndex((w, i) => w && budgets[i] === Math.min(...budgets.filter(Boolean)));
      const grow = idx >= 0 ? idx : budgets.findIndex((b, i) => weights[i]);
      if (grow < 0) break;
      budgets[grow] += 30;
      used += 30;
      if (++guard > 400) break;
    }

    let t = 0;
    const plan = {
      settings,
      headerTitle: settings.firstClass
        ? "First Class Lesson Plan"
        : "Kids Class Lesson Plan",
      opening: {
        start: t,
        duration: opening,
        when: range(t, opening),
        items: openingBlocks(settings, t, opening),
      },
    };
    t += opening;

    if (hasWarm) {
      plan.warmup = {
        start: t,
        duration: budgets[0],
        when: range(t, budgets[0]),
        items: timedItems(warmups, t, budgets[0]),
      };
      t += budgets[0];
      plan.water1 = {
        start: t,
        duration: water,
        when: range(t, water),
      };
      t += water;
    }

    if (hasLesson) {
      plan.lesson = {
        start: t,
        duration: budgets[1],
        when: range(t, budgets[1]),
        items: timedItems(lessons, t, budgets[1]),
      };
      t += budgets[1];
      if (hasGames) {
        plan.water2 = {
          start: t,
          duration: water,
          when: range(t, water),
        };
        t += water;
      }
    }

    if (hasGames) {
      const coneish = games.every((g) =>
        /donut|cone|shark|treasure|superhero save/i.test(g.name)
      );
      plan.games = {
        start: t,
        duration: budgets[2],
        when: range(t, budgets[2]),
        title: coneish ? "Cone games" : "Games",
        note: games.some((g) => /donut|cone/i.test(g.name))
          ? "Scatter 8–10 small cones."
          : "",
        items: timedItems(games, t, budgets[2]),
      };
      t += budgets[2];
    }

    plan.finish = {
      start: t,
      duration: finish,
      when: range(t, finish),
    };

    state.plan = plan;
    save();
    renderPlan();
    updateMeta();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function sayHtml(value, extra) {
    return asList(value)
      .filter(Boolean)
      .map((line) => `<p class="say">“${escapeHtml(fill(line, extra))}”</p>`)
      .join("");
  }

  function extraHtml(text, extra) {
    if (!text) return "";
    return `<p class="extra">${escapeHtml(fill(text, extra)).replaceAll("\n", "<br>")}</p>`;
  }

  function howHtml(text, extra) {
    if (!text) return "";
    return `<p>${escapeHtml(fill(text, extra)).replaceAll("\n", "<br>")}</p>`;
  }

  function repsCtrl(item, section) {
    if (!item?.id || section === "opening") return "";
    const n = Number(item.reps) || 1;
    return `<span class="reps-ctrl" title="How many">
      <button type="button" data-reps="-1" data-id="${item.id}" data-section="${section}">−</button>
      <span>x${n}</span>
      <button type="button" data-reps="1" data-id="${item.id}" data-section="${section}">+</button>
    </span>`;
  }

  function shuffleBtn(section, id) {
    if (!state.showItemShuffle) return "";
    return `<button class="reroll" type="button" data-swap="${section}" data-id="${id}">shuffle</button>`;
  }

  function bodyHtml(item) {
    if (item.parts) {
      return item.parts
        .map((part) =>
          part.say != null ? sayHtml(part.say, item) : howHtml(part.p, item)
        )
        .join("");
    }
    return (
      howHtml(item.how, item) +
      sayHtml(item.say, item) +
      extraHtml(item.extra, item) +
      howHtml(item.after, item) +
      sayHtml(item.sayAfter, item)
    );
  }

  function renderItem(item, section) {
    const equip = item.equipment
      ? `<p>Equipment: ${escapeHtml(fill(item.equipment, item))}</p>`
      : "";
    return `
      <div class="item">
        <h3 class="item-title">
          <span class="when">${item.when}</span>
          <strong class="name-live">${escapeHtml(fill(item.name || "", item))}</strong>
          <strong class="name-print">${escapeHtml(displayName(item))}</strong>
          ${repsCtrl(item, section)}
          ${shuffleBtn(section, item.id)}
        </h3>
        ${bodyHtml(item)}
        ${equip}
      </div>`;
  }

  function staffRows(settings) {
    const rows = settings.firstClass ? DATA.staffFirst : DATA.staffRegular;
    return rows
      .map(
        (r, i) => `
        <tr>
          <td>${escapeHtml(fill(r.role))}</td>
          <td>${escapeHtml(fill(r.job))}</td>
        </tr>`
      )
      .join("");
  }

  function renderPlan() {
    const plan = state.plan;
    if (!plan) return;
    const s = plan.settings;
    const dateBit = s.date
      ? `  ·  ${new Date(s.date + "T00:00:00").toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}`
      : "";

    const waterBlock = (w, label) => {
      if (!w) return "";
      return `
        <section class="block">
          <h2 class="block-title"><span class="when">${w.when}</span> ${label}</h2>
          <div class="item">
            <h3 class="item-title"><span class="when">${w.when}</span> <strong>${escapeHtml(
        DATA.water.name
      )}</strong></h3>
            ${howHtml(DATA.water.how)}
            ${sayHtml(DATA.water.say)}
          </div>
        </section>`;
    };

    $("plan").dataset.editing = state.showItemShuffle ? "true" : "false";
    $("plan").innerHTML = `
      <div class="plan-running-header">
        <span>Kids BJJ  •  ${escapeHtml(plan.headerTitle)}</span>
        <span class="right">${escapeHtml(s.leadRole || "Instructor")} ${escapeHtml(s.instructor)}</span>
      </div>
      <h1 class="title">${escapeHtml(s.title)}</h1>
      <p class="class-meta">${escapeHtml(s.ages)}<span class="sep"></span>|<span class="sep"></span>${s.totalMin} Minutes<span class="sep"></span>|<span class="sep"></span>${escapeHtml(
      s.kids
    )} Kids${dateBit}</p>
      <p class="coaching">${escapeHtml(DATA.coaching)}</p>
      <p class="callout">${escapeHtml(DATA.warmupPaceNotes[s.warmupPace || "mixed"] || DATA.warmupPaceNotes.mixed)}</p>

      <h2 class="section-name">Staff</h2>
      <table class="staff-table">
        <thead><tr><th>Role</th><th>Job</th></tr></thead>
        <tbody>${staffRows(s)}</tbody>
      </table>

      <section class="block">
        <h2 class="block-title"><span class="when">${plan.opening.when}</span> Get ready and come on the mat</h2>
        ${plan.opening.items.map((it) => renderItem(it, "opening")).join("")}
      </section>

      ${
        plan.warmup
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${plan.warmup.when}</span> Warm-up</h2>
              <p class="callout">${escapeHtml(DATA.warmupPaceNotes[s.warmupPace || "mixed"] || DATA.warmupPaceNotes.mixed)}</p>
              ${plan.warmup.items.map((it) => renderItem(it, "warmup")).join("")}
              <div class="item">
                <p>If they get wild:</p>
                ${sayHtml(DATA.wildReset)}
              </div>
            </section>`
          : ""
      }

      ${waterBlock(plan.water1, "Water Break!")}

      ${
        plan.lesson
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${plan.lesson.when}</span> Lesson</h2>
              ${plan.lesson.items.map((it) => renderItem(it, "lesson")).join("")}
            </section>`
          : ""
      }

      ${waterBlock(plan.water2, "Water Break!  Get Some Water!")}

      ${
        plan.games
          ? `<section class="block">
              <h2 class="block-title"><span class="when">${plan.games.when}</span> ${escapeHtml(
                plan.games.title
              )}</h2>
              ${plan.games.note ? `<p>${escapeHtml(plan.games.note)}</p>` : ""}
              ${plan.games.items.map((it) => renderItem(it, "game")).join("")}
            </section>`
          : ""
      }

      <section class="block">
        <h2 class="block-title"><span class="when">${plan.finish.when}</span> Finish</h2>
        <div class="item">
          <ul>
            ${DATA.finish.bullets.map((b) => `<li>${escapeHtml(fill(b))}</li>`).join("")}
          </ul>
          ${sayHtml(DATA.finish.say)}
          <p>${escapeHtml(DATA.finish.after)}</p>
        </div>
      </section>

      <section class="block">
        <h2 class="block-title">Class rules</h2>
        <div class="item">
          <ul>
            ${DATA.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
          </ul>
        </div>
      </section>

      <div class="plan-running-footer">
        ${escapeHtml(s.ages)}  •  ${s.totalMin} minutes  •  ${escapeHtml(s.kids)} kids
      </div>
    `;
  }

  function catLabel(cat) {
    return cat === "warmup" ? "Warm-ups" : cat === "lesson" ? "Lesson" : "Games";
  }

  const SHEET_DB = "bjj-kids-sheets-v1";

  function openSheetDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SHEET_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("uploads")) {
          db.createObjectStore("uploads", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadUploads() {
    try {
      const db = await openSheetDb();
      state.uploads = await new Promise((resolve, reject) => {
        const tx = db.transaction("uploads", "readonly");
        const req = tx.objectStore("uploads").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
    } catch (err) {
      console.warn("Could not load uploaded sheets", err);
      state.uploads = [];
    }
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
    state.uploads = state.uploads.filter((s) => s.id !== id);
  }

  function allSheets() {
    const builtin = (DATA.sheets || []).map((s) => ({ ...s, builtin: true }));
    return builtin.concat(state.uploads.map((s) => ({ ...s, builtin: false })));
  }

  function currentSheet() {
    return allSheets().find((s) => s.id === state.sheetId) || allSheets()[0];
  }

  function randomSheetId(except) {
    const pool = allSheets().filter((s) => !s.firstClass && s.id !== except);
    const list = pool.length ? pool : allSheets().filter((s) => s.id !== except);
    if (!list.length) return state.sheetId;
    return list[Math.floor(Math.random() * list.length)].id;
  }

  function setSheet(id, silent = false) {
    const sheet = allSheets().find((s) => s.id === id);
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

  function questionRow(pin, i) {
    const n = pin.n != null ? pin.n : i + 1;
    const ask = pin.ask || "";
    return `<li>
      <span class="n">${escapeHtml(String(n))}</span>
      <span class="ask">${escapeHtml(ask)}</span>
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
      .filter((p) => p.from && p.to)
      .map((p) => outlinedArrow(p.from, p.to))
      .join("");
    const nums = pins
      .filter((p) => p.from)
      .map((p) => {
        const [x, y] = p.from;
        return `<span class="sheet-num" style="left:${x}%;top:${y}%">${escapeHtml(String(p.n))}</span>`;
      })
      .join("");
    return `
      <svg class="sheet-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${marks}
      </svg>
      ${nums}`;
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
      el.innerHTML = `<img class="sheet-full" src="${sheet.src}" alt="${escapeHtml(sheet.name)}">`;
      return;
    }
    el.classList.remove("baked");
    if (sheet.type === "comic") {
      const panels = (sheet.panels || [])
        .map(
          (p, i) => `
          <figure class="comic-panel">
            <img src="${p.src}" alt="Panel ${i + 1}">
            ${p.bubble ? `<figcaption class="bubble">${escapeHtml(p.bubble)}</figcaption>` : ""}
          </figure>`
        )
        .join("");
      const extraQs =
        sheet.layout === "six"
          ? `<ol class="sheet-qs">
              <li><span class="n">1</span><span class="ask">My favorite position is</span><span class="blank"></span></li>
              <li><span class="n">2</span><span class="ask">The one on top is</span><span class="blank"></span></li>
            </ol>`
          : "";
      el.innerHTML = `
        <h1 class="sheet-title">${escapeHtml(sheet.title || sheet.name)}</h1>
        <p class="sheet-sub">Kids BJJ Comic</p>
        <div class="comic-grid${sheet.layout === "six" ? " six" : ""}">${panels}</div>
        ${extraQs}
        <div class="sheet-name">My name is <span class="line"></span></div>
        <p class="sheet-foot">Bring this back next class for a special surprise.</p>
      `;
      return;
    }
    const pins = sheet.pins && sheet.pins.length ? sheet.pins : GI_PINS;
    const qs = pins.map(questionRow).join("");
    const sub = sheet.subtitle
      ? `<p class="sheet-sub">${escapeHtml(sheet.subtitle)}</p>`
      : "";
    el.innerHTML = `
      <h1 class="sheet-title">${escapeHtml(sheet.title || sheet.name)}</h1>
      ${sub}
      <div class="sheet-stage">
        <img class="sheet-art" src="${sheet.src}" alt="${escapeHtml(sheet.name)}">
        ${arrowLayer(pins)}
      </div>
      <ol class="sheet-qs">${qs}</ol>
      <div class="sheet-name">My name is <span class="line"></span></div>
      <p class="sheet-foot">Bring this back next class for a special surprise.</p>
    `;
  }

  function renderSheetList() {
    const list = $("sheetList");
    if (!list) return;
    list.innerHTML = allSheets()
      .map((s) => {
        const on = s.id === state.sheetId;
        return `<article class="card ${on ? "using" : ""}" data-sheet="${s.id}">
          <header>
            <h3>${escapeHtml(s.name)}</h3>
            <span class="badge ${s.builtin ? "" : "custom"}">${
              s.firstClass ? "first class" : s.builtin ? "built-in" : "yours"
            }</span>
          </header>
          <img class="sheet-list-art" src="${s.src}" alt="">
          <div class="card-actions">
            <button type="button" data-act="use">${on ? "Using" : "Use this"}</button>
            ${
              s.builtin
                ? ""
                : `<button type="button" class="danger" data-act="delete-sheet">Delete</button>`
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
    if (!file || !String(file.type).startsWith("image/")) {
      toast("Pick a picture file.");
      return;
    }
    const src = await fileToDataUrl(file);
    const name = file.name.replace(/\.[^.]+$/, "") || "Uploaded sheet";
    const sheet = {
      id: uid(),
      name,
      src,
      title: name,
      pins: GI_PINS,
    };
    state.uploads.push(sheet);
    try {
      await saveUpload(sheet);
    } catch (err) {
      console.warn(err);
    }
    setSheet(sheet.id);
    toast(`Added “${name}” — the randomizer can pull it now.`);
  }

  function renderLibrary() {
    const cat = state.libCat;
    const items = allActivities()
      .filter((a) => a.category === cat)
      .sort((a, b) => {
        if (!!a.builtin !== !!b.builtin) return a.builtin ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    $("libraryList").innerHTML = items
      .map((a) => {
        const off = state.disabled.includes(a.id);
        const pin = state.pinned.includes(a.id);
        return `
          <article class="card ${off ? "off" : ""}" data-id="${a.id}">
            <header>
              <h3>${escapeHtml(displayName({ ...a, reps: repsOf(a) }))}</h3>
              <span class="badge ${a.builtin ? "" : "custom"}">${
                a.builtin ? "built-in" : "yours"
              } · ${a.duration} min</span>
            </header>
            <p>${escapeHtml(fill((a.how || a.say || "").toString().split("\n")[0], { ...a, reps: repsOf(a) }))}</p>
            <div class="reps-ctrl" title="How many">
              <button type="button" data-act="reps" data-delta="-1">−</button>
              <span>x${repsOf(a)}</span>
              <button type="button" data-act="reps" data-delta="1">+</button>
            </div>
            <div class="card-actions">
              <button type="button" data-act="pin">${pin ? "Unpin" : "Always include"}</button>
              <button type="button" data-act="toggle">${off ? "Use in randomizer" : "Leave out"}</button>
              ${
                a.builtin
                  ? `<button type="button" data-act="copy">Copy &amp; edit</button>`
                  : `<button type="button" data-act="edit">Edit</button>
                     <button type="button" class="danger" data-act="delete">Delete</button>`
              }
            </div>
          </article>`;
      })
      .join("");
  }

  function updateMeta() {
    const counts = ["warmup", "lesson", "game"].map((c) => {
      const n = pool(c).length;
      const custom = state.custom.filter((a) => a.category === c).length;
      return `${n} ${catLabel(c).toLowerCase()}${custom ? ` (${custom} yours)` : ""}`;
    });
    $("poolMeta").textContent = "Pool: " + counts.join(" · ");
    updateTimeSum();
  }

  function updateTimeSum() {
    const s = readSettings();
    const hasWarm = s.warmupCount > 0;
    const hasLesson = s.lessonCount > 0;
    const hasGames = s.gameCount > 0;
    const waters = (hasWarm ? 1 : 0) + (hasLesson && hasGames ? 1 : 0);
    const fixed = s.openingMin + s.finishMin + s.waterMin * waters;
    const left = s.totalMin - fixed;
    const el = $("timeSum");
    if (left < 5) {
      el.className = "time-sum over";
      el.textContent = `Only ${left.toFixed(1)} min left for warm-up / lesson / games. Lengthen the class or shorten opening.`;
    } else {
      el.className = "time-sum ok";
      el.textContent = `${s.totalMin} min class · ${fixed.toFixed(1)} min opening/water/finish · ${left.toFixed(1)} min to split.`;
    }
  }

  function openModal(activity) {
    $("modalTitle").textContent = activity ? "Edit activity" : "Add activity";
    $("actId").value = activity?.id || "";
    $("actCategory").value = activity?.category || state.libCat;
    $("actName").value = activity?.name || "";
    $("actReps").value = activity ? repsOf(activity) : 2;
    $("actDuration").value = activity?.duration || 2;
    $("actHow").value = activity?.how || "";
    $("actSay").value = asList(activity?.say).join("\n") || "";
    $("actExtra").value = activity?.extra || "";
    $("actEquip").value = activity?.equipment || "";
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
    const say = sayRaw.includes("\n")
      ? sayRaw.split("\n").map((l) => l.trim()).filter(Boolean)
      : sayRaw;
    return {
      id: $("actId").value || uid(),
      category: $("actCategory").value,
      name: $("actName").value.trim(),
      reps: Math.max(1, Math.floor(Number($("actReps").value) || 1)),
      duration: Number($("actDuration").value) || 2,
      how: $("actHow").value.trim(),
      say,
      extra: $("actExtra").value.trim(),
      equipment: $("actEquip").value.trim(),
    };
  }

  function findActivity(id) {
    return allActivities().find((a) => a.id === id);
  }

  function swapOne(section, id) {
    const listKey = section === "game" ? "games" : section;
    const block = state.plan?.[listKey];
    if (!block) return;
    const keep = block.items.map((i) => i.id).filter((x) => x !== id);
    const cat = section === "game" || section === "games" ? "game" : section;
    buildPlan({
      keep: {
        warmup: cat === "warmup" ? keep : idsOf("warmup"),
        lesson: cat === "lesson" ? keep : idsOf("lesson"),
        game: cat === "game" ? keep : idsOf("game"),
      },
      exclude: { [cat]: [id] },
    });
  }

  function idsOf(section) {
    const key = section === "game" ? "games" : section;
    return (state.plan?.[key]?.items || []).map((i) => i.id);
  }

  function applyWarmupPaceToPlan() {
    const block = state.plan?.warmup;
    if (!block) return;
    const pace = warmupPace();
    block.items.forEach((item) => {
      const base = item.baseReps != null ? item.baseReps : repsOf(item);
      item.baseReps = base;
      item.reps = pacedReps(base, pace);
    });
  }

  function setWarmupPace(pace, skipRender = false) {
    state.warmupPace =
      pace === "younger" || pace === "older" ? pace : "mixed";
    [...$("warmupPace").querySelectorAll("button")].forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.pace === state.warmupPace);
    });
    if (state.plan) state.plan.settings.warmupPace = state.warmupPace;
    applyWarmupPaceToPlan();
    if (!skipRender && state.plan) renderPlan();
    save();
  }

  function setLeadRole(role, skipRender = false) {
    state.leadRole = role === "Coach" ? "Coach" : "Instructor";
    [...$("leadRole").querySelectorAll("button")].forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.role === state.leadRole);
    });
    if (!skipRender && state.plan) {
      state.plan.settings.leadRole = state.leadRole;
      renderPlan();
    }
    save();
  }

  function bumpReps(id, delta, section, fromPlan = false) {
    const key = section === "game" ? "games" : section;
    const block = state.plan?.[key];
    const planItem = block?.items.find((i) => i.id === id);

    if (fromPlan && planItem) {
      planItem.reps = Math.max(1, Math.min(20, (Number(planItem.reps) || 1) + delta));
      if (section === "warmup") planItem.baseReps = planItem.reps;
      save();
      renderPlan();
      return;
    }

    const current = (() => {
      const item = findActivity(id);
      return repsOf(item || { id, reps: 1 });
    })();
    const next = Math.max(1, Math.min(20, current + delta));
    state.reps[id] = next;
    if (planItem) {
      planItem.baseReps = next;
      planItem.reps =
        section === "warmup" ? pacedReps(next, warmupPace()) : next;
    }
    if (state.custom.some((a) => a.id === id)) {
      state.custom = state.custom.map((a) =>
        a.id === id ? { ...a, reps: next } : a
      );
    }
    save();
    renderPlan();
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
    $("kids").value = "3–4";
    setWarmupPace("mixed", true);
    buildPlan({ keep: FIRST_CLASS_IDS });
    setSheet("first-gi", true);
    if (!silent) toast("Loaded the first class plan from the printed document.");
  }

  function bind() {
    document.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = $(btn.dataset.for);
        const next = Number(input.value) + Number(btn.dataset.step);
        input.value = Math.max(0, Math.min(12, next));
        updateTimeSum();
        save();
      });
    });

    [
      "title",
      "instructor",
      "helper",
      "ages",
      "kids",
      "date",
      "totalMin",
      "openingMin",
      "waterMin",
      "finishMin",
      "warmupCount",
      "lessonCount",
      "gameCount",
      "firstClass",
    ].forEach((id) => {
      $(id).addEventListener("change", () => {
        if (id === "firstClass") {
          $("openingMin").value = $("firstClass").checked ? 13 : 8;
          if ($("firstClass").checked && $("title").value === "KIDS BJJ CLASS") {
            $("title").value = "FIRST BJJ CLASS";
          }
          if (!$("firstClass").checked && $("title").value === "FIRST BJJ CLASS") {
            $("title").value = "KIDS BJJ CLASS";
          }
        }
        updateTimeSum();
        save();
        if (
          state.plan &&
          ["instructor", "helper", "title", "ages", "kids", "date"].includes(id)
        ) {
          Object.assign(state.plan.settings, readSettings());
          renderPlan();
        }
      });
    });

    $("generateBtn").addEventListener("click", () => {
      buildPlan();
      pickSheetForClass();
      toast("New class generated.");
    });
    $("firstPlanBtn").addEventListener("click", () => loadFirstClass(false));
    $("rerollWarmBtn").addEventListener("click", () => {
      buildPlan({
        keep: { lesson: idsOf("lesson"), game: idsOf("game") },
      });
      toast("Warm-ups shuffled.");
    });
    $("rerollLessonBtn").addEventListener("click", () => {
      buildPlan({
        keep: { warmup: idsOf("warmup"), game: idsOf("game") },
      });
      toast("Lesson shuffled.");
    });
    $("rerollGameBtn").addEventListener("click", () => {
      buildPlan({
        keep: { warmup: idsOf("warmup"), lesson: idsOf("lesson") },
      });
      toast("Games shuffled.");
    });

    $("printBtn").addEventListener("click", () => window.print());
    $("editToggle").addEventListener("click", () => {
      state.showItemShuffle = !state.showItemShuffle;
      $("editToggle").textContent = state.showItemShuffle
        ? "Hide shuffle on items"
        : "Show shuffle on items";
      renderPlan();
    });

    $("libTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-cat]");
      if (!btn) return;
      state.libCat = btn.dataset.cat;
      [...$("libTabs").children].forEach((b) =>
        b.classList.toggle("on", b === btn)
      );
      renderLibrary();
    });

    $("addBtn").addEventListener("click", () => openModal(null));
    $("cancelModal").addEventListener("click", closeModal);
    $("modalBack").addEventListener("click", (e) => {
      if (e.target === $("modalBack")) closeModal();
    });

    $("activityForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const act = formActivity();
      if (!act.name) {
        toast("Give it a name.");
        return;
      }
      const idx = state.custom.findIndex((a) => a.id === act.id);
      if (idx >= 0) state.custom[idx] = act;
      else state.custom.push(act);
      state.reps[act.id] = act.reps;
      state.libCat = act.category;
      [...$("libTabs").children].forEach((b) =>
        b.classList.toggle("on", b.dataset.cat === act.category)
      );
      save();
      renderLibrary();
      updateMeta();
      closeModal();
      toast(`Saved “${act.name}” — the randomizer can pull it now.`);
    });

    $("libraryList").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      const card = e.target.closest(".card");
      if (!btn || !card) return;
      const id = card.dataset.id;
      const act = btn.dataset.act;
      const item = findActivity(id);
      if (act === "reps") {
        bumpReps(id, Number(btn.dataset.delta), state.libCat);
        return;
      }
      if (act === "pin") {
        if (state.pinned.includes(id)) {
          state.pinned = state.pinned.filter((x) => x !== id);
        } else state.pinned.push(id);
      }
      if (act === "toggle") {
        if (state.disabled.includes(id)) {
          state.disabled = state.disabled.filter((x) => x !== id);
        } else state.disabled.push(id);
      }
      if (act === "delete") {
        state.custom = state.custom.filter((a) => a.id !== id);
        state.pinned = state.pinned.filter((x) => x !== id);
        state.disabled = state.disabled.filter((x) => x !== id);
        toast("Removed from the library.");
      }
      if (act === "edit") openModal(item);
      if (act === "copy") {
        openModal({
          ...item,
          id: uid(),
          name: item.name + " (yours)",
          builtin: false,
        });
      }
      save();
      renderLibrary();
      updateMeta();
    });

    $("plan").addEventListener("click", (e) => {
      const repsBtn = e.target.closest("[data-reps]");
      if (repsBtn) {
        bumpReps(
          repsBtn.dataset.id,
          Number(repsBtn.dataset.reps),
          repsBtn.dataset.section,
          true
        );
        return;
      }
      const btn = e.target.closest("[data-swap]");
      if (!btn) return;
      swapOne(btn.dataset.swap, btn.dataset.id);
    });

    $("leadRole").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-role]");
      if (!btn) return;
      setLeadRole(btn.dataset.role);
    });

    $("warmupPace").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-pace]");
      if (!btn) return;
      setWarmupPace(btn.dataset.pace);
      const label =
        btn.dataset.pace === "younger"
          ? "Warm-up decreased for 3–4s."
          : btn.dataset.pace === "older"
            ? "Warm-up doubled for older than 4."
            : "Warm-up back to as written.";
      toast(label);
    });

    $("exportBtn").addEventListener("click", () => {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              custom: state.custom,
              disabled: state.disabled,
              pinned: state.pinned,
              reps: state.reps,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "bjj-kids-activity-library.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const incoming = Array.isArray(data.custom) ? data.custom : Array.isArray(data) ? data : [];
        incoming.forEach((act) => {
          if (!act?.name || !act?.category) return;
          if (!act.id) act.id = uid();
          const idx = state.custom.findIndex((a) => a.id === act.id);
          if (idx >= 0) state.custom[idx] = { ...state.custom[idx], ...act };
          else state.custom.push(act);
          if (act.reps) state.reps[act.id] = act.reps;
        });
        if (data.reps && typeof data.reps === "object") {
          state.reps = { ...state.reps, ...data.reps };
        }
        save();
        renderLibrary();
        updateMeta();
        toast(`Imported ${incoming.length} activit${incoming.length === 1 ? "y" : "ies"}.`);
      } catch {
        toast("Could not read that file.");
      }
      e.target.value = "";
    });

    $("firstSheetBtn").addEventListener("click", () => setSheet("first-gi"));
    $("randomSheetBtn").addEventListener("click", () =>
      setSheet(randomSheetId(state.sheetId))
    );
    $("uploadSheetBtn").addEventListener("click", () => $("sheetFile").click());
    $("sheetFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) await handleSheetUpload(file);
    });
    $("sheetList").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      const card = e.target.closest("[data-sheet]");
      if (!btn || !card) return;
      const id = card.dataset.sheet;
      if (btn.dataset.act === "use") setSheet(id);
      if (btn.dataset.act === "delete-sheet") {
        await deleteUpload(id);
        if (state.sheetId === id) setSheet(randomSheetId(id), true);
        else {
          renderSheetList();
          save();
        }
        toast("Removed from the coloring pool.");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  const hadStore = !!localStorage.getItem(STORAGE_KEY);
  load();
  bind();
  loadUploads().then(() => {
    renderLibrary();
    updateMeta();
    if (hadStore) buildPlan();
    else loadFirstClass(true);
    if (!allSheets().some((s) => s.id === state.sheetId)) state.sheetId = "first-gi";
    renderSheet();
    renderSheetList();
  });
})();
