"""Nginx Proxy Manager: create proxy hosts through NPM's own API (the one its web page uses).

Endpoints and fields from NPM's backend/schema: POST /api/tokens (login), GET /api/nginx/certificates,
GET/POST /api/nginx/proxy-hosts. Glancer only reads certificates and proxy hosts and creates new hosts;
it never changes or deletes existing ones.
"""
import asyncio
import json
import time
import urllib.error
import urllib.request

from .config import VERSION

TIMEOUT = 10


class NPMError(Exception):
    pass


class NPM:
    def __init__(self, url: str, email: str, password: str):
        self.url = url.rstrip("/")
        self.email = email
        self.password = password
        self._token: str | None = None
        self._token_until = 0.0

    # ------------------------------------------------------------ HTTP

    def _call(self, method: str, path: str, body=None, auth: bool = True):
        headers = {"Accept": "application/json", "User-Agent": f"Glancer/{VERSION}"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = f"Bearer {self._login()}"
        req = urllib.request.Request(f"{self.url}/api{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            raise NPMError(_error_message(exc)) from None
        except (urllib.error.URLError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise NPMError(f"Cannot reach Nginx Proxy Manager at {self.url} ({reason}). "
                           "Check the address, e.g. http://192.168.1.20:81") from None
        try:
            return json.loads(raw) if raw else None
        except ValueError:
            raise NPMError(f"{self.url} answered, but not like Nginx Proxy Manager's API. Is it the address of NPM's admin page (usually port 81)?") from None

    def _login(self) -> str:
        if self._token and time.time() < self._token_until:
            return self._token
        res = self._call("POST", "/tokens", {"identity": self.email, "secret": self.password}, auth=False)
        if isinstance(res, dict) and res.get("requires_2fa"):
            raise NPMError("This NPM user has two-factor login turned on. Create a separate NPM user for Glancer "
                           "without it (see the help text).")
        if not isinstance(res, dict) or not res.get("token"):
            raise NPMError("Nginx Proxy Manager did not return a login token.")
        self._token = res["token"]
        self._token_until = time.time() + 30 * 60  # NPM tokens last longer; refresh well before
        return self._token

    # ------------------------------------------------------------ what Glancer uses

    def status(self) -> dict:
        """Log in, then return {version, wildcard certificates, proxy host count}."""
        info = self._call("GET", "/", auth=False) or {}
        self._login()
        certs = self.certificates()
        hosts = self.proxy_hosts()
        v = info.get("version") or {}
        version = ".".join(str(v.get(k, "")) for k in ("major", "minor", "revision")).strip(".") if isinstance(v, dict) else str(v)
        return {"version": version, "certificates": certs, "proxy_hosts": len(hosts)}

    def certificates(self) -> list[dict]:
        rows = self._call("GET", "/nginx/certificates") or []
        out = []
        for c in rows:
            if not isinstance(c, dict):
                continue
            names = [str(n) for n in c.get("domain_names") or []]
            out.append({
                "id": c.get("id"), "name": c.get("nice_name") or ", ".join(names), "domains": names,
                "expires": c.get("expires_on"),
                # "*.home.example.com" -> "home.example.com": apps get <name>.home.example.com
                "wildcard_for": [n[2:] for n in names if n.startswith("*.")],
            })
        return out

    def proxy_hosts(self) -> list[dict]:
        rows = self._call("GET", "/nginx/proxy-hosts") or []
        return [{"id": h.get("id"), "domains": [str(n) for n in h.get("domain_names") or []],
                 "forward": f"{h.get('forward_scheme')}://{h.get('forward_host')}:{h.get('forward_port')}"}
                for h in rows if isinstance(h, dict)]

    def create_proxy_host(self, domain: str, scheme: str, host: str, port: int, certificate_id: int | None,
                          force_ssl: bool, websockets: bool, block_exploits: bool, http2: bool) -> dict:
        taken = [h for h in self.proxy_hosts() if domain.lower() in (d.lower() for d in h["domains"])]
        if taken:
            raise NPMError(f"{domain} already exists in Nginx Proxy Manager (it forwards to {taken[0]['forward']}).")
        # Only fields every NPM 2.x accepts (its schema rejects unknown ones).
        body = {
            "domain_names": [domain], "forward_scheme": scheme, "forward_host": host, "forward_port": int(port),
            "access_list_id": 0, "certificate_id": int(certificate_id) if certificate_id else 0,
            "ssl_forced": bool(force_ssl and certificate_id), "http2_support": bool(http2 and certificate_id),
            "hsts_enabled": False, "hsts_subdomains": False, "caching_enabled": False,
            "block_exploits": bool(block_exploits), "allow_websocket_upgrade": bool(websockets),
            "advanced_config": "", "locations": [], "meta": {"letsencrypt_agree": False, "dns_challenge": False},
        }
        res = self._call("POST", "/nginx/proxy-hosts", body) or {}
        return {"id": res.get("id"), "domains": res.get("domain_names") or [domain]}


def _error_message(exc: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(exc.read())
        message = (payload.get("error") or {}).get("message") if isinstance(payload, dict) else None
    except Exception:
        message = None
    if message and "email or password" in message.lower():
        return "Nginx Proxy Manager refused the login: wrong email or password."
    if exc.code == 403:
        return ("Nginx Proxy Manager says this user may not do that. Give the Glancer user "
                "'Manage' permission for Proxy Hosts and 'View' for Certificates.")
    return f"Nginx Proxy Manager: {message or exc.reason} (HTTP {exc.code})"


async def run(fn, *args, **kwargs):
    """NPM calls block on the network: run them off the event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)
