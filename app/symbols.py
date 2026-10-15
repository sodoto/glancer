"""Symbol suggestions for the markets widget, from Yahoo Finance's search (the source Glance uses for prices)."""
import asyncio
import json
import time
import urllib.parse
import urllib.request

from .config import VERSION

SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
# Yahoo answers 429 to Python's default User-Agent (and to some fake browser ones); a named one works.
USER_AGENT = f"Glancer/{VERSION} (+https://github.com/sodoto/glancer)"
CACHE_SECONDS = 3600
_cache: dict[str, tuple[float, list]] = {}


class LookupFailed(Exception):
    pass


def _fetch(query: str) -> list[dict]:
    params = urllib.parse.urlencode({"q": query, "quotesCount": 8, "newsCount": 0, "listsCount": 0})
    req = urllib.request.Request(f"{SEARCH_URL}?{params}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read())
    except Exception as exc:  # network, HTTP or JSON error: suggestions are optional
        raise LookupFailed(f"Yahoo Finance did not answer ({exc.__class__.__name__})") from None
    out = []
    for q in data.get("quotes") or []:
        if not isinstance(q, dict) or not q.get("symbol"):
            continue
        out.append({
            "symbol": str(q["symbol"]),
            "name": str(q.get("longname") or q.get("shortname") or "").strip(),
            "type": str(q.get("typeDisp") or q.get("quoteType") or ""),
            "exchange": str(q.get("exchDisp") or q.get("exchange") or ""),
        })
    return out


async def search(query: str) -> list[dict]:
    query = query.strip()[:60]
    if len(query) < 1:
        return []
    key = query.lower()
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    results = await asyncio.to_thread(_fetch, query)
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.time(), results)
    return results
