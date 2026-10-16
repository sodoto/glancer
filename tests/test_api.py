"""The web API end to end: first login, editing a draft, previewing, saving with backups, restoring."""
import pytest
from fastapi.testclient import TestClient

from app import store
from app.main import app

GLANCE = """\
# my dashboard
pages:
  - name: Home
    columns:
      - size: full
        widgets:
          - type: clock   # the clock
            hour-format: 24h
"""


@pytest.fixture
def client(config_dir):
    (config_dir / "glance.yml").write_bytes(GLANCE.encode())
    c = TestClient(app)
    r = c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    assert r.status_code == 200
    return c


def test_everything_needs_a_login(config_dir):
    c = TestClient(app)
    assert c.get("/api/config").status_code == 401
    assert c.get("/", follow_redirects=False).status_code == 303
    assert c.get("/api/auth-state").json()["setup_needed"] is True


def test_setup_only_once_and_login(client):
    assert client.post("/api/setup", json={"username": "x", "password": "12345678"}).status_code == 409
    fresh = TestClient(app)
    assert fresh.post("/api/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    assert fresh.post("/api/login", json={"username": "admin", "password": "correct horse"}).status_code == 200
    assert fresh.get("/api/config").status_code == 200
    # the password is stored hashed
    assert "correct horse" not in (store.settings.data_dir / "glancer.json").read_text()


def test_env_password_survives_restart(config_dir, monkeypatch):
    from app import auth
    monkeypatch.setenv("GLANCER_USERNAME", "admin")
    monkeypatch.setenv("GLANCER_PASSWORD", "from-the-env")
    monkeypatch.setattr(auth, "_env_hash", None)
    monkeypatch.setattr(auth, "_env_source", None)
    c = TestClient(app)
    assert c.get("/api/auth-state").json()["setup_needed"] is False
    assert c.post("/api/login", json={"username": "admin", "password": "from-the-env"}).status_code == 200
    monkeypatch.setattr(auth, "_env_hash", None)  # what a restart does
    monkeypatch.setattr(auth, "_env_source", None)
    assert c.get("/api/config").status_code == 200  # still signed in


def test_glance_url_setting(client):
    assert client.get("/api/config").json()["glance_url"] == ""
    assert client.post("/api/glance-url", json={"url": "192.168.1.5:8080"}).status_code == 422
    assert client.post("/api/glance-url", json={"url": "http://192.168.1.5:8080/"}).json() == {"glance_url": "http://192.168.1.5:8080"}
    cfg = client.get("/api/config").json()
    assert cfg["glance_url"] == "http://192.168.1.5:8080" and cfg["glance_url_from_env"] is False
    # the login in the same file is untouched
    fresh = TestClient(app)
    assert fresh.post("/api/login", json={"username": "admin", "password": "correct horse"}).status_code == 200
    assert client.post("/api/glance-url", json={"url": ""}).json() == {"glance_url": ""}


def test_post_requires_json(client):
    assert client.post("/api/apply", data={"text": "x"}).status_code == 415


def test_edit_preview_save_and_restore(client, config_dir):
    cfg = client.get("/api/config").json()
    assert cfg["text"] == GLANCE and cfg["reformats"] == 0
    widget = ["pages", 0, "columns", 0, "widgets", 0]
    assert cfg["tree"]["pages"][0]["columns"][0]["widgets"][0]["path"] == widget

    # add a small column: [full, small] is allowed
    r = client.post("/api/apply", json={"text": cfg["text"], "ops": [
        {"op": "insert", "path": ["pages", 0, "columns"], "index": None, "value": {"size": "small", "widgets": []}},
        {"op": "set_fields", "path": widget, "set": {"hour-format": "12h"}, "unset": []},
    ]})
    assert r.status_code == 200, r.text
    draft = r.json()["text"]
    assert "hour-format: 12h" in draft and "# the clock" in draft and "# my dashboard" in draft
    assert (config_dir / "glance.yml").read_text() == GLANCE  # nothing written yet

    # a third small column would break Glance's rules: refused
    r = client.post("/api/apply", json={"text": draft, "ops": [
        {"op": "insert", "path": ["pages", 0, "columns"], "index": 0, "value": {"size": "small"}},
        {"op": "insert", "path": ["pages", 0, "columns"], "index": 0, "value": {"size": "small"}}]})
    assert r.status_code == 422 and "at most 3 columns" in r.json()["detail"]

    pv = client.post("/api/preview", json={"text": draft, "base_sha": cfg["sha"]}).json()
    assert pv["errors"] == [] and not pv["conflict"]
    assert "-            hour-format: 24h" in pv["diff"] and "+            hour-format: 12h" in pv["diff"]

    saved = client.post("/api/save", json={"text": draft, "base_sha": cfg["sha"]})
    assert saved.status_code == 200, saved.text
    assert (config_dir / "glance.yml").read_text() == draft
    backups = client.get("/api/backups").json()["backups"]
    assert len(backups) == 1 and backups[0]["name"] == saved.json()["backup"]

    # saving again with the old sha is a conflict (the file changed since)
    r = client.post("/api/save", json={"text": draft, "base_sha": cfg["sha"]})
    assert r.status_code == 409

    # restore the backup: the file is back, and the version we replaced is itself backed up
    r = client.post(f"/api/backups/{backups[0]['name']}/restore", json={})
    assert r.status_code == 200
    assert (config_dir / "glance.yml").read_text() == GLANCE
    assert len(client.get("/api/backups").json()["backups"]) == 2


def test_wrap_in_group_and_move_into_it(client):
    text = client.get("/api/config").json()["text"]
    w = ["pages", 0, "columns", 0, "widgets"]
    text = client.post("/api/apply", json={"text": text, "ops": [
        {"op": "insert", "path": w, "index": None, "value": {"type": "calendar"}}]}).json()["text"]
    r = client.post("/api/apply", json={"text": text, "ops": [
        {"op": "wrap_group", "path": w + [0]},
        {"op": "move", "path": w + [1], "to": w + [0, "widgets"], "index": None}]})
    assert r.status_code == 200, r.text
    group = r.json()["tree"]["pages"][0]["columns"][0]["widgets"][0]
    assert group["type"] == "group" and [c["type"] for c in group["children"]] == ["clock", "calendar"]
    assert "# the clock" in r.json()["text"]
    bad = client.post("/api/apply", json={"text": text, "ops": [{"op": "wrap_group", "path": w + [0], "type": "rss"}]})
    assert bad.status_code == 422


def test_invalid_config_is_not_saved(client, config_dir):
    cfg = client.get("/api/config").json()
    bad = GLANCE.replace("size: full", "size: small")
    r = client.post("/api/save", json={"text": bad, "base_sha": cfg["sha"]})
    assert r.status_code == 422 and "full columns" in r.json()["detail"]
    assert (config_dir / "glance.yml").read_text() == GLANCE
    r = client.post("/api/save", json={"text": "pages: [", "base_sha": cfg["sha"]})
    assert r.status_code == 422
    assert client.get("/api/backups").json()["backups"] == []


def test_backups_are_pruned(client, config_dir):
    sha = client.get("/api/config").json()["sha"]
    for n in range(5):
        text = GLANCE.replace("24h", "12h") if n % 2 == 0 else GLANCE
        sha = client.post("/api/save", json={"text": text, "base_sha": sha}).json()["sha"]
    assert len(client.get("/api/backups").json()["backups"]) == 3  # settings.backups in the test fixture


def test_crlf_and_bom_are_kept(client, config_dir):
    raw = b"\xef\xbb\xbf" + GLANCE.replace("\n", "\r\n").encode()
    (config_dir / "glance.yml").write_bytes(raw)
    cfg = client.get("/api/config").json()
    assert cfg["text"] == GLANCE
    draft = cfg["text"].replace("24h", "12h")
    assert client.post("/api/save", json={"text": draft, "base_sha": cfg["sha"]}).status_code == 200
    assert (config_dir / "glance.yml").read_bytes() == b"\xef\xbb\xbf" + draft.replace("\n", "\r\n").encode()


def test_included_files_are_readable_but_nothing_else(client, config_dir):
    (config_dir / "rss.yml").write_text("- type: rss\n  feeds:\n    - url: https://example.com/rss\n")
    (config_dir / "glance.yml").write_text(GLANCE + "          - $include: rss.yml\n")
    files = client.get("/api/config").json()["files"]
    assert [f["name"] for f in files] == ["rss.yml"]
    assert "type: rss" in client.get("/api/file", params={"path": files[0]["path"]}).json()["text"]
    other = config_dir.parent / "data" / "glancer.json"
    assert client.get("/api/file", params={"path": str(other)}).status_code == 404


def test_node_yaml_and_plain_data(client):
    text = client.get("/api/config").json()["text"]
    r = client.post("/api/node", json={"text": text, "path": ["pages", 0, "columns", 0, "widgets", 0]}).json()
    assert r["yaml"] == "type: clock   # the clock\nhour-format: 24h\n"
    assert r["data"] == {"type": "clock", "hour-format": "24h"} and r["plain"] is True


def test_starter_config(config_dir):
    c = TestClient(app)
    c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    assert c.get("/api/config").json()["exists"] is False
    assert c.post("/api/create-starter", json={}).status_code == 200
    cfg = c.get("/api/config").json()
    assert cfg["exists"] and cfg["tree"]["pages"][0]["name"] == "Home"
    assert c.post("/api/preview", json={"text": cfg["text"]}).json()["errors"] == []
    assert c.post("/api/create-starter", json={}).status_code == 409
