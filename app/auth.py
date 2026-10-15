"""Login: hashed password, signed session cookies and login throttling (same scheme as Update Manager)."""
import base64
import hashlib
import hmac
import os
import secrets
import time

from .config import load_account, settings

COOKIE = "glancer_session"
SESSION_DAYS = 30
HASH_PREFIX = "scrypt$"
MIN_PASSWORD = 8

MAX_FAILURES = 5  # wrong passwords allowed per address...
LOCKOUT_SECONDS = 60  # ...before it has to wait this long
_failures: dict[str, list[float]] = {}


# ------------------------------------------------------------------ passwords

def is_hashed(value: str | None) -> bool:
    return bool(value) and value.startswith(HASH_PREFIX)


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return f"{HASH_PREFIX}{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not is_hashed(stored):
        return False
    try:
        _, salt, digest = stored.split("$")
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1)
    except ValueError:
        return False
    return hmac.compare_digest(candidate.hex(), digest)


# ------------------------------------------------------------------ the account

_env_hash: str | None = None
_env_source: bytes | None = None  # sha256 of the GLANCER_PASSWORD value _env_hash was made from


def credentials() -> tuple[str | None, str | None]:
    """(username, password hash). GLANCER_PASSWORD (plain or scrypt$ hash) overrides the saved login."""
    global _env_hash, _env_source
    env = os.environ.get("GLANCER_PASSWORD")
    account = load_account()
    if env:
        if is_hashed(env):
            _env_hash = env
        elif _env_source != hashlib.sha256(env.encode()).digest():
            # Hashed once (scrypt is deliberately slow), kept only in memory. The salt is fixed per
            # installation, so the hash (which signs the session cookies) survives restarts.
            salt = hmac.new(_secret(), b"GLANCER_PASSWORD salt", hashlib.sha256).digest()[:16]
            _env_hash = hash_password(env, salt)
            _env_source = hashlib.sha256(env.encode()).digest()
        return account.get("username") or "admin", _env_hash
    return account.get("username"), account.get("password_hash")


def password_from_env() -> bool:
    return bool(os.environ.get("GLANCER_PASSWORD"))


def setup_needed() -> bool:
    username, password_hash = credentials()
    return not (username and password_hash)


# ------------------------------------------------------------------ sessions

def _secret() -> bytes:
    path = settings.data_dir / "session.key"
    if not path.exists():
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        path.write_bytes(secrets.token_bytes(32))
        os.chmod(path, 0o600)
    return path.read_bytes()


def _sign(username: str, expires: int, password_hash: str) -> str:
    # The password hash is part of the signature: changing the password signs everyone out.
    msg = f"{username}\n{expires}\n{password_hash}".encode()
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()


def make_session(username: str, password_hash: str) -> str:
    expires = int(time.time()) + SESSION_DAYS * 86400
    user = base64.urlsafe_b64encode(username.encode()).decode()
    return f"{user}.{expires}.{_sign(username, expires, password_hash)}"


def valid_session(token: str | None, username: str | None, password_hash: str | None) -> bool:
    if not token or not username or not password_hash:
        return False
    try:
        user, expires, sig = token.split(".")
        name = base64.urlsafe_b64decode(user.encode()).decode()
        expires_at = int(expires)
    except ValueError:
        return False
    return (name == username and expires_at > time.time()
            and hmac.compare_digest(sig, _sign(name, expires_at, password_hash)))


# ------------------------------------------------------------------ throttling

def retry_after(client: str) -> int:
    """Seconds this address must wait before trying again (0 = may try now)."""
    now = time.time()
    recent = [t for t in _failures.get(client, []) if now - t < LOCKOUT_SECONDS]
    _failures[client] = recent
    return int(LOCKOUT_SECONDS - (now - recent[0])) + 1 if len(recent) >= MAX_FAILURES else 0


def record_failure(client: str) -> None:
    _failures.setdefault(client, []).append(time.time())


def clear_failures(client: str) -> None:
    _failures.pop(client, None)
