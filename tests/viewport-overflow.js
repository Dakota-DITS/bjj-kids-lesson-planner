/* Phone widths must not scroll sideways, and logos must fit their parents.
   Needs Chrome and puppeteer-core. Skips when those are not installed.
   BJJ_BASE defaults to http://127.0.0.1:8765. Staff checks run when
   BJJ_USER and BJJ_PASSWORD are set. */
const assert = require("assert");

const WIDTHS = [320, 360, 375, 390, 430];
const BASE = process.env.BJJ_BASE || "http://127.0.0.1:8765";

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

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = document.documentElement.scrollWidth - vw;
    const imgs = [...document.images].map((img) => {
      const box = img.getBoundingClientRect();
      const parent = img.parentElement.getBoundingClientRect();
      return {
        alt: img.alt || img.currentSrc.split("/").pop(),
        w: box.width,
        parent: parent.width,
      };
    });
    return { wide, vw, imgs };
  });
}

function check(label, info) {
  assert.ok(info.wide <= 1, `${label} horizontal overflow ${info.wide}px`);
  info.imgs.forEach((img) => {
    assert.ok(img.w <= info.vw + 1, `${label} image ${img.alt} is ${Math.round(img.w)}px`);
    assert.ok(img.w <= img.parent + 1, `${label} image ${img.alt} wider than its parent`);
  });
}

async function main() {
  const puppeteer = loadPuppeteer();
  if (!puppeteer) {
    console.log("viewport overflow check skipped: puppeteer-core is not installed");
    return;
  }
  const fs = require("fs");
  if (!fs.existsSync(chromePath())) {
    console.log("viewport overflow check skipped: Chrome is not installed");
    return;
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(15000);
  try {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800, isMobile: true, hasTouch: true });
      for (const path of ["/", "/coloring/", "/login/"]) {
        const res = await page.goto(BASE + path, { waitUntil: "networkidle0" });
        assert.ok(res && res.ok(), `${path} did not load`);
        check(`${width} ${path}`, await measure(page));
        await page.addStyleTag({ content: "html { font-size: 20px !important; }" });
        check(`${width} ${path} large text`, await measure(page));
      }
    }
    if (process.env.BJJ_USER && process.env.BJJ_PASSWORD) {
      await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
      await page.goto(BASE + "/login/", { waitUntil: "networkidle0" });
      await page.type("#username", process.env.BJJ_USER);
      await page.type("#password", process.env.BJJ_PASSWORD);
      await page.click("button.big");
      await page.waitForSelector("body.authed", { timeout: 15000 });
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800, isMobile: true, hasTouch: true });
        await page.evaluate(() => document.body.classList.remove("menu-open"));
        check(`${width} /app/ plan`, await measure(page));
        await page.evaluate(() => document.body.classList.add("menu-open"));
        check(`${width} /app/ menu`, await measure(page));
        await page.evaluate(() => document.querySelector("[data-view=checkin]").click());
        check(`${width} /app/ check-in`, await measure(page));
        await page.evaluate(() => document.querySelector("[data-view=plan]").click());
      }
    }
  } finally {
    await browser.close();
  }
  console.log("viewport overflow check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
