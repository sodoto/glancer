// The live preview: the real Glance in a frame next to the editor, on the page being edited.
// It shows what is saved (Glance only reads glance.yml), and reloads right after each save.
// The frame lives outside the editor area, so redrawing the editor doesn't reload it.

const Preview = (() => {
  const KEY = "glancer.preview";
  // Glance's CSS switches to its phone layout below 1190px; just above that is the most readable desktop view.
  const DESKTOP_WIDTH = 1200;
  let on = false;
  let frame = null, frameBox = null, label = null, openLink = null, shownUrl = null, resizer = null;
  try { on = localStorage.getItem(KEY) === "1"; } catch { /* no storage: preview starts closed */ }

  const base = () => ((S.cfg && S.cfg.glance_url) || "").replace(/\/+$/, "");

  // Glance's own rule: the slug, or the name in lowercase with runs of spaces turned into "-".
  const slugOf = (p) => {
    if (p.settings && p.settings.slug) return String(p.settings.slug);
    return String(p.name || "").toLowerCase().replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  };

  function currentPage() {
    const pages = (S.tree && S.tree.pages) || [];
    if (S.section !== null || !pages.length) return { path: "", name: (pages[0] && pages[0].name) || "Home" };
    const p = pages[Math.min(S.page, pages.length - 1)];
    if (p.include || p.raw) return { path: "", name: "home page" };
    return { path: S.page === 0 ? "" : encodeURIComponent(slugOf(p)), name: p.name };
  }

  function setOn(value) {
    on = value;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ }
    $("previewBtn").classList.toggle("active", on);
    draw();
  }

  // Build the panel (once per Glance address), then keep it pointed at the current page.
  function draw() {
    const panel = $("previewPanel");
    const editorShown = !$("editorView").hidden;
    panel.hidden = !on || !editorShown || !S.cfg;
    document.querySelector(".work").classList.toggle("with-preview", !panel.hidden);
    if (panel.hidden) return;
    if (!base()) { drawSetup(panel); return; }
    if (!frame || panel.dataset.base !== base()) drawFrame(panel);
    follow();
  }

  function drawSetup(panel) {
    frame = null;
    panel.dataset.base = "";
    const input = h("input", { placeholder: "http://192.168.1.50:8080", spellcheck: "false" });
    const msg = h("span", { class: "msg" });
    const save = async () => {
      msg.textContent = "";
      try {
        const res = await api("api/glance-url", "POST", { url: input.value });
        S.cfg.glance_url = res.glance_url;
        updateOpenLink();
        draw();
      } catch (e) { msg.textContent = e.message; }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    panel.replaceChildren(head("Preview"), h("div", { class: "preview-setup" },
      h("p", {}, "Where does your browser open Glance? Glancer will show it here, on the page you are editing."),
      h("div", { class: "field" }, h("label", {}, "Glance's address"), input,
        h("div", { class: "hint" }, "The same address you type to open your dashboard, e.g. http://192.168.1.50:8080 or https://glance.example.com")),
      h("div", { class: "modal-foot" }, msg, h("button", { class: "primary", onclick: save }, "Save"))));
    input.focus();
  }

  function head(title) {
    label = h("b", { class: "preview-title" }, title);
    return h("div", { class: "preview-head" }, label, h("span", { class: "spacer" }),
      base() ? h("button", { class: "mini", title: "Reload the preview", onclick: reload }, "↻ Reload") : null,
      base() ? (openLink = h("a", { class: "btn mini", target: "_blank", rel: "noopener", title: "Open this page in a new tab" }, "↗")) : null,
      base() && !S.cfg.glance_url_from_env ? h("button", { class: "mini", title: "Change Glance's address", onclick: changeAddress }, "⚙") : null,
      h("button", { class: "mini", title: "Close the preview", onclick: () => setOn(false) }, "✕"));
  }

  function drawFrame(panel) {
    panel.dataset.base = base();
    shownUrl = null;
    frame = h("iframe", { title: "Glance preview", referrerpolicy: "no-referrer" });
    frameBox = h("div", { class: "preview-frame" }, frame);
    const notes = [];
    if (location.protocol === "https:" && base().startsWith("http:")) {
      notes.push(h("div", { class: "notice warn" }, "Glancer is open over https:// but Glance's address is http://, and browsers block that mix. Use Glance's https:// address."));
    }
    panel.replaceChildren(head("Preview"), ...notes, frameBox,
      h("p", { class: "preview-hint" }, "Shows what is saved, and reloads after each save. Blank? Your reverse proxy may forbid showing Glance inside another page (X-Frame-Options)."));
    if (resizer) resizer.disconnect();
    resizer = new ResizeObserver(fit);
    resizer.observe(frameBox);
  }

  // Draw Glance at desktop width and shrink it to fit, so the preview shows the real layout.
  function fit() {
    if (!frame || !frameBox) return;
    const virtual = DESKTOP_WIDTH;
    const w = frameBox.clientWidth, hgt = frameBox.clientHeight;
    const scale = Math.min(1, w / virtual);
    frame.style.width = `${Math.round(w / scale)}px`;
    frame.style.height = `${Math.round(hgt / scale)}px`;
    frame.style.transform = `scale(${scale})`;
  }

  function follow() {
    if (!frame) return;
    const page = currentPage();
    const url = `${base()}/${page.path}`;
    if (label) label.textContent = `Preview · ${page.name}`;
    if (openLink) openLink.href = url;
    if (url !== shownUrl) { shownUrl = url; frame.src = url; }
    fit();
  }

  function reload() {
    if (!frame || !shownUrl) return;
    frame.src = "about:blank";
    setTimeout(() => { frame.src = shownUrl; }, 30);
  }

  // Glance notices the new file within about half a second, then reloads its config.
  function afterSave() { if (on && frame) setTimeout(reload, 1500); }

  async function changeAddress() {
    const input = h("input", { value: base(), spellcheck: "false" });
    const msg = h("span", { class: "msg" });
    const save = async () => {
      try {
        const res = await api("api/glance-url", "POST", { url: input.value });
        S.cfg.glance_url = res.glance_url;
        Modal.forceClose();
        updateOpenLink();
        draw();
      } catch (e) { msg.textContent = e.message; }
    };
    Modal.open([h("h3", { id: "modalTitle" }, "Glance's address"),
      h("p", { class: "lead" }, "The address you open your dashboard with. Leave it empty to remove it."),
      h("div", { class: "field", style: "margin-top:12px" }, input),
      h("div", { class: "modal-foot" }, msg, h("button", { onclick: Modal.close }, "Cancel"), h("button", { class: "primary", onclick: save }, "Save"))]);
  }

  function updateOpenLink() {
    $("openGlance").hidden = !base();
    if (base()) $("openGlance").href = base();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("previewBtn").classList.toggle("active", on);
    $("previewBtn").addEventListener("click", () => setOn(!on));
  });

  return { draw, afterSave, updateOpenLink };
})();
