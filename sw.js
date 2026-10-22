/* Static shell only. VERSION matches the ?v= token on HTML script and style
   links. Public files are network-first. Login-gated files are never stored:
   Cache Storage is shared by everyone who uses the phone, so a private or
   no-store response must not survive logout. /api/ is network-only. */
const VERSION = "20261021-22";

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
  "/calendar/class-days.js",
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
  "/app/offline.html",
  "/app/manifest.webmanifest",
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

const PUBLIC_APP = new Set(["/app/offline.html", "/app/manifest.webmanifest"]);

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

function isGated(pathname) {
  if (pathname.startsWith("/js/") || pathname.startsWith("/vendor/")) return true;
  if (pathname === "/css/styles.css") return true;
  if (pathname === "/app" || pathname === "/app/" || pathname === "/app/index.html") return true;
  if (pathname.startsWith("/app/") && !PUBLIC_APP.has(pathname)) return true;
  return false;
}

function storeable(res, path) {
  if (!res || !res.ok || res.redirected || res.type !== "basic") return false;
  let pathname = "";
  try {
    pathname = new URL(res.url).pathname;
  } catch (err) {
    return false;
  }
  if (pathname !== path || isGated(pathname)) return false;
  const header = res.headers.get("Cache-Control") || "";
  if (/private|no-store/i.test(header)) return false;
  return true;
}

async function storeFresh(cache, path) {
  try {
    const res = await fetch(path, { credentials: "same-origin", cache: "reload" });
    if (!storeable(res, path)) return;
    await cache.put(path, res);
  } catch (err) {
    /* A missing public file must not block the install. */
  }
}

async function cachedOffline() {
  const names = staffScope() ? [STAFF_CACHE, PUBLIC_CACHE] : [PUBLIC_CACHE];
  for (const name of names) {
    const cache = await caches.open(name);
    const hit = await cache.match(offlinePath()) || await cache.match("/offline.html");
    if (hit) return hit;
  }
  return null;
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    if (request.mode === "navigate") {
      const offline = await cachedOffline();
      if (offline) return offline;
    }
    throw err;
  }
}

async function networkFirst(request, path, allowed) {
  const cache = await caches.open(cacheName());
  try {
    const res = await fetch(request);
    if (allowed.has(path) && storeable(res, path)) {
      await cache.put(path, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(path);
    if (hit) return hit;
    if (request.mode === "navigate") {
      const offline = await cachedOffline();
      if (offline) return offline;
    }
    throw err;
  }
}

async function dropStaffCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("grace-staff-")).map((key) => caches.delete(key)));
}

async function ensurePublicPrecache() {
  const cache = await caches.open(cacheName());
  const keys = await cache.keys();
  const have = new Set();
  keys.forEach((req) => {
    try {
      have.add(new URL(req.url).pathname);
    } catch (err) {
      /* skip a bad cache key */
    }
  });
  const missing = assetList().filter((path) => !have.has(path));
  await Promise.all(missing.map((path) => storeFresh(cache, path)));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName());
    await Promise.all(assetList().map((path) => storeFresh(cache, path)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => {
      if (key.startsWith("grace-staff-") && key !== STAFF_CACHE) return true;
      if (key.startsWith("grace-public-") && key !== PUBLIC_CACHE) return true;
      return false;
    }).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "logout") {
    event.waitUntil(dropStaffCaches());
    return;
  }
  if (data.type === "precache") event.waitUntil(ensurePublicPrecache());
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
  const path = url.pathname;
  if (isGated(path)) {
    event.respondWith(networkOnly(request));
    return;
  }
  const allowed = new Set(assetList());
  if (path.startsWith("/img/gi/")) allowed.add(path);
  if (request.mode !== "navigate" && !allowed.has(path)) return;
  event.respondWith(networkFirst(request, path, allowed));
});
