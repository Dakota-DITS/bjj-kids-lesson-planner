/* BJJ_BASE_AWARE
   Public prefix helper. An empty bjj-base meta is production: this file
   does nothing visible. The demo publisher sets the meta to /demo. */
(function () {
  var meta = document.querySelector('meta[name="bjj-base"]');
  var base = meta ? String(meta.getAttribute("content") || "") : "";
  base = base.replace(/\/$/, "");
  if (base && (base.charAt(0) !== "/" || base.charAt(1) === "/")) base = "";
  window.BJJ_BASE = base;

  function prefix(value) {
    if (!base || typeof value !== "string") return value;
    if (value.charAt(0) !== "/" || value.charAt(1) === "/") return value;
    if (value === base || value.indexOf(base + "/") === 0) return value;
    return base + value;
  }
  window.bjjPath = prefix;

  if (!base) return;

  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      if (typeof input === "string") input = prefix(input);
      return origFetch.call(this, input, init);
    };
  }

  if (navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
    var origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (url, options) {
      options = options ? Object.assign({}, options) : {};
      var text = String(url || "");
      var queryAt = text.indexOf("?");
      var path = queryAt === -1 ? text : text.slice(0, queryAt);
      var query = queryAt === -1 ? "" : text.slice(queryAt);
      if (path.charAt(0) === "/") path = prefix(path);
      var scope = options.scope || "/";
      if (scope.charAt(0) === "/" && scope !== base && scope.indexOf(base + "/") !== 0) {
        var staff = scope.indexOf("/app/") !== -1 || location.pathname.indexOf(base + "/app/") === 0;
        scope = staff ? base + "/app/" : base + "/";
      }
      options.scope = scope;
      if (!options.updateViaCache) options.updateViaCache = "none";
      return origRegister(path + query, options);
    };
  }

  function prefixSrcset(value) {
    return String(value).replace(/(^|,\s*)(\/[^,\s]+)/g, function (all, lead, url) {
      return lead + prefix(url);
    });
  }

  function rewriteElement(el) {
    if (!el || el.nodeType !== 1 || el.id === "bjj-demo-banner") return;
    ["href", "src", "action", "poster"].forEach(function (attr) {
      if (!el.getAttribute) return;
      var value = el.getAttribute(attr);
      if (!value) return;
      var next = prefix(value);
      if (next !== value) el.setAttribute(attr, next);
    });
    if (el.getAttribute && el.hasAttribute("srcset")) {
      var srcset = el.getAttribute("srcset");
      var nextSet = prefixSrcset(srcset);
      if (nextSet !== srcset) el.setAttribute("srcset", nextSet);
    }
  }

  function rewriteTree(root) {
    if (!root || !root.querySelectorAll) return;
    rewriteElement(root);
    root.querySelectorAll("[href], [src], [action], [poster], [srcset]").forEach(rewriteElement);
  }

  function labelPayments() {
    document.querySelectorAll('a[href*="onrealm.org"]').forEach(function (link) {
      if (link.getAttribute("data-demo-labeled") === "1") return;
      link.setAttribute("data-demo-labeled", "1");
      var note = document.createElement("span");
      note.className = "bjj-demo-pay";
      note.textContent = " Demo preview: this opens the real giving page. This demo does not take payments.";
      link.insertAdjacentElement("afterend", note);
    });
  }

  function banner() {
    if (document.getElementById("bjj-demo-banner")) return;
    if (!document.getElementById("bjj-demo-style")) {
      var style = document.createElement("style");
      style.id = "bjj-demo-style";
      style.textContent = [
        "#bjj-demo-banner{position:sticky;top:0;z-index:10000;margin:0;padding:10px 16px;min-height:44px;box-sizing:border-box;background:#ffe14a;color:#1c1917;border-bottom:4px solid #9b2a12;font:700 16px/1.35 'Segoe UI',sans-serif;text-align:center}",
        ".bjj-demo-pay{display:block;margin:8px 0 0;color:#1c1917;background:#ffe14a;padding:8px 10px;font-weight:700}",
        "@media print{#bjj-demo-banner,.bjj-demo-pay{display:block !important}}"
      ].join("");
      document.head.appendChild(style);
    }
    var bar = document.createElement("div");
    bar.id = "bjj-demo-banner";
    bar.setAttribute("role", "status");
    bar.textContent = "DEMO PREVIEW, not live. This preview does not email anyone and does not take payments.";
    document.body.insertBefore(bar, document.body.firstChild);
    rewriteTree(document);
    labelPayments();
  }

  function start() {
    banner();
    if (!window.MutationObserver || !document.body) return;
    var observer = new MutationObserver(function () {
      rewriteTree(document.body);
      labelPayments();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src", "action", "srcset"] });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
