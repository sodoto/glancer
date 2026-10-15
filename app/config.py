"""Settings from environment variables, plus the small JSON file that holds the login."""
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"
VERSION = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "dev"


def _int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default


@dataclass
class Settings:
    config_dir: Path = field(default_factory=lambda: Path(os.environ.get("GLANCE_CONFIG_DIR", "/glance-config")))
    config_file: str = field(default_factory=lambda: os.environ.get("GLANCE_CONFIG_FILE", "glance.yml"))
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("DATA_DIR", "/data")))
    backups: int = field(default_factory=lambda: _int("GLANCER_BACKUPS", 30))
    glance_url: str = field(default_factory=lambda: os.environ.get("GLANCE_URL", ""))


settings = Settings()


def account_file() -> Path:
    return settings.data_dir / "glancer.json"


def load_account() -> dict:
    """{"username", "password_hash"}; environment variables win over the file."""
    data = {}
    try:
        data = json.loads(account_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if os.environ.get("GLANCER_USERNAME"):
        data["username"] = os.environ["GLANCER_USERNAME"]
    return data


def save_account(data: dict) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    tmp = account_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, account_file())
