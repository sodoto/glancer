// The editor: the draft text lives here; every change is sent to the server, which applies it
// with ruamel.yaml (so comments and formatting survive) and returns the new draft. Nothing touches
// glance.yml until "Review & save".

const S = {
  cfg: null,       // last /api/config response
  disk: "",        // text on disk
  sha: "",         // its hash, to notice outside changes
  draft: "",       // text being edited
  tree: null,
  history: [],     // previous drafts, for undo
  page: 0,         // selected page index
  section: null,   // selected top-level section key (instead of a page)
};
const DRAFT_KEY = "glancer.draft";
const typeNames = () => (S.cfg && S.cfg.widget_types) || {};
const widgetLabel = (t) => typeNames()[t] || t || "widget";
const dirty = () => S.draft !== S.disk;

function storeDraft() {
  try {
    if (dirty()) localStorage.setItem(DRAFT_KEY, JSON.stringify({ sha: S.sha, text: S.draft }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* storage unavailable: drafts just don't survive a reload */ }
}

function storedDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return d && d.sha === S.sha && typeof d.text === "string" && d.text !== S.disk ? d.text : null;
  } catch { return null; }
}

async function loadConfig({ keepDraft = true } = {}) {
  const cfg = await api("api/config");
  S.cfg = cfg;
  S.disk = cfg.text;
  S.sha = cfg.sha;
  S.draft = cfg.text;
  S.tree = cfg.tree;
  S.history = [];
  const saved = keepDraft ? storedDraft() : null;
  if (saved !== null) {
    try {
      const res = await api("api/apply", "POST", { text: saved, ops: [] });
      S.draft = saved;
      S.tree = res.tree;
      toast("Your unsaved changes from last time were restored.");
    } catch { /* stored draft no longer parses: drop it */ }
  }
  $("version").textContent = "v" + cfg.version;
  Preview.updateOpenLink();
  storeDraft();
  renderAll();
}

// Apply edits to the draft. Returns the server's result (e.g. the path of an inserted item), or throws.
async function edit(ops, { quiet = false } = {}) {
  try {
    const res = await api("api/apply", "POST", { text: S.draft, ops: [ops].flat() });
    if (res.text !== S.draft) {
      S.history.push(S.draft);
      if (S.history.length > 100) S.history.shift();
      S.draft = res.text;
    }
    S.tree = res.tree;
    storeDraft();
    renderAll();
    return res.result;
  } catch (e) {
    if (!quiet) UI.alert("That change was not made", e.message);
    throw e;
  }
}

async function setDraft(text) {
  const res = await api("api/apply", "POST", { text, ops: [] });
  if (text !== S.draft) S.history.push(S.draft);
  S.draft = text;
  S.tree = res.tree;
  storeDraft();
  renderAll();
}

async function undo() {
  if (!S.history.length) return;
  const prev = S.history.pop();
  const res = await api("api/apply", "POST", { text: prev, ops: [] });
  S.draft = prev;
  S.tree = res.tree;
  storeDraft();
  renderAll();
}

function renderAll() {
  renderSavebar();
  renderNotices();
  Editor.render();
  if (typeof Views !== "undefined") Views.refresh();
}

function renderSavebar() {
  $("savebar").hidden = !dirty();
  $("undoBtn").disabled = !S.history.length;
}

function renderNotices() {
  const cfg = S.cfg;
  const box = $("notices");
  box.replaceChildren();
  if (!cfg) return;
  if (!cfg.dir_exists) {
    box.append(h("div", { class: "notice bad" }, "The folder ", h("code", {}, cfg.dir), " does not exist inside the container. ",
      "Mount the folder that holds glance.yml there (see the README), then restart Glancer."));
  } else if (!cfg.exists) {
    box.append(h("div", { class: "notice warn" }, "There is no ", h("code", {}, cfg.file), " yet. ",
      h("button", { class: "small", onclick: createStarter }, "Create a starter glance.yml"),
      " or check that the right folder is mounted."));
  } else if (cfg.reformats && S.draft === S.disk) {
    box.append(h("div", { class: "notice" }, `Heads-up: Glancer will write about ${cfg.reformats} line(s) of this file `
      + "a little differently (indentation or spacing) the first time you save. The preview shows exactly what changes."));
  }
}

async function createStarter() {
  try {
    await api("api/create-starter", "POST", {});
    toast("Created glance.yml");
    await loadConfig({ keepDraft: false });
  } catch (e) { UI.alert("Could not create glance.yml", e.message); }
}

// ---------------------------------------------------------------- layout rules (same as the server)

function layoutError(sizes, width) {
  const max = width === "slim" ? 2 : 3;
  if (!sizes.length) return "A page needs at least one column.";
  if (sizes.length > max) return width === "slim" ? "Slim pages can have at most 2 columns." : "A page can have at most 3 columns.";
  const full = sizes.filter(s => s === "full").length;
  if (full === 0 || full > 2) return "A page needs 1 or 2 full columns.";
  return null;
}

// ---------------------------------------------------------------- widget summary

function widgetSummary(w) {
  const d = w.data || {};
  const n = (arr, one, many) => Array.isArray(arr) ? `${arr.length} ${arr.length === 1 ? one : many}` : "";
  switch (w.type) {
    case "bookmarks": {
      const links = (d.groups || []).reduce((a, g) => a + ((g && g.links) || []).length, 0);
      return `${n(d.groups, "group", "groups")} · ${links} link${links === 1 ? "" : "s"}`;
    }
    case "monitor": return (d.sites || []).map(s => s && s.title).filter(Boolean).join(", ") || n(d.sites, "site", "sites");
    case "rss": return n(d.feeds, "feed", "feeds");
    case "weather": return d.location || "";
    case "search": return d["search-engine"] || "duckduckgo";
    case "calendar": return d["first-day-of-week"] ? `starts ${d["first-day-of-week"]}` : "";
    case "clock": return [d["hour-format"], n(d.timezones, "timezone", "timezones")].filter(Boolean).join(" · ");
    case "docker-containers": return d.category ? `category: ${d.category}` : (d["sock-path"] || "");
    case "group": case "split-column": return n(w.children, "widget", "widgets");
    case "reddit": return d.subreddit ? `r/${d.subreddit}` : "";
    case "releases": case "repository": return n(d.repositories, "repository", "repositories") || d.repository || "";
    case "videos": return n(d.channels, "channel", "channels");
    case "markets": case "stocks": return (d.markets || d.stocks || []).map(m => m && (m.name || m.symbol)).filter(Boolean).join(", ");
    case "iframe": return d.source || "";
    case "custom-api": return d.url || "";
    default: return "";
  }
}

// ---------------------------------------------------------------- editor view

const Editor = (() => {
  const view = () => $("editorView");

  function render() {
    const el = view();
    if (!S.cfg) return;
    if (!S.cfg.exists) { el.replaceChildren(); return; }
    if (!S.tree) {
      el.replaceChildren(h("div", { class: "notice bad" }, "glance.yml could not be read: ", S.cfg.parse_error || "unknown error",
        ". Fix it in the ", h("a", { href: "#raw" }, "Raw YAML"), " tab or restore a ", h("a", { href: "#backups" }, "backup"), "."));
      return;
    }
    const pages = S.tree.pages;
    if (S.section === null && S.page >= pages.length) S.page = Math.max(0, pages.length - 1);
    el.replaceChildren(h("div", { class: "layout" }, sidebar(), h("div", {}, S.section !== null ? sectionView(S.section) : pageView())));
    Preview.draw();  // follow the selected page
  }

  // ---------------------------------------------------------------- sidebar

  function sidebar() {
    const t = S.tree;
    const side = h("aside", { class: "side" });
    side.append(h("h3", {}, "Pages", h("span", { class: "spacer" }),
      t.pages_include ? null : h("button", { class: "mini", onclick: addPage }, "+ Add")));
    if (t.pages_include) {
      side.append(h("div", { class: "help", style: "margin:0 8px" }, "All pages come from ", h("code", {}, t.pages_include),
        ". Glancer shows included files read-only."));
    }
    const pagesBox = h("div", { class: "side-pages" });
    t.pages.forEach((p, i) => {
      const active = S.section === null && S.page === i;
      const item = h("div", { class: "side-item" + (active ? " active" : ""), tabindex: 0, draggable: "true",
        title: "Drag to reorder pages",
        onclick: () => { S.section = null; S.page = i; render(); },
        onkeydown: (e) => { if (e.key === "Enter") { S.section = null; S.page = i; render(); } } },
        h("span", { class: "label" }, p.include ? h("span", { class: "muted" }, "📄 " + p.include) : (p.name || h("span", { class: "muted" }, "(no name)"))),
        h("span", { class: "tools" },
          h("button", { class: "mini", title: "Move up", disabled: i === 0, onclick: (e) => { e.stopPropagation(); movePage(i, -1); } }, "↑"),
          h("button", { class: "mini", title: "Move down", disabled: i === t.pages.length - 1, onclick: (e) => { e.stopPropagation(); movePage(i, 1); } }, "↓")));
      item.addEventListener("dragstart", (e) => startDrag(e, { kind: "page", path: ["pages", i] }, item));
      // a widget dropped here moves to this page
      const target = pageDropTarget(p);
      item.addEventListener("dragover", (e) => {
        if (!drag || drag.kind !== "widget" || !target || startsWith(target, drag.path)) return;
        e.preventDefault();
        e.stopPropagation();
        dropLine.remove();
        item.classList.add("drop-target");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
      item.addEventListener("drop", async (e) => {
        if (!drag || drag.kind !== "widget" || !target) return;
        e.preventDefault();
        e.stopPropagation();
        clearDrop();
        if (samePath(drag.path.slice(0, -1), target)) return;
        const col = p.columns.find(c => !c.include);
        await dropMove(target, col.widgets.length);
        toast(`Moved to the page “${p.name}” (first column)`);
      });
      pagesBox.append(item);
    });
    dropZone(pagesBox, {
      accepts: () => drag && drag.kind === "page",
      items: () => [...pagesBox.children].filter(x => x.classList.contains("side-item")),
      drop: (slot) => dropPage(slot),
    });
    side.append(pagesBox);
    if (!t.pages.length && !t.pages_include) side.append(h("div", { class: "help", style: "margin:4px 8px" }, "No pages yet."));

    side.append(h("h3", {}, "Settings"));
    for (const s of t.sections) {
      side.append(h("div", { class: "side-item" + (S.section === s.key ? " active" : ""), tabindex: 0,
        onclick: () => { S.section = s.key; render(); },
        onkeydown: (e) => { if (e.key === "Enter") { S.section = s.key; render(); } } },
        h("span", { class: "label" }, s.key, s.present ? null : h("span", { class: "muted" }, " (not set)"))));
    }

    side.append(h("h3", {}, "Files"));
    side.append(h("div", { class: "side-item", title: S.cfg.file }, h("span", { class: "label" }, S.cfg.file.split(/[\\/]/).pop()), h("span", { class: "muted" }, "main")));
    for (const f of S.cfg.files) {
      side.append(h("div", { class: "side-item", tabindex: 0, title: f.path, onclick: () => viewFile(f) },
        h("span", { class: "label" + (f.exists ? "" : " missing") }, "📄 " + f.name), h("span", { class: "muted" }, f.exists ? "view" : "missing")));
    }
    return side;
  }

  async function addPage() {
    const name = h("input", { placeholder: "e.g. Homelab" });
    const msg = h("span", { class: "msg" });
    const go = async () => {
      if (!name.value.trim()) { msg.textContent = "Give the page a name."; return; }
      try {
        const path = await edit({ op: "insert", path: ["pages"], index: null,
          value: { name: name.value.trim(), columns: [{ size: "small" }, { size: "full" }] } }, { quiet: true });
        Modal.forceClose();
        S.section = null;
        S.page = path[1];
        render();
      } catch (e) { msg.textContent = e.message; }
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    Modal.open([h("h3", { id: "modalTitle" }, "Add a page"),
      h("p", { class: "lead" }, "It starts with a small and a full column. You can change that afterwards."),
      h("div", { class: "field", style: "margin-top:12px" }, h("label", {}, "Page name"), name),
      h("div", { class: "modal-foot" }, msg, h("button", { onclick: Modal.close }, "Cancel"), h("button", { class: "primary", onclick: go }, "Add page"))]);
  }

  async function movePage(i, d) {
    await edit({ op: "move", path: ["pages", i], to: ["pages"], index: i + d });
    if (S.page === i) S.page = i + d; else if (S.page === i + d) S.page = i;
    render();
  }

  // ---------------------------------------------------------------- a page

  function pageView() {
    const pages = S.tree.pages;
    if (!pages.length) {
      return h("div", { class: "empty" }, S.tree.pages_include ? "Pages are defined in an included file." : "No pages yet. ",
        S.tree.pages_include ? null : h("button", { class: "link", onclick: addPage }, "Add your first page"));
    }
    const p = pages[S.page];
    if (p.include) {
      return h("div", {},
        h("div", { class: "page-head" }, h("h2", {}, "📄 ", p.include), h("span", { class: "pill" }, "included file, read-only"),
          h("span", { class: "spacer" }),
          h("button", { class: "small", onclick: () => viewFile(S.cfg.files.find(f => f.name === p.include) || { name: p.include }) }, "View file"),
          h("button", { class: "small danger", onclick: () => deleteNode(p.path, `the line that includes ${p.include}`) }, "Remove from glance.yml")),
        h("p", { class: "help" }, "This page lives in its own file and is pulled in with ", h("code", {}, `$include: ${p.include}`),
          ". Glancer 0.1 does not edit included files; edit them by hand or move the page into glance.yml."));
    }
    if (p.raw) {
      return h("div", { class: "notice warn" }, "This page entry is not a normal mapping. Edit it in the Raw YAML tab.");
    }
    const st = p.settings || {};
    const sizes = p.columns.map(c => c.size);
    const head = h("div", { class: "page-head" },
      h("h2", {}, p.name || "(no name)"),
      st.slug ? h("span", { class: "pill" }, "/" + st.slug) : null,
      st.width && st.width !== "default" ? h("span", { class: "pill blue" }, st.width) : null,
      S.page === 0 ? h("span", { class: "pill" }, "home page") : null,
      h("span", { class: "spacer" }),
      p.head_widgets === null ? h("button", { class: "small", title: "Widgets shown above the columns, across the full width",
        onclick: () => addWidget(p.path.concat(["head-widgets"])) }, "+ Head widget") : null,
      h("button", { class: "small", onclick: () => editPage(p) }, "Page settings"),
      h("button", { class: "small danger", onclick: () => deleteNode(p.path, `the page “${p.name}” and all its widgets`) }, "Delete page"));

    const parts = [head];
    const layoutProblem = p.columns.some(c => c.include) ? null : layoutError(sizes, st.width);
    if (layoutProblem) parts.push(h("div", { class: "notice warn" }, "Glance will refuse this page: ", layoutProblem));
    if (p.head_widgets !== null) {
      parts.push(h("div", { class: "column head" },
        h("div", { class: "col-head" }, h("b", {}, "Head widgets"), h("span", { class: "muted" }, " · above the columns"), h("span", { class: "spacer" }),
          !p.head_widgets.length ? h("button", { class: "mini danger", title: "Remove the empty head-widgets list",
            onclick: () => edit({ op: "delete", path: p.path.concat(["head-widgets"]) }) }, "✕") : null),
        widgetList(p.head_widgets, p.path.concat(["head-widgets"]), null)));
    }
    if (p.columns_include) {
      parts.push(h("div", { class: "notice" }, "The columns of this page come from ", h("code", {}, p.columns_include), " (read-only)."));
      return h("div", {}, parts);
    }
    const cols = h("div", { class: "columns" });
    p.columns.forEach((c, ci) => cols.append(columnView(p, c, ci, sizes, st.width)));
    const canAdd = (size) => !layoutError([...sizes, size], st.width);
    if (canAdd("small") || canAdd("full")) {
      cols.append(h("div", { class: "add-col" },
        canAdd("small") ? h("button", { class: "small", onclick: () => addColumn(p, "small") }, "+ Small column") : null,
        canAdd("full") ? h("button", { class: "small", onclick: () => addColumn(p, "full") }, "+ Full column") : null));
    }
    dropZone(cols, {
      horizontal: true,
      accepts: () => drag && drag.kind === "column" && samePath(drag.page, p.path),
      items: () => [...cols.children].filter(x => x.classList.contains("column")),
      before: () => cols.querySelector(":scope > .add-col"),
      drop: (slot) => dropMove(p.path.concat(["columns"]), slot),
    });
    parts.push(cols);
    parts.push(h("p", { class: "help", style: "margin-top:14px" },
      "Drag a widget to move it (also onto a page on the left), and ⠿ to reorder columns. ",
      "Glance allows up to 3 columns (2 on slim pages) with 1 or 2 full columns. A small column is 300px wide; full columns share the rest."));
    return h("div", {}, parts);
  }

  function columnView(p, c, ci, sizes, width) {
    if (c.include) {
      return h("div", { class: "column full" }, h("div", { class: "col-head" }, h("span", { class: "wtype inc" }, "📄 " + c.include)),
        h("div", { class: "empty-col" }, "Column from an included file (read-only)"));
    }
    const sizeSel = h("select", { title: "Column size", onchange: () => edit({ op: "set_fields", path: c.path, set: { size: sizeSel.value }, unset: [] }).catch(() => render()) });
    for (const s of ["small", "full"]) {
      const next = sizes.slice(); next[ci] = s;
      const ok = s === c.size || !layoutError(next, width);
      sizeSel.append(h("option", { value: s, selected: s === c.size, disabled: !ok }, s));
    }
    const without = sizes.filter((_, i) => i !== ci);
    const delProblem = layoutError(without, width);
    const listPath = c.path.concat(["widgets"]);
    const handle = h("span", { class: "drag-handle", draggable: "true", title: "Drag to reorder the columns" }, "⠿");
    const colEl = h("div", { class: "column " + (c.size === "small" ? "small" : "full") },
      h("div", { class: "col-head" }, handle, sizeSel, h("span", { class: "spacer" }),
        h("button", { class: "mini", title: "Move column left", disabled: ci === 0, onclick: () => edit({ op: "move", path: c.path, to: p.path.concat(["columns"]), index: ci - 1 }) }, "←"),
        h("button", { class: "mini", title: "Move column right", disabled: ci === p.columns.length - 1, onclick: () => edit({ op: "move", path: c.path, to: p.path.concat(["columns"]), index: ci + 1 }) }, "→"),
        h("button", { class: "mini danger", title: delProblem ? `Can't delete: ${delProblem}` : "Delete column", disabled: !!delProblem,
          onclick: () => deleteNode(c.path, c.widgets.length ? `this column and its ${c.widgets.length} widget(s)` : "this empty column") }, "✕")),
      widgetList(c.widgets, listPath));
    handle.addEventListener("dragstart", (e) => startDrag(e, { kind: "column", path: c.path, page: p.path, image: colEl }, colEl));
    return colEl;
  }

  function widgetList(widgets, listPath) {
    const box = h("div", { class: "wlist" });
    if (!widgets.length) box.append(h("div", { class: "empty-col" }, "No widgets"));
    widgets.forEach((w, i) => box.append(widgetCard(w, i, widgets.length, listPath)));
    box.append(h("button", { class: "small add-widget", onclick: () => addWidget(listPath) }, "+ Add widget"));
    dropZone(box, {
      accepts: () => canDropWidget(listPath),
      items: () => [...box.children].filter(x => x.classList.contains("wcard")),
      before: () => box.querySelector(":scope > .add-widget"),
      drop: (slot) => dropMove(listPath, slot),
    });
    return box;
  }

  function widgetCard(w, i, count, listPath) {
    const move = (to, index) => edit({ op: "move", path: w.path, to, index });
    const tools = h("span", { class: "tools" },
      h("button", { class: "mini", title: "Move up", disabled: i === 0, onclick: () => move(listPath, i - 1) }, "↑"),
      h("button", { class: "mini", title: "Move down", disabled: i === count - 1, onclick: () => move(listPath, i + 1) }, "↓"),
      h("button", { class: "mini", title: "Move to another column, group, page or the head widgets", onclick: () => moveDialog(w) }, "Move…"));
    const draggable = (card) => {
      card.draggable = true;
      card.title = "Drag to move";
      card.addEventListener("dragstart", (e) => startDrag(e, { kind: "widget", path: w.path, type: w.type }, card));
      return card;
    };
    if (w.include) {
      tools.append(h("button", { class: "mini danger", title: "Remove the $include line", onclick: () => deleteNode(w.path, `the line that includes ${w.include}`) }, "✕"));
      return draggable(h("div", { class: "wcard" },
        h("div", { class: "top" }, h("span", { class: "wtype inc" }, "included"),
          h("span", { class: "wtitle", onclick: () => viewFile(S.cfg.files.find(f => f.name === w.include) || { name: w.include }) }, "📄 " + w.include)),
        h("div", { class: "wsum" }, "Read-only in Glancer 0.1"), tools));
    }
    tools.append(
      h("button", { class: "mini", title: "Edit", onclick: () => editWidget(w.path) }, "Edit"),
      h("button", { class: "mini danger", title: "Delete", onclick: () => deleteNode(w.path, `this ${widgetLabel(w.type)} widget`) }, "✕"));
    const known = !!typeNames()[w.type];
    const title = (w.data && w.data.title) || widgetLabel(w.type);
    const card = h("div", { class: "wcard" },
      h("div", { class: "top" },
        h("span", { class: "wtype" + (known ? "" : " unknown"), title: known ? "" : "Not a widget type Glancer knows; it is kept as-is" }, w.type || "?"),
        h("span", { class: "wtitle", title: "Edit", onclick: () => editWidget(w.path) }, title)));
    const sum = w.data ? widgetSummary(w) : "Uses anchors or tags: edit as YAML";
    if (sum) card.append(h("div", { class: "wsum", onclick: () => editWidget(w.path) }, sum));
    card.append(tools);
    if (w.children) {
      const childPath = w.path.concat(["widgets"]);
      card.append(h("div", { class: "children" }, widgetList(w.children, childPath)));
    }
    return draggable(card);
  }

  // ---------------------------------------------------------------- drag and drop
  //
  // Widgets can be dropped in any widget list (columns, head widgets, groups) or on a page in the
  // sidebar; columns are reordered by their ⠿ handle, pages by dragging them in the sidebar.

  let drag = null;  // { kind: "widget" | "column" | "page", path, type?, page? }
  const dropLine = h("div", { class: "drop-line" });

  function startDrag(e, info, el) {
    drag = info;
    e.stopPropagation();  // a widget inside a group: drag the widget, not the group
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "glancer");  // some browsers only start a drag with data
    if (info.image) e.dataTransfer.setDragImage(info.image, 24, 16);
    requestAnimationFrame(() => el.classList.add("dragging"));
  }

  function clearDrop() {
    dropLine.remove();
    dropLine.className = "drop-line";
    document.querySelectorAll(".drop-target").forEach(x => x.classList.remove("drop-target"));
  }

  document.addEventListener("dragend", () => {
    drag = null;
    clearDrop();
    document.querySelectorAll(".dragging").forEach(x => x.classList.remove("dragging"));
  });
  // A drag over something that isn't a drop zone: hide the marker.
  document.addEventListener("dragover", (e) => { if (!e.defaultPrevented) clearDrop(); });

  // Which slot (0 = before the first item) the pointer is in.
  function slotIndex(items, e, horizontal) {
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) return i;
    }
    return items.length;
  }

  // Make `box` accept drops. A zone that doesn't accept the current drag lets it bubble to the
  // zone around it (e.g. a group dragged over another group's list lands in the column instead).
  function dropZone(box, { accepts, items, before, drop, horizontal = false }) {
    let slot = 0;
    box.addEventListener("dragover", (e) => {
      if (!drag || !accepts()) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const list = items();
      slot = slotIndex(list, e, horizontal);
      dropLine.className = "drop-line" + (horizontal ? " vertical" : "");
      const next = list[slot] || (before && before()) || null;
      if (dropLine.parentNode !== box || dropLine.nextSibling !== next) box.insertBefore(dropLine, next);
    });
    box.addEventListener("drop", (e) => {
      if (!drag || !accepts()) return;
      e.preventDefault();
      e.stopPropagation();
      clearDrop();
      const at = slot;
      Promise.resolve(drop(at)).catch(() => {});
    });
  }

  function canDropWidget(listPath) {
    if (!drag || drag.kind !== "widget") return false;
    if (startsWith(listPath, drag.path)) return false;  // not into itself
    if (CONTAINERS.includes(drag.type) && inContainer(listPath)) return false;  // no group inside a group
    return true;
  }

  // The server places the item after taking it out of its old spot, so a later slot in the same list is one less.
  function finalIndex(from, toList, slot) {
    const sameList = samePath(from.slice(0, -1), toList);
    const fromIdx = from[from.length - 1];
    return sameList && slot > fromIdx ? slot - 1 : slot;
  }

  async function dropMove(toList, slot) {
    const from = drag && drag.path;
    if (!from) return;
    const index = finalIndex(from, toList, slot);
    if (samePath(from.slice(0, -1), toList) && index === from[from.length - 1]) return;  // dropped where it was
    await edit({ op: "move", path: from, to: toList, index });
  }

  async function dropPage(slot) {
    const from = drag.path[1];
    const to = finalIndex(drag.path, ["pages"], slot);
    if (to === from) return;
    await edit({ op: "move", path: ["pages", from], to: ["pages"], index: to });
    // keep the same page selected
    if (S.page === from) S.page = to;
    else if (from < S.page && to >= S.page) S.page -= 1;
    else if (from > S.page && to <= S.page) S.page += 1;
    render();
  }

  // A widget dropped on a page in the sidebar goes to the bottom of that page's first column.
  function pageDropTarget(p) {
    if (!p || p.include || p.raw || p.columns_include) return null;
    const col = (p.columns || []).find(c => !c.include);
    return col ? col.path.concat(["widgets"]) : null;
  }

  // ---------------------------------------------------------------- move to…

  const CONTAINERS = ["group", "split-column"];
  const samePath = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const startsWith = (path, prefix) => prefix.length <= path.length && samePath(path.slice(0, prefix.length), prefix);
  // A widget list inside a group/split column has a "widgets" key below another widget list.
  const inContainer = (listPath) => listPath.filter(x => x === "widgets" || x === "head-widgets").length > 1;

  function moveDialog(w) {
    const here = w.path.slice(0, -1);
    const isContainer = CONTAINERS.includes(w.type);
    const name = w.include ? w.include : ((w.data && w.data.title) || widgetLabel(w.type));
    const go = async (to, label, pageIndex) => {
      Modal.forceClose();
      try {
        await edit({ op: "move", path: w.path, to, index: null }, { quiet: true });
        if (pageIndex !== S.page) { S.page = pageIndex; render(); }
        toast(`Moved “${name}” to ${label}`);
      } catch (e) { UI.alert("Could not move the widget", e.message); }
    };
    const dest = (label, to, pageIndex, extra = "") => {
      const current = samePath(to, here);
      return h("button", { class: "small", style: "width:100%;justify-content:flex-start;margin-bottom:6px", disabled: current,
        onclick: () => go(to, label, pageIndex) }, label, extra ? h("span", { class: "muted" }, extra) : null,
        current ? h("span", { class: "muted" }, " (it is here)") : null);
    };
    // groups / split columns this widget could go into (not itself, and Glance allows no group inside a group)
    const containers = (widgets) => isContainer ? [] : (widgets || []).filter(x => CONTAINERS.includes(x.type) && !startsWith(x.path, w.path));

    const parts = [];
    S.tree.pages.forEach((p, pi) => {
      if (p.include || p.raw) return;
      const box = h("div", { class: "form-section" }, h("h4", {}, p.name || `Page ${pi + 1}`));
      const pageLabel = S.tree.pages.length > 1 ? `${p.name}: ` : "";
      box.append(dest(`${pageLabel}Head widgets`, p.path.concat(["head-widgets"]), pi, p.head_widgets === null ? " · above the columns (new)" : " · above the columns"));
      for (const g of containers(p.head_widgets)) {
        box.append(dest(`${pageLabel}↳ into ${(g.data && g.data.title) || widgetLabel(g.type)}`, g.path.concat(["widgets"]), pi, " · in the head widgets"));
      }
      (p.columns || []).forEach((c, ci) => {
        if (c.include) return;
        box.append(dest(`${pageLabel}Column ${ci + 1}`, c.path.concat(["widgets"]), pi, ` · ${c.size}, at the bottom`));
        for (const g of containers(c.widgets)) {
          box.append(dest(`${pageLabel}↳ into ${(g.data && g.data.title) || widgetLabel(g.type)}`, g.path.concat(["widgets"]), pi, ` · in column ${ci + 1}, as a tab`));
        }
      });
      parts.push(box);
    });

    const top = [];
    if (!isContainer && !w.include && !inContainer(here)) {
      top.push(h("div", { class: "form-section" }, h("h4", {}, "Group"),
        h("button", { class: "small", style: "width:100%;justify-content:flex-start", onclick: async () => {
          Modal.forceClose();
          await edit({ op: "wrap_group", path: w.path, type: "group" });
          toast("Put in a new group. Use “Move…” on other widgets to add them to it as tabs.", 6000);
        } }, "Put it in a new group (tabs)", h("span", { class: "muted" }, " · other widgets can then be moved into it"))));
    }
    Modal.open([h("h3", { id: "modalTitle" }, `Move “${name}”`),
      h("p", { class: "lead" }, "Pick where it goes. It is added at the bottom; use the arrows to fine-tune."),
      ...top, ...parts,
      h("div", { class: "modal-foot" }, h("button", { onclick: Modal.close }, "Cancel"))]);
  }

  async function addColumn(p, size) {
    await edit({ op: "insert", path: p.path.concat(["columns"]), index: null, value: { size } });
  }

  async function deleteNode(path, what) {
    if (!(await UI.confirm({ title: "Delete?", message: `Delete ${what}?\n\nNothing is saved until you click “Review & save”, and you can undo.`, ok: "Delete", danger: true }))) return;
    await edit({ op: "delete", path });
  }

  // ---------------------------------------------------------------- add widget

  function addWidget(listPath) {
    // Glance doesn't allow a group or split column inside a group.
    const inGroup = listPath.filter(x => x === "widgets" || x === "head-widgets").length > 1;
    const types = Object.keys(typeNames()).filter(t => t !== "stocks" && !(inGroup && ["group", "split-column"].includes(t)));
    const common = COMMON_WIDGETS.filter(t => types.includes(t));
    const rest = types.filter(t => !common.includes(t)).sort();
    const pick = async (type) => {
      try {
        const path = await edit({ op: "insert", path: listPath, index: null, value: { type, ...(WIDGET_TEMPLATES[type] || {}) } }, { quiet: true });
        Modal.forceClose();
        if (!["group", "split-column"].includes(type)) editWidget(path, { isNew: true });
      } catch (e) { UI.alert("Could not add the widget", e.message); }
    };
    const btn = (t) => h("button", { onclick: () => pick(t) }, h("span", {}, widgetLabel(t)), h("small", {}, WIDGET_HELP[t] || t));
    const custom = h("input", { placeholder: "another-type", spellcheck: "false" });
    Modal.open([
      h("h3", { id: "modalTitle" }, "Add a widget"),
      h("p", { class: "lead" }, "Pick a type. Its settings open right after."),
      h("div", { class: "form-section" }, h("h4", {}, "Common"), h("div", { class: "type-grid" }, common.map(btn))),
      h("div", { class: "form-section" }, h("h4", {}, "All other widgets"), h("div", { class: "type-grid" }, rest.map(btn))),
      h("div", { class: "form-section" }, h("h4", {}, "Not listed? (e.g. a newer Glance widget)"),
        h("div", { style: "display:flex;gap:8px" }, custom, h("button", { onclick: () => custom.value.trim() && pick(custom.value.trim()) }, "Add"))),
    ], { wide: true });
  }

  // ---------------------------------------------------------------- the node editor (form + YAML tabs)

  // Opens a modal with a form tab (when a form exists) and a YAML tab for the node at `path`.
  async function nodeEditor({ path, title, lead, form, isNew = false }) {
    let node;
    try { node = await api("api/node", "POST", { text: S.draft, path }); }
    catch (e) { UI.alert("Cannot open this", e.message); return; }
    let data = node.data !== null ? structuredClone(node.data) : null;
    const original = JSON.stringify(data);
    let tab = form && node.plain ? "form" : "yaml";
    let yamlText = node.yaml;
    const msg = h("span", { class: "msg" });
    const body = h("div");
    const tabs = h("div", { class: "tabs" });
    const textarea = h("textarea", { class: "code", spellcheck: "false" });
    textarea.value = yamlText;
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); textarea.setRangeText("  ", textarea.selectionStart, textarea.selectionEnd, "end"); }
    });
    const formChanged = () => JSON.stringify(data) !== original;
    const yamlChanged = () => textarea.value !== yamlText;

    // Apply the open tab's changes to the draft. Returns false if something is wrong.
    async function applyTab() {
      msg.textContent = "";
      try {
        if (tab === "form" && formChanged()) await edit(form.op(data, path), { quiet: true });
        else if (tab === "yaml" && yamlChanged()) await edit({ op: "set_yaml", path, yaml: textarea.value }, { quiet: true });
        return true;
      } catch (e) { msg.textContent = e.message; return false; }
    }

    function draw() {
      tabs.replaceChildren(
        form && node.plain ? h("button", { class: tab === "form" ? "active" : "", onclick: () => switchTab("form") }, "Form") : null,
        h("button", { class: tab === "yaml" ? "active" : "", onclick: () => switchTab("yaml") }, "YAML"));
      if (tab === "form") body.replaceChildren(form.render(data, () => {}));
      else {
        body.replaceChildren(textarea,
          h("p", { class: "hint" }, "Exactly what goes into glance.yml for this ", form ? form.noun : "section",
            ". Comments are kept. ${ENV_VARS} and $include lines are left as they are."));
      }
      if (!form || !node.plain) {
        if (node.data === null && form) body.prepend(h("div", { class: "notice" }, "This uses YAML anchors, aliases or tags, so it can only be edited as YAML (to keep them intact)."));
      }
    }

    async function switchTab(next) {
      if (next === tab) return;
      // Carry the edits over: apply this tab, then reload the node for the other one.
      if (!(await applyTab())) return;
      const fresh = await api("api/node", "POST", { text: S.draft, path });
      node = fresh;
      data = fresh.data !== null ? structuredClone(fresh.data) : null;
      yamlText = fresh.yaml;
      textarea.value = yamlText;
      if (next === "form" && !fresh.plain) { msg.textContent = "This can only be edited as YAML now."; next = "yaml"; }
      tab = next;
      draw();
    }

    async function done() {
      if (await applyTab()) Modal.forceClose();
    }

    draw();
    Modal.open([
      h("h3", { id: "modalTitle" }, title),
      lead ? h("p", { class: "lead" }, lead) : null,
      tabs, body,
      h("div", { class: "modal-foot" }, msg,
        isNew ? h("button", { class: "danger", onclick: async () => { Modal.forceClose(); await edit({ op: "delete", path }); } }, "Remove") : null,
        h("button", { onclick: () => Modal.close() }, "Cancel"),
        h("button", { class: "primary", onclick: done }, "Apply")),
    ], {
      wide: true,
      beforeClose: async () => {
        const changed = tab === "form" ? formChanged() : yamlChanged();
        if (!changed) return true;
        return UI.confirm({ title: "Discard these changes?", message: "You changed things in this window without clicking Apply.", ok: "Discard", danger: true });
      },
    });
  }

  function editWidget(path, { isNew = false } = {}) {
    const w = findWidget(path);
    const type = w && w.type;
    nodeEditor({
      path, isNew,
      title: `${isNew ? "New" : "Edit"} ${widgetLabel(type)} widget`,
      lead: type && !typeNames()[type] ? `“${type}” is not a widget type Glancer knows. It is kept exactly as written.` : null,
      form: { noun: "widget", render: (data, onChange) => widgetForm(data, onChange), op: (data, p) => ({ op: "set_value", path: p, value: data }) },
    });
  }

  function editPage(p) {
    nodeEditor({
      path: p.path, title: `Page settings: ${p.name}`,
      lead: "The YAML tab shows the whole page, including its columns and widgets.",
      form: {
        noun: "page",
        render: (data, onChange) => renderFields(data, PAGE_FIELDS, onChange),
        op: (data, path) => {
          const set = {}, unset = [];
          for (const f of PAGE_FIELDS) {
            if (has(data, f.key)) set[f.key] = data[f.key]; else unset.push(f.key);
          }
          return { op: "set_fields", path, set, unset };
        },
      },
    });
  }

  function findWidget(path) {
    const walk = (list) => {
      for (const w of list || []) {
        if (JSON.stringify(w.path) === JSON.stringify(path)) return w;
        const inner = walk(w.children);
        if (inner) return inner;
      }
      return null;
    };
    for (const p of S.tree.pages) {
      const hit = walk(p.head_widgets) || (p.columns || []).map(c => walk(c.widgets)).find(Boolean);
      if (hit) return hit;
    }
    return null;
  }

  // ---------------------------------------------------------------- top-level sections

  const SECTION_HELP = {
    server: "Host, port, base-url, assets-path… Changing these usually needs a Glance restart.",
    auth: "Glance's own login (secret-key and users). Use ${ENV_VARS} or password-hash for secrets.",
    theme: "Colors (HSL values like “240 8 9”), contrast, custom-css-file and theme presets.",
    branding: "Logo, footer, favicon and app name.",
    document: "Extra HTML for the page's <head>.",
  };

  function sectionView(key) {
    const s = S.tree.sections.find(x => x.key === key);
    const panel = h("div", { class: "panel" });
    const msg = h("span", { class: "msg" });
    const textarea = h("textarea", { class: "code", spellcheck: "false" });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); textarea.setRangeText("  ", textarea.selectionStart, textarea.selectionEnd, "end"); }
    });
    const docs = "https://github.com/glanceapp/glance/blob/main/docs/configuration.md#" + key;
    panel.append(h("h2", {}, h("code", {}, key + ":")),
      h("p", { class: "help" }, SECTION_HELP[key] || "A top-level section Glancer has no form for. It is kept exactly as written.", " ",
        h("a", { href: docs, target: "_blank", rel: "noopener" }, "Glance docs ↗")));
    if (s && s.present) {
      api("api/node", "POST", { text: S.draft, path: [key] }).then(n => { textarea.value = n.yaml; textarea.dataset.orig = n.yaml; })
        .catch(e => { msg.textContent = e.message; });
    } else {
      textarea.placeholder = key === "theme" ? "background-color: 240 8 9\nprimary-color: 43 50 70" : "key: value";
    }
    const apply = async () => {
      msg.textContent = "";
      if (!textarea.value.trim()) { msg.textContent = "Empty. Use “Remove section” to delete it."; return; }
      try {
        await edit({ op: "set_yaml", path: [key], yaml: textarea.value }, { quiet: true });
        toast(`${key} updated in the draft`);
      } catch (e) { msg.textContent = e.message; }
    };
    panel.append(textarea, h("div", { class: "modal-foot" }, msg,
      s && s.present ? h("button", { class: "danger", onclick: async () => {
        if (await UI.confirm({ title: `Remove ${key}?`, message: `Remove the whole “${key}:” section from the draft?`, ok: "Remove", danger: true })) {
          await edit({ op: "delete", path: [key] });
        }
      } }, "Remove section") : null,
      h("button", { class: "primary", onclick: apply }, s && s.present ? "Apply" : `Add ${key}`)));
    return h("div", { class: "section-editor" }, panel);
  }

  // ---------------------------------------------------------------- included files

  async function viewFile(f) {
    if (!f || !f.path) { UI.alert("File not found", `${f ? f.name : "This file"} is not in the config folder.`); return; }
    let content;
    try { content = (await api("api/file?path=" + encodeURIComponent(f.path))).text; }
    catch (e) { UI.alert("Cannot open the file", e.message); return; }
    Modal.open([h("h3", { id: "modalTitle" }, "📄 " + f.name),
      h("p", { class: "lead" }, "Included from ", h("code", {}, f.from), ". Read-only in Glancer 0.1."),
      h("pre", { class: "viewer" }, content),
      h("div", { class: "modal-foot" }, h("button", { onclick: Modal.close }, "Close"))], { wide: true });
  }

  return { render, addWidget, editWidget };
})();

