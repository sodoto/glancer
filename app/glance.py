"""What Glance accepts: column layouts, widget types and a structure check that mirrors Glance's own.

Rules come from Glance's docs/configuration.md and internal/glance/config.go (isConfigStateValid).
"""
import re
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.error import YAMLError

from .yamldoc import Document, include_target, safe_plain

WIDGET_TYPES = {
    "bookmarks": "Bookmarks", "calendar": "Calendar", "calendar-legacy": "Calendar (legacy)",
    "change-detection": "ChangeDetection.io", "clock": "Clock", "custom-api": "Custom API",
    "dns-stats": "DNS stats", "docker-containers": "Docker containers", "extension": "Extension",
    "group": "Group (tabs)", "hacker-news": "Hacker News", "html": "HTML", "iframe": "iframe",
    "lobsters": "Lobsters", "markets": "Markets", "monitor": "Monitor", "reddit": "Reddit",
    "releases": "Releases", "repository": "Repository", "rss": "RSS", "search": "Search",
    "server-stats": "Server stats", "split-column": "Split column", "stocks": "Markets",
    "to-do": "To-do", "twitch-channels": "Twitch channels", "twitch-top-games": "Twitch top games",
    "videos": "Videos", "weather": "Weather",
}
CONTAINER_WIDGETS = ("group", "split-column")  # widgets with their own `widgets:` list
PAGE_WIDTHS = ("default", "slim", "wide")
TOP_SECTIONS = ("server", "auth", "theme", "branding", "document")
INCLUDE_PATTERN = re.compile(r"(?m)^([ \t]*)(?:-[ \t]*)?(?:!|\$)include:[ \t]*(.+)$")
MAX_INCLUDE_DEPTH = 20


# ---------------------------------------------------------------- column layouts

def layout_error(sizes: list, width: str | None = None) -> str | None:
    """Why Glance would refuse these column sizes, or None when it accepts them."""
    max_cols = 2 if width == "slim" else 3
    if not sizes:
        return "A page needs at least one column."
    if len(sizes) > max_cols:
        return ("Slim pages can have at most 2 columns." if width == "slim"
                else "A page can have at most 3 columns.")
    if any(s not in ("small", "full") for s in sizes):
        return "Column size must be small or full."
    full = sizes.count("full")
    if full == 0 or full > 2:
        return "A page needs 1 or 2 full columns (for example: full · small+full · small+full+small)."
    return None


# ---------------------------------------------------------------- includes

def resolve_includes(path: Path, depth: int = 0, seen: list | None = None) -> tuple[str, list[dict]]:
    """Glance's textual $include expansion. Returns (expanded text, files involved)."""
    files = seen if seen is not None else []
    text = path.read_text(encoding="utf-8-sig")
    if depth > MAX_INCLUDE_DEPTH:
        raise ValueError("Too many nested $include levels (maximum is 20)")

    def replace(match):
        indent, target = match.group(1), match.group(2).strip()
        inc = Path(target) if Path(target).is_absolute() else path.parent / target
        entry = {"path": str(inc), "name": target, "from": path.name, "exists": inc.is_file()}
        files.append(entry)
        if not inc.is_file():
            raise FileNotFoundError(f"{path.name} includes {target}, which does not exist")
        sub, _ = resolve_includes(inc, depth + 1, files)
        return "\n".join(indent + line for line in sub.splitlines())

    return INCLUDE_PATTERN.sub(replace, text), files


def list_includes(path: Path) -> list[dict]:
    """Every file pulled in by $include (recursively), without failing on missing ones."""
    found: list[dict] = []

    def scan(p: Path, depth: int):
        if depth > MAX_INCLUDE_DEPTH or not p.is_file():
            return
        try:
            text = p.read_text(encoding="utf-8-sig")
        except OSError:
            return
        for m in INCLUDE_PATTERN.finditer(text):
            target = m.group(2).strip()
            inc = Path(target) if Path(target).is_absolute() else p.parent / target
            if any(f["path"] == str(inc) for f in found):
                continue
            found.append({"path": str(inc), "name": target, "from": p.name, "exists": inc.is_file()})
            scan(inc, depth + 1)

    scan(path, 0)
    return found


# ---------------------------------------------------------------- structure check

