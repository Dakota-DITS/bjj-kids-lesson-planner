/* Boot the staff app with the live production shape: age-3 student, all-white
   staff, one class, and a pre-PR4 localStorage plan. Also boot again while
   serving the pre-PR4 plan-math.js, which is missing ADULT_BELTS. */
const assert = require("assert");
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.BJJ_BOOT_PORT || 8772);
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = "staff-boot-1";
const root = path.join(__dirname, "..");
const dbDir = fs.mkdtempSync(path.join("/tmp", "bjj-staff-boot-"));
const dbPath = path.join(dbDir, "data.db");

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
import json, os
from server.db import connect, migrate, iso, utcnow
from server.httpapp import hash_password
conn = connect(os.environ["DB"])
migrate(conn)
now = iso(utcnow())
pw = hash_password(os.environ["PW"])
for name, role in (("dakota", "admin"), ("alex", "teacher"), ("jordan", "teacher")):
    uid = "u-" + name
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        (uid, name, pw, role, now),
    )
    conn.execute(
        "INSERT INTO staff (id, name, belt, stripes, user_id, created_at) VALUES (?, ?, 'white', 0, ?, ?)",
        ("st-" + name, name, uid, now),
    )
students = (
    ("s-tiny", "Tiny", 3, "white", 0),
    ("s-sam", "Sam", 6, "grey", 1),
    ("s-rio", "Rio", 8, "white", 2),
    ("s-jules", "Jules", 11, "yellow", 0),
)
for row in students:
    conn.execute(
        "INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        row + (now,),
    )
techs = json.dumps([{"id": "ls-bf-back", "name": "Back breakfall", "position": "Standing", "theme": "breakfalls"}])
conn.execute(
    """INSERT INTO classes
       (id, date, age_group, theme, theme_label, techniques, game, attended, taught)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)""",
    ("k-live", "2026-10-27", "mite", "breakfalls", "Breakfalls", techs, "Dodgeball", json.dumps(["s-sam"])),
)
for n in range(16):
    conn.execute(
        "INSERT INTO cards (code, status, created_at) VALUES (?, 'unclaimed', ?)",
        (f"b-bootcard{n:02d}", now),
    )
conn.commit()
conn.close()
`;
  execFileSync("python3", ["-c", script], {
    cwd: root,
    env: { ...process.env, DB: dbPath, PW: PASS },
  });
}

function header(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get(BASE + urlPath, (res) => {
        res.resume();
        resolve({ status: res.statusCode, cache: res.headers["cache-control"] || "" });
      })
      .on("error", reject);
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http
        .get(BASE + "/", (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - started > 8000) reject(new Error("staff boot server did not start"));
          else setTimeout(tick, 150);
        });
    };
    tick();
  });
}

function oldPlan() {
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/pre-pr4-plan.json"), "utf8"));
  saved.settings.instructor = "Dakota";
  saved.settings.helper = "Riley";
  saved.settings.assistants = "Riley";
  saved.plan.settings.instructor = "Dakota";
  saved.plan.settings.helper = "Riley";
  saved.plan.settings.assistants = "Riley";
  saved.plan.opening.items.unshift(null);
  return saved;
}

async function bootCase(browser, oldMath, stale) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  if (stale) {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().includes("/js/plan-math.js")) {
        request.respond({
          status: 200,
          contentType: "text/javascript; charset=utf-8",
          body: oldMath,
        });
        return;
      }
      request.continue().catch(() => {});
    });
  }
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const saved = oldPlan();
  await page.goto(BASE + "/login/", { waitUntil: "networkidle0" });
  await page.evaluate((payload) => {
    localStorage.setItem("bjj-grace-kids-planner-v2", JSON.stringify(payload));
  }, saved);
  await page.type("#username", "dakota");
  await page.type("#password", PASS);
  await page.click("button.big");
  await page.waitForSelector("body.authed", { timeout: 15000 });
  const state = await page.evaluate(() => {
    const gate = document.getElementById("gate");
    return {
      authed: document.body.classList.contains("authed"),
      gateHidden: !gate || gate.hidden,
      gateText: gate ? gate.textContent : "",
      note: (document.getElementById("staffBeltNote") || {}).textContent || "",
      roster: (document.getElementById("rosterList") || {}).textContent || "",
      plan: (document.getElementById("plan") || {}).textContent || "",
      script: [...document.scripts].some((script) => (script.src || "").includes("plan-math.js?v=20261021-26")),
    };
  });
  assert.strictEqual(state.authed, true, stale ? "stale plan-math did not authenticate" : "app did not authenticate");
  assert.strictEqual(state.gateHidden, true);
  assert.ok(!state.gateText.includes("not reachable"), state.gateText);
  assert.ok(state.script, "plan-math.js is not versioned");
  assert.ok(state.roster.includes("Tiny"), "age-3 student missing from the roster");
  assert.ok(state.roster.includes("age 3"), state.roster);
  assert.ok(state.note.includes("below a blue belt"), state.note);
  assert.ok(state.plan.includes("Riley"), "free-text assistant did not render");
  assert.ok(state.plan.includes("Line up"), "saved plan did not render");
  await page.evaluate(() => document.querySelector("[data-view=progress]").click());
  const progress = await page.evaluate(() => document.getElementById("progressView").textContent);
  assert.ok(progress.includes("Tiny"), progress.slice(0, 200));
  await page.evaluate(() => window.BJJ_APP.showCards("wallet"));
  const cards = await page.evaluate(() => document.getElementById("cardView").textContent);
  assert.ok(cards.includes("Age 3"), cards.slice(0, 300));
  assert.deepStrictEqual(errors, [], errors.join("\n"));
  if (!stale) {
    const dir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, "staff-boot-390.png") });
  }
  await context.close();
}

async function main() {
  const puppeteer = loadPuppeteer();
  if (!puppeteer || !fs.existsSync(chromePath())) {
    console.log("staff boot check skipped: Chrome or puppeteer-core is not installed");
    return;
  }
  seed();
  const server = spawn(
    "python3",
    ["-m", "server", "serve", "--static", root, "--db", dbPath, "--insecure-cookie", "--port", String(PORT)],
    { cwd: root, stdio: "ignore" }
  );
  try {
    await waitForServer();
    const js = await header("/js/app.js");
    const css = await header("/css/splash.css?v=20261021-26");
    const home = await header("/");
    const app = await header("/app/");
    assert.strictEqual(js.status, 200);
    assert.strictEqual(js.cache, "private, no-store");
    assert.strictEqual(css.cache, "no-cache");
    assert.strictEqual(home.cache, "no-cache");
    assert.strictEqual(app.cache, "private, no-store");
    const oldMath = execFileSync("git", ["show", "0534534:js/plan-math.js"], { cwd: root });
    const browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: "new",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      await bootCase(browser, oldMath, false);
      await bootCase(browser, oldMath, true);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
  console.log("staff boot check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
