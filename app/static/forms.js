// Widget forms. Field names come from Glance's docs/configuration.md.
// A form edits a plain copy of the widget; keys the form doesn't know are left untouched.

const TARGETS = [["_blank", "_blank (new tab)"], ["_self", "_self (same tab)"], ["_parent", "_parent"], ["_top", "_top"]];
const HOUR_FORMATS = [["12h", "12h"], ["24h", "24h"]];
const ICON_HINT = "si:, sh:, di: or mdi: icon name, or an image URL. Example: sh:jellyfin";

// Rarely needed settings: shown under a folded "More options".
const more = (...fields) => fields.map(f => ({ ...f, advanced: true }));
const host = (url) => { try { return new URL(String(url)).host || String(url); } catch { return String(url || ""); } };

const SHARED_FIELDS = [
  { key: "title", label: "Title", placeholder: "Defined by the widget" },
  ...more(
    { key: "title-url", label: "Title link", placeholder: "https://…", hint: "Where clicking the title goes" },
    { key: "cache", label: "Cache", placeholder: "e.g. 5m", hint: "Number + s, m, h or d (not every widget uses it)" },
    { key: "css-class", label: "CSS class" },
    { key: "hide-header", label: "Hide the header (title)", type: "bool" },
  ),
];

const LINK_OPTIONS = more(
  { key: "same-tab", label: "Open in the same tab", type: "bool" },
  { key: "hide-arrow", label: "Hide the arrow", type: "bool" },
  { key: "target", label: "Link target", type: "select", options: TARGETS, hint: "Overrides “same tab”" },
);

