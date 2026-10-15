"""Glancer web app: sign-in, the config editor API and the static UI."""
import difflib
import logging
import re
import secrets
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import auth, store, symbols
from .config import VERSION, load_account, save_account, settings
from .glance import WIDGET_TYPES, check, layout_error, list_includes, tree
from .yamldoc import Document, EditError, NotPlain, to_plain

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("glancer")

STATIC = Path(__file__).parent / "static"
STARTER = """\
# Created by Glancer. See https://github.com/glanceapp/glance/blob/main/docs/configuration.md
pages:
  - name: Home
    columns:
      - size: small
        widgets:
          - type: clock
            hour-format: 24h

          - type: calendar
            first-day-of-week: monday

      - size: full
        widgets:
          - type: search
            search-engine: duckduckgo

          - type: bookmarks
            groups:
              - title: Homelab
                links:
                  - title: Glance
                    url: https://github.com/glanceapp/glance
"""

app = FastAPI(title="Glancer", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def no_stale_assets(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"  # revalidate (cheap, ETag) so updates show at once
    return response


# ---------------------------------------------------------------- auth helpers

def _signed_in(request: Request) -> bool:
    username, password_hash = auth.credentials()
    return auth.valid_session(request.cookies.get(auth.COOKIE), username, password_hash)


def require_auth(request: Request) -> None:
    if not _signed_in(request):
        raise HTTPException(401, "Please sign in")


def _set_session(response: Response, request: Request, username: str, password_hash: str) -> None:
    response.set_cookie(
        auth.COOKIE, auth.make_session(username, password_hash), max_age=auth.SESSION_DAYS * 86400,
        httponly=True, samesite="strict", secure=request.url.scheme == "https", path="/",
    )


async def json_body(request: Request) -> dict:
    # Requiring JSON forces a CORS preflight, so other websites can't post to the API.
    if not request.headers.get("content-type", "").startswith("application/json"):
        raise HTTPException(415, "Expected application/json")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected a JSON object")
    return body


def _client(request: Request) -> str:
    return request.client.host if request.client else "?"


# ---------------------------------------------------------------- pages

def _page(name: str) -> HTMLResponse:
    # Version-stamp the scripts and styles so browsers fetch fresh copies after every update.
    html = (STATIC / name).read_text(encoding="utf-8")
    html = re.sub(r'(static/[\w.-]+\.(?:js|css))"', rf'\1?v={VERSION}"', html)
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/login")
async def login_page(request: Request):
    if _signed_in(request):
        return RedirectResponse("./", status_code=303)
    return _page("login.html")


@app.get("/")
async def index(request: Request):
    if not _signed_in(request):
        return RedirectResponse("login", status_code=303)
    return _page("index.html")


@app.get("/api/auth-state")
async def auth_state():
    return {"setup_needed": auth.setup_needed(), "version": VERSION}


@app.post("/api/setup")
async def setup(request: Request, response: Response, body: dict = Depends(json_body)):
    """First start: create the login. Only works while no login exists."""
    if not auth.setup_needed():
        raise HTTPException(409, "A login already exists. Sign in instead.")
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not username:
        raise HTTPException(422, "Choose a username")
    if len(password) < auth.MIN_PASSWORD:
        raise HTTPException(422, f"The password must be at least {auth.MIN_PASSWORD} characters")
    password_hash = auth.hash_password(password)
    save_account({"username": username, "password_hash": password_hash})
    log.info("Login created for %r from %s", username, _client(request))
    _set_session(response, request, username, password_hash)
    return {"ok": True}


@app.post("/api/login")
async def login(request: Request, response: Response, body: dict = Depends(json_body)):
    client = _client(request)
    wait = auth.retry_after(client)
    if wait:
        raise HTTPException(429, f"Too many attempts. Try again in {wait} seconds.")
    username, password_hash = auth.credentials()
    given_user, given_pass = str(body.get("username", "")), str(body.get("password", ""))
    ok = (bool(username and password_hash)
          and secrets.compare_digest(given_user.encode(), (username or "").encode())
          and auth.verify_password(given_pass, password_hash))
    if not ok:
        auth.record_failure(client)
        log.warning("Failed sign-in for %r from %s", given_user, client)
        raise HTTPException(401, "Wrong username or password")
    auth.clear_failures(client)
    _set_session(response, request, username, password_hash)
    return {"ok": True}


@app.post("/api/logout")
async def logout(response: Response, _: dict = Depends(json_body)):
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@app.get("/api/account", dependencies=[Depends(require_auth)])
async def account():
    username, _ = auth.credentials()
    return {"username": username, "from_env": auth.password_from_env()}


@app.post("/api/account", dependencies=[Depends(require_auth)])
async def change_account(request: Request, response: Response, body: dict = Depends(json_body)):
    if auth.password_from_env():
        raise HTTPException(409, "The password is set with GLANCER_PASSWORD. Change it there.")
    username, password_hash = auth.credentials()
    if not auth.verify_password(str(body.get("current_password", "")), password_hash):
        raise HTTPException(403, "The current password is wrong")
    new_user = str(body.get("username") or username).strip()
    new_pass = str(body.get("new_password", ""))
    if new_pass and len(new_pass) < auth.MIN_PASSWORD:
        raise HTTPException(422, f"The new password must be at least {auth.MIN_PASSWORD} characters")
    data = load_account()
    data["username"] = new_user
    data["password_hash"] = auth.hash_password(new_pass) if new_pass else password_hash
    save_account(data)
    _set_session(response, request, new_user, data["password_hash"])  # keep this browser signed in
    return {"ok": True}


# ---------------------------------------------------------------- config

def _doc(text: str) -> Document:
    try:
        return Document(text)
    except EditError as exc:
        raise HTTPException(422, str(exc))


def _text(body: dict) -> str:
    text = body.get("text")
    if not isinstance(text, str):
        raise HTTPException(400, "Missing text")
    return text.replace("\r\n", "\n")


def _path(value) -> list:
    if not isinstance(value, list) or not all(isinstance(p, (str, int)) for p in value):
        raise HTTPException(400, "Bad path")
    return value


def _view(doc: Document, text: str) -> dict:
    return {"text": text, "tree": tree(doc)}


@app.get("/api/config", dependencies=[Depends(require_auth)])
async def get_config():
    loaded = store.load()
    main = store.main_path()
    out = {
        "version": VERSION, "file": str(main), "dir": str(settings.config_dir), "exists": loaded.exists,
        "dir_exists": settings.config_dir.is_dir(), "sha": loaded.sha, "text": loaded.text,
        "files": list_includes(main) if loaded.exists else [], "glance_url": settings.glance_url,
        "widget_types": WIDGET_TYPES, "backups_kept": settings.backups,
        "tree": None, "parse_error": None, "reformats": 0,
    }
    if loaded.exists:
        try:
            doc = Document(loaded.text)
            out["tree"] = tree(doc)
            out["reformats"] = doc.reformats
        except EditError as exc:
            out["parse_error"] = str(exc)
    return out


@app.post("/api/create-starter", dependencies=[Depends(require_auth)])
async def create_starter(_: dict = Depends(json_body)):
    if store.main_path().exists():
        raise HTTPException(409, "glance.yml already exists")
    if not settings.config_dir.is_dir():
        raise HTTPException(409, f"The folder {settings.config_dir} does not exist. Check the volume in docker-compose.yml.")
    store.write(STARTER, None)
    return {"ok": True}


def _invalid_layouts(doc: Document) -> set:
    """A message for every page whose columns Glance would refuse."""
    out = set()
    pages = doc.data.get("pages")
    if not isinstance(pages, list):
        return out
    for i, page in enumerate(pages):
        if not isinstance(page, dict) or not isinstance(page.get("columns"), list):
            continue
        cols = page["columns"]
        if any(not isinstance(c, dict) or "$include" in c for c in cols):
            continue
        problem = layout_error([c.get("size") for c in cols], page.get("width"))
        if problem:
            out.add(f"{page.get('name') or f'Page {i + 1}'}: {problem}")
    return out


def _apply_op(doc: Document, op: dict):
    kind = op.get("op")
    if kind == "set_yaml":
        return doc.set_yaml(_path(op.get("path")), str(op.get("yaml", "")))
    if kind == "set_value":
        return doc.set_value(_path(op.get("path")), op.get("value"))
    if kind == "set_fields":
        return doc.set_fields(_path(op.get("path")), op.get("set") or {}, op.get("unset") or [])
    if kind == "delete":
        return doc.delete(_path(op.get("path")))
    if kind == "insert":
        return doc.insert(_path(op.get("path")), op.get("index"), op.get("value"),
                          op.get("yaml") if isinstance(op.get("yaml"), str) else None)
    if kind == "move":
        index = op.get("index")
        return doc.move(_path(op.get("path")), _path(op.get("to")), None if index is None else int(index))
    if kind == "wrap_group":
        wtype = op.get("type", "group")
        if wtype not in ("group", "split-column"):
            raise EditError("Can only wrap in a group or split-column widget")
        return doc.wrap_in_group(_path(op.get("path")), wtype)
    raise EditError(f"Unknown operation {kind!r}")


@app.post("/api/apply", dependencies=[Depends(require_auth)])
async def apply(body: dict = Depends(json_body)):
    """Apply edits to the draft text and return the new draft. Nothing is written to disk."""
    text = _text(body)
    doc = _doc(text)
    ops = body.get("ops") or []
    if not ops:
        return _view(doc, text)
    before = _invalid_layouts(doc)
    result = None
    try:
        for op in ops:
            result = _apply_op(doc, op)
    except EditError as exc:
        raise HTTPException(422, str(exc))
    broken = sorted(_invalid_layouts(doc) - before)
    if broken:
        raise HTTPException(422, broken[0])
    new_text = doc.dump()
    # Re-read what we wrote so the tree matches the text exactly.
    out = _view(_doc(new_text), new_text)
    out["result"] = result
    return out


@app.post("/api/node", dependencies=[Depends(require_auth)])
async def node(body: dict = Depends(json_body)):
    doc = _doc(_text(body))
    path = _path(body.get("path"))
    try:
        value = doc.get(path)
        yaml_text = doc.node_yaml(path)
    except EditError as exc:
        raise HTTPException(404, str(exc))
    try:
        data, plain = to_plain(value), True
    except NotPlain:
        data, plain = None, False
    return {"yaml": yaml_text, "data": data, "plain": plain}


def _diff(old: str, new: str, old_name="on disk", new_name="after saving") -> str:
    return "".join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                        fromfile=old_name, tofile=new_name, n=3))


