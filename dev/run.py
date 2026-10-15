"""Run Glancer locally against the sample config in dev/ (python dev/run.py)."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
os.environ.setdefault("GLANCE_CONFIG_DIR", str(root / "glance-config"))
os.environ.setdefault("DATA_DIR", str(root / "data"))
sys.path.insert(0, str(root.parent))

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", 8765)))
