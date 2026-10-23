/* Header menu for narrow screens. Desktop keeps the links in the bar. */
(function () {
  var header = document.querySelector("[data-site-header]");
  if (!header) return;
  var button = header.querySelector(".nav-toggle");
  var nav = header.querySelector(".site-nav");
  var query = window.matchMedia("(max-width: 800px)");

  function narrow() {
    return query.matches;
  }

  function measure() {
    var bar = header.querySelector(".top-bar") || header;
    var height = Math.ceil(bar.getBoundingClientRect().height);
    if (height > 0) document.documentElement.style.setProperty("--site-header-h", height + "px");
  }

  function setExpanded(open) {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-label", open ? "Close menu" : "Menu");
  }

  function shut() {
    header.classList.remove("is-open");
    setExpanded(false);
  }

  measure();
  window.addEventListener("resize", measure);
  if (!button || !nav) return;

  button.addEventListener("click", function () {
    if (!narrow()) return;
    if (header.classList.contains("is-open")) shut();
    else {
      header.classList.add("is-open");
      setExpanded(true);
      var first = nav.querySelector("a, button");
      if (first) first.focus();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !header.classList.contains("is-open")) return;
    event.preventDefault();
    shut();
    button.focus();
  });

  document.addEventListener("click", function (event) {
    if (!header.classList.contains("is-open") || header.contains(event.target)) return;
    var inside = nav.contains(document.activeElement);
    shut();
    if (inside) button.focus();
  });

  nav.addEventListener("click", function (event) {
    if (narrow() && event.target.closest("a")) shut();
  });

  nav.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || !header.classList.contains("is-open")) return;
    var items = nav.querySelectorAll("a, button");
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function onMode() {
    if (!narrow()) shut();
    measure();
  }

  if (query.addEventListener) query.addEventListener("change", onMode);
  else if (query.addListener) query.addListener(onMode);
})();
