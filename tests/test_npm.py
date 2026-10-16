"""The Nginx Proxy Manager connection, against a fake NPM that is as strict as NPM's schema."""
import pytest
from fastapi.testclient import TestClient

from app import npm
from app.main import app
from tests import fake_npm


@pytest.fixture
def fake():
    server, state = fake_npm.start()
    yield f"http://127.0.0.1:{server.server_port}", state
    server.shutdown()


@pytest.fixture
def client(config_dir):
    c = TestClient(app)
    c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    return c


def connect(client, url, password=fake_npm.PASSWORD):
    return client.post("/api/npm", json={"url": url, "email": fake_npm.EMAIL, "password": password}).json()


def test_connect_and_status(client, fake):
    url, _ = fake
    res = connect(client, url + "/")
    assert res["ok"] and res["status"]["version"] == "2.12.6" and res["status"]["proxy_hosts"] == 1
    wildcard = [c for c in res["status"]["certificates"] if c["wildcard_for"]]
    assert wildcard == [{"id": 1, "name": "Wildcard", "domains": ["*.home.example.com", "home.example.com"],
                         "expires": "2027-01-01 00:00:00", "wildcard_for": ["home.example.com"]}]
    saved = client.get("/api/npm").json()
    assert saved == {"url": url, "email": fake_npm.EMAIL, "password": "********", "from_env": False}
    # saving again with the mask keeps the stored password
    assert client.post("/api/npm", json={"url": url, "email": fake_npm.EMAIL, "password": "********"}).json()["ok"]


def test_wrong_password_and_2fa(client, fake):
    url, state = fake
    res = connect(client, url, password="nope")
    assert not res["ok"] and "wrong email or password" in res["error"]
    state.two_factor = True
    res = connect(client, url)
    assert not res["ok"] and "two-factor" in res["error"]


def test_unreachable(client):
    res = connect(client, "http://127.0.0.1:9")
    assert not res["ok"] and "Cannot reach Nginx Proxy Manager" in res["error"]


def test_create_proxy_host(client, fake):
    url, state = fake
    connect(client, url)
    r = client.post("/api/npm/proxy-hosts", json={"domain": "Immich.home.example.com", "scheme": "http",
                                                   "host": "192.168.1.31", "port": "2283", "certificate_id": 1})
    assert r.status_code == 200, r.text
    assert r.json()["domains"] == ["immich.home.example.com"]
    sent = state.created[-1]
    assert sent["forward_port"] == 2283 and sent["certificate_id"] == 1 and sent["ssl_forced"] is True
    assert sent["allow_websocket_upgrade"] is True and sent["block_exploits"] is True
    # an address that already exists is refused before asking NPM
    r = client.post("/api/npm/proxy-hosts", json={"domain": "jellyfin.home.example.com", "host": "x", "port": 1})
    assert r.status_code == 502 and "already exists" in r.json()["detail"]
    # without a certificate there is no forced https
    client.post("/api/npm/proxy-hosts", json={"domain": "lan.home.example.com", "host": "10.0.0.5", "port": 80})
    assert state.created[-1]["certificate_id"] == 0 and state.created[-1]["ssl_forced"] is False


def test_bad_input(client, fake):
    url, _ = fake
    connect(client, url)
    assert client.post("/api/npm/proxy-hosts", json={"domain": "no spaces.x", "host": "h", "port": 80}).status_code == 422
    assert client.post("/api/npm/proxy-hosts", json={"domain": "a.b.c", "host": "h", "port": "x"}).status_code == 422
    assert client.post("/api/npm/proxy-hosts", json={"domain": "a.b.c", "host": "", "port": 80}).status_code == 422


def test_needs_connection_and_login(config_dir):
    c = TestClient(app)
    assert c.get("/api/npm/status").status_code == 401
    c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    assert c.get("/api/npm/status").status_code == 409


def test_check_target(client, fake):
    url, _ = fake
    port = int(url.rsplit(":", 1)[1])
    assert client.post("/api/check-target", json={"host": "127.0.0.1", "port": port}).json()["ok"] is True
    assert client.post("/api/check-target", json={"host": "127.0.0.1", "port": 9}).json()["ok"] is False


def test_payload_matches_npm_schema(fake):
    # The fake rejects any field NPM's schema doesn't know, like NPM itself does.
    url, state = fake
    created = npm.NPM(url, fake_npm.EMAIL, fake_npm.PASSWORD).create_proxy_host(
        "app.home.example.com", "https", "10.0.0.9", 8443, 1, True, False, True, True)
    assert created["domains"] == ["app.home.example.com"]
    assert set(state.created[-1]) <= fake_npm.ALLOWED
