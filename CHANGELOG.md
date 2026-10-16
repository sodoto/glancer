# Changelog

## 0.4.0 (2026-10-16)
- Theme editor (Settings → theme): color pickers for the background, primary, positive and negative colors
  (Glance's HSL values are filled in for you), sliders for text contrast and color strength, a light/dark
  switch, and the extra themes for Glance's theme picker. Start from one of the 14 ready-made themes in
  Glance's documentation with one click. A small mock-up shows the colors as you change them; the Preview
  panel shows the real result after saving. The YAML tab is still there.
- Fixed: editing a top-level section (like `theme:`) as YAML could drop the comment lines at its top.

## 0.3.0 (2026-10-16)
- Live preview: click **Preview** to see your real Glance next to the editor, on the page you are editing.
  It is drawn at desktop width and scaled to fit, so you see Glance's real layout, and it reloads by itself
  after each save or restore. It shows what is saved.
- Glance's address can now be entered in Glancer (the first time you open the preview, or with ⚙ in it);
  `GLANCE_URL` still works and takes precedence. It is also used by the **Open Glance** button.

## 0.2.0 (2026-10-16)
- Drag and drop. Drag a widget card anywhere: another spot in its column, another column, the head widgets,
  into or out of a group (as a tab), or onto a page in the sidebar to send it to that page. A blue line shows
  where it will land. Drag ⠿ in a column's header to reorder columns, and drag pages in the sidebar to reorder
  them. Glance's rules still apply (no group inside a group).
- The ← → buttons on widget cards are gone (drag, or use **Move…**). ↑ ↓ and Move… stay for keyboards,
  phones and tablets.

## 0.1.3 (2026-10-15)
- Much less scrolling in widget forms. Entries in a list (monitor sites, bookmarks links, feeds, markets…)
  are folded to one line showing their title and address; click one to open it, or use "unfold all". New
  entries and entries missing a required value open by themselves.
- Rarely used settings (check URL, timeout, status codes, basic authentication, link target, cache, CSS
  class…) are under a folded **More options**, which lists the ones that are set.
- The widget's title is now at the top of its form.

## 0.1.2 (2026-10-15)
- Much faster: every click could take seconds on a small LXC when glance.yml had even one line written
  differently than Glancer would write it (extra spaces, for example). Glancer re-detected the file's
  indentation on each request by writing the whole file out up to 30 times. It now reads the indentation
  from the file once and remembers it: about 20x faster.
- With `GLANCER_PASSWORD` set, each request no longer re-checks the password with the (deliberately slow) hash.

## 0.1.1 (2026-10-15)
- Ready-made Docker image: `ghcr.io/sodoto/glancer:latest` (for regular PCs/servers and ARM boards like a
  Raspberry Pi). No more building it yourself: the compose file and the install steps use the image, and
  updating is `docker compose pull` + `docker compose up -d`.
- Each release is tested and published automatically by GitHub Actions.

## 0.1.0 (2026-10-15)
First release.
- Edits the real glance.yml in place. Comments, key order, quoting, `${ENV}` placeholders and `$include`
  lines are kept exactly as they are; only what you change is rewritten.
- Pages, columns and widgets: add, edit, delete and reorder (buttons), head widgets, and widgets inside
  groups and split columns. **Move…** sends a widget to any column, page, head widgets or group, and
  **Put it in a new group** turns a widget into a group (tabs) that other widgets can be moved into. Glance's column rules are enforced
  (1 to 3 columns, 2 on slim pages, with 1 or 2 full columns).
- Forms for bookmarks, monitor, RSS, search, weather, calendar, clock, markets and Docker containers widgets, plus
  the common settings (title, title link, cache, CSS class, hide header). Every widget has a YAML tab;
  unknown widget types and settings are kept untouched.
- Markets: type a company or coin name in **Symbol** and pick from Yahoo Finance's suggestions; the name
  is filled in for you.
- Page settings form. Top-level sections (server, auth, theme, branding, document and any other) as YAML.
- Files pulled in with `$include` are listed and viewable, read-only.
- Safe saving: a diff preview, a check that Glance will accept the config, atomic writes, timestamped
  backups (30 by default) and one-click restore. Unsaved changes survive a page reload; undo with Ctrl+Z.
- Sign-in page with a hashed password and a 30-day session cookie. The login is created on first start.
