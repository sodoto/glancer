"""Icon search for Glance's icon prefixes: sh: (selfh.st), di: (Dashboard Icons), si: (Simple Icons), mdi:.

The libraries' own index files are downloaded once and kept for a week in Glancer's data folder.
Image addresses are built exactly like Glance does (internal/glance/config-fields.go), so what you
see in Glancer is what Glance shows.
"""
import asyncio
import json
import logging
import time
import urllib.request

from .config import VERSION, settings

log = logging.getLogger("glancer")

INDEXES = {
    "sh": "https://cdn.jsdelivr.net/gh/selfhst/icons@main/index.json",
    "di": "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json",
    "si": "https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json",
    "mdi": "https://cdn.jsdelivr.net/npm/@mdi/svg@latest/meta.json",
}
SOURCES = {"sh": "selfh.st", "di": "Dashboard Icons", "si": "Simple Icons", "mdi": "Material Design"}
# Homelab app logos first (in color), then brand marks and generic symbols.
ORDER = {"sh": 0, "di": 1, "si": 2, "mdi": 3}
MAX_AGE = 7 * 86400
_entries: list[tuple] | None = None  # (prefix, slug, label, ext, search text)
_loading: asyncio.Lock | None = None


class IconsUnavailable(Exception):
    pass


def icon_url(value: str) -> str:
    """Glance's own rules: "sh:jellyfin" -> https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/jellyfin.svg"""
    value = value.strip().removeprefix("auto-invert ").strip()
    prefix, sep, icon = value.partition(":")
    if not sep or prefix not in ORDER:
        return value
    basename, dot, ext = icon.partition(".")
    if not dot or ext not in ("svg", "png", "webp"):
        ext = "svg"
    if prefix == "si":
        return f"https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/{basename}.svg"
    if prefix == "di":
        return f"https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/{ext}/{basename}.{ext}"
    if prefix == "mdi":
        return f"https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/{basename}.svg"
    return f"https://cdn.jsdelivr.net/gh/selfhst/icons@main/{ext}/{basename}.{ext}"


def _parse(prefix: str, data) -> list[tuple]:
    out = []
    if prefix == "sh":  # [{"Name", "Reference", "SVG": "Yes", "PNG", "WebP", ...}]
        for row in data or []:
            ref = str(row.get("Reference") or "").strip()
            if not ref:
                continue
            ext = "svg" if row.get("SVG") == "Yes" else "png" if row.get("PNG") == "Yes" else "webp" if row.get("WebP") == "Yes" else "svg"
            name = str(row.get("Name") or ref)
            out.append((prefix, ref, name, ext, f"{ref} {name}".lower()))
    elif prefix == "di":  # {"slug": {"base": "svg", "aliases": [...]}}
        for slug, meta in (data or {}).items():
            meta = meta if isinstance(meta, dict) else {}
            ext = meta.get("base") if meta.get("base") in ("svg", "png", "webp") else "svg"
            aliases = " ".join(str(a) for a in meta.get("aliases") or [])
            out.append((prefix, slug, slug.replace("-", " "), ext, f"{slug} {aliases}".lower()))
    elif prefix == "si":  # [{"title", "slug", "aliases": {"aka": [...]}}]
        for row in data or []:
            slug = row.get("slug")
            if not slug:
                continue
            aliases = row.get("aliases") or {}
            aka = " ".join(str(a) for a in (aliases.get("aka") or []) if isinstance(aliases, dict))
            title = str(row.get("title") or slug)
            out.append((prefix, slug, title, "svg", f"{slug} {title} {aka}".lower()))
    elif prefix == "mdi":  # [{"name", "aliases": [...], "tags": [...]}]
        for row in data or []:
            name = row.get("name")
            if not name:
                continue
            words = " ".join(str(a) for a in (row.get("aliases") or []))
            out.append((prefix, name, name.replace("-", " "), "svg", f"{name} {words}".lower()))
    return out


def _download(prefix: str) -> list[tuple]:
    req = urllib.request.Request(INDEXES[prefix], headers={"User-Agent": f"Glancer/{VERSION} (+https://github.com/sodoto/glancer)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return _parse(prefix, json.loads(resp.read()))


def _cache_file():
    return settings.data_dir / "icon-index.json"


def _load_sync() -> list[tuple]:
    path = _cache_file()
    cached = None
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if cached and time.time() - cached.get("fetched", 0) < MAX_AGE:
        return [tuple(e) for e in cached["entries"]]
    entries, failed = [], []
    for prefix in INDEXES:
        try:
            entries += _download(prefix)
        except Exception as exc:  # one library down shouldn't block the others
            failed.append(prefix)
            log.warning("Could not download the %s icon index: %s", SOURCES[prefix], exc)
    if failed and cached:  # keep last week's list rather than a partial one
        return [tuple(e) for e in cached["entries"]]
    if not entries:
        raise IconsUnavailable("Could not download the icon lists (no internet access from Glancer?).")
    if not failed:
        try:
            settings.data_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"fetched": time.time(), "entries": entries}), encoding="utf-8")
        except OSError:
            pass
    return entries


async def _entries_loaded() -> list[tuple]:
    global _entries, _loading
    if _entries is not None:
        return _entries
    if _loading is None:
        _loading = asyncio.Lock()
    async with _loading:
        if _entries is None:
            _entries = await asyncio.to_thread(_load_sync)
    return _entries


async def search(query: str, limit: int = 30) -> list[dict]:
    q = " ".join(query.lower().replace(":", " ").split())[:60]
    if len(q) < 2:
        return []
    words = q.split()
    compact = q.replace(" ", "").replace("-", "")  # "pihole" finds "pi-hole", "home assistant" finds "homeassistant"
    scored = []
    for prefix, slug, label, ext, text in await _entries_loaded():
        flat = text.replace("-", "").replace(" ", "")
        if not all(w in text for w in words) and compact not in flat:
            continue
        s = slug.lower().replace("-", "")
        rank = 0 if s == compact else 1 if s.startswith(compact) else 2 if compact in s else 3
        scored.append((rank, ORDER[prefix], len(slug), prefix, slug, label, ext))
    scored.sort()
    out = []
    for _, _, _, prefix, slug, label, ext in scored[:limit]:
        value = f"{prefix}:{slug}" + (f".{ext}" if ext != "svg" else "")
        out.append({"icon": value, "label": label, "source": SOURCES[prefix], "url": icon_url(value),
                    "invert": prefix in ("si", "mdi")})  # Glance shows these monochrome icons inverted on dark themes
    return out


def reset() -> None:
    """Forget the in-memory list (tests)."""
    global _entries, _loading
    _entries = None
    _loading = None
