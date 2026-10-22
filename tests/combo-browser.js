/* Combo class in the staff planner: multi-select, plan notes, check-in, and ratio. */
const assert = require("assert");
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.BJJ_COMBO_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = "correct-horse";
const root = path.join(__dirname, "..");
const dbDir = fs.mkdtempSync(path.join("/tmp", "bjj-combo-"));
const dbPath = path.join(dbDir, "data.db");
const shotDir = "/opt/cursor/artifacts/screenshots";

function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (err) {
    try {
      return require("/tmp/pw/node_modules/puppeteer-core");
    } catch (again) {
      return null;
    }
  }
}

function chromePath() {
  return process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
}

function seed() {
  const script = `
import os
from server.db import connect, migrate, iso, utcnow
from server.httpapp import hash_password
conn = connect(os.environ["DB"])
migrate(conn)
now = iso(utcnow())
pw = hash_password(os.environ["PW"])
conn.execute(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
    ("u-dakota", "dakota", pw, now),
)
conn.execute(
    "INSERT INTO staff (id, name, belt, stripes, user_id, created_at) VALUES (?, ?, 'blue', 0, ?, ?)",
    ("st-dakota", "Dakota", "u-dakota", now),
)
students = (
    ("s-ada", "ComboAda", 5, "white", 0),
    ("s-bea", "ComboBea", 8, "grey", 1),
    ("s-cleo", "ComboCleo", 11, "yellow", 1),
    ("s-dee", "ComboDee", 14, "orange", 2),
)
for row in students:
    conn.execute(
        "INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        row + (now,),
    )
conn.commit()
conn.close()
`;
  execFileSync("python3", ["-c", script], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: root, DB: dbPath, PW: PASS },
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http
        .get(BASE + "/login/", (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else if (Date.now() - started > 8000) reject(new Error("combo server status " + res.statusCode));
          else setTimeout(tick, 150);
        })
        .on("error", () => {
          if (Date.now() - started > 8000) reject(new Error("combo server did not start"));
          else setTimeout(tick, 150);
        });
    };
    tick();
  });
}

async function shot(page, name) {
  fs.mkdirSync(shotDir, { recursive: true });
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot({
        path: path.join(shotDir, name),
        captureBeyondViewport: false,
      });
      return;
    } catch (err) {
      last = err;
      if (!/destroyed|navigat|timeout/i.test(String(err))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw last;
}

async function ready(page) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.waitForSelector("body.authed #plan .plan-kicker", { timeout: 15000 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const text = await page.$eval("#plan .plan-kicker", (el) => el.textContent);
      if (text && text.trim()) return text;
    } catch (err) {
      last = err;
      if (!/destroyed|navigat|Execution context/i.test(String(err))) throw err;
    }
  }
  throw last;
}