@app.post("/api/preview", dependencies=[Depends(require_auth)])
async def preview(body: dict = Depends(json_body)):
    text = _text(body)
    current = store.load()
    errors, warnings = check(text, store.main_path())
    return {
        "diff": _diff(current.text, text), "unchanged": current.text == text,
        "conflict": body.get("base_sha") is not None and body.get("base_sha") != current.sha,
        "errors": errors, "warnings": warnings,
    }


@app.post("/api/save", dependencies=[Depends(require_auth)])
async def save(body: dict = Depends(json_body)):
    text = _text(body)
    errors, _ = check(text, store.main_path())
    if errors:
        raise HTTPException(422, "Not saved. " + " · ".join(errors[:5]))
    try:
        result = store.write(text, body.get("base_sha"), force=bool(body.get("force")))
    except store.Conflict as exc:
        raise HTTPException(409, str(exc))
    except OSError as exc:
        raise HTTPException(500, f"Could not write {store.main_path()}: {exc}")
    return result


# ---------------------------------------------------------------- markets symbol suggestions

@app.get("/api/symbols", dependencies=[Depends(require_auth)])
async def symbol_suggestions(q: str = ""):
    try:
        return {"results": await symbols.search(q)}
    except symbols.LookupFailed as exc:
        raise HTTPException(502, str(exc))


# ---------------------------------------------------------------- included files

@app.get("/api/file", dependencies=[Depends(require_auth)])
async def included_file(path: str):
    allowed = {f["path"] for f in list_includes(store.main_path())}
    if path not in allowed:
        raise HTTPException(404, "Not a file included by glance.yml")
    try:
        return {"path": path, "text": Path(path).read_text(encoding="utf-8-sig")}
    except OSError as exc:
        raise HTTPException(404, str(exc))


# ---------------------------------------------------------------- backups

@app.get("/api/backups", dependencies=[Depends(require_auth)])
async def backups():
    return {"backups": store.list_backups(), "keep": settings.backups}


@app.get("/api/backups/{name}", dependencies=[Depends(require_auth)])
async def backup(name: str):
    try:
        text = store.read_backup(name)
    except FileNotFoundError:
        raise HTTPException(404, "No such backup")
    return {"name": name, "text": text, "diff": _diff(store.load().text, text, "current", name)}


@app.post("/api/backups/{name}/restore", dependencies=[Depends(require_auth)])
async def restore(name: str, _: dict = Depends(json_body)):
    try:
        return store.restore_backup(name)
    except FileNotFoundError:
        raise HTTPException(404, "No such backup")
