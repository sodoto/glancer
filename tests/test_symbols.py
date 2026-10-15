"""Markets symbol suggestions: Yahoo's answer is trimmed to what the form needs; failures are reported, not fatal."""
import io
import json

import pytest
from fastapi.testclient import TestClient

from app import symbols
from app.main import app

YAHOO = {"quotes": [
    {"symbol": "ETH-USD", "shortname": "Ethereum USD", "longname": "Ethereum USD", "typeDisp": "Cryptocurrency", "exchDisp": "CCC"},
    {"symbol": "ETHA", "shortname": "iShares Ethereum Trust ETF", "quoteType": "ETF", "exchange": "NGM"},
    {"shortname": "no symbol, skipped"},
]}


@pytest.fixture
def client(config_dir, monkeypatch):
    symbols._cache.clear()
    c = TestClient(app)
    c.post("/api/setup", json={"username": "admin", "password": "correct horse"})
    return c


def test_suggestions(client, monkeypatch):
    calls = []

    def fake_urlopen(req, timeout):
        calls.append(req)
        return io.BytesIO(json.dumps(YAHOO).encode())

    monkeypatch.setattr(symbols.urllib.request, "urlopen", fake_urlopen)
    r = client.get("/api/symbols", params={"q": "ethereum"})
    assert r.status_code == 200
    assert r.json()["results"] == [
        {"symbol": "ETH-USD", "name": "Ethereum USD", "type": "Cryptocurrency", "exchange": "CCC"},
        {"symbol": "ETHA", "name": "iShares Ethereum Trust ETF", "type": "ETF", "exchange": "NGM"},
    ]
    assert "q=ethereum" in calls[0].full_url and calls[0].get_header("User-agent").startswith("Glancer/")
    client.get("/api/symbols", params={"q": "Ethereum"})
    assert len(calls) == 1  # cached


def test_lookup_failure_is_a_502(client, monkeypatch):
    def broken(req, timeout):
        raise OSError("network down")

    monkeypatch.setattr(symbols.urllib.request, "urlopen", broken)
    r = client.get("/api/symbols", params={"q": "apple"})
    assert r.status_code == 502 and "Yahoo Finance did not answer" in r.json()["detail"]


def test_needs_login(config_dir):
    assert TestClient(app).get("/api/symbols", params={"q": "apple"}).status_code == 401
