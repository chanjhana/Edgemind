"""
tests/test_batch_sync.py — unit tests for batch-sync service.

Tests are isolated from Docker / InfluxDB / PVC.  They test:

  Group 1 — ExportState lock semantics (409 conflict behaviour)
  Group 2 — cleanup_scheduled() retention policy
  Group 3 — _df_to_parquet_bytes() round-trip fidelity
  Group 4 — POST /trigger API (FastAPI TestClient, InfluxDB + httpx mocked)
  Group 5 — GET /status and GET /health
  Group 6 — pump_id validation (422 on unknown pump)
  Group 7 — _query_to_df() column cleanup

Run:
    cd <repo-root>
    python -m pytest batch_sync/tests/test_batch_sync.py -v
"""

from __future__ import annotations

import asyncio
import importlib.util as _ilu
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

# ---------------------------------------------------------------------------
# Path setup — run from repo root so `from common.contract import ...` works.
# ---------------------------------------------------------------------------
_REPO = Path(__file__).parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# ---------------------------------------------------------------------------
# Load batch_sync/main.py as a named module ("batch_sync_main") so it never
# collides with any other service's main.py cached in sys.modules["main"].
# This is the robust alternative to `sys.path` manipulation for multi-suite
# test runs where alert_manager (or others) may load their own main.py first.
# ---------------------------------------------------------------------------

def _load_bsm():
    module_name = "batch_sync_main"
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = _ilu.spec_from_file_location(module_name, _REPO / "batch_sync" / "main.py")
    mod = _ilu.module_from_spec(spec)
    sys.modules[module_name] = mod          # register before exec to handle circular refs
    spec.loader.exec_module(mod)
    return mod

_bsm = _load_bsm()

# Bring the tested symbols into local scope.
ExportState        = _bsm.ExportState
_cleanup_scheduled = _bsm._cleanup_scheduled
_df_to_parquet_bytes = _bsm._df_to_parquet_bytes
_query_to_df       = _bsm._query_to_df


# ===========================================================================
# Group 1 — ExportState lock semantics
# ===========================================================================

class TestExportStateLock:
    """ExportState tracks one-at-a-time export via asyncio.Lock."""

    def test_initial_state(self):
        s = ExportState()
        assert s.active is False
        assert s.active_export_id is None
        assert s.scheduled_count == 0
        assert s.fault_count == 0
        assert s.total_bytes_written == 0

    def test_try_acquire_first_time_succeeds(self):
        s = ExportState()
        result = asyncio.run(s.try_acquire("id-001"))
        assert result is True
        assert s.active is True
        assert s.active_export_id == "id-001"

    def test_try_acquire_while_busy_fails(self):
        s = ExportState()
        asyncio.run(s.try_acquire("id-001"))

        result = asyncio.run(s.try_acquire("id-002"))
        assert result is False
        # Original export ID unchanged.
        assert s.active_export_id == "id-001"

    def test_release_clears_lock(self):
        async def _run():
            s = ExportState()
            await s.try_acquire("id-001")
            await s.release("id-001", 1024, Path("/tmp/test.parquet"))
            # Should be acquirable again.
            result = await s.try_acquire("id-002")
            return s, result

        s, result = asyncio.run(_run())
        assert result is True
        assert s.active is True
        assert s.active_export_id == "id-002"

    def test_release_updates_stats(self):
        async def _run():
            s = ExportState()
            await s.try_acquire("id-001")
            await s.release("id-001", 1_048_576, Path("/data/exports/fault/test.parquet"))
            return s

        s = asyncio.run(_run())
        assert s.total_bytes_written == 1_048_576
        assert s.last_export_size_mb == pytest.approx(1.0, abs=0.01)
        # Compare normalised paths (handles Windows backslash vs Linux slash).
        assert Path(s.last_export_file) == Path("/data/exports/fault/test.parquet")
        assert s.last_export_ts is not None

    def test_multiple_acquire_release_cycles(self):
        """Lock can be reused across multiple export cycles."""
        async def _run():
            s = ExportState()
            for i in range(5):
                ok = await s.try_acquire(f"id-{i:03d}")
                assert ok
                await s.release(f"id-{i:03d}", 1000 * (i + 1), Path(f"/tmp/f{i}.parquet"))
            return s

        s = asyncio.run(_run())
        assert s.total_bytes_written == 1000 + 2000 + 3000 + 4000 + 5000


