/* Manifest, icon, and service-worker checks. No browser required. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel));
}

function text(rel) {
  return read(rel).toString("utf8");
}

function pngInfo(rel) {
  const buf = read(rel);
  assert.equal(buf.toString("ascii", 1, 4), "PNG", rel);
  assert.equal(buf.toString("ascii", 12, 16), "IHDR", rel);
  return {
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
    color: buf[25]
  };
}

const sw = text("sw.js");
assert.ok(sw.includes('const VERSION = "20261021-20"'));
assert.ok(sw.includes("skipWaiting"));
assert.ok(sw.includes("clients.claim"));
assert.ok(sw.includes("grace-public-"));
assert.ok(sw.includes("grace-staff-"));
assert.ok(sw.includes('url.pathname.startsWith("/api/")'));
assert.match(sw, /startsWith\("\/api\/"\)[\s\S]{0,160}respondWith\(fetch\(request\)\)/);
assert.equal((sw.match(/"\/api\//g) || []).length, 1);
assert.ok(sw.includes('cache: "reload"'));
assert.equal(sw.includes("updateViaCache"), false);
assert.ok(sw.includes("private"));
assert.ok(sw.includes("no-store"));
assert.ok(sw.includes('data.type === "logout"'));
assert.ok(sw.includes('data.type === "precache"'));

const publicList = sw.split("const PUBLIC_ASSETS")[1].split("const STAFF_ASSETS")[0];
const staffList = sw.split("const STAFF_ASSETS")[1].split("const PUBLIC_APP")[0];
for (const block of [publicList, staffList]) {
  assert.equal(block.includes('"/js/'), false, block);
  assert.equal(block.includes('"/vendor/'), false, block);
  assert.equal(block.includes('"/css/styles.css"'), false, block);
  assert.equal(block.includes('"/app/index.html"'), false, block);
  assert.equal(block.includes('"/app/"'), false, block);
}
assert.ok(staffList.includes('"/app/offline.html"'));
assert.ok(staffList.includes('"/app/manifest.webmanifest"'));
assert.equal(publicList.includes("/img/gi/"), false);
assert.equal(staffList.includes("/img/gi/"), false);
assert.ok(sw.includes('path.startsWith("/img/gi/")'));

const pwa = text("pwa.js");
assert.ok(pwa.includes('scope: scope'));
assert.ok(pwa.includes('updateViaCache: "none"'));
assert.ok(pwa.includes("bjj-install-dismiss-public"));
assert.ok(pwa.includes("bjj-install-dismiss-staff"));
assert.ok(pwa.includes("beforeinstallprompt"));
assert.ok(pwa.includes("Add to Home Screen"));
assert.ok(pwa.includes("checkinVideo"));
assert.ok(pwa.includes("15 * 60 * 1000"));

const kids = JSON.parse(text("manifest.webmanifest"));
assert.equal(kids.name, "Grace BJJ Kids");
assert.equal(kids.short_name, "Grace BJJ Kids");
assert.equal(kids.start_url, "/");
assert.equal(kids.scope, "/");
assert.equal(kids.id, "/");
assert.equal(kids.display, "standalone");
assert.equal(kids.background_color, "#fff8f3");
assert.equal(kids.theme_color, "#9b2a12");

const staff = JSON.parse(text("app/manifest.webmanifest"));
assert.equal(staff.name, "Grace BJJ Staff");
assert.equal(staff.short_name, "Grace BJJ Staff");
assert.equal(staff.start_url, "/app/");
assert.equal(staff.scope, "/app/");
assert.equal(staff.id, "/app/");
assert.equal(staff.display, "standalone");
assert.equal(staff.background_color, "#1c1917");
assert.equal(staff.theme_color, "#1c1917");

function iconRoles(manifest) {
  const any = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes).sort();
  const mask = manifest.icons.filter((icon) => icon.purpose === "maskable");
  assert.deepEqual(any, ["192x192", "512x512"]);
  assert.equal(mask.length, 1);
  assert.equal(mask[0].sizes, "512x512");
  manifest.icons.forEach((icon) => {
    const info = pngInfo(icon.src.slice(1));
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.equal(info.w, w, icon.src);
    assert.equal(info.h, h, icon.src);
    assert.equal(info.color, 2, icon.src + " should be opaque RGB");
  });
}

iconRoles(kids);
iconRoles(staff);

for (const rel of [
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/staff-apple-touch-icon.png",
  "icons/staff-favicon-32.png"
]) {
  const info = pngInfo(rel);
  const size = rel.includes("favicon") ? 32 : 180;
  assert.equal(info.w, size, rel);
  assert.equal(info.h, size, rel);
  assert.equal(info.color, 2, rel);
}

assert.ok(read("favicon.ico").readUInt16LE(0) === 0);
assert.equal(read("favicon.ico").readUInt16LE(2), 1);

for (const rel of ["index.html", "login/index.html", "coloring/index.html"]) {
  const html = text(rel);
  assert.ok(html.includes('href="/manifest.webmanifest"'), rel);
  assert.ok(html.includes('content="Grace BJJ Kids"'), rel);
  assert.ok(html.includes('name="apple-mobile-web-app-capable" content="yes"'), rel);
  assert.ok(html.includes('name="mobile-web-app-capable" content="yes"'), rel);
  assert.ok(html.includes('name="apple-mobile-web-app-status-bar-style" content="default"'), rel);
  assert.ok(html.includes('href="/icons/apple-touch-icon.png"'), rel);
  assert.ok(html.includes('src="/pwa.js?v=20261021-20"'), rel);
  assert.ok(html.includes('content="#9b2a12"'), rel);
}

const app = text("app/index.html");
assert.ok(app.includes('href="/app/manifest.webmanifest"'));
assert.ok(app.includes('content="Grace BJJ Staff"'));
assert.ok(app.includes('name="apple-mobile-web-app-capable" content="yes"'));
assert.ok(app.includes('name="apple-mobile-web-app-status-bar-style" content="black"'));
assert.ok(app.includes('href="/icons/staff-apple-touch-icon.png"'));
assert.ok(app.includes('src="/pwa.js?v=20261021-20"'));
assert.ok(app.includes('content="#1c1917"'));

assert.ok(text("offline.html").includes("Grace BJJ Kids"));
assert.ok(text("app/offline.html").includes("Grace BJJ Staff"));
assert.ok(!text("offline.html").includes("/api/"));
assert.ok(!text("app/offline.html").includes("/api/"));

const nginx = text("deploy/nginx-bjj.conf");
assert.ok(text("pwa.js").includes('"/sw.js" + (version ? "?v=" + encodeURIComponent(version) : "")'));
assert.ok(nginx.includes("location = /sw.js"));
assert.ok(nginx.includes("location = /manifest.webmanifest"));
assert.ok(nginx.includes("location = /app/manifest.webmanifest"));
assert.ok(nginx.includes("location = /app/offline.html"));
assert.ok(nginx.includes("application/manifest+json"));
assert.ok(nginx.includes("no-cache"));
assert.ok(nginx.includes("private, no-store"));

const http = text("server/httpapp.py");
assert.ok(http.includes('".webmanifest": "application/manifest+json"'));
assert.ok(http.includes('".ico": "image/x-icon"'));
assert.ok(http.includes('return "no-cache"'));
assert.ok(http.includes('return "private, no-store"'));

console.log("pwa static checks passed");