const WIDGET_FORMS = {
  bookmarks: [
    { key: "groups", label: "Groups", type: "list", item: "Group", titleKey: "title", required: true, newItem: () => ({ links: [] }),
      subtitle: (g) => `${(g.links || []).length} link${(g.links || []).length === 1 ? "" : "s"}`, fields: [
        { key: "title", label: "Group title", placeholder: "Optional" },
        { key: "color", label: "Color", placeholder: "e.g. 10 70 50", hint: "HSL: hue saturation lightness" },
        ...LINK_OPTIONS,
        { key: "links", label: "Links", type: "list", item: "Link", titleKey: "title", required: true, subtitle: (l) => host(l.url), fields: [
          { key: "title", label: "Title", required: true },
          { key: "url", label: "URL", required: true, placeholder: "https://…" },
          { key: "icon", label: "Icon", hint: ICON_HINT },
          ...more({ key: "description", label: "Description" }),
          ...LINK_OPTIONS,
        ] },
      ] },
  ],
  monitor: [
    { key: "style", label: "Style", type: "select", options: [["compact", "compact"]] },
    { key: "show-failing-only", label: "Show only failing sites", type: "bool" },
    { key: "sites", label: "Sites", type: "list", item: "Site", titleKey: "title", required: true, subtitle: (s) => host(s.url), fields: [
      { key: "title", label: "Title", required: true },
      { key: "url", label: "URL", required: true, placeholder: "https://…", hint: "Must be reachable by Glance" },
      { key: "icon", label: "Icon", hint: ICON_HINT },
      ...more(
        { key: "check-url", label: "Check URL", hint: "Checked instead of the URL, if set" },
        { key: "error-url", label: "Error URL", hint: "Opened when the site is down" },
        { key: "timeout", label: "Timeout", placeholder: "3s" },
        { key: "alt-status-codes", label: "Also OK status codes", type: "csv", placeholder: "e.g. 401, 403" },
        { key: "allow-insecure", label: "Allow self-signed certificates", type: "bool" },
        { key: "same-tab", label: "Open in the same tab", type: "bool" },
        { key: "basic-auth", label: "Basic authentication", type: "object", fields: [
          { key: "username", label: "Username" },
          { key: "password", label: "Password", hint: "Tip: use ${ENV_VAR} instead of the real password" },
        ] },
      ),
    ] },
  ],
  rss: [
    { key: "style", label: "Style", type: "select", options: [["vertical-list", "vertical-list"], ["detailed-list", "detailed-list"], ["horizontal-cards", "horizontal-cards"], ["horizontal-cards-2", "horizontal-cards-2"]] },
    { key: "limit", label: "Max articles", type: "number", placeholder: "25" },
    { key: "collapse-after", label: "Collapse after", type: "number", placeholder: "5", hint: "-1 = never collapse" },
    ...more(
      { key: "thumbnail-height", label: "Thumbnail height (rem)", type: "number", placeholder: "10", hint: "horizontal-cards only" },
      { key: "card-height", label: "Card height (rem)", type: "number", placeholder: "27", hint: "horizontal-cards-2 only" },
      { key: "preserve-order", label: "Keep the feeds' own order", type: "bool" },
      { key: "single-line-titles", label: "Single-line titles", type: "bool" },
    ),
    { key: "feeds", label: "Feeds", type: "list", item: "Feed", titleKey: "title", fallbackKey: "url", required: true, subtitle: (f) => host(f.url), fields: [
      { key: "url", label: "Feed URL", required: true, placeholder: "https://…/rss" },
      { key: "title", label: "Title", placeholder: "From the feed" },
      ...more(
        { key: "limit", label: "Max articles from this feed", type: "number" },
        { key: "item-link-prefix", label: "Link prefix" },
        { key: "hide-categories", label: "Hide categories (detailed-list)", type: "bool" },
        { key: "hide-description", label: "Hide description (detailed-list)", type: "bool" },
      ),
    ] },
  ],
  search: [
    { key: "search-engine", label: "Search engine", type: "combo", options: ["duckduckgo", "google", "bing", "perplexity", "kagi", "startpage"], placeholder: "duckduckgo", hint: "A name from the list or a URL with {QUERY}" },
    { key: "placeholder", label: "Placeholder text", placeholder: "Type here to search…" },
    ...more(
      { key: "target", label: "Link target", type: "select", options: TARGETS },
      { key: "new-tab", label: "Open results in a new tab", type: "bool" },
      { key: "autofocus", label: "Focus the search bar on load", type: "bool" },
    ),
    { key: "bangs", label: "Bangs (shortcuts like !yt)", type: "list", item: "Bang", titleKey: "shortcut", subtitle: (b) => b.title || host(b.url), fields: [
      { key: "shortcut", label: "Shortcut", required: true, placeholder: "!yt" },
      { key: "url", label: "URL", required: true, placeholder: "https://www.youtube.com/results?search_query={QUERY}" },
      { key: "title", label: "Title", placeholder: "YouTube" },
    ] },
  ],
  weather: [
    { key: "location", label: "Location", required: true, placeholder: "London, United Kingdom", hint: "City, Country (state optional)" },
    { key: "units", label: "Units", type: "select", options: [["metric", "metric (°C)"], ["imperial", "imperial (°F)"]] },
    { key: "hour-format", label: "Hour format", type: "select", options: HOUR_FORMATS },
    ...more(
      { key: "hide-location", label: "Hide the location name", type: "bool" },
      { key: "show-area-name", label: "Show the state / area name", type: "bool" },
    ),
  ],
  calendar: [
    { key: "first-day-of-week", label: "First day of the week", type: "select",
      options: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(d => [d, d]) },
  ],
  clock: [
    { key: "hour-format", label: "Hour format", type: "select", options: HOUR_FORMATS },
    { key: "timezones", label: "Other timezones", type: "list", item: "Timezone", titleKey: "label", fallbackKey: "timezone", subtitle: (t) => t.label ? t.timezone : "", fields: [
      { key: "timezone", label: "Timezone", required: true, placeholder: "Europe/Paris" },
      { key: "label", label: "Label", placeholder: "Paris" },
    ] },
  ],
  // Older configs list them under `stocks:`; Glance still reads that, so edit whichever list is there.
  markets: (data) => {
    const listKey = !has(data, "markets") && has(data, "stocks") ? "stocks" : "markets";
    return [
      { key: "sort-by", label: "Sort by", type: "select", options: [["change", "change (biggest % gain first)"], ["absolute-change", "absolute-change (biggest move first)"]], hint: "Default: the order below" },
      ...more(
        { key: "chart-link-template", label: "Chart link (all markets)", placeholder: "https://www.tradingview.com/chart/?symbol={SYMBOL}", hint: "{SYMBOL} is replaced by each symbol" },
        { key: "symbol-link-template", label: "Symbol link (all markets)", placeholder: "https://www.google.com/search?tbm=nws&q={SYMBOL}", hint: "{SYMBOL} is replaced by each symbol" },
      ),
      { key: listKey, label: "Markets", type: "list", item: "Market", titleKey: "name", fallbackKey: "symbol", required: true, subtitle: (m) => m.name ? m.symbol : "", fields: [
        { key: "symbol", label: "Symbol", required: true, placeholder: "Type a name or symbol, e.g. apple, bitcoin",
          hint: "Suggestions come from Yahoo Finance", suggest: (q) => suggestSymbols(q), onPick: (it, obj, scope) => fillMarketName(it, obj, scope) },
        { key: "name", label: "Name", placeholder: "e.g. S&P 500", hint: "Shown under the symbol" },
        ...more(
          { key: "symbol-link", label: "Symbol link", placeholder: "https://…", hint: "Overrides the template above" },
          { key: "chart-link", label: "Chart link", placeholder: "https://…", hint: "Overrides the template above" },
        ),
      ] },
    ];
  },
  "docker-containers": [
    { key: "sock-path", label: "Docker socket", placeholder: "/var/run/docker.sock", hint: "Or tcp://… for a remote or proxied socket" },
    { key: "category", label: "Category filter", hint: "Only containers with this glance.category label" },
    { key: "hide-by-default", label: "Hide containers by default", type: "bool" },
    { key: "running-only", label: "Only running containers", type: "bool" },
    ...more({ key: "format-container-names", label: "Prettify container names", type: "bool" }),
    { key: "containers", label: "Containers (instead of glance.* labels)", type: "map", item: "Container", keyLabel: "Container name", keyPlaceholder: "container_name", newKey: "container", fields: [
      { key: "name", label: "Display name" },
      { key: "url", label: "URL" },
      { key: "icon", label: "Icon", hint: ICON_HINT },
      ...more(
        { key: "description", label: "Description" },
        { key: "same-tab", label: "Open in the same tab", type: "bool" },
        { key: "hide", label: "Hide", type: "bool" },
      ),
    ] },
  ],
};

