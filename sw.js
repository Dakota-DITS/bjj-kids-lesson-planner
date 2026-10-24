/* Static shell only. VERSION matches the ?v= token on HTML script and style
   links. Public files are network-first. Login-gated files are never stored:
   Cache Storage is shared by everyone who uses the phone, so a private or
   no-store response must not survive logout. /api/ is network-only. */
const VERSION = "20261024-53";

function workerBasePath() {
  var path = "";
  try {
    path = new URL(self.location.href).pathname;
  } catch (err) {
    path = "";
  }
  var suffix = "/sw.js";
  if (path.endsWith(suffix)) return path.slice(0, -suffix.length);
  return "";
}

const workerBase = workerBasePath();
const PUBLIC_CACHE = (workerBase ? "grace-demo-public-" : "grace-public-") + VERSION;
const STAFF_CACHE = (workerBase ? "grace-demo-staff-" : "grace-staff-") + VERSION;

const PUBLIC_ASSETS = [
  "/",
  "/index.html",
  "/kids",
  "/kids/",
  "/kids/index.html",
  "/css/home.css",
  "/adult-class.json",
  "/waiver",
  "/waiver/",
  "/waiver/index.html",
  "/waiver/waiver.js",
  "/kids/waiver",
  "/kids/waiver/",
  "/kids/waiver/index.html",
  "/css/waiver.css",
  "/waiver-config.json",
  "/privacy",
  "/privacy/",
  "/privacy/index.html",
  "/offline.html",
  "/coloring",
  "/coloring/",
  "/coloring/index.html",
  "/login",
  "/login/",
  "/login/index.html",
  "/p",
  "/p/",
  "/p/index.html",
  "/css/splash.css",
  "/css/site-header.css",
  "/site-nav.js",
  "/coloring/coloring.css",
  "/coloring/catalog.js",
  "/calendar/class-days.js",
  "/manifest.webmanifest",
  "/kids/manifest.webmanifest",
  "/coloring/manifest.webmanifest",
  "/login/manifest.webmanifest",
  "/pwa.js",
  "/bjj-base.js",
  "/sw.js",
  "/favicon.ico",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/img/logo/grace-logo-mark-transparent.png",
  "/img/logo/grace-logo-mark-reversed-transparent.png",
  "/img/logo/grace-logo-kids-transparent.png",
  "/img/logo/grace-logo-kids-reversed-transparent.png",
  "/fonts/LuckiestGuy-Regular.ttf",
  "/fonts/Fredoka-SemiBold.ttf"
];

const STAFF_ASSETS = [
  "/app/offline.html",
  "/app/manifest.webmanifest",
  "/pwa.js",
  "/bjj-base.js",
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
  var path = new URL(self.registration.scope).pathname;
  if (path.endsWith("/")) path = path.slice(0, -1);
  return path.endsWith("/app");
}

function absAsset(path) {
  if (!workerBase) return path;
  if (!path || path.charAt(0) !== "/") return path;
  if (path === workerBase || path.indexOf(workerBase + "/") === 0) return path;
  if (path === "/") return workerBase + "/";
  return workerBase + path;
}

function rootOf(pathname) {
  if (!workerBase) return pathname;
  if (pathname === workerBase) return "/";
  var prefix = workerBase + "/";
  if (pathname.indexOf(prefix) === 0) return pathname.slice(workerBase.length) || "/";
  return pathname;
}

function cacheName() {
  return staffScope() ? STAFF_CACHE : PUBLIC_CACHE;
}

function assetList() {
  return staffScope() ? STAFF_ASSETS : PUBLIC_ASSETS;
}

function offlinePath() {
  return absAsset(staffScope() ? "/app/offline.html" : "/offline.html");
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
  if (pathname !== path || isGated(rootOf(pathname))) return false;
  const header = res.headers.get("Cache-Control") || "";
  if (/private|no-store/i.test(header)) return false;
  return true;
}

async function storeFresh(cache, path) {
  const abs = absAsset(path);
  try {
    const res = await fetch(abs, { credentials: "same-origin", cache: "reload" });
    if (!storeable(res, abs)) return;
    await cache.put(abs, res);
  } catch (err) {
    /* A missing public file must not block the install. */
  }
}

async function cachedOffline() {
  const names = staffScope() ? [STAFF_CACHE, PUBLIC_CACHE] : [PUBLIC_CACHE];
  for (const name of names) {
    const cache = await caches.open(name);
    const hit = await cache.match(offlinePath()) || await cache.match(absAsset("/offline.html"));
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
  const prefix = workerBase ? "grace-demo-staff-" : "grace-staff-";
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => caches.delete(key)));
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
  const missing = assetList().filter((path) => !have.has(absAsset(path)));
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
    const staffPrefix = workerBase ? "grace-demo-staff-" : "grace-staff-";
    const publicPrefix = workerBase ? "grace-demo-public-" : "grace-public-";
    await Promise.all(keys.filter((key) => {
      if (key.startsWith(staffPrefix) && key !== STAFF_CACHE) return true;
      if (key.startsWith(publicPrefix) && key !== PUBLIC_CACHE) return true;
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
  if (!workerBase && (url.pathname === "/demo" || url.pathname.startsWith("/demo/"))) return;
  if (workerBase && url.pathname !== workerBase && !url.pathname.startsWith(workerBase + "/")) return;
  const fullPath = url.pathname;
  if (workerBase) url = { pathname: url.pathname.slice(workerBase.length) || "/", origin: url.origin };
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }
  const path = fullPath;
  const rooted = rootOf(path);
  if (isGated(rooted)) {
    event.respondWith(networkOnly(request));
    return;
  }
  const allowed = new Set(assetList().map(absAsset));
  if (path.startsWith("/img/gi/") || rooted.startsWith("/img/gi/")) allowed.add(path);
  if (request.mode !== "navigate" && !allowed.has(path)) return;
  event.respondWith(networkFirst(request, path, allowed));
});
