<img src="app/static/logo.svg" alt="" width="64" height="64">

# Glancer

A web editor for the config of [Glance](https://github.com/glanceapp/glance), the self-hosted dashboard.
Add pages, columns and widgets with forms instead of editing `glance.yml` by hand.

> **Unofficial.** Glancer is a community tool. It is not made by, endorsed by or affiliated with the Glance project.

- **Edits your real `glance.yml`, in place.** Your comments, key order, quotes, `${ENV}` placeholders and
  `$include` lines stay exactly as they are. Only the lines you change are rewritten, and you see them first.
- **Pages, columns and widgets** in a visual layout: add, edit and delete them, and **drag and drop** widgets
  between columns, groups, head widgets and pages, columns to reorder them, and pages in the sidebar. Glance's
  rules are checked as you go (up to 3 columns, 2 on slim pages, 1 or 2 of them full; no group inside a group).
- **Forms** for the widgets most homelabs use: bookmarks, monitor, Docker containers, search, RSS, weather, markets,
  calendar and clock, plus the common settings (title, title link, cache, CSS class, hide header).
  Every widget also has a **YAML** tab, and widget types or settings Glancer doesn't know are kept untouched.
- **Theme editor** with color pickers, contrast sliders, your own presets for Glance's theme switcher, and the
  ready-made themes from Glance's documentation to start from.
- **Live preview** of your real Glance next to the editor, refreshed after each save.
- **Add app:** give a new app its web address in Nginx Proxy Manager (with your wildcard certificate) and a
  monitor entry in Glance, in one window.
- **Safe saving:** before anything is written you get a preview of the changed lines and a check that Glance will
  accept the file. The file is replaced in one step (never half-written), and the previous version is kept as a
  backup you can restore with one click. Glance notices the change and reloads by itself.
- **Sign-in page** with a hashed password.

Files pulled in with `$include` are shown (and can be viewed) but are read-only in this version.

## Install (Proxmox LXC with Docker)

These steps assume Glance already runs with Docker, for example in an LXC, and that you manage it with
Docker Compose (Dockhand, Portainer and the like use Compose too).

### 1. Find Glance's config folder

Glancer needs the folder that holds `glance.yml`. Open your Glance compose file and look at its `volumes:`.
With Glance's official setup it looks like this:

```yaml
services:
  glance:
    image: glanceapp/glance
    volumes:
      - ./config:/app/config
```

The part **before** the `:` is the folder on your machine (here `./config`, next to the compose file).
Not sure? In the LXC's console, run this and look for the line ending in `/app/config`:

```bash
docker inspect glance --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
```

### 2. Add Glancer next to Glance

**Easiest:** add Glancer to Glance's own compose file (in Dockhand: open the Glance stack and edit its compose).
Paste this under `services:`, at the same indentation as `glance:`, and use the same folder as Glance before the `:`:

```yaml
  glancer:
    image: ghcr.io/sodoto/glancer:latest
    container_name: glancer
    restart: unless-stopped
    ports:
      - "8090:8080"
    volumes:
      - ./config:/glance-config     # the same folder Glance uses for /app/config
      - ./glancer-data:/data        # Glancer's login and backups
```

Then deploy the stack again (Dockhand: **Deploy**; command line: `docker compose up -d` in that folder).
Docker downloads the ready-made Glancer image (it works on regular PCs and on ARM boards like a Raspberry Pi).

**Or on its own:** download [docker-compose.yml](docker-compose.yml) into a new folder, change
`/opt/glance/config` to your Glance config folder, and run `docker compose up -d` there.

### 3. Open it and create your login

Go to `http://<your-LXC-IP>:8090`. The first time, Glancer asks you to choose a username and password
(at least 8 characters). After that, that page is the sign-in page. You stay signed in for 30 days.

Create the login right after installing: until then, anyone who can reach the page could create it.

### 4. Edit, review, save

- Pick a page on the left, then use **+ Add widget**, **Edit**, or drag widgets where you want them
  (drop one on a page on the left to send it there). Drag ⠿ to reorder columns. On a phone or tablet, use
  the arrows and **Move…** instead.
- Changes collect in a draft (they survive a page reload, and **Undo** / Ctrl+Z works).
- Click **Review & save** at the bottom: you see exactly which lines change and whether Glance will accept them.
  Click **Save to glance.yml**. Glance reloads its config on its own a moment later.

## Add an app (Nginx Proxy Manager)

**+ Add app** creates a new app's web address in Nginx Proxy Manager (like `jellyfin.home.example.com`,
forwarded to the app's IP and port) and adds the app to a monitor widget in Glance.

**Connect NPM once** (top right **Settings**):

1. In Nginx Proxy Manager, create a user just for Glancer: **Users → Add User**, with an email like
   `glancer@example.com`. Untick **Administrator**. Under **Permissions**, set Item Visibility to "All Items",
   **Proxy Hosts** to "Manage" and **Certificates** to "View", and the rest to "Hidden". Give it a password
   (⋮ → Change Password). Don't turn on two-factor login for this user.
2. In Glancer, open **Settings**, enter NPM's admin address (the page you log in to, usually
   `http://<npm-ip>:81`), that email and password, and click **Save and test**. It shows the wildcard
   certificate it found.

