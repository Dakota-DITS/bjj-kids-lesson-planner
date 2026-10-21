/* Install tip, offline shell, and login/camera with the service worker in control.
   Needs Chrome and puppeteer-core. Skips when those are not installed.
   BJJ_BASE defaults to http://127.0.0.1:8765.
   Login, logout, and the camera check run when BJJ_USER and BJJ_PASSWORD are set. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BJJ_BASE || "http://127.0.0.1:8765";
const SHOTS = "/opt/cursor/artifacts/screenshots";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

async function controlled(page) {
  await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
    if (!ready.active) throw new Error("service worker is not active");
  });
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function hideTip(page) {
  if (await page.$(".pwa-tip")) {
    await page.click(".pwa-tip button.later");
    await page.waitForSelector(".pwa-tip", { hidden: true });
  }
}

async function setOffline(browser, page, offline) {
  await page.setOfflineMode(offline);
  const targets = browser.targets().filter((target) => target.type() === "service_worker" || target.type() === "page");
  for (const target of targets) {
    try {
      const session = await target.createCDPSession();
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        offline,
        latency: 0,
        downloadThroughput: offline ? 0 : -1,
        uploadThroughput: offline ? 0 : -1
      });
    } catch (err) {
      /* A target can close while the condition is applied. */
    }
  }
}