// What "Add widget" creates. Every widget opens in the editor right after.
const WIDGET_TEMPLATES = {
  bookmarks: { groups: [{ title: "Links", links: [{ title: "Example", url: "https://example.com" }] }] },
  monitor: { cache: "1m", sites: [{ title: "Example", url: "https://example.com" }] },
  rss: { limit: 10, "collapse-after": 3, feeds: [{ url: "https://selfh.st/rss/", title: "selfh.st" }] },
  search: { "search-engine": "duckduckgo" },
  weather: { location: "London, United Kingdom", units: "metric", "hour-format": "24h" },
  calendar: { "first-day-of-week": "monday" },
  clock: { "hour-format": "24h" },
  "docker-containers": {},
  markets: { markets: [{ symbol: "SPY", name: "S&P 500" }, { symbol: "BTC-USD", name: "Bitcoin" }] },
  group: { widgets: [] },
  "split-column": { widgets: [] },
};
const COMMON_WIDGETS = ["bookmarks", "monitor", "docker-containers", "search", "rss", "weather", "calendar", "clock", "group"];
const WIDGET_HELP = {
  bookmarks: "Groups of links", monitor: "Is each site up?", "docker-containers": "Status of your containers",
  search: "A search bar", rss: "Articles from feeds", weather: "Forecast for a city", calendar: "A month calendar",
  clock: "Time, plus other timezones", markets: "Stocks and crypto prices", group: "Several widgets as tabs", "split-column": "Two widgets side by side",
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isEnv = (v) => typeof v === "string" && v.includes("${");

// Glance writes colors as "hue saturation lightness" without units: "225 14 15" (a "%" is allowed too).
function parseHsl(v) {
  const m = String(v || "").trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%?\s+(\d+(?:\.\d+)?)%?$/);
  return m ? [Number(m[1]) % 360, Math.min(100, Number(m[2])), Math.min(100, Number(m[3]))] : null;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

function hexToHslText(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let hue = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return `${Math.round(hue)} ${Math.round(sat * 100)} ${Math.round(l * 100)}`;
}

function parseNumber(v) {
  const t = v.trim();
  if (t === "") return undefined;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  return t;  // ${ENV} or anything else stays a string
}

// Render fields for obj (mutated in place). onChange is called after every edit.
// Fields marked `advanced: true` go under a folded "More options".
function renderFields(obj, fields, onChange = () => {}) {
  const basic = fields.filter(f => !f.advanced);
  const advanced = fields.filter(f => f.advanced);
  const wrap = renderFieldList(obj, basic, onChange);
  if (advanced.length) {
    // Folded even when something in it is set; the summary names what is set.
    const used = advanced.filter(f => has(obj, f.key)).map(f => f.label.toLowerCase());
    wrap.append(h("details", { class: "fold more" },
      h("summary", {}, "More options", used.length ? h("span", { class: "muted" }, ` · ${used.join(", ")}`) : null),
      renderFieldList(obj, advanced, onChange)));
  }
  return wrap;
}

function renderFieldList(obj, fields, onChange) {
  const wrap = h("div");
  const grid = h("div", { class: "grid" });
  const blocks = [];
  for (const f of fields) {
    if (["list", "map", "object"].includes(f.type)) blocks.push(renderBlock(obj, f, onChange));
    else grid.append(renderSimple(obj, f, onChange));
  }
  if (grid.children.length) wrap.append(grid);
  wrap.append(...blocks);
  return wrap;
}

// Which list entries are unfolded. Kept across re-renders of the same form.
const openItems = new WeakSet();

function itemNeedsAttention(f, item) {
  return f.fields.some(ff => ff.required && ff.type !== "list" && (item[ff.key] === undefined || item[ff.key] === ""));
}

function renderSimple(obj, f, onChange) {
  const had = has(obj, f.key);
  const cur = obj[f.key];
  const id = "f" + Math.random().toString(36).slice(2, 9);
  const set = (v) => {
    if (v === undefined || v === "") delete obj[f.key]; else obj[f.key] = v;
    onChange();
  };
  let type = f.type || "text";
  // Values from ${ENV} placeholders (or of an unexpected kind) are edited as text so nothing is lost.
  if (type !== "text" && (isEnv(cur) || (type === "bool" && cur !== undefined && typeof cur !== "boolean"))) type = "text";
  if ((type === "text" || type === "combo") && cur !== undefined && cur !== null && typeof cur === "object") type = "locked";

  const label = h("label", { for: id }, f.label, f.required ? h("span", { class: "req" }, " *") : null);
  const hint = f.hint ? h("div", { class: "hint" }, f.hint) : null;

  if (type === "bool") {
    const box = h("input", { type: "checkbox", id, checked: cur === true });
    box.addEventListener("change", () => {
      if (box.checked) set(true);
      else if (had) { obj[f.key] = false; onChange(); }
      else set(undefined);
    });
    return h("div", { class: "field" }, h("label", { class: "check" }, box, h("span", {}, f.label)), hint);
  }
  if (type === "hsl") {
    // A color picker plus Glance's own "hue saturation lightness" text (e.g. "225 14 15").
    const picker = h("input", { type: "color", class: "hsl-picker", title: "Pick a color" });
    const def = () => (f.defaultFrom ? f.defaultFrom(obj) : f.default) || "";
    const text = h("input", { id, value: cur == null ? "" : String(cur), placeholder: def() ? `${def()} (default)` : "", spellcheck: "false", autocomplete: "off" });
    const sync = () => {
      const hsl = parseHsl(text.value) || parseHsl(def());
      if (hsl) picker.value = hslToHex(...hsl);
      field.classList.toggle("is-default", !text.value.trim());
    };
    picker.addEventListener("input", () => { text.value = hexToHslText(picker.value); set(text.value); sync(); });
    text.addEventListener("input", () => { set(text.value.trim() || undefined); sync(); });
    const reset = h("button", { type: "button", class: "mini", title: "Use Glance's default", onclick: () => { text.value = ""; set(undefined); sync(); } }, "default");
    const field = h("div", { class: "field" }, label, h("div", { class: "hsl-row" }, picker, text, reset), hint);
    sync();
    return field;
  }
  if (type === "range") {
    const slider = h("input", { type: "range", min: f.min, max: f.max, step: f.step });
    const num = h("input", { id, value: cur == null ? "" : String(cur), placeholder: `${f.default} (default)`, inputmode: "decimal", class: "range-num" });
    const sync = () => { const v = parseFloat(num.value); slider.value = isNaN(v) ? f.default : v; };
    slider.addEventListener("input", () => { num.value = slider.value; set(parseFloat(slider.value)); });
    num.addEventListener("input", () => { set(parseNumber(num.value)); sync(); });
    const reset = h("button", { type: "button", class: "mini", title: "Use Glance's default", onclick: () => { num.value = ""; set(undefined); sync(); } }, "default");
    sync();
    return h("div", { class: "field" }, label, h("div", { class: "hsl-row" }, slider, num, reset), hint);
  }
  if (type === "select") {
    const sel = h("select", { id });
    sel.append(h("option", { value: "" }, "(default)"));
    const opts = [...f.options];
    if (cur !== undefined && cur !== null && !opts.some(o => o[0] === String(cur))) opts.push([String(cur), String(cur)]);
    for (const [v, l] of opts) sel.append(h("option", { value: v, selected: String(cur ?? "") === v }, l));
    sel.addEventListener("change", () => set(sel.value || undefined));
    return h("div", { class: "field" }, label, sel, hint);
  }
  if (type === "locked") {
    return h("div", { class: "field" }, label, h("input", { id, disabled: true, value: "(complex value: edit in the YAML tab)" }));
  }
  const input = h("input", { id, value: cur === undefined || cur === null ? "" : (Array.isArray(cur) ? cur.join(", ") : String(cur)),
    placeholder: f.placeholder || "", autocomplete: "off", spellcheck: "false" });
  if (type === "combo") {
    const listId = id + "l";
    input.setAttribute("list", listId);
    const dl = h("datalist", { id: listId }, ...f.options.map(o => h("option", { value: o })));
    input.addEventListener("input", () => set(input.value.trim() || undefined));
    return h("div", { class: "field" }, label, input, dl, hint);
  }
  if (type === "number") {
    input.inputMode = "decimal";
    input.addEventListener("input", () => set(parseNumber(input.value)));
  } else if (type === "csv") {
    input.addEventListener("input", () => {
      const parts = input.value.split(",").map(s => s.trim()).filter(Boolean).map(parseNumber);
      set(parts.length ? parts : undefined);
    });
  } else {
    input.addEventListener("input", () => set(input.value === "" ? undefined : input.value));
  }
  input.dataset.key = f.key;
  const field = h("div", { class: "field" }, label, input, hint);
  if (f.suggest) attachSuggest(field, input, f, obj, set, onChange);
  return field;
}

// A dropdown of suggestions under a text field. f.suggest(query) returns [{ value, label, detail }];
// f.onPick(item, obj, field) can fill in other fields.
function attachSuggest(field, input, f, obj, set, onChange) {
  field.classList.add("suggest-field");
  const list = h("div", { class: "suggest", role: "listbox", hidden: true });
  field.insertBefore(list, input.nextSibling);
  let items = [], active = -1, timer = null, seq = 0;

  const close = () => { list.hidden = true; active = -1; };
  const draw = (message) => {
    list.replaceChildren();
    if (message) list.append(h("div", { class: "suggest-msg" }, message));
    items.forEach((it, i) => list.append(h("div", {
      class: "suggest-item" + (i === active ? " active" : ""), role: "option",
      onmousedown: (e) => { e.preventDefault(); pick(i); },
    }, h("b", {}, it.value), " ", h("span", {}, it.label), it.detail ? h("small", {}, it.detail) : null)));
    list.hidden = !message && !items.length;
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = it.value;
    set(it.value);
    if (f.onPick) f.onPick(it, obj, field.closest(".grid") || field.parentElement);
    onChange();
    close();
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { items = []; close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      draw("Searching…");
      try {
        const found = await f.suggest(q);
        if (mine !== seq) return;  // a newer search is running
        items = found; active = -1;
        draw(found.length ? null : "No matches");
      } catch (e) {
        if (mine === seq) { items = []; draw("Suggestions unavailable: " + e.message); }
      }
    }, 300);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); pick(active);
    } else if (e.key === "Escape") {
      e.stopPropagation(); close();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

// Markets: look symbols up on Yahoo Finance (through Glancer's server) and fill in the name.
async function suggestSymbols(q) {
  const res = await api("api/symbols?q=" + encodeURIComponent(q));
  return res.results.map(r => ({ value: r.symbol, label: r.name, detail: [r.type, r.exchange].filter(Boolean).join(" · ") }));
}

function fillMarketName(item, obj, scope) {
  if (obj.name || !item.label) return;
  obj.name = item.label;
  const nameInput = scope && scope.querySelector('input[data-key="name"]');
  if (nameInput) nameInput.value = item.label;
}

function itemTitle(f, item, i) {
  const t = isObj(item) ? (item[f.titleKey] || item[f.fallbackKey]) : item;
  return `${f.item} ${i + 1}` + (t ? `: ${t}` : "");
}

function renderBlock(obj, f, onChange) {
  const had = has(obj, f.key);
  let el;
  const rebuild = () => { const n = build(); el.replaceWith(n); el = n; onChange(); };

  function build() {
    const box = h("div", { class: "list-field" }, h("div", { class: "list-label" }, f.label));
    if (f.type === "object") {
      if (obj[f.key] !== undefined && !isObj(obj[f.key])) {
        box.append(h("div", { class: "hint" }, "Complex value: edit it in the YAML tab."));
        return box;
      }
      const sub = isObj(obj[f.key]) ? obj[f.key] : {};
      // Optional groups of settings start folded unless they are in use.
      return h("details", { class: "list-field fold", open: Object.keys(sub).length > 0 },
        h("summary", { class: "list-label" }, f.label),
        h("div", { class: "list-item" }, renderFields(sub, f.fields, () => {
          if (Object.keys(sub).length) obj[f.key] = sub; else delete obj[f.key];
          onChange();
        })));
    }
    if (f.type === "map") {
      const value = obj[f.key];
      if (value !== undefined && value !== null && !isObj(value)) {
        box.append(h("div", { class: "hint" }, "Complex value: edit it in the YAML tab."));
        return box;
      }
      const entries = Object.entries(value || {});
      const sync = () => {
        if (entries.length || had) obj[f.key] = Object.fromEntries(entries); else delete obj[f.key];
        onChange();
      };
      entries.forEach((entry, i) => {
        if (!isObj(entry[1])) entry[1] = entry[1] == null ? {} : entry[1];
        const keyInput = h("input", { value: entry[0], placeholder: f.keyPlaceholder || "name", spellcheck: "false" });
        keyInput.addEventListener("change", () => { entry[0] = keyInput.value.trim() || entry[0]; sync(); });
        const body = isObj(entry[1]) ? renderFields(entry[1], f.fields, sync)
          : h("div", { class: "hint" }, "Complex value: edit it in the YAML tab.");
        box.append(h("div", { class: "list-item" },
          h("div", { class: "item-head" }, h("b", {}, `${f.item}: ${entry[0]}`),
            h("button", { type: "button", class: "mini danger", title: "Remove", onclick: () => { entries.splice(i, 1); sync(); rebuild(); } }, "✕")),
          h("div", { class: "field" }, h("label", {}, f.keyLabel || "Key"), keyInput),
          h("div", { style: "margin-top:10px" }, body)));
      });
      box.append(h("button", { type: "button", class: "small", onclick: () => {
        const prefix = f.newKey || "item";
        let n = entries.length + 1, k = `${prefix}-${n}`;
        while (entries.some(e => e[0] === k)) k = `${prefix}-${++n}`;
        entries.push([k, {}]); sync(); rebuild();
      } }, `+ Add ${f.item.toLowerCase()}`));
      return box;
    }
    // list
    const arr = obj[f.key];
    if (arr !== undefined && arr !== null && !Array.isArray(arr)) {
      box.append(h("div", { class: "hint" }, "Complex value: edit it in the YAML tab."));
      return box;
    }
    const items = arr || [];
    // Entries start folded to one line; one entry alone, or one that misses a required value, starts open.
    items.forEach(item => {
      if (isObj(item) && (items.length === 1 || itemNeedsAttention(f, item))) openItems.add(item);
    });
    const label = box.firstChild;
    if (items.length > 2) {
      const allOpen = items.every(it => !isObj(it) || openItems.has(it));
      label.append(" ", h("button", { type: "button", class: "link small-link", onclick: () => {
        items.forEach(it => { if (isObj(it)) { if (allOpen) openItems.delete(it); else openItems.add(it); } });
        rebuild();
      } }, allOpen ? "fold all" : "unfold all"));
    }
    items.forEach((item, i) => {
      const title = h("b", {}, itemTitle(f, item, i));
      const sub = h("span", { class: "item-sub" }, isObj(item) && f.subtitle ? f.subtitle(item) : "");
      const move = (d) => { const j = i + d; [items[i], items[j]] = [items[j], items[i]]; rebuild(); };
      const open = !isObj(item) || openItems.has(item);
      const body = isObj(item)
        ? renderFields(item, f.fields, () => {
          title.textContent = itemTitle(f, item, i);
          sub.textContent = f.subtitle ? f.subtitle(item) : "";
          onChange();
        })
        : h("div", { class: "hint" }, "This item is not a mapping: edit it in the YAML tab.");
      if (!open) body.hidden = true;
      const entry = h("div", { class: "list-item" + (open ? "" : " folded") });
      const toggle = () => {
        if (!isObj(item)) return;
        const nowOpen = body.hidden;
        body.hidden = !nowOpen;
        entry.classList.toggle("folded", !nowOpen);
        chev.textContent = nowOpen ? "▾" : "▸";
        if (nowOpen) openItems.add(item); else openItems.delete(item);
      };
      const chev = h("span", { class: "chev" }, open ? "▾" : "▸");
      entry.append(
        h("div", { class: "item-head" },
          h("div", { class: "item-title", role: "button", tabindex: 0, title: "Show or hide the settings",
            onclick: toggle, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } },
            chev, title, sub),
          h("button", { type: "button", class: "mini", title: "Move up", disabled: i === 0, onclick: () => move(-1) }, "↑"),
          h("button", { type: "button", class: "mini", title: "Move down", disabled: i === items.length - 1, onclick: () => move(1) }, "↓"),
          h("button", { type: "button", class: "mini danger", title: "Remove", onclick: () => {
            items.splice(i, 1);
            if (!items.length && !had && !f.required) delete obj[f.key];
            rebuild();
          } }, "✕")),
        body);
      box.append(entry);
    });
    box.append(h("button", { type: "button", class: "small", onclick: () => {
      if (!Array.isArray(obj[f.key])) obj[f.key] = [];
      const fresh = f.newItem ? f.newItem() : {};
      openItems.add(fresh);  // a new entry opens so it can be filled in
      obj[f.key].push(fresh);
      rebuild();
      const added = el.querySelectorAll(":scope > .list-item");
      const last = added[added.length - 1];
      if (last) { last.scrollIntoView({ block: "nearest" }); const inp = last.querySelector("input"); if (inp) inp.focus(); }
    } }, `+ Add ${f.item.toLowerCase()}`));
    return box;
  }

  el = build();
  return el;
}

