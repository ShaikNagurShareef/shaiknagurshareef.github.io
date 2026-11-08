/* Renders the publication lists from data/*.json and adds search + "oral only" filtering. */
(function () {
  "use strict";
  var LISTS = [
    { id: "pub-conferences", src: "data/conferences.json" },
    { id: "pub-journals", src: "data/journals.json" },
    { id: "pub-workshops", src: "data/workshops.json" },
    { id: "pub-review", src: "data/under-review.json" }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function textOf(html) {
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return d.textContent || "";
  }

  // The JSON files are first-party and contain small HTML snippets (<strong>, badges, <span> colours).
  function itemHtml(p) {
    return '<i class="fa-li" aria-hidden="true">&#128196;</i>' +
      '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + "</a>" + (p.new || "") +
      "<br/>" + (p.authors || "") + "<br/>" + (p.medium || "") + (p.year ? ", " + esc(p.year) : "");
  }

  var groups = [];

  function render(list, items) {
    var ul = document.getElementById(list.id);
    if (!ul) return;
    ul.textContent = "";
    var group = { ul: ul, rows: [], heading: ul.previousElementSibling };
    items.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "pub-item mb-2";
      li.innerHTML = itemHtml(p);
      group.rows.push({ li: li, text: textOf(itemHtml(p)).toLowerCase(), oral: /oral/i.test(p.medium || "") });
      ul.appendChild(li);
    });
    if (group.heading) {
      var count = document.createElement("span");
      count.className = "pub-count";
      group.heading.appendChild(count);
      group.count = count;
    }
    groups.push(group);
  }

  function applyFilter() {
    var q = (document.getElementById("pub-search").value || "").trim().toLowerCase();
    var oral = document.getElementById("pub-oral").getAttribute("aria-pressed") === "true";
    var terms = q.split(/\s+/).filter(Boolean);
    var total = 0;
    groups.forEach(function (g) {
      var shown = 0;
      g.rows.forEach(function (r) {
        var ok = (!oral || r.oral) && terms.every(function (t) { return r.text.indexOf(t) !== -1; });
        r.li.hidden = !ok;
        if (ok) shown++;
      });
      total += shown;
      if (g.count) g.count.textContent = " (" + shown + (shown !== g.rows.length ? " of " + g.rows.length : "") + ")";
      g.ul.hidden = shown === 0;
    });
    document.getElementById("pub-status").textContent = total + " paper" + (total === 1 ? "" : "s") + " shown";
  }

  function init() {
    var search = document.getElementById("pub-search");
    var oral = document.getElementById("pub-oral");
    if (!search || !oral) return;
    search.addEventListener("input", applyFilter);
    oral.addEventListener("click", function () {
      oral.setAttribute("aria-pressed", String(oral.getAttribute("aria-pressed") !== "true"));
      applyFilter();
    });
    Promise.all(LISTS.map(function (list) {
      return fetch(list.src).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then(function (items) { render(list, items); })
        .catch(function () {
          var ul = document.getElementById(list.id);
          if (ul) ul.innerHTML = '<li class="text-muted">Could not load this list. Please refresh.</li>';
        });
    })).then(applyFilter);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