def check(text: str, main_path: Path) -> tuple[list[str], list[str]]:
    """Validate a candidate glance.yml (with includes resolved from disk). Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        YAML(typ="safe", pure=True).load(text)
    except YAMLError as exc:
        return [f"YAML error: {exc}"], warnings

    def expand(match):
        indent, target = match.group(1), match.group(2).strip()
        inc = Path(target) if Path(target).is_absolute() else main_path.parent / target
        try:
            sub, _ = resolve_includes(inc)
        except FileNotFoundError as exc:
            errors.append(str(exc) if inc.is_file() else f"Included file not found: {target}")
            return match.group(0)
        except (OSError, ValueError) as exc:
            errors.append(f"Could not read included file {target}: {exc}")
            return match.group(0)
        return "\n".join(indent + line for line in sub.splitlines())

    full = INCLUDE_PATTERN.sub(expand, text)
    if errors:
        return errors, warnings
    try:
        data = YAML(typ="safe", pure=True).load(full)
    except YAMLError as exc:
        return [f"YAML error after resolving $include files: {exc}"], warnings
    if data is None:
        return ["The file is empty"], warnings
    if not isinstance(data, dict):
        return ["The top level must be a mapping (server:, pages:, ...)"], warnings

    auth = data.get("auth")
    if isinstance(auth, dict) and auth.get("users") and not auth.get("secret-key"):
        errors.append("auth: secret-key must be set when users are configured")
    if isinstance(auth, dict) and isinstance(auth.get("users"), dict):
        for name, user in auth["users"].items():
            user = user if isinstance(user, dict) else {}
            if not user.get("password") and not user.get("password-hash"):
                errors.append(f"auth: user {name} must have a password or a password-hash")
            elif user.get("password") and len(str(user["password"])) < 6 and "${" not in str(user["password"]):
                errors.append(f"auth: the password for {name} must be at least 6 characters")

    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        errors.append("No pages configured (Glance needs at least one page)")
        return errors, warnings
    for i, page in enumerate(pages, 1):
        if not isinstance(page, dict):
            errors.append(f"Page {i} is not a mapping")
            continue
        label = f"Page {i}" + (f" ({page.get('name')})" if page.get("name") else "")
        if not page.get("name"):
            errors.append(f"{label} has no name")
        for key in ("width", "desktop-navigation-width"):
            if page.get(key) not in (None, "", *PAGE_WIDTHS) and "${" not in str(page.get(key)):
                errors.append(f"{label}: {key} must be default, slim or wide")
        columns = page.get("columns")
        if not isinstance(columns, list) or not columns:
            errors.append(f"{label} has no columns")
            continue
        sizes = [c.get("size") if isinstance(c, dict) else None for c in columns]
        problem = layout_error(sizes, page.get("width"))
        if problem:
            errors.append(f"{label}: {problem}")
        for c, column in enumerate(columns, 1):
            if isinstance(column, dict):
                _check_widgets(column.get("widgets"), f"{label}, column {c}", errors, warnings, False)
        _check_widgets(page.get("head-widgets"), f"{label}, head widgets", errors, warnings, False)
    return errors, warnings


def _check_widgets(widgets, where: str, errors: list, warnings: list, in_group: bool) -> None:
    if widgets is None:
        return
    if not isinstance(widgets, list):
        errors.append(f"{where}: widgets must be a list")
        return
    for n, w in enumerate(widgets, 1):
        if not isinstance(w, dict):
            errors.append(f"{where}, widget {n}: not a mapping")
            continue
        wtype = w.get("type")
        if not wtype:
            errors.append(f"{where}, widget {n}: missing type")
            continue
        wtype = str(wtype)
        if wtype not in WIDGET_TYPES:
            warnings.append(f"{where}, widget {n}: unknown widget type '{wtype}' "
                            "(fine if your Glance version has it)")
        if in_group and wtype in CONTAINER_WIDGETS:
            errors.append(f"{where}, widget {n}: a {wtype} widget cannot be placed inside a group")
        if wtype in CONTAINER_WIDGETS:
            _check_widgets(w.get("widgets"), f"{where}, {wtype}", errors, warnings, wtype == "group")
        required = {"monitor": "sites", "bookmarks": "groups", "rss": "feeds", "weather": "location"}
        if wtype in required and not w.get(required[wtype]):
            errors.append(f"{where}, {wtype} widget: '{required[wtype]}' is required")


# ---------------------------------------------------------------- tree for the UI

def tree(doc: Document) -> dict:
    data = doc.data
    sections = [{"key": k, "present": k in data} for k in TOP_SECTIONS]
    sections += [{"key": str(k), "present": True} for k in data if k not in TOP_SECTIONS and k != "pages"]
    pages = data.get("pages")
    out = {"sections": sections, "pages": [], "pages_include": include_target(pages)}
    if isinstance(pages, CommentedSeq):
        out["pages"] = [_page(p, ["pages", i]) for i, p in enumerate(pages)]
    return out


def _page(page, path: list) -> dict:
    inc = include_target(page)
    if inc is not None or not isinstance(page, CommentedMap):
        return {"path": path, "include": inc, "name": inc or "?", "raw": inc is None}
    settings = {k: safe_plain(v) for k, v in page.items() if k not in ("columns", "head-widgets")}
    cols = page.get("columns")
    columns = []
    if isinstance(cols, CommentedSeq):
        for c, col in enumerate(cols):
            cpath = path + ["columns", c]
            ci = include_target(col)
            if ci is not None or not isinstance(col, CommentedMap):
                columns.append({"path": cpath, "include": ci, "size": None, "widgets": []})
                continue
            columns.append({"path": cpath, "size": col.get("size"),
                            "widgets": _widgets(col.get("widgets"), cpath + ["widgets"])})
    head = page.get("head-widgets")
    return {
        "path": path, "name": str(page.get("name") or ""), "settings": settings,
        "columns": columns, "columns_include": include_target(cols),
        "head_widgets": _widgets(head, path + ["head-widgets"]) if head is not None else None,
    }


def _widgets(seq, path: list) -> list:
    if not isinstance(seq, CommentedSeq):
        return []
    return [_widget(w, path + [i]) for i, w in enumerate(seq)]


def _widget(w, path: list) -> dict:
    inc = include_target(w)
    if inc is not None:
        return {"path": path, "include": inc}
    if not isinstance(w, CommentedMap):
        return {"path": path, "type": None, "data": None}
    wtype = str(w.get("type") or "")
    out = {"path": path, "type": wtype, "data": safe_plain(w)}
    if wtype in CONTAINER_WIDGETS:
        out["children"] = _widgets(w.get("widgets"), path + ["widgets"])
    return out
