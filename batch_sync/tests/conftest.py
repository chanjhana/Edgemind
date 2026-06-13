"""
conftest.py — batch_sync test configuration.

Ensures that when pytest collects batch_sync/tests together with other
service test suites, the `main` module always resolves to batch_sync/main.py
and not to any other service's main.py that was imported first.
"""
import importlib
import sys
from pathlib import Path

# The batch_sync/ directory must be first on sys.path so `import main`
# resolves to batch_sync/main.py even when running with other suites.
_BATCH_SYNC_DIR = str(Path(__file__).parent.parent)
_REPO_DIR = str(Path(__file__).parent.parent.parent)

# Insert at position 0 to beat any other service directories already on path.
if _BATCH_SYNC_DIR not in sys.path:
    sys.path.insert(0, _BATCH_SYNC_DIR)
if _REPO_DIR not in sys.path:
    sys.path.insert(1, _REPO_DIR)

# Force a fresh import of batch_sync's main module,
# unloading any previously cached 'main' from another service.
if "main" in sys.modules:
    mod = sys.modules["main"]
    # Only evict if it's not already batch_sync's main.
    if not hasattr(mod, "ExportState"):
        del sys.modules["main"]
        importlib.import_module("main")
