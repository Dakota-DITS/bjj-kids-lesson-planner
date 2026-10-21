(function () {
  if (!("serviceWorker" in navigator)) return;

  var staff = location.pathname === "/app" || location.pathname.indexOf("/app/") === 0;
  var scope = staff ? "/app/" : "/";
  var dismissKey = staff ? "bjj-install-dismiss-staff" : "bjj-install-dismiss-public";
  var refreshing = false;
  var hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (refreshing) return;
    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    var video = document.getElementById("checkinVideo");
    if (video && video.srcObject) return;
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker.register("/sw.js", { scope: scope, updateViaCache: "none" }).then(function (reg) {
    function update() {
      reg.update().catch(function () {});
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") update();
    });
    window.setInterval(update, 15 * 60 * 1000);
  }).catch(function () {});

  function installed() {
    if (navigator.standalone === true) return true;
    return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)").matches;
  }

  if (installed()) return;

  var deferred = null;
  var tip = null;

  function dismiss() {
    try { localStorage.setItem(dismissKey, "1"); } catch (err) { /* private mode */ }
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    tip = null;
    deferred = null;
  }

  function dismissed() {
    try { return localStorage.getItem(dismissKey) === "1"; } catch (err) { return true; }
  }

  function show(ios) {
    if (tip || installed() || dismissed()) return;
    if (!document.getElementById("pwa-tip-style")) {
      var style = document.createElement("style");
      style.id = "pwa-tip-style";
      style.textContent = [
        ".pwa-tip{position:fixed;z-index:22;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;align-items:center;gap:8px;box-sizing:border-box;max-width:calc(100vw - 24px);padding:12px;border-radius:16px;font-size:16px;line-height:1.35;box-shadow:0 8px 24px rgba(20,17,15,.18)}",
        ".pwa-tip p{margin:0;flex:1 1 180px}",
        ".pwa-tip button{min-height:44px;padding:8px 14px;border-radius:999px;font:inherit;font-size:16px;cursor:pointer}",
        ".pwa-tip-public{background:#fff8f3;color:#14110f;border:1px solid #eadfd6}",
        ".pwa-tip-public button.add{background:#9b2a12;color:#fff8f3;border:0}",
        ".pwa-tip-public button.later{background:transparent;color:#14110f;border:1px solid #eadfd6}",
        ".pwa-tip-staff{background:#1c1917;color:#fff8f3;border:1px solid #44403c}",
        ".pwa-tip-staff button.add{background:#fff8f3;color:#1c1917;border:0}",
        ".pwa-tip-staff button.later{background:transparent;color:#fff8f3;border:1px solid #57534e}",
        "@media print{.pwa-tip{display:none !important}}"
      ].join("");
      document.head.appendChild(style);
    }
    tip = document.createElement("div");
    tip.className = "pwa-tip no-print " + (staff ? "pwa-tip-staff" : "pwa-tip-public");
    tip.setAttribute("role", "region");
    tip.setAttribute("aria-label", "Add to home screen");
    var text = document.createElement("p");
    if (ios) {
      text.textContent = "To install, tap Share, then Add to Home Screen.";
    } else {
      text.textContent = staff ? "Add Grace BJJ Staff to your home screen." : "Add Grace BJJ Kids to your home screen.";
    }
    tip.appendChild(text);
    if (!ios) {
      var add = document.createElement("button");
      add.type = "button";
      add.className = "add";
      add.textContent = "Add";
      add.addEventListener("click", function () {
        if (!deferred) return;
        var promptEvent = deferred;
        deferred = null;
        promptEvent.prompt();
        promptEvent.userChoice.then(dismiss, dismiss);
      });
      tip.appendChild(add);
    }
    var later = document.createElement("button");
    later.type = "button";
    later.className = "later";
    later.textContent = "Not now";
    later.addEventListener("click", dismiss);
    tip.appendChild(later);
    document.body.appendChild(tip);
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    if (dismissed() || installed()) return;
    event.preventDefault();
    deferred = event;
    show(false);
  });

  window.addEventListener("appinstalled", dismiss);

  var ua = navigator.userAgent || "";
  var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { show(true); });
    } else {
      show(true);
    }
  }
})();
