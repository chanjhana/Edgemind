"""
tests/test_enricher.py — unit tests for alert_manager.enricher.

No FastAPI, no filesystem, no network.  Everything runs against synthetic
dicts and the pure logic in enricher.py.

Run from repo root:
    python -m pytest alert_manager/tests -v
"""

from __future__ import annotations

import sys
import os
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from alert_manager.enricher import (
    DEDUP_SUPPRESS_AFTER,
    DedupTracker,
    EnrichedAlert,
    IncomingAlert,
    enrich,
)
from common.contract import (
    STATE_CRITICAL,
    STATE_DATA_STALE,
    STATE_WARNING,
    TRIGGER_BEARING_FAULT,
    TRIGGER_COMBINED_FAULT,
    TRIGGER_DATA_STALE,
    TRIGGER_THERMAL_ANOMALY,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TS = "2025-06-12T08:32:15Z"

def make_payload(
    pump_id="pump2",
    state=STATE_WARNING,
    trigger=TRIGGER_BEARING_FAULT,
    overall_health=61.3,
    vibration_score=0.43,
    thermal_score=0.12,
    consecutive_cycles=2,
    timestamp=_TS,
) -> dict:
    return {
        "pump_id": pump_id,
        "state": state,
        "overall_health": overall_health,
        "vibration_score": vibration_score,
        "thermal_score": thermal_score,
        "bearing_health": overall_health,
        "trigger": trigger,
        "consecutive_cycles": consecutive_cycles,
        "timestamp": timestamp,
    }


# ---------------------------------------------------------------------------
# IncomingAlert.from_dict — parsing and validation
# ---------------------------------------------------------------------------

class TestIncomingAlertParsing:
    def test_valid_payload_parses(self):
        a = IncomingAlert.from_dict(make_payload())
        assert a.pump_id == "pump2"
        assert a.state == STATE_WARNING
        assert a.trigger == TRIGGER_BEARING_FAULT
        assert a.overall_health == pytest.approx(61.3)

    def test_timestamp_z_suffix_parsed(self):
        a = IncomingAlert.from_dict(make_payload(timestamp="2025-06-12T08:32:15Z"))
        assert a.timestamp.tzinfo is not None

    def test_timestamp_offset_parsed(self):
        a = IncomingAlert.from_dict(make_payload(timestamp="2025-06-12T08:32:15+00:00"))
        assert a.timestamp.year == 2025

    def test_missing_pump_id_raises(self):
        p = make_payload()
        del p["pump_id"]
        with pytest.raises(ValueError, match="Missing required fields"):
            IncomingAlert.from_dict(p)

    def test_missing_state_raises(self):
        p = make_payload()
        del p["state"]
        with pytest.raises(ValueError, match="Missing required fields"):
            IncomingAlert.from_dict(p)

    def test_unknown_pump_id_raises(self):
        p = make_payload(pump_id="pump9")
        with pytest.raises(ValueError, match="Unknown pump_id"):
            IncomingAlert.from_dict(p)

    def test_invalid_state_raises(self):
        p = make_payload(state="UNKNOWN")
        with pytest.raises(ValueError, match="Unexpected state"):
            IncomingAlert.from_dict(p)

    def test_critical_state_parses(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_CRITICAL))
        assert a.state == STATE_CRITICAL

    def test_data_stale_state_parses(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_DATA_STALE, trigger=TRIGGER_DATA_STALE))
        assert a.state == STATE_DATA_STALE

    def test_bearing_health_falls_back_to_overall_health(self):
        p = make_payload()
        del p["bearing_health"]
        a = IncomingAlert.from_dict(p)
        assert a.bearing_health == pytest.approx(p["overall_health"])


# ---------------------------------------------------------------------------
# enrich() — template application
# ---------------------------------------------------------------------------

