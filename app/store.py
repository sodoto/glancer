"""Reading and writing glance.yml safely: atomic writes, timestamped backups and restore."""
import hashlib
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .config import settings

log = logging.getLogger("glancer")
BACKUP_NAME = re.compile(r"^(?P<stem>.+)\.(?P<ts>\d{8}-\d{6}(?:-\d+)?)\.bak$")


class Conflict(Exception):
    """The file changed on disk since it was loaded."""


@dataclass
class Loaded:
    text: str  # always with \n line endings
    sha: str  # of the raw bytes on disk ("" when the file does not exist)
    crlf: bool
    bom: bool
    exists: bool


def main_path() -> Path:
    return settings.config_dir / settings.config_file


def sha_of(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load(path: Path | None = None) -> Loaded:
    path = path or main_path()
    if not path.is_file():
        return Loaded("", "", False, False, False)
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    crlf = "\r\n" in text
    return Loaded(text.replace("\r\n", "\n"), sha_of(raw), crlf, bom, True)


def _encode(text: str, like: Loaded) -> bytes:
    if like.crlf:
        text = text.replace("\n", "\r\n")
    return (b"\xef\xbb\xbf" if like.bom else b"") + text.encode("utf-8")


def write(text: str, base_sha: str | None, force: bool = False) -> dict:
    """Back up the current file, then replace it atomically. Returns {sha, backup}."""
    path = main_path()
    current = load(path)
    if not force and base_sha is not None and current.sha != base_sha:
        raise Conflict("glance.yml was changed by something else since you opened it.")
    backup = make_backup(path) if current.exists else None
    raw = _encode(text, current)
    _atomic_write(path, raw)
    prune_backups()
    log.info("Saved %s (%d bytes)%s", path, len(raw), f", backup {backup}" if backup else "")
    return {"sha": sha_of(raw), "backup": backup}


def _atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    st = path.stat() if path.exists() else None
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        if st:
            os.chmod(tmp, st.st_mode & 0o7777)
            if hasattr(os, "chown"):
                try:
                    os.chown(tmp, st.st_uid, st.st_gid)
                except PermissionError:
                    pass
        try:
            os.replace(tmp, path)
        except OSError:
            # A single file bind-mounted into the container can't be replaced, only rewritten.
            with open(path, "r+b") as f:
                f.write(raw)
                f.truncate()
                f.flush()
                os.fsync(f.fileno())
            os.unlink(tmp)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---------------------------------------------------------------- backups

def backup_dir() -> Path:
    d = settings.data_dir / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def make_backup(path: Path | None = None) -> str:
    path = path or main_path()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"{path.name}.{stamp}.bak"
    n = 1
    while (backup_dir() / name).exists():
        n += 1
        name = f"{path.name}.{stamp}-{n}.bak"
    shutil.copy2(path, backup_dir() / name)
    return name


def list_backups() -> list[dict]:
    out = []
    for p in backup_dir().iterdir():
        m = BACKUP_NAME.match(p.name)
        if not m or not p.is_file():
            continue
        ts = m.group("ts")
        when = datetime.strptime(ts[:15], "%Y%m%d-%H%M%S")
        out.append({"name": p.name, "time": when.isoformat(), "size": p.stat().st_size, "_key": (ts[:15], len(ts), ts)})
    out.sort(key=lambda b: b["_key"], reverse=True)
    for b in out:
        b.pop("_key")
    return out


def backup_path(name: str) -> Path:
    if not BACKUP_NAME.match(name) or "/" in name or "\\" in name:
        raise FileNotFoundError(name)
    p = backup_dir() / name
    if not p.is_file():
        raise FileNotFoundError(name)
    return p


def read_backup(name: str) -> str:
    return backup_path(name).read_bytes().decode("utf-8-sig").replace("\r\n", "\n")


def restore_backup(name: str) -> dict:
    """Put a backup back. The current file is backed up first, so a restore can be undone too."""
    raw = backup_path(name).read_bytes()
    path = main_path()
    backup = make_backup(path) if path.exists() else None
    _atomic_write(path, raw)
    prune_backups(keep={name})
    log.info("Restored %s from backup %s", path, name)
    return {"sha": sha_of(raw), "backup": backup}


def prune_backups(keep: set | None = None) -> None:
    backups = list_backups()
    for b in backups[max(0, settings.backups):]:
        if keep and b["name"] in keep:
            continue
        try:
            (backup_dir() / b["name"]).unlink()
        except OSError:
            pass
