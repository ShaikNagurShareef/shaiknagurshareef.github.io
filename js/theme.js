/* Theme toggle (light/dark). The initial theme is applied by a tiny inline script in <head> to avoid a flash. */
(function () {
  "use strict";
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  function current() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function paint() {
    var dark = current() === "dark";
    btn.setAttribute("aria-pressed", String(dark));
    btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    btn.innerHTML = dark ? '<i class="fas fa-sun" aria-hidden="true"></i>' : '<i class="fas fa-moon" aria-hidden="true"></i>';
  }
  btn.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
    paint();
  });
  paint();
})();
