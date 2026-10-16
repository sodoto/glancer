"""A stand-in for Nginx Proxy Manager's API, strict like its JSON schema (backend/schema in NPM's repo).

Used by the tests, and runnable for trying the "Add app" wizard without a real NPM:
    python tests/fake_npm.py 18181          (login: admin@example.com / changeme)
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

EMAIL, PASSWORD, TOKEN = "admin@example.com", "changeme", "fake-token"
ALLOWED = {"domain_names", "forward_scheme", "forward_host", "forward_port", "certificate_id", "ssl_forced",
           "hsts_enabled", "hsts_subdomains", "trust_forwarded_proto", "http2_support", "block_exploits",
           "caching_enabled", "allow_websocket_upgrade", "access_list_id", "advanced_config", "enabled", "meta",
           "locations"}


class State:
    def __init__(self):
        self.certificates = [
            {"id": 1, "nice_name": "Wildcard", "domain_names": ["*.home.example.com", "home.example.com"],
             "provider": "letsencrypt", "expires_on": "2027-01-01 00:00:00"},
            {"id": 2, "nice_name": "Old one", "domain_names": ["old.example.org"], "provider": "letsencrypt",
             "expires_on": "2026-12-01 00:00:00"},
        ]
        self.hosts = [{"id": 1, "domain_names": ["jellyfin.home.example.com"], "forward_scheme": "http",
                       "forward_host": "192.168.1.30", "forward_port": 8096}]
        self.created = []
        self.two_factor = False


def make_handler(state: State):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, payload):
            raw = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def error(self, code, message):
            self.send(code, {"error": {"code": code, "message": message}})

        def authed(self):
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                self.error(401, "Token has expired")
                return False
            return True

        def body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"null")

        def do_GET(self):
            if self.path == "/api/":
                return self.send(200, {"status": "OK", "setup": True, "version": {"major": 2, "minor": 12, "revision": 6}})
            if not self.authed():
                return
            if self.path.startswith("/api/nginx/certificates"):
                return self.send(200, state.certificates)
            if self.path.startswith("/api/nginx/proxy-hosts"):
                return self.send(200, state.hosts)
            self.error(404, "Not Found")

        def do_POST(self):
            if self.path == "/api/tokens":
                b = self.body()
                if b.get("identity") != EMAIL or b.get("secret") != PASSWORD:
                    return self.error(400, "Invalid email or password")
                if state.two_factor:
                    return self.send(200, {"requires_2fa": True, "challenge_token": "x"})
                return self.send(200, {"token": TOKEN, "expires": "2099-01-01T00:00:00Z"})
            if not self.authed():
                return
            if self.path == "/api/nginx/proxy-hosts":
                b = self.body()
                extra = set(b) - ALLOWED
                if extra:
                    return self.error(400, f"data must NOT have additional properties ({sorted(extra)})")
                for key in ("domain_names", "forward_scheme", "forward_host", "forward_port"):
                    if key not in b:
                        return self.error(400, f"data must have required property '{key}'")
                if not isinstance(b["forward_port"], int) or not isinstance(b["domain_names"], list):
                    return self.error(400, "data/forward_port must be integer")
                if any(d in h["domain_names"] for h in state.hosts for d in b["domain_names"]):
                    return self.error(400, f"{b['domain_names'][0]} is already in use")
                host = {"id": len(state.hosts) + 1, **b}
                state.hosts.append(host)
                state.created.append(b)
                return self.send(201, host)
            self.error(404, "Not Found")

    return Handler


def start(port: int = 0):
    """Start in a background thread. Returns (server, state); server.server_port is the port."""
    state = State()
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(state))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, state


if __name__ == "__main__":
    srv, _ = start(int(sys.argv[1]) if len(sys.argv) > 1 else 18181)
    print(f"Fake NPM on http://127.0.0.1:{srv.server_port}  (admin@example.com / changeme)")
    threading.Event().wait()
