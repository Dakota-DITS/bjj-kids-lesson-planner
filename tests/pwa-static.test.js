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
assert.ok(sw.includes('const VERSION = "20261029-63"'));
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

const adult = JSON.parse(text("manifest.webmanifest"));
assert.equal(adult.name, "Grace BJJ");
assert.equal(adult.short_name, "Grace BJJ");
assert.equal(adult.start_url, "/");
assert.equal(adult.scope, "/");
assert.equal(adult.id, "/");
assert.equal(adult.display, "standalone");
assert.equal(adult.background_color, "#1c1917");
assert.equal(adult.theme_color, "#9b2a12");

const kidsManifest = JSON.parse(text("kids/manifest.webmanifest"));
assert.equal(kidsManifest.name, "Grace BJJ Kids");
assert.equal(kidsManifest.short_name, "Grace BJJ Kids");
assert.equal(kidsManifest.start_url, "/kids/");
assert.equal(kidsManifest.scope, "/kids/");
assert.equal(kidsManifest.id, "/kids/");
assert.equal(kidsManifest.display, "standalone");
assert.equal(kidsManifest.theme_color, "#9b2a12");

const coloringManifest = JSON.parse(text("coloring/manifest.webmanifest"));
assert.equal(coloringManifest.name, "Grace BJJ Kids");
assert.equal(coloringManifest.short_name, "Grace BJJ Kids");
assert.equal(coloringManifest.start_url, "/coloring/");
assert.equal(coloringManifest.scope, "/coloring/");
assert.equal(coloringManifest.id, "/coloring/");

const loginManifest = JSON.parse(text("login/manifest.webmanifest"));
assert.equal(loginManifest.name, "Grace BJJ Staff");
assert.equal(loginManifest.short_name, "Grace BJJ Staff");
assert.equal(loginManifest.start_url, "/login/");
assert.equal(loginManifest.scope, "/login/");
assert.equal(loginManifest.id, "/login/");

const staff = JSON.parse(text("app/manifest.webmanifest"));
assert.equal(staff.name, "Grace BJJ Staff");
assert.equal(staff.short_name, "Grace BJJ Staff");
assert.equal(staff.start_url, "/app/");
assert.equal(staff.scope, "/app/");
assert.equal(staff.id, "/app/");
assert.equal(staff.display, "standalone");
assert.equal(staff.background_color, "#1c1917");
assert.equal(staff.theme_color, "#1c1917");
assert.notEqual(adult.id, kidsManifest.id);
assert.notEqual(adult.id, staff.id);
assert.notEqual(kidsManifest.id, staff.id);

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

iconRoles(adult);
iconRoles(kidsManifest);
iconRoles(coloringManifest);
iconRoles(loginManifest);
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

for (const rel of ["kids/index.html", "kids/waiver/index.html"]) {
  const html = text(rel);
  assert.ok(html.includes('href="/kids/manifest.webmanifest"'), rel);
  assert.ok(html.includes('name="application-name" content="Grace BJJ Kids"'), rel);
  assert.ok(html.includes('name="apple-mobile-web-app-title" content="Grace BJJ Kids"'), rel);
  assert.ok(html.includes('src="/pwa.js?v=20261029-63"'), rel);
}
const coloring = text("coloring/index.html");
assert.ok(coloring.includes('href="/coloring/manifest.webmanifest"'));
assert.ok(coloring.includes('name="application-name" content="Grace BJJ Kids"'));
assert.ok(coloring.includes('name="apple-mobile-web-app-title" content="Grace BJJ Kids"'));
assert.ok(coloring.includes('src="/pwa.js?v=20261029-63"'));
const login = text("login/index.html");
assert.ok(login.includes('href="/login/manifest.webmanifest"'));
assert.ok(login.includes('name="application-name" content="Grace BJJ Staff"'));
assert.ok(login.includes('name="apple-mobile-web-app-title" content="Grace BJJ Staff"'));
assert.equal(login.includes('content="Grace BJJ Kids"'), false);
assert.ok(login.includes('src="/pwa.js?v=20261029-63"'));

const app = text("app/index.html");
assert.ok(app.includes('href="/app/manifest.webmanifest"'));
assert.ok(app.includes('name="application-name" content="Grace BJJ Staff"'));
assert.ok(app.includes('name="apple-mobile-web-app-title" content="Grace BJJ Staff"'));
assert.ok(text("app/waivers/index.html").includes('href="/app/manifest.webmanifest"'));
assert.ok(text("app/waitlist/index.html").includes('href="/app/manifest.webmanifest"'));
assert.ok(app.includes('name="apple-mobile-web-app-capable" content="yes"'));
assert.ok(app.includes('name="apple-mobile-web-app-status-bar-style" content="black"'));
assert.ok(app.includes('href="/icons/staff-apple-touch-icon.png"'));
assert.ok(app.includes('src="/pwa.js?v=20261029-63"'));
assert.ok(app.includes('content="#1c1917"'));

assert.ok(text("index.html").includes('name="application-name" content="Grace BJJ"'));
assert.ok(text("index.html").includes('name="apple-mobile-web-app-title" content="Grace BJJ"'));
assert.equal(text("index.html").includes('content="Grace BJJ Kids"'), false);
assert.ok(text("index.html").includes('href="/manifest.webmanifest"'));
assert.ok(text("waiver/index.html").includes('href="/manifest.webmanifest"'));
assert.ok(text("waiver/index.html").includes('name="apple-mobile-web-app-title" content="Grace BJJ"'));
assert.equal(text("p/index.html").includes("manifest"), false);
assert.ok(text("index.html").includes('name="apple-mobile-web-app-capable" content="yes"'));
assert.ok(text("index.html").includes('href="/icons/apple-touch-icon.png"'));
assert.ok(text("index.html").includes('content="#9b2a12"'));
assert.ok(text("offline.html").includes("Grace BJJ"));
assert.equal(text("offline.html").includes("Grace BJJ Kids"), false);
assert.ok(text("app/offline.html").includes("Grace BJJ Staff"));
assert.ok(!text("offline.html").includes("/api/"));
assert.ok(!text("app/offline.html").includes("/api/"));

const nginx = text("deploy/nginx-bjj.conf");
assert.ok(text("pwa.js").includes('"/sw.js" + (version ? "?v=" + encodeURIComponent(version) : "")'));
assert.ok(nginx.includes("location = /sw.js"));
assert.ok(nginx.includes("location = /manifest.webmanifest"));
assert.ok(nginx.includes("location = /kids/manifest.webmanifest"));
assert.ok(nginx.includes("location = /coloring/manifest.webmanifest"));
assert.ok(nginx.includes("location = /login/manifest.webmanifest"));
assert.ok(nginx.includes("location = /app/manifest.webmanifest"));
assert.ok(text("pwa.js").includes("Add Grace BJJ to your home screen."));
assert.ok(text("pwa.js").includes("Add Grace BJJ Kids to your home screen."));
assert.ok(text("pwa.js").includes("Add Grace BJJ Staff to your home screen."));
assert.equal(text("pwa.js").includes("Lesson Planner"), false);
assert.equal(text("pwa.js").includes("Planner"), false);
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
