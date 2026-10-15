const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, method = "GET", body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  // Resolve against the origin, not the page URL: a page opened as http://user:pass@host/ can't fetch relative URLs.
  const r = await fetch(new URL(path, location.origin + location.pathname), opts);
  if (r.status === 401) {  // signed out (or the session expired): go to the sign-in page
    location.href = "login" + location.hash;
    throw new Error("Please sign in");
  }
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    const err = new Error((data && data.detail) || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Build an element: h("button", { class: "small", onclick: fn }, "text", child...)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function when(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function toast(message, ms = 3500) {
  const t = h("div", { class: "toast", role: "status" }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

function diffHtml(diff) {
  if (!diff) return '<span class="meta">No differences.</span>';
  return diff.split("\n").map(line => {
    let cls = "";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
    else if (line.startsWith("@@")) cls = "hunk";
    else if (line.startsWith("+")) cls = "add";
    else if (line.startsWith("-")) cls = "del";
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join("");
}

// In-app confirmation and message dialogs (instead of the browser's confirm() / alert()).
const UI = (() => {
  let resolve = null;
  let returnFocus = null;

  function open({ title, message, ok = "OK", cancel = "Cancel", danger = false }) {
    $("dialogTitle").textContent = title;
    $("dialogMsg").innerHTML = String(message || "").split(/\n\s*\n/)
      .map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    $("dialogOk").textContent = ok;
    $("dialogOk").className = danger ? "danger-fill" : "primary";
    $("dialogCancel").hidden = cancel === null;
    $("dialogCancel").textContent = cancel || "";
    returnFocus = document.activeElement;
    $("dialog").hidden = false;
    $("dialogOk").focus();
    return new Promise(r => { resolve = r; });
  }

  function close(result) {
    if (!resolve) return;
    $("dialog").hidden = true;
    const r = resolve;
    resolve = null;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    r(result);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("dialogOk").addEventListener("click", () => close(true));
    $("dialogCancel").addEventListener("click", () => close(false));
    $("dialog").addEventListener("click", (e) => { if (e.target === $("dialog")) close(false); });
  });
  document.addEventListener("keydown", (e) => {
    if (!resolve) return;
    if (e.key === "Escape") { e.stopImmediatePropagation(); close(false); }
  }, true);

  return {
    confirm: (opts) => open(opts),
    alert: (title, message) => open({ title, message, cancel: null }),
  };
})();

// The big modal (widget editor, diff preview...). onClose may return false to keep it open.
const Modal = (() => {
  let onClose = null;
  async function close() {
    if (onClose && (await onClose()) === false) return;
    onClose = null;
    $("modal").hidden = true;
    $("modalBody").innerHTML = "";
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("modalClose").addEventListener("click", close);
    $("modal").addEventListener("mousedown", (e) => { if (e.target === $("modal")) close(); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modal").hidden && $("dialog").hidden) close();
  });
  return {
    open(nodes, { wide = false, beforeClose = null } = {}) {
      $("modalBox").classList.toggle("wide", wide);
      $("modalBody").replaceChildren(...[nodes].flat().filter(n => n !== null && n !== undefined && n !== false));
      onClose = beforeClose;
      $("modal").hidden = false;
      const first = $("modalBody").querySelector("input, select, textarea");
      if (first) first.focus();
    },
    close,
    forceClose() { onClose = null; return close(); },
    get isOpen() { return !$("modal").hidden; },
  };
})();