class TestEnrich:
    def test_bearing_fault_description_contains_pump_num(self):
        a = IncomingAlert.from_dict(make_payload(pump_id="pump2", trigger=TRIGGER_BEARING_FAULT))
        e = enrich(a)
        assert "2" in e.description
        assert "bearing" in e.description.lower()

    def test_thermal_anomaly_description_mentions_temperature(self):
        a = IncomingAlert.from_dict(make_payload(trigger=TRIGGER_THERMAL_ANOMALY))
        e = enrich(a)
        assert "temperature" in e.description.lower() or "thermal" in e.description.lower()

    def test_data_stale_description_mentions_stale(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_DATA_STALE, trigger=TRIGGER_DATA_STALE))
        e = enrich(a)
        assert "90 seconds" in e.description or "stale" in e.description.lower() or "not been updated" in e.description

    def test_combined_fault_description_mentions_multiple(self):
        a = IncomingAlert.from_dict(make_payload(trigger=TRIGGER_COMBINED_FAULT, state=STATE_CRITICAL))
        e = enrich(a)
        assert "multiple" in e.description.lower() or "concurrent" in e.description.lower()

    def test_recommended_action_is_non_empty(self):
        for trigger in (TRIGGER_BEARING_FAULT, TRIGGER_THERMAL_ANOMALY,
                        TRIGGER_DATA_STALE, TRIGGER_COMBINED_FAULT):
            state = STATE_WARNING if trigger != TRIGGER_COMBINED_FAULT else STATE_CRITICAL
            a = IncomingAlert.from_dict(make_payload(trigger=trigger, state=state))
            e = enrich(a)
            assert len(e.recommended_action) > 10

    def test_severity_warning_for_warning_state(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_WARNING))
        e = enrich(a)
        assert e.severity == "WARNING"

    def test_severity_critical_for_critical_state(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_CRITICAL))
        e = enrich(a)
        assert e.severity == "CRITICAL"

    def test_severity_warning_for_data_stale(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_DATA_STALE, trigger=TRIGGER_DATA_STALE))
        e = enrich(a)
        assert e.severity == "WARNING"

    def test_alert_id_is_valid_uuid(self):
        a = IncomingAlert.from_dict(make_payload())
        e = enrich(a)
        # This should not raise:
        parsed = uuid.UUID(e.alert_id)
        assert str(parsed) == e.alert_id

    def test_two_enrichments_produce_different_alert_ids(self):
        a = IncomingAlert.from_dict(make_payload())
        e1 = enrich(a)
        e2 = enrich(a)
        assert e1.alert_id != e2.alert_id

    def test_fields_preserved_through_enrichment(self):
        a = IncomingAlert.from_dict(make_payload(pump_id="pump3", overall_health=42.0))
        e = enrich(a)
        assert e.pump_id == "pump3"
        assert e.overall_health == pytest.approx(42.0)
        assert e.trigger == TRIGGER_BEARING_FAULT

    def test_fallback_template_used_for_unknown_trigger(self):
        p = make_payload()
        p["trigger"] = "unknown_trigger_xyz"
        # from_dict doesn't validate trigger — only state and pump_id
        a = IncomingAlert.from_dict(p)
        e = enrich(a)
        assert len(e.description) > 0   # fallback description set

    def test_to_dict_contains_all_keys(self):
        a = IncomingAlert.from_dict(make_payload())
        e = enrich(a)
        d = e.to_dict()
        for key in ("alert_id", "pump_id", "state", "severity", "overall_health",
                    "trigger", "description", "recommended_action", "received_at"):
            assert key in d, f"Missing key: {key}"

    def test_is_active_true_for_warning(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_WARNING))
        e = enrich(a)
        assert e.is_active is True

    def test_is_active_true_for_critical(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_CRITICAL))
        e = enrich(a)
        assert e.is_active is True

    def test_is_active_true_for_data_stale(self):
        a = IncomingAlert.from_dict(make_payload(state=STATE_DATA_STALE, trigger=TRIGGER_DATA_STALE))
        e = enrich(a)
        assert e.is_active is True


