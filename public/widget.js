(function () {
  // Guard against accidental double-load (e.g., script tag in two layouts/components)
  if (window.__cb_widget_loaded) return;
  window.__cb_widget_loaded = true;

  "use strict";

  // Find our own script tag robustly. document.currentScript can be null when
  // the script is injected dynamically (e.g., Next.js <Script> component), so
  // we look for any script with data-bot-id — that's our marker.
  function findScript() {
    if (document.currentScript && document.currentScript.hasAttribute("data-bot-id")) {
      return document.currentScript;
    }
    var list = document.querySelectorAll("script[data-bot-id]");
    if (list.length) return list[list.length - 1];
    var all = document.getElementsByTagName("script");
    return all[all.length - 1];
  }
  var script = findScript();
  var BOT_KEY = script && script.getAttribute("data-bot-id");
  var DEFAULT_API = script && script.src ? script.src.split("/").slice(0, 3).join("/") : "";
  var API_BASE = (script && script.getAttribute("data-api")) || DEFAULT_API;
  var TITLE = (script && script.getAttribute("data-title")) || "Chat with us";
  var STORE_KEY = "cb_vid_" + BOT_KEY;

  if (!BOT_KEY) { console.warn("[chatbot] missing data-bot-id"); return; }
  if (document.getElementById("cb-root-v1")) return;  // guard against double-injection

  // Resolve relative URLs (e.g., /static/uploads/x.png) against the ChatBot
  // server origin so they work when the widget is hosted on a customer site.
  function absUrl(u) {
    if (!u || typeof u !== "string") return u;
    if (/^(https?:|data:|blob:)/i.test(u)) return u;
    if (u.charAt(0) === "/") return API_BASE + u;
    return u;
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function openLightbox(src, alt) {
    var img = h("img", { src: src, alt: alt || "" });
    img.addEventListener("click", function (ev) { ev.stopPropagation(); });
    var closeBtn = h("button", { class: "cb-lightbox-close", "aria-label": "Close", text: "×" });
    var box = h("div", { class: "cb-lightbox", role: "dialog", "aria-modal": "true" }, [img, closeBtn]);
    function close() {
      if (box.parentNode) box.parentNode.removeChild(box);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    box.addEventListener("click", close);
    closeBtn.addEventListener("click", function (ev) { ev.stopPropagation(); close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(box);
  }

  function captureUtm() {
    var q = new URLSearchParams(window.location.search);
    return {
      utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"),
      utm_campaign: q.get("utm_campaign"), utm_term: q.get("utm_term"),
      utm_content: q.get("utm_content"),
      gclid: q.get("gclid"), fbclid: q.get("fbclid"),
      referrer: document.referrer || null, landing_url: window.location.href
    };
  }

  function getVisitorId() { try { return localStorage.getItem(STORE_KEY); } catch (_) { return null; } }
  function setVisitorId(v) { try { localStorage.setItem(STORE_KEY, v); } catch (_) {} }

  var state = { conversationId: null, awaiting: null, status: "bot", lastMsgId: null, pollTimer: null, agentName: null, persona: null };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Safe markdown: escape first, then apply a small set of transforms.
  // Supports **bold**, *italic* / _italic_, `code`, [text](https://url), line breaks.
  function mdToHtml(text) {
    var s = String(text || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      function (_, label, url) { return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    s = s.replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px">$1</code>');
    s = s.replace(/\n/g, "<br>");
    return s;
  }

  function bubbleWithMarkdown(text, side) {
    var div = document.createElement("div");
    div.className = "cb-bubble";
    div.innerHTML = mdToHtml(text);
    return div;
  }

  function showTyping() {
    if (document.getElementById("cb-typing")) return;
    var dots = h("div", { class: "cb-bubble", id: "cb-typing-bubble", style: "display:inline-flex;gap:3px;background:#f3f4f6" }, [
      h("span", { style: "width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:cb-pulse 1s infinite 0s" }),
      h("span", { style: "width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:cb-pulse 1s infinite .15s" }),
      h("span", { style: "width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:cb-pulse 1s infinite .3s" })
    ]);
    var m = h("div", { class: "cb-msg bot", id: "cb-typing" }, [dots]);
    body.appendChild(m); requestAnimationFrame(function () { body.scrollTop = body.scrollHeight; });
  }
  function hideTyping() {
    var t = document.getElementById("cb-typing");
    if (t) t.remove();
  }

  var panel = h("div", { class: "cb-panel", id: "cb-panel-v1", style: "display:none" });

  // Persistent bottom input bar. Hidden by default; shown when the flow is
  // awaiting a text-type input node, or when the conversation is in agent/AI mode.
  var EMOJIS = ["😀","😄","😅","😂","😍","😊","😎","🤔","😐","😢","😭","😡","👍","👎","👌","🙏","🙌","👋","💪","🎉","❤️","💔","✅","❌","❓","❗","⏳","📅","📞","📍","🏠","🏢","🚀","✨","🔔","📝","💬","🤝","☎️","📷"];
  var emojiBtn = h("button", { class: "cb-bar-emoji", "aria-label": "Emoji", title: "Insert emoji", type: "button" }, ["😊"]);
  var emojiPanel = h("div", { class: "cb-emoji-panel", style: "display:none" });
  EMOJIS.forEach(function (e) {
    var b = h("button", { class: "cb-emoji-cell", type: "button", "aria-label": e }, [e]);
    b.addEventListener("click", function () {
      var start = barInput.selectionStart, end = barInput.selectionEnd;
      var v = barInput.value || "";
      barInput.value = (start != null ? v.slice(0, start) + e + v.slice(end) : v + e);
      emojiPanel.style.display = "none";
      try { barInput.focus(); barInput.selectionStart = barInput.selectionEnd = (start || v.length) + e.length; } catch (err) {}
    });
    emojiPanel.appendChild(b);
  });
  emojiBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    emojiPanel.style.display = emojiPanel.style.display === "none" ? "grid" : "none";
  });
  document.addEventListener("click", function (ev) {
    if (emojiPanel.style.display !== "none" && !emojiPanel.contains(ev.target) && ev.target !== emojiBtn) {
      emojiPanel.style.display = "none";
    }
  });
  var barInput = h("input", { class: "cb-bar-input", placeholder: "Type here…" });
  var barBtn = h("button", { class: "cb-bar-send", "aria-label": "Send" }, ["➤"]);
  var bottomBar = h("div", { class: "cb-bar" }, [emojiBtn, emojiPanel, barInput, barBtn]);
  bottomBar.style.display = "none";
  var currentSend = null;
  // Remembered opts so we can re-show the bar on validation errors (422)
  var _lastBarOpts = null;
  var _lastBarValue = null;
  function showInputBar(opts) {
    // Preserve the visitor's in-progress text if we're re-showing the bar
    // for the same mode (e.g. polling re-enters ensureAgentInput every 2s
    // and would otherwise wipe what they're typing).
    var sameMode = bottomBar.style.display === "flex"
      && _lastBarOpts && opts.mode && _lastBarOpts.mode === opts.mode;
    _lastBarOpts = opts;
    bottomBar.style.display = "flex";
    barInput.type = opts.type || "text";
    barInput.placeholder = opts.placeholder || "Type here…";
    if (!sameMode) barInput.value = "";
    barInput.disabled = false;
    barBtn.disabled = false;
    currentSend = opts.onSend;
    if (!sameMode) {
      // Body just shrank (bar appeared). Re-scroll so the newest message stays visible.
      requestAnimationFrame(function () {
        body.scrollTop = body.scrollHeight;
        try { barInput.focus(); } catch (e) {}
      });
    }
  }
  function hideInputBar() {
    bottomBar.style.display = "none";
    currentSend = null;
    // Body just grew (bar disappeared). Re-scroll to bottom.
    requestAnimationFrame(function () { body.scrollTop = body.scrollHeight; });
  }
  barBtn.addEventListener("click", function () { if (currentSend) currentSend(); });
  barInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && currentSend) { e.preventDefault(); currentSend(); }
  });
  var headerAvatar = h("img", { id: "cb-header-avatar", alt: "", class: "cb-header-avatar", style: "display:none" });
  var headerTitle = h("div", { id: "cb-header-title", class: "cb-header-title", text: TITLE });
  var headerStatus = h("div", { class: "cb-header-status" }, [
    h("span", { class: "cb-dot" }),
    h("span", { text: "We are online to assist you" }),
  ]);
  var headerText = h("div", { class: "cb-header-text" }, [headerTitle, headerStatus]);
  function svgIcon(inner) {
    var w = document.createElement("span");
    w.className = "cb-icon-svg";
    w.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    return w;
  }
  var ICON_REFRESH = '<polyline points="23 4 23 10 17 10"/>' +
    '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>';
  var ICON_END = '<line x1="18" y1="6" x2="6" y2="18"/>' +
    '<line x1="6" y1="6" x2="18" y2="18"/>';
  var ICON_MIN = '<line x1="5" y1="12" x2="19" y2="12"/>';
  var refreshBtn = h("button", { class: "cb-icon-btn", title: "Start a new chat", "aria-label": "Restart" }, [svgIcon(ICON_REFRESH)]);
  var endBtn = h("button", { class: "cb-icon-btn", title: "End chat", "aria-label": "End chat" }, [svgIcon(ICON_END)]);
  var minBtn = h("button", { class: "cb-icon-btn", title: "Minimise", "aria-label": "Minimise", onclick: toggle }, [svgIcon(ICON_MIN)]);
  var header = h("div", { class: "cb-header" }, [
    h("div", { class: "cb-header-left" }, [headerAvatar, headerText]),
    h("div", { class: "cb-header-right" }, [endBtn, refreshBtn, minBtn]),
  ]);
  var body = h("div", { class: "cb-body" });
  var footer = h("div", { class: "cb-footer", text: "Powered by ChatBot" });
  panel.appendChild(header); panel.appendChild(body); panel.appendChild(bottomBar); panel.appendChild(footer);

  var launcherAvatar = h("img", { class: "cb-launcher-avatar", alt: "", style: "display:none" });
  var launcherIcon = h("span", { class: "cb-launcher-icon", text: "💬" });
  var launcher = h("button", { class: "cb-launcher", "aria-label": "Open chat", onclick: toggle }, [launcherAvatar, launcherIcon]);
  var root = h("div", { class: "cb-root", id: "cb-root-v1" }, [launcher, panel]);
  document.body.appendChild(root);

  endBtn.addEventListener("click", async function () {
    if (!state.conversationId) return;
    if (!confirm("End this chat? You can start a new one with the ⟳ button.")) return;
    try {
      await fetch(API_BASE + "/widget/close", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: state.conversationId, visitor_id: getVisitorId() })
      });
    } catch (e) { /* swallow — server-side close still happens via timeout */ }
    handleStatusChange("closed");
  });

  refreshBtn.addEventListener("click", function () {
    if (!confirm("Start a new chat? Your current conversation will be closed.")) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    body.innerHTML = "";
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    hideInputBar();
    state.conversationId = null;
    state.awaiting = null;
    state.status = "bot";
    state.lastMsgId = null;
    _lastStamp = 0;
    startSession();
  });

  function toggle() {
    if (panel.style.display === "none") {
      panel.style.display = "flex";
      if (!state.conversationId) startSession();
    } else {
      panel.style.display = "none";
    }
  }

  var _lastStamp = 0;
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function addMessage(side, bubbleEl, messageId) {
    var now = Date.now();
    // Show a timestamp separator on first message or when >5min since the last one
    if (now - _lastStamp > 5 * 60 * 1000) {
      body.appendChild(h("div", { class: "cb-timestamp", text: fmtTime(now) }));
    }
    _lastStamp = now;

    var children = [];
    if (side === "bot") {
      var av = state.persona && state.persona.avatar ? absUrl(state.persona.avatar) : null;
      if (av) children.push(h("img", { class: "cb-msg-avatar", src: av, alt: "" }));
      else children.push(h("div", { class: "cb-msg-avatar cb-msg-avatar-empty" }));
    }
    children.push(bubbleEl);
    if (side === "bot" && messageId) {
      children.push(buildFeedbackRow(messageId));
    }
    var m = h("div", { class: "cb-msg " + side }, children);
    if (side === "bot" && messageId) m.setAttribute("data-msg-id", messageId);
    body.appendChild(m);
    // Scroll after layout reflow so scrollHeight includes the new node.
    requestAnimationFrame(function () { body.scrollTop = body.scrollHeight; });
  }

  // Per-message visitor votes, keyed by message_id. Populated from the GET on
  // open and from local clicks. Used to restore UI state across re-renders.
  var _msgVotes = {};

  function buildFeedbackRow(messageId) {
    var row = h("div", { class: "cb-msg-fb", "data-fb-for": messageId });
    var thanks = h("span", { class: "cb-msg-fb-thanks", style: "display:none", text: "Thanks!" });
    var commentBox = h("div", { class: "cb-msg-fb-comment", style: "display:none" });
    var commentInput = h("textarea", {
      class: "cb-msg-fb-textarea", rows: "2",
      placeholder: "Tell us more (optional)"
    });
    var sendBtn = h("button", { class: "cb-msg-fb-send", type: "button", text: "Send" });
    commentBox.appendChild(commentInput);
    commentBox.appendChild(sendBtn);

    var btnUp, btnDown;

    function postRating(rating, comment) {
      _msgVotes[messageId] = rating;
      return fetch(API_BASE + "/widget/message-feedback", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: state.conversationId,
          message_id: messageId,
          visitor_id: getVisitorId(),
          rating: rating,
          comment: comment || null,
        })
      }).catch(function () { /* swallow; visitor sees no error */ });
    }

    function applyChosen(rating) {
      btnUp.classList.toggle("cb-msg-fb-on", rating === "up");
      btnDown.classList.toggle("cb-msg-fb-on", rating === "down");
      btnUp.classList.toggle("cb-msg-fb-faded", rating === "down");
      btnDown.classList.toggle("cb-msg-fb-faded", rating === "up");
    }

    btnUp = h("button", {
      class: "cb-msg-fb-btn", "aria-label": "Good answer", title: "Good answer", type: "button",
      onclick: function () {
        applyChosen("up");
        commentBox.style.display = "none";
        thanks.style.display = "inline";
        postRating("up", null);
      }
    }, ["👍"]);
    btnDown = h("button", {
      class: "cb-msg-fb-btn", "aria-label": "Bad answer", title: "Bad answer", type: "button",
      onclick: function () {
        applyChosen("down");
        thanks.style.display = "none";
        commentBox.style.display = "block";
        postRating("down", null);
        try { commentInput.focus(); } catch (e) {}
      }
    }, ["👎"]);

    sendBtn.addEventListener("click", function () {
      var c = (commentInput.value || "").trim();
      sendBtn.disabled = true;
      commentInput.disabled = true;
      postRating("down", c).then(function () {
        commentBox.style.display = "none";
        thanks.style.display = "inline";
      });
    });

    row.appendChild(btnUp);
    row.appendChild(btnDown);
    row.appendChild(thanks);
    row.appendChild(commentBox);

    // Restore prior vote if we already have one for this message.
    var prior = _msgVotes[messageId];
    if (prior) {
      applyChosen(prior);
      thanks.style.display = "inline";
    }
    return row;
  }

  function refreshFeedbackRows() {
    // After /widget/message-feedback GET, paint any prior votes onto rows
    // already in the DOM. New rows pick up the state via _msgVotes themselves.
    Object.keys(_msgVotes).forEach(function (mid) {
      var row = body.querySelector('.cb-msg-fb[data-fb-for="' + mid + '"]');
      if (!row) return;
      var btnUp = row.querySelector('.cb-msg-fb-btn[aria-label="Good answer"]');
      var btnDown = row.querySelector('.cb-msg-fb-btn[aria-label="Bad answer"]');
      var thanks = row.querySelector('.cb-msg-fb-thanks');
      if (!btnUp || !btnDown) return;
      var rating = _msgVotes[mid];
      btnUp.classList.toggle("cb-msg-fb-on", rating === "up");
      btnDown.classList.toggle("cb-msg-fb-on", rating === "down");
      btnUp.classList.toggle("cb-msg-fb-faded", rating === "down");
      btnDown.classList.toggle("cb-msg-fb-faded", rating === "up");
      if (thanks) thanks.style.display = "inline";
    });
  }

  function loadPriorFeedback() {
    if (!state.conversationId) return;
    var url = API_BASE + "/widget/message-feedback/" + encodeURIComponent(state.conversationId)
      + "?visitor_id=" + encodeURIComponent(getVisitorId() || "");
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : { feedbacks: [] }; })
      .then(function (d) {
        (d.feedbacks || []).forEach(function (f) { _msgVotes[f.message_id] = f.rating; });
        refreshFeedbackRows();
      })
      .catch(function () { /* offline / 404 — non-fatal */ });
  }

  function renderOutput(out) {
    var kind = out.kind, cfg = out.config || {};
    var mid = out.message_id || null;  // server-attached when the kind is feedback-eligible
    if (kind === "text") {
      var txt = (cfg.body || "").trim();
      if (!txt) return; // skip empty text bubbles
      addMessage("bot", bubbleWithMarkdown(txt), mid);
    } else if (kind === "image") {
      var box = h("div", { class: "cb-media" }, [h("img", { src: absUrl(cfg.url) })]);
      if (cfg.caption) box.appendChild(h("div", { class: "cb-caption", text: cfg.caption }));
      addMessage("bot", box, mid);
    } else if (kind === "video") {
      var v = h("video", { src: absUrl(cfg.url), controls: "controls" });
      var box2 = h("div", { class: "cb-media" }, [v]);
      if (cfg.caption) box2.appendChild(h("div", { class: "cb-caption", text: cfg.caption }));
      addMessage("bot", box2, mid);
    } else if (kind === "document") {
      var url = absUrl(cfg.url || "");
      var title = cfg.title || cfg.original_filename || "Document";
      var desc = cfg.description || "";
      var fmt = (cfg.original_filename || cfg.url || "").split(".").pop().toUpperCase();
      var sizeKB = cfg.size ? (cfg.size < 1024 * 1024
        ? Math.round(cfg.size / 1024) + " KB"
        : (cfg.size / 1024 / 1024).toFixed(1) + " MB") : "";
      var meta = [fmt, sizeKB].filter(Boolean).join(" · ");
      var docIcon = h("div", { style: "flex-shrink:0;width:38px;height:46px;border-radius:4px;background:linear-gradient(135deg,#eef1fb,#dbe3ff);display:grid;place-items:center;font-size:18px;color:#273b84" }, ["📄"]);
      var docInfo = h("div", { style: "flex:1;min-width:0" }, [
        h("div", { style: "font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: title }),
        meta ? h("div", { style: "font-size:11px;color:#9ca3af", text: meta }) : null,
        desc ? h("div", { style: "font-size:12px;color:#6b7280;margin-top:4px", text: desc }) : null,
      ]);
      var dlLabel = (cfg.original_filename || "").replace(/[^\w.\-]+/g, "_") || (title + "." + fmt.toLowerCase());
      // Route through /widget/download/<filename> so the response carries
      // Content-Disposition: attachment with the original filename. This
      // bypasses Chrome's inline PDF viewer (which can drop the extension)
      // and works cross-origin where the <a download> attribute is ignored.
      var dlHref = url;
      var basename = (cfg.url || "").split("/").pop();
      if (basename) dlHref = absUrl("/widget/download/" + encodeURIComponent(basename) + "?name=" + encodeURIComponent(dlLabel));
      var dlBtn = h("a", {
        href: dlHref, target: "_blank", rel: "noopener", download: dlLabel,
        style: "flex-shrink:0;padding:6px 12px;border-radius:6px;background:#273b84;color:#fff;text-decoration:none;font-size:12px;font-weight:600",
        text: "↓ Open"
      });
      // Notify backend so the configured email-on-click hook can fire.
      // Fire-and-forget; the download itself proceeds via the link click.
      if (cfg.node_id) {
        dlBtn.addEventListener("click", function () {
          if (!state.conversationId) return;
          try {
            fetch(API_BASE + "/widget/document-clicked", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversation_id: state.conversationId, visitor_id: getVisitorId(), node_id: cfg.node_id }),
              keepalive: true,
            }).catch(function () {});
          } catch (e) { /* ignore */ }
        });
      }
      var docCard = h("div", {
        style: "display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;max-width:320px"
      }, [docIcon, docInfo, dlBtn]);
      if (cfg.caption) {
        var wrap = h("div", {}, [docCard, h("div", { class: "cb-caption", text: cfg.caption })]);
        addMessage("bot", wrap, mid);
      } else {
        addMessage("bot", docCard, mid);
      }
    } else if (kind === "schedule") {
      var sWrap = h("div", { class: "cb-form" });
      if (cfg.description) {
        sWrap.appendChild(h("div", { text: cfg.description, style: "font-size:12px;color:#6b7280;margin-bottom:8px" }));
      }
      var today = new Date();
      var minDays = parseInt(cfg.min_days || "0", 10);
      var maxDays = parseInt(cfg.max_days || "30", 10);
      function _isoDate(off) {
        var t = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
        return t.getFullYear() + "-" + String(t.getMonth()+1).padStart(2,"0") + "-" + String(t.getDate()).padStart(2,"0");
      }
      var slots = Array.isArray(cfg.time_slots) ? cfg.time_slots.filter(Boolean) : [];

      var dateInp, selSlot = null, slotRow = null, dateTimeInp = null;

      if (slots.length > 0) {
        // Date + time-slot buttons
        dateInp = h("input", {
          type: "date", min: _isoDate(minDays), max: _isoDate(maxDays), value: _isoDate(minDays),
          style: "width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box"
        });
        sWrap.appendChild(dateInp);
        sWrap.appendChild(h("div", { text: cfg.time_label || "Pick a time:", style: "font-size:12px;color:#6b7280;margin-top:10px;margin-bottom:4px" }));
        slotRow = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap" });
        slots.forEach(function (slot, idx) {
          var btn = h("button", {
            type: "button", text: slot,
            style: "padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#111;cursor:pointer;font-size:13px"
          });
          btn.addEventListener("click", function () {
            selSlot = slot;
            slotRow.querySelectorAll("button").forEach(function (b) {
              b.style.background = "#fff"; b.style.borderColor = "#d1d5db"; b.style.color = "#111";
            });
            btn.style.background = "#2563eb"; btn.style.borderColor = "#2563eb"; btn.style.color = "#fff";
          });
          slotRow.appendChild(btn);
          // Auto-select if there's only one slot
          if (slots.length === 1 && idx === 0) {
            setTimeout(function () { btn.click(); }, 0);
          }
        });
        sWrap.appendChild(slotRow);
      } else {
        // Simple combined date+time picker (native HTML5)
        var pad = function (n) { return String(n).padStart(2, "0"); };
        var now = new Date();
        var defaultT = _isoDate(minDays) + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
        dateTimeInp = h("input", {
          type: "datetime-local",
          min: _isoDate(minDays) + "T00:00",
          max: _isoDate(maxDays) + "T23:59",
          value: defaultT,
          style: "width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box"
        });
        sWrap.appendChild(dateTimeInp);
      }

      var confirmBtn = h("button", {
        text: cfg.submit_label || "Confirm",
        style: "margin-top:10px;background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600",
        onclick: function () {
          var value;
          if (slotRow) {
            var d = dateInp.value;
            if (!d) { alert("Please pick a date"); return; }
            if (!selSlot) { alert("Please pick a time"); return; }
            value = d + " " + selSlot;
          } else {
            value = dateTimeInp.value;
            if (!value) { alert("Please pick a date & time"); return; }
            // Make the value human-friendly: "2026-04-25T14:30" -> "2026-04-25 2:30 PM"
            var parts = value.split("T");
            var hhmm = parts[1].split(":");
            var hh = parseInt(hhmm[0], 10);
            var ampm = hh >= 12 ? "PM" : "AM";
            var hh12 = ((hh + 11) % 12) + 1;
            value = parts[0] + " " + hh12 + ":" + hhmm[1] + " " + ampm;
          }
          addMessage("visitor", h("div", { class: "cb-bubble", text: value }));
          sWrap.querySelectorAll("input,button").forEach(function (n) { n.disabled = true; });
          sendReply({ value: value });
        }
      });
      sWrap.appendChild(confirmBtn);
      addMessage("bot", sWrap);
        } else if (kind === "carousel") {
      var track = h("div", { class: "cb-carousel-track" },
        (cfg.cards || []).map(function (c) {
          var actions = (c.buttons || []).map(function (btn) {
            return h("button", {
              class: "cb-card-btn",
              text: btn.label || btn.value,
              onclick: function () { onButton(btn); }
            });
          });
          var imgUrl = c.image ? absUrl(c.image) : null;
          var imgWrap = imgUrl ? h("div", {
            class: "cb-card-image",
            onclick: function () { openLightbox(imgUrl, c.title || ""); }
          }, [h("img", { src: imgUrl, alt: c.title || "" })]) : null;
          return h("div", { class: "cb-card" }, [
            imgWrap,
            h("div", { class: "cb-card-body" }, [
              c.title ? h("div", { class: "cb-card-title", text: c.title }) : null,
              c.subtitle ? h("div", { class: "cb-card-subtitle", text: c.subtitle }) : null,
              actions.length ? h("div", { class: "cb-card-actions" }, actions) : null
            ])
          ]);
        }));
      var prev = h("button", { class: "cb-carousel-nav cb-carousel-prev", "aria-label": "Previous", text: "‹" });
      var next = h("button", { class: "cb-carousel-nav cb-carousel-next", "aria-label": "Next", text: "›" });
      var carousel = h("div", { class: "cb-carousel" }, [track, prev, next]);
      var scrollByCard = function (dir) {
        var first = track.querySelector(".cb-card");
        var step = first ? first.getBoundingClientRect().width + 10 : 200;
        track.scrollBy({ left: dir * step, behavior: "smooth" });
      };
      prev.addEventListener("click", function () { scrollByCard(-1); });
      next.addEventListener("click", function () { scrollByCard(1); });
      addMessage("bot", carousel, mid);
    } else if (kind === "buttons") {
      addMessage("bot", h("div", { class: "cb-bubble", text: cfg.body || "" }));
      var row = h("div", { class: "cb-buttons" },
        (cfg.options || []).map(function (opt) {
          return h("button", {
            class: "cb-btn", text: opt.label || opt.value,
            onclick: function () { onButton(opt); }
          });
        }));
      addMessage("bot", row);
    } else if (kind === "image_buttons") {
      if (cfg.body) addMessage("bot", h("div", { class: "cb-bubble", text: cfg.body }));
      var ibTrack = h("div", { class: "cb-image-btns cb-carousel-track" },
        (cfg.options || []).map(function (opt) {
          var imgUrl = opt.image ? absUrl(opt.image) : null;
          var children = [];
          if (imgUrl) {
            children.push(h("div", { class: "cb-image-btn-img" }, [
              h("img", { src: imgUrl, alt: opt.label || opt.value || "" })
            ]));
          }
          var bodyChildren = [];
          var titleText = opt.label || opt.value;
          if (titleText) {
            bodyChildren.push(h("div", { class: "cb-image-btn-title", text: titleText }));
          }
          if (opt.description) {
            bodyChildren.push(h("div", { class: "cb-image-btn-desc", text: opt.description }));
          }
          bodyChildren.push(h("span", { class: "cb-image-btn-cta", text: opt.button_label || "Know more" }));
          children.push(h("div", { class: "cb-image-btn-body" }, bodyChildren));
          return h("button", {
            class: "cb-image-btn",
            onclick: function () { onButton(opt); }
          }, children);
        }));
      var ibPrev = h("button", { class: "cb-carousel-nav cb-carousel-prev", "aria-label": "Previous", text: "‹" });
      var ibNext = h("button", { class: "cb-carousel-nav cb-carousel-next", "aria-label": "Next", text: "›" });
      var ibCarousel = h("div", { class: "cb-carousel cb-image-btns-carousel" }, [ibTrack, ibPrev, ibNext]);
      var ibStep = function (dir) {
        var first = ibTrack.querySelector(".cb-image-btn");
        var step = first ? first.getBoundingClientRect().width + 10 : 220;
        ibTrack.scrollBy({ left: dir * step, behavior: "smooth" });
      };
      ibPrev.addEventListener("click", function (e) { e.stopPropagation(); ibStep(-1); });
      ibNext.addEventListener("click", function (e) { e.stopPropagation(); ibStep(1); });
      addMessage("bot", ibCarousel);
    } else if (kind === "input") {
      var t1 = (cfg.type || "text").toLowerCase();
      // Text-like input → use the persistent bottom bar (better UX than a bubble).
      // Keep bubble for select/radio/checkbox/file which need their own widget.
      var TEXT_LIKE = ["text", "email", "tel", "phone", "number", "url", "date"];
      if (TEXT_LIKE.indexOf(t1) !== -1) {
        var htypeBar = t1 === "tel" || t1 === "phone" ? "tel" :
          t1 === "email" ? "email" : t1 === "number" ? "number" :
          t1 === "url" ? "url" : t1 === "date" ? "date" : "text";
        showInputBar({
          type: htypeBar,
          placeholder: "Type your " + (cfg.field || "answer") + "…",
          onSend: function () {
            var v = (barInput.value || "").trim();
            if (!v) return;
            _lastBarValue = v;
            addMessage("visitor", h("div", { class: "cb-bubble", text: v }));
            hideInputBar();
            sendReply({ value: v });
          },
        });
        return;  // don't render a bubble for this input
      }
      var wrap = h("div", { class: "cb-form" });
      var inp;
      if (t1 === "textarea") {
        // Textarea still uses the bottom bar — single-line bar with Enter-to-send
        showInputBar({
          type: "text",
          placeholder: "Type your " + (cfg.field || "answer") + "…",
          onSend: function () {
            var v = (barInput.value || "").trim();
            if (!v) return;
            _lastBarValue = v;
            addMessage("visitor", h("div", { class: "cb-bubble", text: v }));
            hideInputBar();
            sendReply({ value: v });
          },
        });
        return;
      } else if (t1 === "select") {
        inp = h("select", {});
        (cfg.options || []).forEach(function (o) { inp.appendChild(h("option", { value: o.value, text: o.label || o.value })); });
      } else if (t1 === "radio") {
        inp = h("div"); inp.__isRadioGroup = true;
        (cfg.options || []).forEach(function (o, i) {
          var id = "cb-ir-" + Date.now() + "-" + i;
          var r = h("input", { type: "radio", name: "cb_input_" + Date.now(), value: o.value, id: id });
          var lb = h("label", { for: id, text: " " + (o.label || o.value), style: "display:inline;margin-right:10px;font-weight:400" });
          inp.appendChild(r); inp.appendChild(lb);
          inp.__groupName = r.name;
        });
      } else if (t1 === "checkbox") {
        inp = h("input", { type: "checkbox", style: "width:auto" });
      } else if (t1 === "file") {
        inp = h("input", { type: "file", accept: "image/*,video/*,application/pdf" });
        inp.__fileUploadUrl = null;
        inp.addEventListener("change", async function () {
          var fo = inp.files && inp.files[0];
          if (!fo) return;
          var fd = new FormData(); fd.append("file", fo);
          var res = await fetch(API_BASE + "/widget/upload?conversation_id=" + state.conversationId + "&visitor_id=" + encodeURIComponent(getVisitorId() || ""), { method: "POST", body: fd });
          if (res.ok) { var d = await res.json(); inp.__fileUploadUrl = d.url; }
          else { inp.value = ""; alert("Upload failed"); }
        });
      } else {
        var htype1 = t1 === "tel" || t1 === "phone" ? "tel" :
          t1 === "email" ? "email" : t1 === "number" ? "number" :
          t1 === "url" ? "url" : t1 === "date" ? "date" : "text";
        var attrs1 = { type: htype1, placeholder: cfg.placeholder || "" };
        if (t1 === "number") { if (cfg.min != null) attrs1.min = String(cfg.min); if (cfg.max != null) attrs1.max = String(cfg.max); }
        inp = h("input", attrs1);
      }
      wrap.appendChild(inp);
      var btn1 = h("button", {
        text: "Send",
        onclick: function () {
          var v;
          if (inp.__isRadioGroup) {
            var c = inp.querySelector('input[name="' + inp.__groupName + '"]:checked');
            v = c ? c.value : "";
          } else if (inp.type === "checkbox") {
            v = inp.checked ? "true" : "false";
          } else if (inp.type === "file") {
            v = inp.__fileUploadUrl || "";
          } else {
            v = inp.value;
          }
          addMessage("visitor", h("div", { class: "cb-bubble", text: String(v) || "(empty)" }));
          wrap.querySelectorAll("input,button,select,textarea").forEach(function (n) { n.disabled = true; });
          sendReply({ value: v });
        }
      });
      wrap.appendChild(btn1);
      addMessage("bot", wrap);
    } else if (kind === "otp") {
      var otpWrap = h("div", { class: "cb-form" });
      otpWrap.appendChild(h("div", { text: cfg.phone ? ("Phone: " + cfg.phone) : "Enter OTP:" }));
      var otpInput = h("input", { type: "tel", placeholder: "6-digit OTP", maxlength: String(cfg.length || 6) });
      otpInput.style.letterSpacing = "4px"; otpInput.style.textAlign = "center"; otpInput.style.fontSize = "18px";
      otpWrap.appendChild(otpInput);
      var otpBtn = h("button", {
        text: "Verify",
        onclick: function () {
          var v = (otpInput.value || "").trim();
          if (!/^\d{4,8}$/.test(v)) { otpInput.focus(); return; }
          addMessage("visitor", h("div", { class: "cb-bubble", text: "•".repeat(v.length) }));
          otpWrap.querySelectorAll("input,button").forEach(function (n) { n.disabled = true; });
          sendReply({ value: v, otp: v });
        }
      });
      otpWrap.appendChild(otpBtn);
      addMessage("bot", otpWrap);
    } else if (kind === "form") {
      var fields = cfg.fields || [];
      var inputs = {};
      var frm = h("div", { class: "cb-form" });
      (cfg.intro ? [h("div", { text: cfg.intro })] : []).forEach(function (e) { frm.appendChild(e); });
      fields.forEach(function (f) {
        frm.appendChild(h("label", { text: (f.label || f.name) + (f.required === false ? " (optional)" : "") }));
        var inp;
        var t = (f.type || "text").toLowerCase();
        if (t === "textarea") {
          inp = h("textarea", { name: f.name, placeholder: f.placeholder || "" });
        } else if (t === "select") {
          inp = h("select", { name: f.name });
          (f.options || []).forEach(function (o) { inp.appendChild(h("option", { value: o.value, text: o.label || o.value })); });
        } else if (t === "radio") {
          var radios = h("div");
          (f.options || []).forEach(function (o, i) {
            var id = "cb-r-" + f.name + "-" + i;
            var r = h("input", { type: "radio", name: "cb_" + f.name, value: o.value, id: id });
            var lbl = h("label", { for: id, text: " " + (o.label || o.value), style: "display:inline;margin-right:10px;font-weight:400" });
            radios.appendChild(r); radios.appendChild(lbl);
          });
          // Wrap so we can read selected value later
          inp = radios; inp.__isRadioGroup = true; inp.__name = f.name;
        } else if (t === "checkbox") {
          inp = h("input", { type: "checkbox", name: f.name, style: "width:auto" });
        } else if (t === "file") {
          inp = h("input", { type: "file", name: f.name, accept: "image/*,video/*,application/pdf" });
          inp.__fileUploadUrl = null;
          inp.addEventListener("change", async function () {
            var fileObj = inp.files && inp.files[0];
            if (!fileObj) return;
            var fd = new FormData(); fd.append("file", fileObj);
            var res = await fetch(API_BASE + "/widget/upload?conversation_id=" + state.conversationId + "&visitor_id=" + encodeURIComponent(getVisitorId() || ""), {
              method: "POST", body: fd,
            });
            if (res.ok) {
              var data = await res.json();
              inp.__fileUploadUrl = data.url;
            } else {
              inp.value = ""; inp.__fileUploadUrl = null;
              alert("Upload failed");
            }
          });
        } else {
          var htype = t === "tel" || t === "phone" ? "tel" :
            t === "email" ? "email" : t === "number" ? "number" :
            t === "url" ? "url" : t === "date" ? "date" : "text";
          var attrs = { name: f.name, placeholder: f.placeholder || "", type: htype };
          if (t === "number") { if (f.min != null) attrs.min = String(f.min); if (f.max != null) attrs.max = String(f.max); }
          inp = h("input", attrs);
        }
        inputs[f.name] = inp; frm.appendChild(inp);
      });
      var submit = h("button", {
        text: cfg.submit_label || "Submit",
        onclick: function () {
          var values = {};
          Object.keys(inputs).forEach(function (k) {
            var el = inputs[k];
            if (el.__isRadioGroup) {
              var checked = el.querySelector('input[name="cb_' + el.__name + '"]:checked');
              values[k] = checked ? checked.value : "";
            } else if (el.type === "checkbox") {
              values[k] = el.checked ? "true" : "false";
            } else if (el.type === "file") {
              values[k] = el.__fileUploadUrl || "";
            } else {
              values[k] = el.value;
            }
          });
          var lines = fields.map(function (f) { return (f.label || f.name) + ": " + (values[f.name] || ""); }).join("\n");
          addMessage("visitor", h("div", { class: "cb-bubble", text: lines }));
          frm.querySelectorAll("input,button,select,textarea").forEach(function (n) { n.disabled = true; });
          sendReply({ values: values });
        }
      });
      frm.appendChild(submit);
      addMessage("bot", frm);
    }
  }

  function onButton(opt) {
    addMessage("visitor", h("div", { class: "cb-bubble", text: opt.label || opt.value }));
    // Disable any remaining buttons in the last button row (text or image variant)
    var rows = body.querySelectorAll(".cb-buttons, .cb-image-btns");
    if (rows.length) rows[rows.length - 1].querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    sendReply({ value: opt.value });
  }

  function addSystemMsg(text) {
    var el = h("div", { class: "cb-msg bot" }, [
      h("div", { class: "cb-bubble", style: "font-style:italic;color:#6b7280;background:#f3f4f6" }, [text])
    ]);
    body.appendChild(el); body.scrollTop = body.scrollHeight;
  }

  function ensureAgentInput() {
    // Reuse the unified bottom bar for agent / AI chat.
    showInputBar({
      mode: "agent",
      type: "text",
      placeholder: "Type a message…",
      onSend: function () {
        var t = (barInput.value || "").trim();
        if (!t) return;
        barInput.value = "";
        addMessage("visitor", h("div", { class: "cb-bubble", text: t }));
        fetch(API_BASE + "/widget/message", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversation_id: state.conversationId, visitor_id: getVisitorId(), text: t })
        });
      },
    });
  }

  function handleStatusChange(newStatus) {
    if (state.status === newStatus) return;
    state.status = newStatus;
    if (newStatus === "queued") addSystemMsg("Waiting for an agent…");
    if (newStatus === "assigned" && state.agentName) addSystemMsg(state.agentName + " joined the chat");
    if (newStatus === "assigned" && !state.agentName) addSystemMsg("An agent joined the chat");
    if (newStatus === "closed") {
      addSystemMsg("Chat closed");
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
      hideInputBar();
      maybeShowCsat();
    }
  }

  function maybeShowCsat() {
    if (state.csatShown) return;
    state.csatShown = true;
    var convId = state.conversationId;
    // Don't ask twice if the visitor already rated (e.g. they reloaded).
    fetch(API_BASE + "/widget/csat/" + encodeURIComponent(convId) + "?visitor_id=" + encodeURIComponent(getVisitorId() || ""))
      .then(function (r) { return r.ok ? r.json() : { submitted: false }; })
      .then(function (d) { if (d && !d.submitted) renderCsatBlock(convId); })
      .catch(function () { renderCsatBlock(convId); });
  }

  function renderCsatBlock(convId) {
    var box = h("div", { class: "cb-csat" });
    var title = h("div", { class: "cb-csat-title", text: "How was your chat?" });
    var btnRow = h("div", { class: "cb-csat-btns" });
    var commentWrap = h("div", { class: "cb-csat-comment", style: "display:none" });
    var commentLabel = h("div", { class: "cb-csat-comment-label", text: "Tell us more (optional):" });
    var commentInput = h("textarea", {
      class: "cb-csat-textarea", rows: "2",
      placeholder: "Anything you'd like to share?"
    });
    var commentRow = h("div", { class: "cb-csat-comment-row" });
    var sendBtn = h("button", { class: "cb-csat-send", type: "button", text: "Send" });
    var skipBtn = h("button", { class: "cb-csat-skip", type: "button", text: "Skip" });
    commentRow.appendChild(skipBtn);
    commentRow.appendChild(sendBtn);
    commentWrap.appendChild(commentLabel);
    commentWrap.appendChild(commentInput);
    commentWrap.appendChild(commentRow);
    var thanks = h("div", { class: "cb-csat-thanks", text: "Thank you for the feedback!", style: "display:none" });

    var chosen = null;

    function postRating(positive, comment) {
      return fetch(API_BASE + "/widget/csat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convId,
          visitor_id: getVisitorId(),
          positive: positive,
          comment: comment || null,
        })
      });
    }

    function pickThumb(positive) {
      chosen = positive;
      thumbUp.disabled = thumbDown.disabled = true;
      // Visual: dim the unselected one
      (positive ? thumbDown : thumbUp).classList.add("cb-csat-btn-faded");
      // Capture rating immediately so we don't lose it if they walk away.
      postRating(positive, null);
      btnRow.style.display = "none";
      commentWrap.style.display = "block";
      try { commentInput.focus(); } catch (e) {}
    }
    function finish() {
      commentWrap.style.display = "none";
      thanks.style.display = "block";
    }

    var thumbUp = h("button", {
      class: "cb-csat-btn", "aria-label": "Good", title: "Good", type: "button",
      onclick: function () { pickThumb(true); }
    }, ["👍"]);
    var thumbDown = h("button", {
      class: "cb-csat-btn", "aria-label": "Bad", title: "Bad", type: "button",
      onclick: function () { pickThumb(false); }
    }, ["👎"]);
    btnRow.appendChild(thumbUp);
    btnRow.appendChild(thumbDown);

    sendBtn.addEventListener("click", function () {
      var c = (commentInput.value || "").trim();
      sendBtn.disabled = true; skipBtn.disabled = true;
      // Re-post with the comment to upsert.
      postRating(chosen, c).finally(finish);
    });
    skipBtn.addEventListener("click", finish);

    box.appendChild(title);
    box.appendChild(btnRow);
    box.appendChild(commentWrap);
    box.appendChild(thanks);
    body.appendChild(box);
    body.scrollTop = body.scrollHeight;
  }

  async function pollOnce() {
    if (!state.conversationId) return;
    try {
      var res = await fetch(API_BASE + "/widget/poll", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: state.conversationId, visitor_id: getVisitorId(), since_id: state.lastMsgId })
      });
      if (!res.ok) return;
      var data = await res.json();
      if (data.agent_name) state.agentName = data.agent_name;
      handleStatusChange(data.status);
      (data.messages || []).forEach(function (m) {
        state.lastMsgId = m.id;
        var fbMid = m.sender === "bot" ? m.id : null;
        if (m.sender === "agent" || m.sender === "bot") {
          if (m.kind === "text") {
            addMessage("bot", bubbleWithMarkdown(m.body || ""), fbMid);
          } else if (m.kind === "image" || m.kind === "document") {
            var p = m.payload || {};
            var cfg = m.kind === "image"
              ? { url: p.url, caption: p.caption }
              : { url: p.url, original_filename: p.filename, description: p.caption };
            renderOutput({ kind: m.kind, config: cfg, message_id: fbMid });
          }
        } else if (m.sender === "system") {
          addSystemMsg(m.body || "");
        }
        // visitor's own messages come back but are already rendered locally; skip
      });
      if (data.status === "assigned" || data.status === "queued") ensureAgentInput();
    } catch (e) { /* swallow; we'll retry */ }
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(pollOnce, 2000);
  }

  function applyPersona(p) {
    if (!p) return;
    state.persona = p;
    if (p.name) headerTitle.textContent = p.name;
    if (p.avatar) {
      var url = absUrl(p.avatar);
      headerAvatar.src = url; headerAvatar.style.display = "inline-block";
      launcherAvatar.src = url; launcherAvatar.style.display = "block";
      launcherIcon.style.display = "none";
      launcher.classList.add("has-avatar");
    }
    if (p.theme_color) {
      header.style.background = p.theme_color;
    }
    if (p.footer_text) {
      footer.textContent = p.footer_text;
    }
  }

  // Pre-fetch persona at script load so the launcher shows the bot's avatar
  // before the visitor opens the panel (no session is created yet).
  (function preloadPersona() {
    fetch(API_BASE + "/widget/persona/" + encodeURIComponent(BOT_KEY))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) applyPersona(p); })
      .catch(function () { /* offline / 404 — fall back to emoji */ });
  })();

  async function renderOutputsStaggered(outs, opts) {
    var stagger = !opts || opts.stagger !== false;
    for (var i = 0; i < outs.length; i++) {
      var o = outs[i];
      var isBotBubble = o.kind === "text" || o.kind === "image" || o.kind === "video" || o.kind === "carousel" || o.kind === "document" || o.kind === "schedule";
      if (stagger && isBotBubble) {
        // Longer pause before the first bot message of a response (it's the
        // natural "thinking" gap after the visitor's reply). Shorter pause
        // between subsequent bubbles within the same response.
        var delay = i === 0 ? 1800 : 500;
        showTyping();
        await sleep(delay);
        hideTyping();
      }
      renderOutput(o);
    }
  }

  async function startSession() {
    try {
      var res = await fetch(API_BASE + "/widget/session", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ bot_key: BOT_KEY, visitor_id: getVisitorId(), utm: captureUtm() })
      });
      if (!res.ok) { addMessage("bot", h("div", { class: "cb-bubble", text: "Sorry, chat unavailable." })); return; }
      var data = await res.json();
      state.conversationId = data.conversation_id;
      state.awaiting = data.awaiting;
      state.status = data.status || "bot";
      applyPersona(data.persona);
      setVisitorId(data.visitor_id);
      // Prime _msgVotes BEFORE rendering so each row picks up its prior state on creation.
      loadPriorFeedback();
      // Boot: show everything instantly so the first paint is the full welcome.
      await renderOutputsStaggered(data.outputs || [], { stagger: false });
      if (state.status === "queued" || state.status === "assigned" || state.status === "ai") {
        ensureAgentInput();
        handleStatusChange(state.status);
        startPolling();
      }
    } catch (e) {
      addMessage("bot", h("div", { class: "cb-bubble", text: "Connection error." }));
    }
  }

  async function sendReply(payload) {
    try {
      var res = await fetch(API_BASE + "/widget/reply", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: state.conversationId, visitor_id: getVisitorId(), payload: payload })
      });
      if (res.status === 422) {
        // Per-field validation errors from the server
        var err = await res.json();
        var fe = (err.detail && err.detail.field_errors) || {};
        var keys = Object.keys(fe);
        if (keys.length) {
          addMessage("bot", h("div", { class: "cb-bubble", style: "background:#fef3c7;color:#92400e" }, [keys.map(function (k) { return k + ": " + fe[k]; }).join("\n")]));
          // Case A: bar-based text/tel/email input — bar was hidden on send; re-show with prior value
          if (bottomBar.style.display === "none" && _lastBarOpts) {
            showInputBar(_lastBarOpts);
            if (_lastBarValue != null) {
              barInput.value = _lastBarValue;
              setTimeout(function () { try { barInput.focus(); barInput.select && barInput.select(); } catch (_) {} }, 60);
            }
            return;
          }
          // Case B: form-node submit — re-enable inputs on the LAST .cb-form so the user can correct
          var allForms = body.querySelectorAll(".cb-form");
          var lastForm = allForms[allForms.length - 1];
          if (lastForm) {
            lastForm.querySelectorAll("input, button, select, textarea").forEach(function (n) { n.disabled = false; });
            var firstKey = keys[0];
            var target = lastForm.querySelector('[name="' + firstKey + '"]') ||
                         lastForm.querySelector('input[name="cb_' + firstKey + '"]');
            if (target) { try { target.focus(); if (target.select) target.select(); } catch (_) {} }
            try { lastForm.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
          }
          return;
        }
      }
      if (!res.ok) { addMessage("bot", h("div", { class: "cb-bubble", text: "Send failed." })); return; }
      var data = await res.json();
      state.awaiting = data.awaiting;
      state.status = data.status || state.status;
      await renderOutputsStaggered(data.outputs || []);
      if (state.status === "queued" || state.status === "assigned" || state.status === "ai") {
        ensureAgentInput();
        handleStatusChange(state.status);
        startPolling();
      } else if (data.ended) {
        addMessage("bot", h("div", { class: "cb-bubble", text: "— end of chat —" }));
      }
    } catch (e) {
      addMessage("bot", h("div", { class: "cb-bubble", text: "Connection error." }));
    }
  }

  // Auto-inject CSS from same origin as the script
  var cssHref = script.src.replace(/widget\.js(\?.*)?$/, "widget.css");
  var link = document.createElement("link");
  link.rel = "stylesheet"; link.href = cssHref;
  document.head.appendChild(link);
})();