**Then, for each new app:** click **+ Add app**, enter its name, icon and where it runs (IP and port), check
the web address (the name is filled in, the domain comes from your wildcard certificate), pick the monitor
widget, and click **Create**. The NPM address is created right away; the Glance entry goes through the usual
**Review & save**.

Glancer only reads NPM's certificates and proxy hosts and adds new ones. It never changes or deletes existing
hosts, and it refuses an address that already exists. To undo an app, delete its proxy host in NPM.

## Updating Glancer

In the folder of the compose file, run:

```bash
docker compose pull glancer
```

```bash
docker compose up -d glancer
```

In Dockhand: redeploy the stack with the option to pull the latest images. Your login and backups are kept in
the data folder. To stay on one version instead of always the newest, use for example
`ghcr.io/sodoto/glancer:0.1` (newest 0.1.x) or `ghcr.io/sodoto/glancer:0.1.1`.

**Prefer to build it yourself?** Replace the `image:` line with `build: https://github.com/sodoto/glancer.git#main`
and use `docker compose up -d --build`.

## Settings

All optional, set under `environment:` in the compose file.

| Variable | Default | What it does |
|---|---|---|
| `GLANCER_BACKUPS` | `30` | How many backups of `glance.yml` to keep. |
| `GLANCE_URL` | | Your Glance address, e.g. `http://192.168.1.50:8080`, for the preview and the **Open Glance** button. You can also enter it in Glancer (**Preview**); this variable overrides that. |
| `GLANCE_CONFIG_FILE` | `glance.yml` | The file name inside the config folder, if yours is different. |
| `GLANCER_USERNAME` / `GLANCER_PASSWORD` | | Set the login from the environment instead of the first-start page. The password can be plain text or a `scrypt$...` hash. |
| `NPM_URL` / `NPM_EMAIL` / `NPM_PASSWORD` | | Connect Nginx Proxy Manager from the environment instead of Settings. |
| `GLANCE_CONFIG_DIR` | `/glance-config` | Where the config folder is mounted inside the container. |
| `DATA_DIR` | `/data` | Where the login and backups are stored inside the container. |

## Good to know

- **Backups** are in the data folder (`glancer-data/backups`), named after the time they were made. The
  **Backups** tab compares any of them with the current file and restores it in one click. Restoring backs up the
  current file first, so it can be undone too.
- **Changed the file by hand while Glancer was open?** Glancer notices when you save and tells you, instead of
  silently overwriting your edit.
- **`${ENV}` values** are shown and saved as written. Glance fills them in when it reads the file.
- **Icon search:** in any Icon field, type a name (e.g. `jellyfin`) to search the four icon libraries Glance
  supports (selfh.st `sh:`, Dashboard Icons `di:`, Simple Icons `si:`, Material Design `mdi:`), with previews.
  Glancer downloads the libraries' lists once a week from cdn.jsdelivr.net (where Glance loads the icons from too)
  and keeps them in its data folder.
- **Markets symbol suggestions:** when you type in a market's Symbol field, Glancer asks Yahoo Finance (the
  service Glance gets prices from) for matching symbols. Only the text you type is sent. Besides Glance's
  and NPM's addresses that you enter and the icon lists, it is the only outside service Glancer contacts; without internet access you simply get no suggestions.
- **YAML anchors** (`&name`, `*name`, `<<:`): widgets that use them are edited in the YAML tab only, so the
  anchors stay intact.
- **Preview:** click **Preview** at the top to see your real Glance next to the editor, on the page you are
  editing. The first time, enter the address you open Glance with. It shows what is saved and reloads after each
  save. If it stays blank, your reverse proxy probably forbids showing Glance inside another page (an
  `X-Frame-Options` or `frame-ancestors` header on Glance's site). If Glancer is opened over https://, Glance's
  address must be https:// too.
- **Raw YAML** tab: the whole draft as text, for anything the editor doesn't cover.
- **Forgot your password?** Delete `glancer.json` in the data folder and restart the container. The first-start
  page appears again.
- **Behind nginx:** proxy a (sub)domain to port 8090 as usual, for example:
  ```nginx
  location / {
      proxy_pass http://192.168.1.60:8090;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```
- The container runs as root so it can write `glance.yml` whatever its owner is; the file keeps its owner and permissions.

## Development

```bash
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt     # Windows: .venv\Scripts\pip
.venv/bin/python -m pytest
.venv/bin/python dev/run.py                       # http://127.0.0.1:8765 with the sample config in dev/
```

The backend is FastAPI with [ruamel.yaml](https://yaml.dev/doc/ruamel.yaml/) in round-trip mode
(`app/yamldoc.py`); the frontend is plain HTML, CSS and JavaScript in `app/static` (no build step).
The tests in `tests/test_roundtrip.py` load Glance's official example config, apply edits, and check that every
other byte is unchanged.

## License

MIT, see [LICENSE](LICENSE). Glance is a separate project by its own authors; Glancer doesn't include its code or logo.
`tests/fixtures/glance-example.yml` is Glance's example config, used as test data (see [its note](tests/fixtures/README.md)).
