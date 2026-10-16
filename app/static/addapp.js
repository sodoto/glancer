// "Add app": create the app's web address in Nginx Proxy Manager and its entry in a Glance monitor
// widget, in one window. The NPM proxy host is created right away; the Glance entry goes into the
// draft and the save review opens, like every other change.

const AddApp = (() => {
  let npmStatus = null;  // last /api/npm/status (certificates), cached for the session

  const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // Every monitor widget in the draft (in columns, head widgets and groups), with a readable place.
  function monitors() {
    const out = [];
    const walk = (list, where) => (list || []).forEach(w => {
      if (w.type === "monitor" && w.data && (w.data.sites === undefined || Array.isArray(w.data.sites))) {
        out.push({ path: w.path, label: `${where} › ${w.data.title || "Monitor"} (${(w.data.sites || []).length} sites)` });
      }
      if (w.children) walk(w.children, where);
    });
    (S.tree.pages || []).forEach((p, pi) => {
      if (p.include || p.raw) return;
      walk(p.head_widgets, p.name || `Page ${pi + 1}`);
      (p.columns || []).forEach((c, ci) => walk(c.widgets, `${p.name || `Page ${pi + 1}`}, column ${ci + 1}`));
    });
    return out;
  }

  // Where a new monitor widget goes: the first full column of the page being edited (or the first page).
  function newMonitorPlace() {
    const pages = S.tree.pages || [];
    const order = [S.page, ...pages.map((_, i) => i)].filter((i, n, a) => a.indexOf(i) === n && pages[i]);
    for (const pi of order) {
      const p = pages[pi];
      if (p.include || p.raw || p.columns_include) continue;
      const col = (p.columns || []).find(c => !c.include && c.size === "full") || (p.columns || []).find(c => !c.include);
      if (col) return { path: col.path.concat(["widgets"]), label: `${p.name}, column ${p.columns.indexOf(col) + 1}` };
    }
    return null;
  }

  async function open() {
    if (!S.tree) { UI.alert("Add app", "Load a valid glance.yml first."); return; }
    let npmCfg = { url: "" };
    try { npmCfg = await api("api/npm"); } catch { /* not connected */ }
    if (npmCfg.url && !npmStatus) {
      try { npmStatus = await api("api/npm/status"); } catch (e) { npmStatus = { error: e.message }; }
    }
    draw(npmCfg);
  }

  function draw(npmCfg) {
    const npmReady = !!(npmCfg.url && npmStatus && !npmStatus.error);
    const certs = (npmReady && npmStatus.certificates) || [];
    const wildDomains = [...new Set(certs.flatMap(c => c.wildcard_for))];
    const f = {};  // inputs
    const field = (label, input, hint) => h("div", { class: "field" }, h("label", {}, label), input, hint ? h("div", { class: "hint" }, hint) : null);
    const check = (label, on) => { const box = h("input", { type: "checkbox", checked: on }); return [box, h("label", { class: "check" }, box, h("span", {}, label))]; };

    // ---- the app
    f.name = h("input", { placeholder: "e.g. Jellyfin" });
    const iconData = {};
    const iconField = renderSimple(iconData, ICON_FIELD, () => {});  // search + preview, like everywhere else
    f.scheme = h("select", {}, h("option", { value: "http" }, "http"), h("option", { value: "https" }, "https"));
    f.host = h("input", { placeholder: "e.g. 192.168.1.30", spellcheck: "false" });
    f.port = h("input", { placeholder: "e.g. 8096", inputmode: "numeric" });
    const testMsg = h("span", { class: "hint" });
    const testBtn = h("button", { type: "button", class: "small", onclick: async () => {
      testMsg.textContent = "Checking…";
      try {
        const r = await api("api/check-target", "POST", { host: f.host.value.trim(), port: f.port.value.trim() });
        testMsg.textContent = (r.ok ? "✓ " : "✕ ") + r.message;
        testMsg.className = "hint " + (r.ok ? "ok-text" : "bad-text");
      } catch (e) { testMsg.textContent = e.message; testMsg.className = "hint bad-text"; }
    } }, "Test");

    // ---- the web address (NPM)
    const npmBox = h("div", { class: "form-section" }, h("h4", {}, "Web address (Nginx Proxy Manager)"));
    let makeHost = null, sub = null, domain = null, other = null, cert = null, forceSsl = null, ws = null, exploits = null, http2 = null;
    if (!npmCfg.url) {
      npmBox.append(h("p", { class: "help" }, "Connect Nginx Proxy Manager in ", h("button", { class: "link", type: "button", onclick: () => Settings.open() }, "Settings"),
        " and Glancer will also create the app's web address (like jellyfin.home.example.com). For now, only the Glance entry is added, with the app's own address."));
    } else if (!npmReady) {
      npmBox.append(h("div", { class: "notice bad" }, "Nginx Proxy Manager: ", npmStatus && npmStatus.error, " ",
        h("button", { class: "link", type: "button", onclick: () => Settings.open() }, "Open Settings")));
    } else {
      const [mh, mhLabel] = check("Create this address in Nginx Proxy Manager", true);
      makeHost = mh;
      sub = h("input", { placeholder: "jellyfin", spellcheck: "false" });
      domain = h("select", {}, ...wildDomains.map(d => h("option", { value: d }, "." + d)), h("option", { value: "" }, "other…"));
      other = h("input", { placeholder: "jellyfin.example.com (full address)", spellcheck: "false", hidden: wildDomains.length > 0 });
      cert = h("select", {}, h("option", { value: "" }, "None (http only)"),
        ...certs.map(c => h("option", { value: c.id }, `${c.name} (${c.domains.join(", ")})`)));
      const [fs, fsLabel] = check("Force HTTPS", true); forceSsl = fs;
      const [w, wLabel] = check("Websockets support", true); ws = w;
      const [x, xLabel] = check("Block common exploits", true); exploits = x;
      const [h2, h2Label] = check("HTTP/2", true); http2 = h2;
      const pickCert = () => {
        const full = fullDomain();
        const match = certs.find(c => c.domains.some(d => d === full || (d.startsWith("*.") && full.endsWith(d.slice(1)) && full.split(".").length === d.split(".").length)));
        cert.value = match ? String(match.id) : "";
      };
      domain.addEventListener("change", () => { other.hidden = domain.value !== ""; sub.hidden = domain.value === ""; pickCert(); refresh(); });
      sub.addEventListener("input", () => { sub.dataset.touched = "1"; pickCert(); refresh(); });
      other.addEventListener("input", () => { pickCert(); refresh(); });
      if (!wildDomains.length) sub.hidden = true;
      sub.style.flex = "1 1 140px";
      domain.style.cssText = "flex: 0 1 auto; width: auto; max-width: 60%";
      other.style.flex = "1 1 200px";
      mhLabel.style.marginBottom = "10px";
      npmBox.append(mhLabel,
        h("div", { class: "grid" },
          field("Address", h("div", { class: "hsl-row" }, sub, domain, other),
            wildDomains.length ? "Your wildcard certificate covers these domains" : "No wildcard certificate found: type the full address"),
          field("Certificate", cert, "Picked automatically for the address")),
        h("div", { class: "checks addapp-checks" }, fsLabel, wLabel, xLabel, h2Label));
      makeHost.addEventListener("change", refresh);
      setTimeout(pickCert, 0);
    }
    const fullDomain = () => !domain ? "" : domain.value ? `${slug(sub.value) || "app"}.${domain.value}` : other.value.trim().toLowerCase();

    // ---- Glance
    const mons = monitors();
    const place = newMonitorPlace();
    f.target = h("select", {},
      ...mons.map((m, i) => h("option", { value: `m${i}` }, m.label)),
      place ? h("option", { value: "new" }, `New monitor widget (${place.label})`) : null,
      h("option", { value: "none" }, "Don't add it to Glance"));
    const [internalCheck, internalLabel] = check("Let Glance check the app's own address (if Glance can't resolve the web address)", false);
    const glanceBox = h("div", { class: "form-section" }, h("h4", {}, "Glance"),
      field("Add it to", f.target, "As a site in a monitor widget, which shows whether it is up"),
      h("div", { class: "checks" }, internalLabel));

    const summary = h("div", { class: "addapp-summary" });
    const msg = h("span", { class: "msg" });
    const createBtn = h("button", { class: "primary", onclick: () => create() }, "Create");

    const internalUrl = () => {
      const host = f.host.value.trim(), port = f.port.value.trim();
      return host ? `${f.scheme.value}://${host}${port ? ":" + port : ""}` : "";
    };
    const npmOn = () => !!(makeHost && makeHost.checked);
    const publicUrl = () => npmOn() && fullDomain() ? `${cert && cert.value ? "https" : "http"}://${fullDomain()}` : internalUrl();

    function refresh() {
      if (sub && !sub.dataset.touched) sub.value = slug(f.name.value);
      const items = [];
      if (npmOn()) items.push(h("li", {}, "Nginx Proxy Manager: ", h("b", {}, fullDomain() ? publicUrl() : "…"), " forwards to ", internalUrl() || "…",
        h("span", { class: "muted" }, " · created right away")));
      if (f.target.value !== "none") items.push(h("li", {}, "Glance: ", h("b", {}, f.name.value || "…"), " in ",
        f.target.value === "new" ? "a new monitor widget" : (mons[Number(f.target.value.slice(1))] || {}).label, ", link ", publicUrl() || "…",
        h("span", { class: "muted" }, " · added to the draft, then you review and save")));
      summary.replaceChildren(items.length ? h("ul", {}, items) : h("p", { class: "hint" }, "Nothing to do."));
    }
    [f.name, f.host, f.port].forEach(i => i.addEventListener("input", refresh));
    [f.scheme, f.target].forEach(i => i.addEventListener("change", refresh));

    async function create() {
      msg.textContent = "";
      const name = f.name.value.trim(), host = f.host.value.trim(), port = f.port.value.trim();
      if (!name) { msg.textContent = "Give the app a name."; return; }
      if (!host || !/^\d+$/.test(port)) { msg.textContent = "Enter the app's IP address and port, e.g. 192.168.1.30 and 8096."; return; }
      if (npmOn() && !fullDomain()) { msg.textContent = "Enter the web address."; return; }
      createBtn.disabled = true;
      try {
        if (npmOn()) {
          await api("api/npm/proxy-hosts", "POST", {
            domain: fullDomain(), scheme: f.scheme.value, host, port: Number(port),
            certificate_id: cert && cert.value ? Number(cert.value) : null,
            force_ssl: forceSsl.checked, websockets: ws.checked, block_exploits: exploits.checked, http2: http2.checked,
          });
          if (npmStatus && npmStatus.proxy_hosts !== undefined) npmStatus.proxy_hosts += 1;
        }
      } catch (e) { msg.textContent = e.message; createBtn.disabled = false; return; }
      const site = { title: name, url: publicUrl() };
      if (iconData.icon && String(iconData.icon).trim()) site.icon = String(iconData.icon).trim();
      if (internalCheck.checked && npmOn()) site["check-url"] = internalUrl();
      if (f.scheme.value === "https") site["allow-insecure"] = true;  // apps on the LAN often use self-signed certificates
      try {
        if (f.target.value === "new") {
          await edit({ op: "insert", path: place.path, index: null, value: { type: "monitor", title: "Services", cache: "1m", sites: [site] } }, { quiet: true });
        } else if (f.target.value !== "none") {
          const m = mons[Number(f.target.value.slice(1))];
          await edit({ op: "insert", path: m.path.concat(["sites"]), index: null, value: site }, { quiet: true });
        }
      } catch (e) {
        msg.textContent = (npmOn() ? "The NPM address was created, but adding it to Glance failed: " : "") + e.message;
        createBtn.disabled = false;
        return;
      }
      Modal.forceClose();
      if (npmOn()) toast(`Created ${fullDomain()} in Nginx Proxy Manager.`, 5000);
      if (f.target.value !== "none") reviewAndSave();
    }

    Modal.open([
      h("h3", { id: "modalTitle" }, "Add an app"),
      h("p", { class: "lead" }, "Give a new app its web address and a spot on your dashboard in one go."),
      h("div", { class: "form-section" }, h("h4", {}, "The app"),
        h("div", { class: "grid" },
          field("Name", f.name),
          iconField),
        h("div", { class: "grid", style: "margin-top:12px" },
          field("Where it runs on your network", h("div", { class: "hsl-row" }, f.scheme, f.host, f.port, testBtn),
            "The address NPM forwards to: the app's IP (or hostname) and port"),
        ), testMsg),
      npmBox, glanceBox,
      h("div", { class: "form-section" }, h("h4", {}, "What happens"), summary),
      h("div", { class: "modal-foot" }, msg, h("button", { onclick: Modal.close }, "Cancel"), createBtn),
    ], { wide: true });
    f.scheme.style.flex = "0 0 86px";
    f.port.style.flex = "0 0 90px";
    refresh();
    f.name.focus();
  }

  function forget() { npmStatus = null; }

  return { open, forget };
})();

