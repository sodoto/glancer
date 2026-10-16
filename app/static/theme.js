// The theme editor: Glance's `theme:` section as color pickers, sliders and presets, plus a YAML tab.
// Setting names and defaults come from Glance's docs/configuration.md (Theme); the ready-made themes
// are the ones listed in Glance's docs/themes.md.

const Theme = (() => {
  let lastTab = "form";  // kept when the editor redraws after an edit
  const DEFAULTS = { background: "240 8 9", primary: "43 50 70", negative: "0 70 70" };

  // Fields shared by the main theme and each picker preset.
  const COLOR_FIELDS = [
    { key: "light", label: "Light theme", type: "bool", hint: "Dark text for a light background color" },
    { key: "background-color", label: "Background", type: "hsl", default: DEFAULTS.background, hint: "The page and the widgets" },
    { key: "primary-color", label: "Primary", type: "hsl", default: DEFAULTS.primary, hint: "Links and highlights" },
    { key: "positive-color", label: "Positive", type: "hsl", defaultFrom: (t) => t["primary-color"] || DEFAULTS.primary, hint: "Online, price up… (default: the primary color)" },
    { key: "negative-color", label: "Negative", type: "hsl", default: DEFAULTS.negative, hint: "Offline, errors, price down" },
    { key: "contrast-multiplier", label: "Text contrast", type: "range", min: 0.5, max: 2, step: 0.05, default: 1, hint: "1.2 = text 20% easier to read" },
    { key: "text-saturation-multiplier", label: "Text color strength", type: "range", min: 0, max: 2, step: 0.05, default: 1, hint: "Lower it for very colorful backgrounds" },
  ];
  const THEME_KEYS = COLOR_FIELDS.map(f => f.key);

  const FIELDS = [
    ...COLOR_FIELDS,
    ...more(
      { key: "custom-css-file", label: "Custom CSS file", placeholder: "/assets/my-style.css", hint: "A URL, or a file in Glance's assets folder" },
      { key: "disable-picker", label: "Hide Glance's theme picker", type: "bool", hint: "Everyone gets this theme" },
    ),
    { key: "presets", label: "Extra themes in Glance's theme picker", type: "map", item: "Theme", keyLabel: "Name (default-dark / default-light replace Glance's own)", keyPlaceholder: "my-theme", newKey: "my-theme", fields: COLOR_FIELDS },
  ];

  // From Glance's docs/themes.md.
  const READY = [
    ["Teal City", { "background-color": "225 14 15", "primary-color": "157 47 65", "contrast-multiplier": 1.1 }],
    ["Catppuccin Frappe", { "background-color": "229 19 23", "contrast-multiplier": 1.2, "primary-color": "222 74 74", "positive-color": "96 44 68", "negative-color": "359 68 71" }],
    ["Catppuccin Macchiato", { "background-color": "232 23 18", "contrast-multiplier": 1.2, "primary-color": "220 83 75", "positive-color": "105 48 72", "negative-color": "351 74 73" }],
    ["Catppuccin Mocha", { "background-color": "240 21 15", "contrast-multiplier": 1.2, "primary-color": "217 92 83", "positive-color": "115 54 76", "negative-color": "347 70 65" }],
    ["Camouflage", { "background-color": "186 21 20", "contrast-multiplier": 1.2, "primary-color": "97 13 80" }],
    ["Gruvbox Dark", { "background-color": "0 0 16", "primary-color": "43 59 81", "positive-color": "61 66 44", "negative-color": "6 96 59" }],
    ["Kanagawa Dark", { "background-color": "240 13 14", "primary-color": "51 33 68", "negative-color": "358 100 68", "contrast-multiplier": 1.2 }],
    ["Tucan", { "background-color": "50 1 6", "primary-color": "24 97 58", "negative-color": "209 88 54" }],
    ["Dracula", { "background-color": "231 15 21", "primary-color": "265 89 79", "contrast-multiplier": 1.2, "positive-color": "135 94 66", "negative-color": "0 100 67" }],
    ["Shades of Purple", { "background-color": "243 33 25", "contrast-multiplier": 1.2, "primary-color": "50 100 49", "positive-color": "98 82 71", "negative-color": "12 77 52" }],
    ["Neon Pink", { "background-color": "240 27 11", "contrast-multiplier": 1.5, "primary-color": "321 100 71", "positive-color": "165 78 51", "negative-color": "360 100 71" }],
    ["Catppuccin Latte", { light: true, "background-color": "220 23 95", "contrast-multiplier": 1.0, "primary-color": "220 91 54", "positive-color": "109 58 40", "negative-color": "347 87 44" }],
    ["Peachy", { light: true, "background-color": "28 40 77", "primary-color": "155 100 20", "negative-color": "0 100 60", "contrast-multiplier": 1.1, "text-saturation-multiplier": 0.5 }],
    ["Zebra", { light: true, "background-color": "0 0 95", "primary-color": "0 0 10", "negative-color": "0 90 50" }],
  ];

  const css = (v, fallback) => {
    const hsl = parseHsl(v) || parseHsl(fallback);
    return hsl ? `hsl(${hsl[0]} ${hsl[1]}% ${hsl[2]}%)` : "transparent";
  };

  function swatch(t) {
    const primary = t["primary-color"] || DEFAULTS.primary;
    return h("span", { class: "swatch", style: `background:${css(t["background-color"], DEFAULTS.background)}` },
      ...[primary, t["positive-color"] || primary, t["negative-color"] || DEFAULTS.negative]
        .map(c => h("i", { style: `background:${css(c)}` })));
  }

  // A rough idea of the colors on a Glance-like widget. Glance's own math differs a little;
  // the Preview panel shows the real result after saving.
  function mockup(t) {
    const bg = parseHsl(t["background-color"]) || parseHsl(DEFAULTS.background);
    const light = t.light === true;
    const contrast = typeof t["contrast-multiplier"] === "number" ? t["contrast-multiplier"] : 1;
    const sat = typeof t["text-saturation-multiplier"] === "number" ? t["text-saturation-multiplier"] : 1;
    const clamp = (x) => Math.max(0, Math.min(100, x));
    const textL = light ? clamp(bg[2] - 55 * contrast) : clamp(bg[2] + 62 * contrast);
    const subL = light ? clamp(bg[2] - 35 * contrast) : clamp(bg[2] + 40 * contrast);
    const text = `hsl(${bg[0]} ${clamp(bg[1] * sat)}% ${textL}%)`;
    const sub = `hsl(${bg[0]} ${clamp(bg[1] * sat)}% ${subL}%)`;
    const widget = `hsl(${bg[0]} ${bg[1]}% ${clamp(bg[2] + (light ? 3 : 4))}%)`;
    const border = `hsl(${bg[0]} ${bg[1]}% ${clamp(bg[2] + (light ? -8 : 9))}%)`;
    const primary = css(t["primary-color"], DEFAULTS.primary);
    const positive = css(t["positive-color"], t["primary-color"] || DEFAULTS.primary);
    const negative = css(t["negative-color"], DEFAULTS.negative);
    return h("div", { class: "theme-mock", style: `background:${css(t["background-color"], DEFAULTS.background)};color:${text}` },
      h("div", { class: "mock-title", style: `color:${sub}` }, "SERVICES"),
      h("div", { class: "mock-widget", style: `background:${widget};border-color:${border}` },
        h("div", { class: "mock-row" }, h("span", { style: `color:${primary}` }, "Jellyfin"), h("b", { style: `color:${positive}` }, "● OK")),
        h("div", { class: "mock-row" }, h("span", { style: `color:${primary}` }, "Immich"), h("b", { style: `color:${negative}` }, "● ERROR")),
        h("div", { class: "mock-text" }, "Regular text on a widget"),
        h("div", { class: "mock-sub", style: `color:${sub}` }, "Less important text")),
      h("div", { class: "mock-note" }, "Approximate. Open Preview to see the real thing after saving."));
  }

  function view() {
    const s = S.tree.sections.find(x => x.key === "theme");
    const present = !!(s && s.present);
    const panel = h("div", { class: "panel theme-editor" });
    const msg = h("span", { class: "msg" });
    const tabs = h("div", { class: "tabs" });
    const body = h("div");
    let tab = lastTab, data = {}, original = "{}", yamlText = "", plain = true;
    const textarea = h("textarea", { class: "code", spellcheck: "false" });

    panel.append(h("h2", {}, "Theme"),
      h("p", { class: "help" }, "The colors of your dashboard. ",
        h("a", { href: "https://github.com/glanceapp/glance/blob/main/docs/configuration.md#theme", target: "_blank", rel: "noopener" }, "Glance docs ↗")),
      tabs, body,
      h("div", { class: "modal-foot" }, msg,
        present ? h("button", { class: "danger", onclick: removeTheme }, "Remove theme") : null,
        h("button", { onclick: () => load() }, "Reset"),
        h("button", { class: "primary", onclick: apply }, "Apply")));

    async function load() {
      msg.textContent = "";
      if (present) {
        try {
          const n = await api("api/node", "POST", { text: S.draft, path: ["theme"] });
          plain = n.plain && n.data && typeof n.data === "object" && !Array.isArray(n.data);
          data = plain ? structuredClone(n.data) : {};
          yamlText = n.yaml;
        } catch (e) { msg.textContent = e.message; return; }
      } else {
        data = {}; yamlText = ""; plain = true;
      }
      original = JSON.stringify(data);
      textarea.value = yamlText;
      if (!plain) tab = lastTab = "yaml";
      draw();
    }

    function draw() {
      tabs.replaceChildren(
        plain ? h("button", { class: tab === "form" ? "active" : "", onclick: () => switchTab("form") }, "Colors") : null,
        h("button", { class: tab === "yaml" ? "active" : "", onclick: () => switchTab("yaml") }, "YAML"));
      if (tab === "yaml") {
        body.replaceChildren(textarea, h("p", { class: "hint" }, "Exactly what goes under theme: in glance.yml. Comments are kept."));
        return;
      }
      const mock = h("div", {}, mockup(data));
      const redrawMock = () => mock.replaceChildren(mockup(data));
      const gallery = h("div", { class: "theme-gallery" }, READY.map(([name, t]) =>
        h("button", { type: "button", class: "theme-card", title: `Use ${name}`, onclick: () => usePreset(t) },
          swatch(t), h("span", {}, name), t.light ? h("small", {}, "light") : null)));
      body.replaceChildren(
        h("div", { class: "form-section" }, h("h4", {}, "Start from a ready-made theme"), gallery,
          h("p", { class: "hint" }, "Click one to fill in its colors below (your other theme settings are kept). Themes from Glance's documentation.")),
        h("div", { class: "theme-layout" },
          h("div", { class: "form-section theme-fields" }, h("h4", {}, "Your theme"), renderFields(data, FIELDS, redrawMock)),
          h("div", { class: "form-section theme-side" }, h("h4", {}, "Looks roughly like"), mock)));
    }

    function usePreset(t) {
      for (const k of THEME_KEYS) delete data[k];
      Object.assign(data, structuredClone(t));
      draw();
    }

    async function switchTab(next) {
      if (next === tab) return;
      const before = lastTab;
      lastTab = next;  // the redraw that follows an edit opens this tab
      if (!(await applyTab(true))) { lastTab = before; return; }
      tab = next;
      await load();
      tab = next;
      draw();
    }

    // Apply the open tab's edits to the draft. Returns false if something was wrong.
    async function applyTab(quiet) {
      msg.textContent = "";
      try {
        if (tab === "form" && JSON.stringify(data) !== original) {
          if (Object.keys(data).length) await edit({ op: "set_fields", path: [], set: { theme: data }, unset: [] }, { quiet: true });
          else if (present) await edit({ op: "delete", path: ["theme"] }, { quiet: true });
        } else if (tab === "yaml" && textarea.value !== yamlText) {
          if (textarea.value.trim()) await edit({ op: "set_yaml", path: ["theme"], yaml: textarea.value }, { quiet: true });
          else if (present) await edit({ op: "delete", path: ["theme"] }, { quiet: true });
        } else if (!quiet) {
          msg.textContent = "Nothing changed.";
          return true;
        }
        if (!quiet) toast("Theme updated in the draft. Click “Review & save” to write it.");
        return true;
      } catch (e) { msg.textContent = e.message; return false; }
    }

    async function apply() { await applyTab(false); }

    async function removeTheme() {
      if (await UI.confirm({ title: "Remove the theme?", message: "Remove the whole theme: section? Glance goes back to its default colors.", ok: "Remove", danger: true })) {
        await edit({ op: "delete", path: ["theme"] });
      }
    }

    load();
    return h("div", { class: "section-editor" }, panel);
  }

  return { view };
})();