async function main() {
  const puppeteer = loadPuppeteer();
  if (!puppeteer) {
    console.log("pwa browser check skipped: puppeteer-core is not installed");
    return;
  }
  if (!fs.existsSync(chromePath())) {
    console.log("pwa browser check skipped: Chrome is not installed");
    return;
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream"
    ]
  });
  try {
    const phone = await browser.createBrowserContext();
    const page = await phone.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.setUserAgent(IPHONE);
    await page.goto(BASE + "/", { waitUntil: "networkidle0" });
    await page.waitForSelector(".pwa-tip");
    const tip = await page.$eval(".pwa-tip", (el) => el.innerText);
    assert.ok(tip.includes("Add to Home Screen"), tip);
    const wide = await overflow(page);
    assert.ok(wide <= 1, `welcome tip overflow ${wide}px`);
    await page.screenshot({ path: path.join(SHOTS, "pwa-tip-390.png") });
    await page.click(".pwa-tip button.later");
    await page.waitForSelector(".pwa-tip", { hidden: true });
    await page.reload({ waitUntil: "networkidle0" });
    assert.equal(await page.$(".pwa-tip"), null);

    const desktop = await browser.createBrowserContext();
    const shell = await desktop.newPage();
    await shell.goto(BASE + "/", { waitUntil: "networkidle0" });
    await controlled(shell);
    await hideTip(shell);
    await setOffline(browser, shell, true);
    await shell.reload({ waitUntil: "domcontentloaded" });
    const home = await shell.evaluate(() => document.body.innerText);
    assert.ok(home.includes("Kids class"), home.slice(0, 180));
    assert.ok(!home.includes("You are offline"));
    await shell.goto(BASE + "/coloring/", { waitUntil: "domcontentloaded" });
    const coloring = await shell.evaluate(() => document.body.innerText);
    assert.ok(coloring.includes("Coloring sheets"), coloring.slice(0, 180));
    const missed = await shell.goto(BASE + "/not-a-real-pwa-page", { waitUntil: "domcontentloaded" });
    assert.ok(missed, "offline navigation produced no response");
    const offline = await shell.evaluate(() => document.body.innerText);
    assert.ok(offline.includes("You are offline"), offline.slice(0, 180));
    await shell.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await shell.screenshot({ path: path.join(SHOTS, "pwa-offline-390.png") });
    const api = await shell.evaluate(async () => {
      try {
        const res = await fetch("/api/auth/csrf", { credentials: "same-origin" });
        return { status: res.status, body: (await res.text()).slice(0, 80) };
      } catch (err) {
        return { error: err.name };
      }
    });
    assert.ok(api.error, JSON.stringify(api));
    await desktop.close();

    if (process.env.BJJ_USER && process.env.BJJ_PASSWORD) {
      const signedIn = await browser.createBrowserContext();
      const authed = await signedIn.newPage();
      await authed.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await authed.goto(BASE + "/login/", { waitUntil: "networkidle0" });
      await controlled(authed);
      await hideTip(authed);
      await authed.type("#username", process.env.BJJ_USER);
      await authed.type("#password", "not-the-password");
      await authed.evaluate(() => document.querySelector("button.big").click());
      await authed.waitForFunction(() => (document.getElementById("error").textContent || "").length > 0, { timeout: 8000 });
      const bad = await authed.$eval("#error", (el) => el.textContent);
      assert.ok(bad.includes("don't match"), bad);
      await authed.evaluate(() => {
        document.getElementById("username").value = "";
        document.getElementById("password").value = "";
      });
      await authed.type("#username", process.env.BJJ_USER);
      await authed.type("#password", process.env.BJJ_PASSWORD);
      await authed.evaluate(() => document.querySelector("button.big").click());
      await authed.waitForSelector("body.authed", { timeout: 15000 });
      assert.ok(authed.url().includes("/app/"));
      await authed.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        await authed.reload({ waitUntil: "networkidle0", timeout: 15000 });
      } catch (err) {
        /* The first claim can reload the staff page on its own. */
      }
      await authed.waitForSelector("body.authed", { timeout: 15000 });
      const cached = await authed.evaluate(async () => {
        await navigator.serviceWorker.ready;
        const regs = await navigator.serviceWorker.getRegistrations();
        const names = await caches.keys();
        const paths = [];
        for (const name of names) {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          keys.forEach((req) => paths.push(new URL(req.url).pathname));
        }
        return { names, paths, scopes: regs.map((reg) => reg.scope) };
      });
      assert.ok(cached.scopes.some((scope) => scope.endsWith("/app/")), cached.scopes.join(","));
      const leaked = cached.paths.filter((pathname) => (
        pathname.startsWith("/js/")
        || pathname.startsWith("/vendor/")
        || pathname === "/css/styles.css"
        || pathname === "/app"
        || pathname === "/app/"
        || pathname === "/app/index.html"
      ));
      assert.deepEqual(leaked, [], JSON.stringify(cached));
      assert.ok(cached.paths.includes("/app/offline.html"), JSON.stringify(cached.names));
      await authed.setUserAgent(IPHONE);
      await authed.reload({ waitUntil: "networkidle0" });
      await authed.waitForSelector("body.authed", { timeout: 15000 });
      await authed.waitForSelector(".pwa-tip");
      const staffTip = await authed.$eval(".pwa-tip", (el) => el.innerText);
      assert.ok(staffTip.includes("Add to Home Screen"), staffTip);
      const staffWide = await overflow(authed);
      assert.ok(staffWide <= 1, `staff tip overflow ${staffWide}px`);
      await authed.screenshot({ path: path.join(SHOTS, "pwa-staff-tip-390.png") });
      await authed.click(".pwa-tip button.later");
      await authed.evaluate(() => document.getElementById("logoutBtn").click());
      await authed.waitForFunction(() => location.pathname === "/", { timeout: 15000 });
      await authed.waitForFunction(async () => {
        const names = await caches.keys();
        return names.every((name) => !name.startsWith("grace-staff-"));
      }, { timeout: 5000 });

      await authed.goto(BASE + "/login/", { waitUntil: "networkidle0" });
      await hideTip(authed);
      await authed.type("#username", process.env.BJJ_USER);
      await authed.type("#password", process.env.BJJ_PASSWORD);
      await authed.evaluate(() => document.querySelector("button.big").click());
      await authed.waitForSelector("body.authed", { timeout: 15000 });
      await authed.evaluate(() => document.querySelector("[data-view=checkin]").click());
      await authed.waitForSelector("#cameraBtn");
      await authed.evaluate(() => document.getElementById("cameraBtn").click());
      await authed.waitForFunction(() => {
        const text = document.getElementById("checkinStatus").textContent || "";
        return text.includes("Looking for a card") || text.includes("not available") || text.includes("https");
      }, { timeout: 8000 });
      const camera = await authed.$eval("#checkinStatus", (el) => el.textContent);
      assert.ok(camera.includes("Looking for a card"), camera);
    }
  } finally {
    await browser.close();
  }
  console.log("pwa browser check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