# ===========================================================================
# Group 2 — Cleanup retention policy
# ===========================================================================

class TestCleanupScheduled:
    """_cleanup_scheduled() deletes scheduled exports older than 24 h."""

    def _make_parquet(self, path: Path, age_h: float) -> None:
        """Create a real minimal Parquet file with a given modification time."""
        df = pd.DataFrame({"x": [1, 2, 3]})
        path.write_bytes(_df_to_parquet_bytes(df))
        mtime = (datetime.now(timezone.utc) - timedelta(hours=age_h)).timestamp()
        os.utime(path, (mtime, mtime))

    def test_old_scheduled_file_deleted(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            exports = Path(tmpdir)
            sched = exports / "scheduled"
            sched.mkdir()
            old_file = sched / "2024-01-01_00-00.parquet"
            self._make_parquet(old_file, age_h=25)  # older than 24 h

            _cleanup_scheduled(exports)
            assert not old_file.exists()

    def test_fresh_scheduled_file_kept(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            exports = Path(tmpdir)
            sched = exports / "scheduled"
            sched.mkdir()
            new_file = sched / "2025-06-13_10-00.parquet"
            self._make_parquet(new_file, age_h=1)  # only 1 hour old

            _cleanup_scheduled(exports)
            assert new_file.exists()

    def test_fault_exports_never_deleted(self):
        """Files in the fault/ directory must NOT be touched by cleanup."""
        with tempfile.TemporaryDirectory() as tmpdir:
            exports = Path(tmpdir)
            fault = exports / "fault"
            fault.mkdir()
            old_fault = fault / "2024-01-01_00-00_pump2.parquet"
            self._make_parquet(old_fault, age_h=200)  # very old

            _cleanup_scheduled(exports)  # should not touch fault/
            assert old_fault.exists()

    def test_mixed_files(self):
        """Only old scheduled files are deleted; new and fault survive."""
        with tempfile.TemporaryDirectory() as tmpdir:
            exports = Path(tmpdir)
            sched = exports / "scheduled"
            fault = exports / "fault"
            sched.mkdir()
            fault.mkdir()

            old_sched = sched / "old.parquet"
            new_sched = sched / "new.parquet"
            old_fault = fault / "old_fault.parquet"

            self._make_parquet(old_sched, age_h=30)
            self._make_parquet(new_sched, age_h=2)
            self._make_parquet(old_fault, age_h=100)

            _cleanup_scheduled(exports)

            assert not old_sched.exists()
            assert new_sched.exists()
            assert old_fault.exists()

    def test_missing_scheduled_dir_does_not_crash(self):
        """If scheduled/ doesn't exist yet, cleanup should be a no-op."""
        with tempfile.TemporaryDirectory() as tmpdir:
            exports = Path(tmpdir)  # no scheduled/ subdirectory
            _cleanup_scheduled(exports)  # should not raise


# ===========================================================================
# Group 3 — Parquet round-trip
# ===========================================================================

class TestParquetRoundTrip:
    """_df_to_parquet_bytes() produces valid, re-readable Parquet."""

    def test_basic_round_trip(self):
        original = pd.DataFrame({
            "timestamp": pd.to_datetime(["2025-06-13T08:00:00Z", "2025-06-13T08:00:01Z"]),
            "pump_id": ["pump2", "pump2"],
            "vibration_axial": [0.82, 0.84],
            "temperature": [46.5, 46.7],
            "rpm": [1452.1, 1451.9],
        })
        parquet_bytes = _df_to_parquet_bytes(original)
        assert len(parquet_bytes) > 0

        restored = pd.read_parquet(pd.io.common.BytesIO(parquet_bytes))
        assert list(restored.columns) == list(original.columns)
        assert len(restored) == len(original)
        assert restored["vibration_axial"].tolist() == pytest.approx(
            original["vibration_axial"].tolist(), abs=1e-6
        )

    def test_empty_df_produces_valid_parquet(self):
        empty = pd.DataFrame({"a": pd.Series([], dtype=float), "b": pd.Series([], dtype=str)})
        parquet_bytes = _df_to_parquet_bytes(empty)
        restored = pd.read_parquet(pd.io.common.BytesIO(parquet_bytes))
        assert len(restored) == 0

    def test_large_df_is_snappy_compressed(self):
        """A large numeric DataFrame should compress well with snappy."""
        n = 10_000
        df = pd.DataFrame({
            "timestamp": pd.date_range("2025-01-01", periods=n, freq="1s", tz="UTC"),
            "pump_id": ["pump2"] * n,
            "vibration_axial": [0.82 + 0.001 * i for i in range(n)],
            "temperature": [46.5] * n,
        })
        parquet_bytes = _df_to_parquet_bytes(df)
        raw_bytes = df.to_csv().encode()
        # Compressed Parquet should be smaller than raw CSV.
        assert len(parquet_bytes) < len(raw_bytes)

    def test_mixed_types_preserved(self):
        df = pd.DataFrame({
            "ts": pd.date_range("2025-06-01", periods=3, freq="1s", tz="UTC"),
            "pump_id": ["pump1", "pump2", "pump3"],
            "health": [90.0, 75.0, 50.0],
            "state": ["HEALTHY", "WARNING", "CRITICAL"],
            "cycles": [0, 2, 5],
        })
        parquet_bytes = _df_to_parquet_bytes(df)
        restored = pd.read_parquet(pd.io.common.BytesIO(parquet_bytes))
        assert restored["state"].tolist() == ["HEALTHY", "WARNING", "CRITICAL"]
        assert restored["health"].tolist() == pytest.approx([90.0, 75.0, 50.0])


# ===========================================================================
# Group 4 — POST /trigger API (FastAPI TestClient, mocked InfluxDB + httpx)
# ===========================================================================

class TestTriggerEndpoint:
    """
    Test the /trigger HTTP endpoint using FastAPI TestClient.
    Always uses _bsm (batch_sync_main module) — never `import main as m`.
    """

    def test_trigger_valid_pump_returns_200(self):
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()

        with (
            patch.object(_bsm, "_query_api", new=MagicMock()),
            patch.object(_bsm, "_http_client", new=AsyncMock()),
            patch("asyncio.create_task"),
        ):
            client = TestClient(_bsm.app, raise_server_exceptions=False)
            resp = client.post("/trigger", json={
                "pump_id": "pump2",
                "state": "CRITICAL",
                "overall_health": 42.1,
                "trigger_reason": "bearing_fault_pattern",
                "timestamp": "2025-06-13T08:32:15Z",
            })

        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert "export_id" in body
        assert body["estimated_size_mb"] > 0

    def test_trigger_unknown_pump_returns_422(self):
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()

        with patch("asyncio.create_task"):
            client = TestClient(_bsm.app, raise_server_exceptions=False)
            resp = client.post("/trigger", json={
                "pump_id": "pump99",
                "state": "CRITICAL",
                "trigger_reason": "bearing_fault_pattern",
                "timestamp": "2025-06-13T08:32:15Z",
            })

        assert resp.status_code == 422
        assert resp.json()["ok"] is False

    def test_trigger_while_busy_returns_409(self):
        """Second /trigger while export is active must return 409."""
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()

        with patch("asyncio.create_task"):
            client = TestClient(_bsm.app, raise_server_exceptions=False)

            # Manually mark as busy to simulate in-progress export.
            asyncio.run(_bsm._state.try_acquire("pre-existing-id"))

            resp = client.post("/trigger", json={
                "pump_id": "pump2",
                "state": "WARNING",
                "trigger_reason": "bearing_fault_pattern",
                "timestamp": "2025-06-13T08:32:15Z",
            })

        assert resp.status_code == 409
        body = resp.json()
        assert body["ok"] is False
        assert body["reason"] == "export_in_progress"
        assert body["active_export_id"] == "pre-existing-id"

    def test_trigger_all_three_valid_pump_ids(self):
        from fastapi.testclient import TestClient

        for pump_id in ["pump1", "pump2", "pump3"]:
            _bsm._state = ExportState()
            with patch("asyncio.create_task"):
                client = TestClient(_bsm.app, raise_server_exceptions=False)
                resp = client.post("/trigger", json={
                    "pump_id": pump_id,
                    "state": "CRITICAL",
                    "trigger_reason": "bearing_fault_pattern",
                    "timestamp": "2025-06-13T08:00:00Z",
                })
            assert resp.status_code == 200, f"pump_id={pump_id} returned {resp.status_code}"


# ===========================================================================
# Group 5 — /status and /health endpoints
# ===========================================================================

class TestStatusAndHealth:

    def test_health_returns_ok(self):
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()
        client = TestClient(_bsm.app, raise_server_exceptions=False)
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body["service"] == "batch-sync"

    def test_status_idle(self):
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()
        client = TestClient(_bsm.app, raise_server_exceptions=False)
        resp = client.get("/status")
        assert resp.status_code == 200
        body = resp.json()
        assert body["active"] is False
        assert body["scheduled_count"] == 0
        assert body["fault_count"] == 0
        assert body["total_mb_written"] == 0.0

    def test_status_reflects_active_export(self):
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()
        asyncio.run(_bsm._state.try_acquire("running-export-id"))

        client = TestClient(_bsm.app, raise_server_exceptions=False)
        resp = client.get("/status")
        body = resp.json()
        assert body["active"] is True
        assert body["active_export_id"] == "running-export-id"


# ===========================================================================
# Group 6 — pump_id validation (all invalid values return 422)
# ===========================================================================

class TestPumpIdValidation:

    @pytest.mark.parametrize("bad_id", [
        "pump0", "pump4", "pump99", "PUMP2", "Pump2", "", "null", "all",
    ])
    def test_invalid_pump_ids_rejected(self, bad_id):
        from fastapi.testclient import TestClient

        _bsm._state = ExportState()
        client = TestClient(_bsm.app, raise_server_exceptions=False)
        resp = client.post("/trigger", json={
            "pump_id": bad_id,
            "state": "CRITICAL",
            "trigger_reason": "bearing_fault_pattern",
            "timestamp": "2025-06-13T08:00:00Z",
        })
        assert resp.status_code == 422, (
            f"Expected 422 for pump_id={bad_id!r}, got {resp.status_code}"
        )


# ===========================================================================
# Group 7 — _query_to_df column cleanup
# ===========================================================================

class TestQueryToDf:
    """_query_to_df() drops internal Flux columns and renames _time."""

    def _make_mock_query_api(self, rows: list[dict]) -> Any:
        """Build a minimal mock that makes query_api.query() return table records."""
        mock_record = MagicMock()
        mock_record.values = rows[0] if rows else {}

        mock_table = MagicMock()
        mock_table.records = [mock_record] if rows else []

        mock_api = AsyncMock()
        mock_api.query = AsyncMock(return_value=[mock_table] if rows else [])
        return mock_api

    def test_internal_columns_dropped(self):
        row = {
            "result": "_result",
            "table": 0,
            "_start": "2025-06-13T07:55:00Z",
            "_stop":  "2025-06-13T08:00:00Z",
            "_time":  "2025-06-13T08:00:01Z",
            "pump_id": "pump2",
            "vibration_axial": 0.82,
        }
        api = self._make_mock_query_api([row])
        df = asyncio.run(_query_to_df(api, "dummy_flux"))

        for col in ("result", "table", "_start", "_stop"):
            assert col not in df.columns, f"Column {col!r} should have been dropped"
        assert "timestamp" in df.columns  # _time renamed
        assert "pump_id" in df.columns
        assert "vibration_axial" in df.columns

    def test_empty_query_returns_empty_df(self):
        api = self._make_mock_query_api([])
        df = asyncio.run(_query_to_df(api, "dummy_flux"))
        assert df.empty

    def test_query_exception_returns_empty_df(self):
        api = AsyncMock()
        api.query = AsyncMock(side_effect=Exception("InfluxDB connection refused"))
        df = asyncio.run(_query_to_df(api, "dummy_flux"))
        assert df.empty
