"""Icon search: the libraries' index formats, Glance's image addresses, ranking, and the cache."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app import icons
from app.main import app


def search(q):
    return asyncio.run(icons.search(q))

SAMPLE = {
    "sh": [{"Name": "Jellyfin", "Reference": "jellyfin", "SVG": "Yes", "PNG": "Yes", "WebP": "Yes"},
           {"Name": "Pi-hole", "Reference": "pi-hole", "SVG": "Yes", "PNG": "Yes", "WebP": "Yes"},
           {"Name": "Paperless AI", "Reference": "paperless-ai", "SVG": "No", "PNG": "Yes", "WebP": "Yes"}],
    "di": {"jellyfin": {"base": "svg", "aliases": []}, "jellyseerr": {"base": "svg", "aliases": ["overseerr fork"]},
           "camera-ui": {"base": "png", "aliases": []}},
    "si": [{"title": "Jellyfin", "slug": "jellyfin", "hex": "00A4DC"}, {"title": "Pi-hole", "slug": "pihole", "hex": "96060C",
            "aliases": {"aka": ["Pi hole"]}}],
    "mdi": [{"name": "camera", "aliases": ["photo"], "tags": []}, {"name": "home-assistant", "aliases": ["hass"], "tags": []}],
}


@pytest.fixture
def loaded(config_dir, monkeypatch):
    calls = []

    def fake_download(prefix):
        calls.append(prefix)
        return icons._parse(prefix, SAMPLE[prefix])

    icons.reset()
    monkeypatch.setattr(icons, "_download", fake_download)
    yield calls
    icons.reset()


@pytest.mark.parametrize("value,url", [
    ("sh:jellyfin", "https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/jellyfin.svg"),
    ("sh:paperless-ai.png", "https://cdn.jsdelivr.net/gh/selfhst/icons@main/png/paperless-ai.png"),
    ("di:camera-ui.png", "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/camera-ui.png"),
    ("si:jellyfin", "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/jellyfin.svg"),
    ("mdi:camera", "https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/camera.svg"),
    ("auto-invert sh:glance-dark", "https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/glance-dark.svg"),
    ("si:x.gif", "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/x.svg"),  # Glance falls back to svg
    ("https://example.com/a.png", "https://example.com/a.png"),
])
def test_icon_url_like_glance(value, url):
    assert icons.icon_url(value) == url


def test_search_ranking_and_png_suffix(loaded):
    found = [r["icon"] for r in search("jellyfin")]
    assert found[:3] == ["sh:jellyfin", "di:jellyfin", "si:jellyfin"]  # exact names first, app logos before brand marks
    assert "di:jellyseerr" not in found
    assert [r["icon"] for r in search("pihole")][:2] == ["sh:pi-hole", "si:pihole"]  # dashes don't matter
    assert [r["icon"] for r in search("paperless")] == ["sh:paperless-ai.png"]  # only a PNG: Glance needs .png
    assert [r["icon"] for r in search("hass")] == ["mdi:home-assistant"]  # aliases count
    assert search("j") == []
    r = (search("camera"))[0]
    assert r == {"icon": "mdi:camera", "label": "camera", "source": "Material Design",
                 "url": "https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/camera.svg", "invert": True}


def test_lists_are_cached_on_disk(loaded, config_dir):
    search("jellyfin")
    assert sorted(loaded) == ["di", "mdi", "sh", "si"]
    cache = config_dir.parent / "data" / "icon-index.json"
    assert len(json.loads(cache.read_text())["entries"]) == 10
    icons.reset()  # a restart: the file is used, nothing is downloaded
    loaded.clear()
    assert [r["icon"] for r in search("jellyfin")][0] == "sh:jellyfin"
    assert loaded == []


def test_one_library_down(config_dir, monkeypatch):
    def flaky(prefix):
        if prefix == "mdi":
            raise OSError("down")
        return icons._parse(prefix, SAMPLE[prefix])

    icons.reset()
    monkeypatch.setattr(icons, "_download", flaky)
    assert [r["icon"] for r in search("jellyfin")][0] == "sh:jellyfin"  # the others still work
    assert not (config_dir.parent / "data" / "icon-index.json").exists()  # a partial list isn't kept for a week
    icons.reset()


def test_api(loaded, config_dir):
    c = TestClient(app)
    assert c.get("/api/icons", params={"q": "jellyfin"}).status_code == 401
    c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    assert c.get("/api/icons", params={"q": "jellyfin"}).json()["results"][0]["icon"] == "sh:jellyfin"


def test_api_offline(config_dir, monkeypatch):
    icons.reset()
    monkeypatch.setattr(icons, "_download", lambda prefix: (_ for _ in ()).throw(OSError("offline")))
    c = TestClient(app)
    c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    r = c.get("/api/icons", params={"q": "jellyfin"})
    assert r.status_code == 502 and "no internet access" in r.json()["detail"]
    icons.reset()