// ---------------------------------------------------------------- save flow

async function reviewAndSave() {
  let pv;
  try { pv = await api("api/preview", "POST", { text: S.draft, base_sha: S.sha }); }
  catch (e) { UI.alert("Cannot check the changes", e.message); return; }
  const issues = h("div", { class: "issues" });
  for (const e of pv.errors) issues.append(h("div", { class: "err" }, "✕ ", e));
  for (const w of pv.warnings) issues.append(h("div", { class: "wrn" }, "! ", w));
  if (pv.conflict) issues.append(h("div", { class: "wrn" }, "! glance.yml was changed by something else since Glancer loaded it. Saving will overwrite that change (it is kept in a backup)."));
  if (!pv.errors.length) issues.append(h("div", { class: "ok" }, "✓ Glance should accept this config."));
  const msg = h("span", { class: "msg" });
  const saveBtn = h("button", { class: "primary", disabled: pv.errors.length > 0 || pv.unchanged, onclick: async () => {
    saveBtn.disabled = true;
    try {
      const res = await api("api/save", "POST", { text: S.draft, base_sha: S.sha, force: pv.conflict });
      S.disk = S.draft;
      S.sha = res.sha;
      S.history = [];
      if (S.cfg) S.cfg.reformats = 0;
      storeDraft();
      Modal.forceClose();
      renderAll();
      Preview.afterSave();
      toast(res.backup ? "Saved. Glance reloads it by itself. Previous version kept as a backup." : "Saved.", 5000);
    } catch (e) {
      msg.textContent = e.message;
      saveBtn.disabled = false;
    }
  } }, "Save to glance.yml");
  Modal.open([
    h("h3", { id: "modalTitle" }, "Review your changes"),
    h("p", { class: "lead" }, "Red lines are removed, green lines are added. Everything else stays exactly as it is."),
    issues,
    h("pre", { class: "diff", html: diffHtml(pv.diff) }),
    h("div", { class: "modal-foot" }, msg, h("button", { onclick: Modal.close }, "Keep editing"), saveBtn),
  ], { wide: true });
}

document.addEventListener("DOMContentLoaded", () => {
  $("saveBtn").addEventListener("click", reviewAndSave);
  $("undoBtn").addEventListener("click", undo);
  $("discardBtn").addEventListener("click", async () => {
    if (!(await UI.confirm({ title: "Discard all changes?", message: "Go back to what is saved in glance.yml?", ok: "Discard", danger: true }))) return;
    await loadConfig({ keepDraft: false });
  });
  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !typing && !Modal.isOpen) { e.preventDefault(); undo(); }
  });
  window.addEventListener("beforeunload", (e) => { if (dirty()) e.preventDefault(); });
});