# ---------------------------------------------------------------------------
# DedupTracker
# ---------------------------------------------------------------------------

class TestDedupTracker:
    def test_first_post_not_suppressed(self):
        tracker = DedupTracker()
        result = tracker.check("pump2", TRIGGER_BEARING_FAULT)
        assert result is None

    def test_below_threshold_not_suppressed(self):
        tracker = DedupTracker()
        for i in range(DEDUP_SUPPRESS_AFTER - 1):
            tracker.record("pump2", TRIGGER_BEARING_FAULT, f"alert-{i}")
        result = tracker.check("pump2", TRIGGER_BEARING_FAULT)
        assert result is None

    def test_at_threshold_suppressed(self):
        tracker = DedupTracker()
        for i in range(DEDUP_SUPPRESS_AFTER):
            tracker.record("pump2", TRIGGER_BEARING_FAULT, f"alert-{i}")
        result = tracker.check("pump2", TRIGGER_BEARING_FAULT)
        assert result is not None

    def test_suppressed_returns_last_alert_id(self):
        tracker = DedupTracker()
        last_id = "final-alert-id"
        for i in range(DEDUP_SUPPRESS_AFTER - 1):
            tracker.record("pump2", TRIGGER_BEARING_FAULT, f"alert-{i}")
        tracker.record("pump2", TRIGGER_BEARING_FAULT, last_id)
        result = tracker.check("pump2", TRIGGER_BEARING_FAULT)
        assert result == last_id

    def test_reset_clears_counter(self):
        tracker = DedupTracker()
        for i in range(DEDUP_SUPPRESS_AFTER):
            tracker.record("pump2", TRIGGER_BEARING_FAULT, f"alert-{i}")
        tracker.reset("pump2", TRIGGER_BEARING_FAULT)
        result = tracker.check("pump2", TRIGGER_BEARING_FAULT)
        assert result is None

    def test_reset_pump_clears_all_triggers_for_pump(self):
        tracker = DedupTracker()
        for i in range(DEDUP_SUPPRESS_AFTER):
            tracker.record("pump2", TRIGGER_BEARING_FAULT, f"a-{i}")
            tracker.record("pump2", TRIGGER_DATA_STALE, f"b-{i}")
        tracker.reset_pump("pump2")
        assert tracker.check("pump2", TRIGGER_BEARING_FAULT) is None
        assert tracker.check("pump2", TRIGGER_DATA_STALE) is None

    def test_different_pumps_track_independently(self):
        tracker = DedupTracker()
        for i in range(DEDUP_SUPPRESS_AFTER):
            tracker.record("pump1", TRIGGER_BEARING_FAULT, f"a-{i}")
        # pump2 is unaffected
        assert tracker.check("pump2", TRIGGER_BEARING_FAULT) is None

    def test_deliberate_gap_data_stale_and_bearing_fault_independent(self):
        """
        DATA_STALE and BEARING_FAULT use different dedup keys.
        Suppressing one must not suppress the other.
        This is the critical design requirement for the flood scenario.
        """
        tracker = DedupTracker()
        # Saturate bearing_fault key
        for i in range(DEDUP_SUPPRESS_AFTER):
            tracker.record("pump2", TRIGGER_BEARING_FAULT, f"a-{i}")
        # data_stale key is still fresh — must NOT be suppressed
        assert tracker.check("pump2", TRIGGER_DATA_STALE) is None

    def test_get_count_returns_zero_for_unseen(self):
        tracker = DedupTracker()
        assert tracker.get_count("pump1", TRIGGER_BEARING_FAULT) == 0

    def test_get_count_increments_correctly(self):
        tracker = DedupTracker()
        tracker.record("pump1", TRIGGER_BEARING_FAULT, "a1")
        tracker.record("pump1", TRIGGER_BEARING_FAULT, "a2")
        assert tracker.get_count("pump1", TRIGGER_BEARING_FAULT) == 2
