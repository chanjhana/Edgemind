"""
tests/test_api.py — integration tests for alert-manager FastAPI endpoints.

Uses FastAPI TestClient.  No Docker, no real filesystem writes (we override
ALERTS_DIR to a temp path or patch _write_jsonl so it's a no-op during tests).

Run from repo root:
    python -m pytest alert_manager/tests/test_api.py -v
"""

from __future__ import annotations

import json
import sys
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# Override the ALERTS_DIR env var before the app module imports it.
_TMP_DIR = tempfile.mkdtemp(prefix="alert_manager_test_")
os.environ["ALERTS_DIR"] = _TMP_DIR

# Now import the app (it reads ALERTS_DIR at import time).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import main as alert_main
from alert_manager.enricher import DEDUP_SUPPRESS_AFTER

client = TestClient(alert_main.app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TS = "2025-06-12T08:32:15Z"

def _payload(
    pump_id="pump2",
    state="WARNING",
    trigger="bearing_fault_pattern",
    overall_health=61.3,
    consecutive_cycles=2,
):
    return {
        "pump_id": pump_id,
        "state": state,
        "overall_health": overall_health,
        "vibration_score": 0.43,
        "thermal_score": 0.12,
        "bearing_health": overall_health,
        "trigger": trigger,
        "consecutive_cycles": consecutive_cycles,
        "timestamp": _TS,
    }


def _reset_service_state():
    """Clear the in-memory buffer and dedup tracker between tests."""
    alert_main._ALERT_BUFFER.clear()
    alert_main._dedup._state.clear()


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_body_ok(self):
        resp = client.get("/health")
        body = resp.json()
        assert body["ok"] is True
        assert body["service"] == "alert-manager"


# ---------------------------------------------------------------------------
# POST /alert — acceptance
# ---------------------------------------------------------------------------

class TestPostAlertAccepted:
    def setup_method(self):
        _reset_service_state()

    def test_valid_alert_returns_200(self):
        resp = client.post("/alert", json=_payload())
        assert resp.status_code == 200

    def test_response_has_ok_and_alert_id(self):
        resp = client.post("/alert", json=_payload())
        body = resp.json()
        assert body["ok"] is True
        assert "alert_id" in body
        assert len(body["alert_id"]) == 36   # UUID format

    def test_critical_alert_accepted(self):
        resp = client.post("/alert", json=_payload(state="CRITICAL"))
        assert resp.status_code == 200

    def test_data_stale_alert_accepted(self):
        resp = client.post("/alert", json=_payload(state="DATA_STALE", trigger="data_stale"))
        assert resp.status_code == 200

    def test_alert_appears_in_buffer(self):
        client.post("/alert", json=_payload())
        assert len(alert_main._ALERT_BUFFER) == 1

    def test_two_distinct_pumps_both_accepted(self):
        client.post("/alert", json=_payload(pump_id="pump1"))
        client.post("/alert", json=_payload(pump_id="pump2"))
        assert len(alert_main._ALERT_BUFFER) == 2

    def test_different_triggers_same_pump_both_accepted(self):
        """bearing_fault and data_stale on the same pump must both be accepted (dedup gap)."""
        client.post("/alert", json=_payload(trigger="bearing_fault_pattern"))
        client.post("/alert", json=_payload(trigger="data_stale", state="DATA_STALE"))
        assert len(alert_main._ALERT_BUFFER) == 2


# ---------------------------------------------------------------------------
# POST /alert — JSONL file write
# ---------------------------------------------------------------------------

class TestJSONLWrite:
    def setup_method(self):
        """Fresh temp dir AND fresh service state per test to avoid JSONL pollution."""
        _reset_service_state()
        self._test_dir = tempfile.mkdtemp(prefix="am_jsonl_test_")
        alert_main.ALERTS_DIR = Path(self._test_dir)

    def teardown_method(self):
        # Restore global ALERTS_DIR so other test classes are unaffected.
        alert_main.ALERTS_DIR = Path(_TMP_DIR)

    def test_jsonl_file_created(self):
        client.post("/alert", json=_payload())
        jsonl_files = list(Path(self._test_dir).rglob("*.jsonl"))
        assert len(jsonl_files) == 1

    def test_jsonl_line_is_valid_json(self):
        client.post("/alert", json=_payload())
        jsonl_file = list(Path(self._test_dir).rglob("*.jsonl"))[0]
        lines = jsonl_file.read_text().strip().splitlines()
        assert len(lines) == 1
        record = json.loads(lines[0])
        assert record["pump_id"] == "pump2"

    def test_two_alerts_produce_two_jsonl_lines(self):
        client.post("/alert", json=_payload(pump_id="pump1"))
        client.post("/alert", json=_payload(pump_id="pump2"))
        jsonl_file = list(Path(self._test_dir).rglob("*.jsonl"))[0]
        lines = jsonl_file.read_text().strip().splitlines()
        assert len(lines) == 2

    def test_jsonl_record_has_enrichment_fields(self):
        client.post("/alert", json=_payload())
        jsonl_file = list(Path(self._test_dir).rglob("*.jsonl"))[0]
        lines = jsonl_file.read_text().strip().splitlines()
        record = json.loads(lines[0])
        assert "description" in record
        assert "recommended_action" in record
        assert "severity" in record
        assert "alert_id" in record


# ---------------------------------------------------------------------------
# POST /alert — deduplication (429)
# ---------------------------------------------------------------------------

class TestDeduplication:
    def setup_method(self):
        _reset_service_state()

    def test_first_n_minus_1_posts_accepted(self):
        for _ in range(DEDUP_SUPPRESS_AFTER - 1):
            resp = client.post("/alert", json=_payload())
            assert resp.status_code == 200

    def test_nth_post_suppressed(self):
        for _ in range(DEDUP_SUPPRESS_AFTER):
            client.post("/alert", json=_payload())
        resp = client.post("/alert", json=_payload())
        assert resp.status_code == 429

    def test_suppressed_response_body(self):
        for _ in range(DEDUP_SUPPRESS_AFTER):
            client.post("/alert", json=_payload())
        resp = client.post("/alert", json=_payload())
        body = resp.json()
        assert body["ok"] is False
        assert body["reason"] == "duplicate"
        assert "existing_alert_id" in body

    def test_data_stale_not_suppressed_by_bearing_fault(self):
        """The deliberate dedup gap — the key property for the flood scenario."""
        for _ in range(DEDUP_SUPPRESS_AFTER):
            client.post("/alert", json=_payload(trigger="bearing_fault_pattern"))
        # data_stale has a different key → must still be accepted
        resp = client.post("/alert", json=_payload(trigger="data_stale", state="DATA_STALE"))
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /alert — validation errors (422)
# ---------------------------------------------------------------------------

class TestValidation:
    def test_missing_pump_id_returns_422(self):
        p = _payload()
        del p["pump_id"]
        resp = client.post("/alert", json=p)
        assert resp.status_code == 422

    def test_unknown_pump_id_returns_422(self):
        p = _payload(pump_id="pump99")
        resp = client.post("/alert", json=p)
        assert resp.status_code == 422

    def test_invalid_state_returns_422(self):
        p = _payload(state="BROKEN")
        resp = client.post("/alert", json=p)
        assert resp.status_code == 422

    def test_empty_body_returns_422(self):
        resp = client.post("/alert", json={})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /alerts
# ---------------------------------------------------------------------------

class TestGetAlerts:
    def setup_method(self):
        _reset_service_state()

    def test_empty_buffer_returns_empty_list(self):
        resp = client.get("/alerts")
        assert resp.status_code == 200
        body = resp.json()
        assert body["alerts"] == []
        assert body["count"] == 0

    def test_alerts_returned_newest_first(self):
        for pid in ("pump1", "pump2", "pump3"):
            client.post("/alert", json=_payload(pump_id=pid, trigger=f"bearing_fault_pattern"))
            # Reset dedup so each pump can post again next iteration if needed.
        resp = client.get("/alerts")
        alerts = resp.json()["alerts"]
        # The last posted pump should be first in the list.
        assert alerts[0]["pump_id"] == "pump3"

    def test_pump_filter_returns_only_matching(self):
        client.post("/alert", json=_payload(pump_id="pump1"))
        client.post("/alert", json=_payload(pump_id="pump2", trigger="bearing_fault_pattern"))
        resp = client.get("/alerts?pump=pump1")
        alerts = resp.json()["alerts"]
        assert all(a["pump_id"] == "pump1" for a in alerts)

    def test_pump_filter_no_match_returns_empty(self):
        client.post("/alert", json=_payload(pump_id="pump1"))
        resp = client.get("/alerts?pump=pump3")
        assert resp.json()["alerts"] == []

    def test_limit_param_respected(self):
        for _ in range(5):
            # post with different triggers to avoid dedup
            client.post("/alert", json=_payload(pump_id="pump1"))
            alert_main._dedup.reset_pump("pump1")
        resp = client.get("/alerts?limit=3")
        assert len(resp.json()["alerts"]) == 3


# ---------------------------------------------------------------------------
# GET /alerts/active
# ---------------------------------------------------------------------------

class TestGetAlertsActive:
    def setup_method(self):
        _reset_service_state()

    def test_empty_returns_empty(self):
        resp = client.get("/alerts/active")
        assert resp.json()["alerts"] == []

    def test_warning_alert_appears_in_active(self):
        client.post("/alert", json=_payload(state="WARNING"))
        resp = client.get("/alerts/active")
        assert len(resp.json()["alerts"]) == 1

    def test_critical_alert_appears_in_active(self):
        client.post("/alert", json=_payload(state="CRITICAL"))
        resp = client.get("/alerts/active")
        assert len(resp.json()["alerts"]) == 1

    def test_data_stale_appears_in_active(self):
        client.post("/alert", json=_payload(state="DATA_STALE", trigger="data_stale"))
        resp = client.get("/alerts/active")
        assert len(resp.json()["alerts"]) == 1

    def test_active_returns_one_per_pump(self):
        """If a pump sent two alerts, only the most recent appears in /active."""
        client.post("/alert", json=_payload(pump_id="pump2", trigger="bearing_fault_pattern"))
        alert_main._dedup.reset_pump("pump2")
        client.post("/alert", json=_payload(pump_id="pump2", trigger="thermal_anomaly"))
        resp = client.get("/alerts/active")
        assert resp.json()["count"] == 1
