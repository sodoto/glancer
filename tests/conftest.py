import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    """An empty Glance config folder and data folder, wired into the app's settings."""
    cfg, data = tmp_path / "glance-config", tmp_path / "data"
    cfg.mkdir()
    data.mkdir()
    monkeypatch.setattr(settings, "config_dir", cfg)
    monkeypatch.setattr(settings, "data_dir", data)
    monkeypatch.setattr(settings, "backups", 3)
    monkeypatch.delenv("GLANCER_PASSWORD", raising=False)
    monkeypatch.delenv("GLANCER_USERNAME", raising=False)
    return cfg
