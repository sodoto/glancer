// The Raw YAML and Backups tabs, the account window, and page routing.

const Views = (() => {
  // ---------------------------------------------------------------- raw YAML

  let rawShownFor = null;  // the draft the textarea was filled from

  function renderRaw() {
    const box = $("rawView");
    const textarea = h("textarea", { class: "code tall", spellcheck: "false", id: "rawText" });
    textarea.value = S.draft;
    rawShownFor = S.draft;
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); textarea.setRangeText("  ", textarea.selectionStart, textarea.selectionEnd, "end"); }
    });
    const msg = h("span", { class: "msg" });
    const apply = async () => {
      msg.textContent = "";
      try {
        await setDraft(textarea.value.replace(/\r\n/g, "\n"));
        toast("Applied to the draft. Click “Review & save” to write it.");
      } catch (e) { msg.textContent = e.message; }
    };
    box.replaceChildren(h("div", { class: "panel" },
      h("h2", {}, "Raw YAML"),
      h("p", { class: "help" }, "The whole draft of ", h("code", {}, S.cfg ? S.cfg.file : "glance.yml"),
        ", for anything the editor doesn't cover. Apply sends it to the draft; nothing is written until you review and save."),
      textarea,
      h("div", { class: "modal-foot" }, msg,
        h("button", { onclick: () => { textarea.value = S.draft; msg.textContent = ""; } }, "Reset"),
        h("button", { class: "primary", onclick: apply }, "Apply to draft"))));
  }

  // ---------------------------------------------------------------- backups

  async function renderBackups() {
    const box = $("backupsView");
    let data;
    try { data = await api("api/backups"); }
    catch (e) { box.replaceChildren(h("div", { class: "notice bad" }, e.message)); return; }
    const panel = h("div", { class: "panel" },
      h("h2", {}, "Backups"),
      h("p", { class: "help" }, "Every save keeps the previous glance.yml here. The newest ", h("b", {}, String(data.keep)),
        " are kept (change it with GLANCER_BACKUPS). Restoring also backs up the current file first, so you can always go back."));
    if (!data.backups.length) {
      panel.append(h("div", { class: "empty" }, "No backups yet. One is made each time you save."));
    } else {
      const table = h("table", { class: "list" }, h("tr", {}, h("th", {}, "Saved before"), h("th", {}, "Size"), h("th", {})));
      for (const b of data.backups) {
        table.append(h("tr", {},
          h("td", {}, when(b.time), h("div", { class: "muted", style: "font-size:12px" }, b.name)),
          h("td", {}, `${(b.size / 1024).toFixed(1)} KB`),
          h("td", { class: "actions" },
            h("button", { class: "small", onclick: () => showBackup(b) }, "Compare"),
            " ",
            h("button", { class: "small", onclick: () => restore(b) }, "Restore"))));
      }
      panel.append(table);
    }
    box.replaceChildren(panel);
  }

  async function showBackup(b) {
    let d;
    try { d = await api("api/backups/" + encodeURIComponent(b.name)); }
    catch (e) { UI.alert("Cannot open the backup", e.message); return; }
    Modal.open([h("h3", { id: "modalTitle" }, "Backup from " + when(b.time)),
      h("p", { class: "lead" }, "Red = in the current glance.yml, green = in this backup."),
      h("pre", { class: "diff", html: diffHtml(d.diff) }),
      h("div", { class: "modal-foot" }, h("button", { onclick: Modal.close }, "Close"),
        h("button", { class: "primary", onclick: () => { Modal.forceClose(); restore(b); } }, "Restore this backup"))], { wide: true });
  }

  async function restore(b) {
    const extra = dirty() ? "\n\nYour unsaved changes in the editor will be thrown away." : "";
    if (!(await UI.confirm({ title: "Restore this backup?", message: `glance.yml goes back to how it was before ${when(b.time)}. The current file is backed up first.${extra}`, ok: "Restore" }))) return;
    try {
      await api("api/backups/" + encodeURIComponent(b.name) + "/restore", "POST", {});
      await loadConfig({ keepDraft: false });
      toast("Restored. Glance reloads it by itself.");
      renderBackups();
    } catch (e) { UI.alert("Restore failed", e.message); }
  }

  // ---------------------------------------------------------------- account

  async function account() {
    let acc;
    try { acc = await api("api/account"); } catch (e) { UI.alert("Account", e.message); return; }
    if (acc.from_env) {
      UI.alert("Account", `You are signed in as ${acc.username}. The password comes from the GLANCER_PASSWORD environment variable; change it there and restart Glancer.`);
      return;
    }
    const user = h("input", { value: acc.username || "", autocomplete: "username" });
    const cur = h("input", { type: "password", autocomplete: "current-password" });
    const pw = h("input", { type: "password", autocomplete: "new-password", placeholder: "Leave empty to keep it" });
    const pw2 = h("input", { type: "password", autocomplete: "new-password" });
    const msg = h("span", { class: "msg" });
    const save = async () => {
      msg.textContent = "";
      if (pw.value !== pw2.value) { msg.textContent = "The new passwords are different."; return; }
      try {
        await api("api/account", "POST", { username: user.value, current_password: cur.value, new_password: pw.value });
        Modal.forceClose();
        toast("Login updated. Other browsers are signed out.");
      } catch (e) { msg.textContent = e.message; }
    };
    Modal.open([h("h3", { id: "modalTitle" }, "Your login"),
      h("p", { class: "lead" }, "Forgot the password? Delete glancer.json in Glancer's data folder and restart it."),
      h("div", { class: "grid", style: "margin-top:12px" },
        h("div", { class: "field" }, h("label", {}, "Username"), user),
        h("div", { class: "field" }, h("label", {}, "Current password"), cur),
        h("div", { class: "field" }, h("label", {}, "New password"), pw),
        h("div", { class: "field" }, h("label", {}, "Repeat new password"), pw2)),
      h("div", { class: "modal-foot" }, msg, h("button", { onclick: Modal.close }, "Cancel"), h("button", { class: "primary", onclick: save }, "Save"))]);
  }

  // ---------------------------------------------------------------- routing

  function current() {
    return ({ "#raw": "raw", "#backups": "backups" })[location.hash] || "editor";
  }

  function route() {
    const v = current();
    $("editorView").hidden = v !== "editor";
    $("rawView").hidden = v !== "raw";
    $("backupsView").hidden = v !== "backups";
    $("navEditor").classList.toggle("active", v === "editor");
    $("navRaw").classList.toggle("active", v === "raw");
    $("navBackups").classList.toggle("active", v === "backups");
    if (v === "raw") renderRaw();
    if (v === "backups") renderBackups();
  }

  // After every draft change: keep the raw tab in step (unless the user is typing in it).
  function refresh() {
    if (current() === "raw" && rawShownFor !== S.draft && document.activeElement !== $("rawText")) renderRaw();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    window.addEventListener("hashchange", route);
    $("accountBtn").addEventListener("click", account);
    $("logoutBtn").addEventListener("click", async () => {
      await api("api/logout", "POST", {}).catch(() => {});
      location.href = "login";
    });
    route();
    try { await loadConfig(); }
    catch (e) { $("notices").replaceChildren(h("div", { class: "notice bad" }, "Could not load the config: ", e.message)); }
    route();
  });

  return { refresh };
})();