// The complete form for a widget: shared fields + the type's own fields + a note about other keys.
function widgetForm(data, onChange) {
  const spec = WIDGET_FORMS[data.type === "stocks" ? "markets" : data.type] || [];
  const own = typeof spec === "function" ? spec(data) : spec;
  // The title first (with the rarely used common settings folded), then the widget's own settings.
  const wrap = h("div", {}, h("div", { class: "form-section" }, renderFields(data, SHARED_FIELDS, onChange)));
  if (own.length) {
    wrap.append(h("div", { class: "form-section" }, h("h4", {}, `${widgetLabel(data.type)} settings`), renderFields(data, own, onChange)));
  } else if (!["group", "split-column"].includes(data.type)) {
    wrap.append(h("p", { class: "help", style: "margin-top:14px" }, "Glancer has no form for this widget type yet. Use the ",
      h("b", {}, "YAML"), " tab for its own settings."));
  }
  const known = new Set(["type", "widgets", ...own.map(f => f.key), ...SHARED_FIELDS.map(f => f.key)]);
  const other = Object.keys(data).filter(k => !known.has(k));
  if (other.length) {
    wrap.append(h("div", { class: "kept" }, "Also set in this widget and kept exactly as they are: ",
      h("code", {}, other.join(", ")), ". Edit them in the YAML tab."));
  }
  return wrap;
}

const PAGE_FIELDS = [
  { key: "name", label: "Name", required: true, hint: "Shown in the navigation bar" },
  { key: "slug", label: "Slug", placeholder: "Made from the name", hint: "The page's address, e.g. homelab → /homelab" },
  { key: "width", label: "Width", type: "select", options: [["default", "default (1600px)"], ["slim", "slim (1100px, max 2 columns)"], ["wide", "wide (1920px)"]] },
  { key: "desktop-navigation-width", label: "Navigation width", type: "select", options: [["default", "default"], ["slim", "slim"], ["wide", "wide"]] },
  { key: "center-vertically", label: "Center the content vertically", type: "bool" },
  { key: "hide-desktop-navigation", label: "Hide the navigation on desktop", type: "bool" },
  { key: "show-mobile-header", label: "Show a header on mobile", type: "bool" },
];
