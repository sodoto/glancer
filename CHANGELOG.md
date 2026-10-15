# Changelog

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