// Glancer's own settings: Glance's address and the Nginx Proxy Manager connection.
const Settings = (() => {
  async function open() {
    let npmCfg, cfg = S.cfg || {};
    try { npmCfg = await api("api/npm"); } catch (e) { UI.alert("Settings", e.message); return; }
    const glanceUrl = h("input", { value: cfg.glance_url || "", placeholder: "http://192.168.1.50:8080", disabled: cfg.glance_url_from_env, spellcheck: "false" });
    const url = h("input", { value: npmCfg.url, placeholder: "http://192.168.1.20:81", disabled: npmCfg.from_env, spellcheck: "false" });
    const email = h("input", { value: npmCfg.email, placeholder: "glancer@example.com", disabled: npmCfg.from_env, autocomplete: "off" });
    const password = h("input", { type: "password", value: npmCfg.password, disabled: npmCfg.from_env, autocomplete: "new-password" });
    const result = h("div", { class: "test-result", hidden: true });
    const msg = h("span", { class: "msg" });

    const show = (ok, text) => { result.hidden = false; result.className = "test-result " + (ok ? "ok" : "bad"); result.replaceChildren(text); };

    async function save() {
      msg.textContent = "";
      try {
        if (!cfg.glance_url_from_env && glanceUrl.value.trim().replace(/\/+$/, "") !== (cfg.glance_url || "")) {
          const r = await api("api/glance-url", "POST", { url: glanceUrl.value });
          S.cfg.glance_url = r.glance_url;
          Preview.updateOpenLink();
          Preview.draw();
        }
        if (!npmCfg.from_env) {
          AddApp.forget();
          const r = await api("api/npm", "POST", { url: url.value, email: email.value, password: password.value });
          if (!r.connected) { show(true, "Nginx Proxy Manager is not connected."); return; }
          if (!r.ok) { show(false, "Saved, but the test failed: " + r.error); return; }
          const wild = r.status.certificates.flatMap(c => c.wildcard_for);
          show(true, `Connected to Nginx Proxy Manager ${r.status.version || ""}: ${r.status.proxy_hosts} proxy host(s). `
            + (wild.length ? `Wildcard certificate for ${wild.map(d => "*." + d).join(", ")}.` : "No wildcard certificate found (apps can still get an http address)."));
        } else {
          toast("Saved.");
        }
      } catch (e) { msg.textContent = e.message; }
    }

    Modal.open([
      h("h3", { id: "modalTitle" }, "Settings"),
      h("div", { class: "form-section" }, h("h4", {}, "Glance"),
        h("div", { class: "field" }, h("label", {}, "Glance's address"), glanceUrl,
          h("div", { class: "hint" }, cfg.glance_url_from_env ? "Set with GLANCE_URL." : "For the preview and the Open Glance button."))),
      h("div", { class: "form-section" }, h("h4", {}, "Nginx Proxy Manager (for Add app)"),
        npmCfg.from_env ? h("p", { class: "help" }, "Set with NPM_URL, NPM_EMAIL and NPM_PASSWORD.") : null,
        h("div", { class: "grid" },
          h("div", { class: "field" }, h("label", {}, "Admin address"), url, h("div", { class: "hint" }, "The page you log in to NPM with, usually port 81")),
          h("div", { class: "field" }, h("label", {}, "Email"), email),
          h("div", { class: "field" }, h("label", {}, "Password"), password)),
        h("details", { class: "fold more" }, h("summary", {}, "Use a separate NPM user for Glancer (recommended)"),
          h("ol", { class: "help steps" },
            h("li", {}, "In Nginx Proxy Manager, open Users → Add User. Give it an email like glancer@example.com."),
            h("li", {}, "Untick Administrator. Under Permissions, set Item Visibility to “All Items”, Proxy Hosts to “Manage” and Certificates to “View”; set the rest to “Hidden”."),
            h("li", {}, "Set its password (⋮ → Change Password), and don't turn on two-factor login for it."),
            h("li", {}, "Enter that email and password here. Glancer only reads certificates and proxy hosts and adds new hosts; it never changes or deletes existing ones."))),
        h("p", { class: "hint" }, "Leave the address empty to disconnect. The password is stored in Glancer's data folder (glancer.json, readable only by Glancer)."),
        result),
      h("div", { class: "modal-foot" }, msg, h("button", { onclick: Modal.close }, "Close"), h("button", { class: "primary", onclick: save }, "Save and test")),
    ], { wide: true });
  }
  return { open };
})();
