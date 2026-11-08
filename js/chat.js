/* Chat assistant front end.
 * Talks to the portfolio chat API (see portfolio-chat-api/app.py). The browser sends only the
 * question and recent history; all knowledge lives server-side in knowledge.md.
 */
(function () {
  "use strict";

  var DEFAULT_API = "https://nagur-shareef-shaik-portfolio-chat-api.hf.space";
  var API_BASE = DEFAULT_API;
  // Local testing only: http://localhost:8000/?chat_api=http://localhost:7861
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var override = new URLSearchParams(location.search).get("chat_api");
    if (override) API_BASE = override.replace(/\/$/, "");
  }

  var MAX_CHARS = 1000;
  var MAX_HISTORY = 16; // messages kept and sent (server accepts up to 16)
  var GREETING = "Hi! I'm Shareef's AI assistant. Ask me about his research, dissertation, projects or experience.";
  var CHIPS = [
    ["Research", "What is Shareef's research about?"],
    ["Dissertation", "Summarize his dissertation and who his advisor is."],
    ["Projects", "What are his most notable projects?"],
    ["Experience", "What does he do at UST?"],
    ["Contact", "How can I contact him?"]
  ];

  var el = {
    btn: document.getElementById("chat-widget-btn"),
    win: document.getElementById("chat-widget-window"),
    msgs: document.getElementById("chat-messages"),
    chips: document.getElementById("chat-chips"),
    form: document.getElementById("chat-form"),
    input: document.getElementById("user-input"),
    send: document.getElementById("chat-send"),
    clear: document.getElementById("chat-clear"),
    close: document.getElementById("chat-close")
  };
  if (!el.btn || !el.win) return;

  var history = []; // [{role: "user"|"assistant", text}]
  var busy = false;

  // ---- storage (per-tab convenience; the widget works without it) ----
  function save() {
    try { sessionStorage.setItem("chat-history", JSON.stringify(history)); } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      var raw = sessionStorage.getItem("chat-history");
      var data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.filter(function (m) {
        return m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string";
      }).slice(-MAX_HISTORY) : [];
    } catch (e) { return []; }
  }

  // ---- rendering ----
  function render(text) {
    if (window.marked && window.DOMPurify) {
      return window.DOMPurify.sanitize(window.marked.parse(text, { breaks: true }), { USE_PROFILES: { html: true } });
    }
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/\n/g, "<br>");
  }
  if (window.DOMPurify) {
    window.DOMPurify.addHook("afterSanitizeAttributes", function (node) {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function addMessage(kind, text) {
    var div = document.createElement("div");
    div.className = "message " + kind;
    if (kind === "ai") div.innerHTML = render(text); else div.textContent = text;
    el.msgs.appendChild(div);
    el.msgs.scrollTop = el.msgs.scrollHeight;
    return div;
  }

  function reset() {
    history = [];
    save();
    el.msgs.textContent = "";
    addMessage("ai", GREETING);
    el.chips.hidden = false;
  }

  // ---- open / close ----
  function setOpen(open) {
    el.win.hidden = !open;
    el.btn.setAttribute("aria-expanded", String(open));
    if (open) el.input.focus(); else el.btn.focus();
  }

  // ---- networking ----
  function payload(message) {
    return JSON.stringify({ message: message, history: history.slice(-MAX_HISTORY) });
  }

  async function readError(res) {
    try {
      var body = await res.json();
      if (typeof body.detail === "string") return body.detail;
      if (res.status === 422) return "That message is too long or invalid. Please shorten it.";
    } catch (e) { /* ignore */ }
    return "Something went wrong (" + res.status + "). Please try again.";
  }

  async function streamReply(message, bubble) {
    var res = await fetch(API_BASE + "/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload(message)
    });
    if (!res.ok) throw new Error(await readError(res));
    if (!res.body || !res.body.getReader) throw new Error("__nostream__");

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = "", text = "", pending = false, errMsg = "";

    function paint() {
      pending = false;
      bubble.innerHTML = render(text);
      el.msgs.scrollTop = el.msgs.scrollHeight;
    }

    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      var parts = buf.split("\n\n");
      buf = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].replace(/^data: ?/, "");
        if (!line || line === "[DONE]") continue;
        try {
          var evt = JSON.parse(line);
          if (evt.t) { text += evt.t; bubble.classList.remove("typing"); }
          if (evt.error) errMsg = evt.error;
        } catch (e) { /* ignore malformed event */ }
      }
      if (!pending) { pending = true; requestAnimationFrame(paint); }
    }
    paint();
    if (!text && errMsg) throw new Error(errMsg);
    return text || errMsg;
  }

  async function plainReply(message) {
    var res = await fetch(API_BASE + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload(message)
    });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()).reply;
  }

  async function ask(message) {
    if (busy) return;
    message = message.trim();
    if (!message) return;
    if (message.length > MAX_CHARS) message = message.slice(0, MAX_CHARS);

    busy = true;
    el.send.disabled = true;
    el.input.value = "";
    el.chips.hidden = true;
    addMessage("user", message);
    var bubble = addMessage("ai", "");
    bubble.classList.add("typing");
    bubble.setAttribute("aria-busy", "true");

    var reply = "";
    try {
      try {
        reply = await streamReply(message, bubble);
      } catch (e) {
        if (e.message && e.message !== "__nostream__" && !(e instanceof TypeError)) throw e;
        reply = await plainReply(message); // streaming unavailable: use the non-streaming endpoint
        bubble.innerHTML = render(reply);
      }
      bubble.classList.remove("typing");
      history.push({ role: "user", text: message }, { role: "assistant", text: reply });
      history = history.slice(-MAX_HISTORY);
      save();
    } catch (e) {
      bubble.className = "message error";
      bubble.textContent = e.message && e.message.indexOf("Failed to fetch") === -1
        ? e.message
        : "I couldn't reach the assistant. Please try again in a moment.";
    } finally {
      bubble.removeAttribute("aria-busy");
      busy = false;
      el.send.disabled = false;
      el.input.focus();
      el.msgs.scrollTop = el.msgs.scrollHeight;
    }
  }

  // ---- wire up ----
  CHIPS.forEach(function (c) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = c[0];
    b.addEventListener("click", function () { ask(c[1]); });
    el.chips.appendChild(b);
  });

  el.btn.addEventListener("click", function () { setOpen(el.win.hidden); });
  el.close.addEventListener("click", function () { setOpen(false); });
  el.clear.addEventListener("click", reset);
  el.form.addEventListener("submit", function (e) { e.preventDefault(); ask(el.input.value); });
  el.win.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });

  history = load();
  el.msgs.textContent = "";
  addMessage("ai", GREETING);
  if (history.length) {
    el.chips.hidden = true;
    history.forEach(function (m) { addMessage(m.role === "user" ? "user" : "ai", m.text); });
  }
})();
