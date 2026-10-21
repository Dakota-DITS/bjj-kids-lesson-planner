/* Static shell only. VERSION matches the ?v= token on HTML script and style
   links. Online loads are network-first, so a 15-minute deploy still shows
   up before this file itself changes. /api/ is never stored. */
const VERSION = "20261021-2";

const PUBLIC_CACHE = "grace-public-" + VERSION;
const STAFF_CACHE = "grace-staff-" + VERSION;

const PUBLIC_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/coloring",
  "/coloring/",
  "/coloring/index.html",
  "/login",
  "/login/",
  "/login/index.html",
  "/css/splash.css",
  "/coloring/coloring.css",
  "/coloring/catalog.js",
  "/manifest.webmanifest",
  "/pwa.js",
  "/sw.js",
  "/favicon.ico",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/img/logo/grace-logo-mark-transparent.png",
  "/fonts/LuckiestGuy-Regular.ttf",
  "/fonts/Fredoka-SemiBold.ttf"
];

const STAFF_ASSETS = [
  "/app",
  "/app/",
  "/app/index.html",
  "/app/offline.html",
  "/app/manifest.webmanifest",
  "/css/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/data.js",
  "/js/curriculum.js",
  "/js/plan-math.js",
  "/vendor/qrcode-generator/qrcode.js",
  "/vendor/jsQR/jsQR.js",
  "/pwa.js",
  "/sw.js",
  "/icons/staff-favicon-32.png",
  "/icons/staff-apple-touch-icon.png",
  "/icons/staff-icon-192.png",
  "/icons/staff-icon-512.png",
  "/icons/staff-icon-maskable-512.png",
  "/img/logo/grace-logo-mark-transparent.png",
  "/img/logo/grace-logo-mark-reversed-transparent.png",
  "/fonts/LuckiestGuy-Regular.ttf",
  "/fonts/Fredoka-SemiBold.ttf"
];

function staffScope() {
  return new URL(self.registration.scope).pathname.indexOf("/app") === 0;
}

function cacheName() {
  return staffScope() ? STAFF_CACHE : PUBLIC_CACHE;
}

function assetList() {
  return staffScope() ? STAFF_ASSETS : PUBLIC_ASSETS;
}

function offlinePath() {
  return staffScope() ? "/app/offline.html" : "/offline.html";
}

async function storeFresh(cache, path) {
  try {
    const res = await fetch(path, { credentials: "same-origin", cache: "reload" });
    if (!res.ok || res.redirected || res.type !== "basic") return;
    if (new URL(res.url).pathname !== path) return;
    await cache.put(path, res);
  } catch (err) {
    /* A locked staff file must not block the public install. */
  }
}

async function networkFirst(request, path, allowed) {
  const cache = await caches.open(cacheName());
  try {
    const res = await fetch(request);
    if (allowed.has(path) && res.ok && !res.redirected && res.type === "basic" && new URL(res.url).pathname === path) {
      await cache.put(path, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(path);
    if (hit) return hit;
    if (request.mode === "navigate") {
      const offline = await cache.match(offlinePath());
      if (offline) return offline;
    }
    throw err;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName());
    await Promise.all(assetList().map((path) => storeFresh(cache, path)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  const prefix = staffScope() ? "grace-staff-" : "grace-public-";
  const current = cacheName();
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== current).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }
  const allowed = new Set(assetList());
  const path = url.pathname;
  if (request.mode !== "navigate" && !allowed.has(path)) return;
  event.respondWith(networkFirst(request, path, allowed));
});