async function evalStable(page, fn, ...args) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.waitForSelector("body.authed", { timeout: 15000 });
      return await page.evaluate(fn, ...args);
    } catch (err) {
      last = err;
      if (!/destroyed|navigat|Execution context/i.test(String(err))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw last;
}

async function main() {
  const puppeteer = loadPuppeteer();
  if (!puppeteer || !fs.existsSync(chromePath())) {
    console.log("combo browser check skipped: Chrome or puppeteer-core is not installed");
    return;
  }
  seed();
  const server = spawn(
    "python3",
    ["-m", "server", "serve", "--static", root, "--db", dbPath, "--insecure-cookie", "--port", String(PORT)],
    { cwd: root, env: { ...process.env, PYTHONPATH: root }, stdio: "ignore" }
  );
  let browser;
  try {
    await waitForServer();
    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: "new",
      protocolTimeout: 30000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + "/login/", { waitUntil: "networkidle0" });
    await page.evaluate(() => localStorage.clear());
    await page.type("#username", "dakota");
    await page.type("#password", PASS);
    await page.click("button.big");
    const before = await ready(page);
    assert.ok(before.includes("3–6"), before);
    assert.ok(!before.includes("Combo class"), before);

    await evalStable(page, () => document.querySelector('#ageGroup button[data-group="upper"]').click());
    await page.waitForFunction(
      () => (document.querySelector("#plan .plan-kicker") || {}).textContent.includes("Combo class"),
      { timeout: 10000 }
    );
    const pressed = await evalStable(page, () =>
      Object.fromEntries(
        [...document.querySelectorAll("#ageGroup button")].map((btn) => [btn.dataset.group, btn.getAttribute("aria-pressed")])
      )
    );
    assert.deepStrictEqual(pressed, { mite: "true", upper: "true" });
    const blurb = await evalStable(page, () => document.getElementById("ageBlurb").textContent);
    assert.ok(blurb.includes("Combo class: 3–6 + 7–10"), blurb);
    await evalStable(page, () => {
      const sel = document.getElementById("themeLock");
      sel.value = "guard";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () => (document.getElementById("plan") || {}).textContent.includes("Kimura from guard"),
      { timeout: 10000 }
    );
    const planText = await evalStable(page, () => document.getElementById("plan").textContent);
    assert.ok(planText.includes("Combo class: 3–6 + 7–10"), planText.slice(0, 400));
    assert.ok(planText.includes("Older kids:"), planText);
    assert.ok(planText.includes("Kimura from guard"), planText);
    assert.ok(planText.includes("Never pair a 3–6 with a 7–10."), planText);
    const home = await evalStable(page, () => document.getElementById("homeSummary").textContent);
    assert.ok(home.includes("Combo class: 3–6 + 7–10"), home);
    const kids = await evalStable(page, () => document.getElementById("kidCount").value);
    assert.strictEqual(kids, "4", "combo ratio uses both selected groups, not someone outside 4–15");

    await evalStable(page, () => {
      document.querySelectorAll("#plan .item, #sheet, .sheet-page").forEach((el) => {
        el.dataset.shotHide = "1";
        el.style.display = "none";
      });
    });
    await shot(page, "combo-desktop.png");
    await evalStable(page, () => {
      document.querySelectorAll("[data-shot-hide]").forEach((el) => {
        el.style.display = "";
        delete el.dataset.shotHide;
      });
    });

    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await evalStable(page, () => document.getElementById("menuToggle").click());
    await new Promise((resolve) => setTimeout(resolve, 400));
    const box = await evalStable(page, () => {
      const el = document.querySelector('#ageGroup button[data-group="upper"]');
      el.scrollIntoView({ block: "center" });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, h: rect.height };
    });
    assert.ok(box.h >= 44, `age button height ${box.h}`);
    await page.touchscreen.tap(box.x, box.y);
    await page.waitForFunction(
      () => !(document.getElementById("ageBlurb") || {}).textContent.includes("Combo class"),
      { timeout: 10000 }
    );
    await shot(page, "combo-phone.png");
    const again = await evalStable(page, () => {
      const el = document.querySelector('#ageGroup button[data-group="upper"]');
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.touchscreen.tap(again.x, again.y);
    await page.waitForFunction(
      () => (document.getElementById("ageBlurb") || {}).textContent.includes("Combo class: 3–6 + 7–10"),
      { timeout: 10000 }
    );
    await evalStable(page, () => document.getElementById("menuToggle").click());
    const overflow = await evalStable(
      page,
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);

    await page.setViewport({ width: 1280, height: 900 });
    const result = await evalStable(page, () =>
      window.BJJ_APP.markPresent(["s-ada", "s-cleo"]).then((res) => ({
        known: res.known.map((kid) => kid.name),
        outside: (res.outside || []).map((kid) => kid.name),
      }))
    );
    assert.deepStrictEqual(result.known, ["ComboAda", "ComboCleo"]);
    assert.deepStrictEqual(result.outside, []);
    await evalStable(page, () => document.querySelector('[data-view="checkin"]').click());
    await page.waitForSelector("#checkinList");
    const checkin = await evalStable(page, () => ({
      view: document.getElementById("checkinView").textContent,
      list: document.getElementById("checkinList").textContent,
    }));
    assert.ok(checkin.view.includes("Combo class: 3–6 + 7–10"), checkin.view.slice(0, 300));
    assert.ok(checkin.list.includes("ComboAda"), checkin.list);
    assert.ok(checkin.list.includes("ComboBea"), checkin.list);
    assert.ok(checkin.list.includes("ComboCleo"), checkin.list);
    assert.ok(checkin.list.includes("ComboDee"), checkin.list);
    assert.ok(!checkin.view.includes("is not in this combo class."), checkin.view);
    const afterCheckin = await evalStable(page, () => document.getElementById("kidCount").value);
    assert.strictEqual(afterCheckin, "2");

    await evalStable(page, () => document.querySelector('[data-view="review"]').click());
    await page.waitForSelector("#saveClassBtn");
    await evalStable(page, () => document.getElementById("saveClassBtn").click());
    await page.waitForFunction(() => {
      const snap = window.BJJ_APP.snapshot();
      return snap.progress.classes.some(
        (entry) => entry.taught && entry.ageGroup === "mite+upper" && entry.attended.includes("s-ada")
      );
    }, { timeout: 10000 });
    await evalStable(page, () => document.querySelector('[data-view="progress"]').click());
    await page.waitForSelector("#progressView h2");
    const progress = await evalStable(page, () => document.getElementById("progressView").textContent);
    assert.ok(progress.includes("Combo class: 3–6 + 7–10"), progress.slice(0, 240));
    assert.ok(progress.includes("1 of 8 classes"), progress);

    await evalStable(page, () => document.querySelector('#ageGroup button[data-group="upper"]').click());
    await page.waitForFunction(
      () => !(document.querySelector("#plan .plan-kicker") || {}).textContent.includes("Combo class"),
      { timeout: 10000 }
    );
    const single = await evalStable(page, () => document.querySelector("#plan .plan-kicker").textContent);
    assert.ok(single.includes("Mighty Mites") || single.includes("3–6"), single);
    const singleKids = await evalStable(page, () => document.getElementById("kidCount").value);
    assert.strictEqual(singleKids, "4");
    assert.deepStrictEqual(errors, [], errors.join("\n"));
    console.log("combo browser checks passed");
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
