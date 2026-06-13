"""
tests/test_scorer.py — unit tests for health_scorer.scorer.

No InfluxDB, no network, no Docker.  All tests operate on synthetic feature
dicts and synthetic PumpState objects, verifying the pure scoring logic.

Run from repo root:
    python -m pytest health_scorer/tests -v
"""

from __future__ import annotations

import sys
import os
import pytest
from datetime import datetime, timezone

# Make the repo root importable (common/ and health_scorer/ both live there).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from health_scorer.scorer import (
    PumpState,
    ScoringResult,
    _classify,
    _thermal_score,
    _vibration_score,
    score_pump,
)
from common.contract import (
    ACTION_NONE,
    ACTION_TRIGGER_BOTH,
    F_AXIAL_DOMINANCE,
    F_BEARING_HEALTH,
    F_RPM_STABILITY,
    F_TEMP_RATE,
    F_VIB_RMS_TREND,
    HEALTH_STALE_THRESHOLD_S,
    STATE_CRITICAL,
    STATE_DATA_STALE,
    STATE_HEALTHY,
    STATE_WARNING,
    TRIGGER_BEARING_FAULT,
    TRIGGER_DATA_STALE,
    TRIGGER_THERMAL_ANOMALY,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def healthy_features(pump_id: str = "pump1") -> dict:
    """Feature dict representing a pump in normal operation."""
    return {
        F_VIB_RMS_TREND: 0.0,
        F_AXIAL_DOMINANCE: 0.31,
        F_TEMP_RATE: 0.0,
        F_RPM_STABILITY: 1.5,
        F_BEARING_HEALTH: 92.0,
    }


def warning_features(pump_id: str = "pump2") -> dict:
    """Feature dict with bearing_health in the WARNING band (50–75)."""
    return {
        F_VIB_RMS_TREND: 0.008,
        F_AXIAL_DOMINANCE: 0.45,
        F_TEMP_RATE: 0.001,
        F_RPM_STABILITY: 2.0,
        F_BEARING_HEALTH: 62.0,
    }


def critical_features(pump_id: str = "pump2") -> dict:
    """Feature dict with bearing_health in the CRITICAL band (<50)."""
    return {
        F_VIB_RMS_TREND: 0.018,
        F_AXIAL_DOMINANCE: 0.70,
        F_TEMP_RATE: 0.004,
        F_RPM_STABILITY: 4.0,
        F_BEARING_HEALTH: 41.0,
    }


def fresh_state(pump_id: str = "pump1") -> PumpState:
    return PumpState(pump_id=pump_id)


# ---------------------------------------------------------------------------
# _classify tests
# ---------------------------------------------------------------------------

class TestClassify:
    def test_healthy_at_boundary(self):
        assert _classify(75.0) == STATE_HEALTHY

    def test_healthy_above_boundary(self):
        assert _classify(92.0) == STATE_HEALTHY

    def test_warning_at_lower_boundary(self):
        assert _classify(50.0) == STATE_WARNING

    def test_warning_just_below_healthy(self):
        assert _classify(74.9) == STATE_WARNING

    def test_critical_just_below_warning(self):
        assert _classify(49.9) == STATE_CRITICAL

    def test_critical_at_zero(self):
        assert _classify(0.0) == STATE_CRITICAL


# ---------------------------------------------------------------------------
# _vibration_score tests
# ---------------------------------------------------------------------------

class TestVibrationScore:
    def test_zero_trend_low_dominance_scores_near_zero(self):
        feats = {F_VIB_RMS_TREND: 0.0, F_AXIAL_DOMINANCE: 0.31}
        assert _vibration_score(feats) < 0.05

    def test_negative_trend_clipped_to_zero(self):
        feats = {F_VIB_RMS_TREND: -0.01, F_AXIAL_DOMINANCE: 0.31}
        assert _vibration_score(feats) < 0.05

    def test_high_trend_scores_high(self):
        feats = {F_VIB_RMS_TREND: 0.02, F_AXIAL_DOMINANCE: 0.31}
        score = _vibration_score(feats)
        assert score > 0.5

    def test_bearing_fault_dominance_scores_high(self):
        # axial_dominance_ratio 0.7 → bearing fault signature
        feats = {F_VIB_RMS_TREND: 0.0, F_AXIAL_DOMINANCE: 0.70}
        score = _vibration_score(feats)
        assert score > 0.3

    def test_score_bounded_0_to_1(self):
        feats = {F_VIB_RMS_TREND: 999.0, F_AXIAL_DOMINANCE: 999.0}
        score = _vibration_score(feats)
        assert 0.0 <= score <= 1.0


# ---------------------------------------------------------------------------
# _thermal_score tests
# ---------------------------------------------------------------------------

class TestThermalScore:
    def test_zero_rate_scores_zero(self):
        feats = {F_TEMP_RATE: 0.0}
        assert _thermal_score(feats) == 0.0

    def test_negative_rate_scores_zero(self):
        feats = {F_TEMP_RATE: -0.01}
        assert _thermal_score(feats) == 0.0

    def test_fast_rise_scores_high(self):
        # 0.05 °C/s = 3 °C/min → saturation value
        feats = {F_TEMP_RATE: 0.05}
        assert _thermal_score(feats) == pytest.approx(1.0)

    def test_moderate_rise_intermediate_score(self):
        feats = {F_TEMP_RATE: 0.025}
        score = _thermal_score(feats)
        assert 0.3 < score < 0.8

    def test_score_capped_at_1(self):
        feats = {F_TEMP_RATE: 999.0}
        assert _thermal_score(feats) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# score_pump — HEALTHY path
# ---------------------------------------------------------------------------

class TestScorePumpHealthy:
    def test_healthy_pump_returns_healthy_state(self):
        result = score_pump("pump1", healthy_features(), fresh_state(), feature_age_s=5.0)
        assert result.state == STATE_HEALTHY

    def test_healthy_pump_no_action(self):
        result = score_pump("pump1", healthy_features(), fresh_state(), feature_age_s=5.0)
        assert result.action == ACTION_NONE

    def test_healthy_pump_resets_warning_counter(self):
        state = fresh_state()
        state.consecutive_warning_cycles = 3
        score_pump("pump1", healthy_features(), state, feature_age_s=5.0)
        assert state.consecutive_warning_cycles == 0

    def test_healthy_pump_scores_in_range(self):
        result = score_pump("pump1", healthy_features(), fresh_state(), feature_age_s=5.0)
        assert 0.0 <= result.vibration_score <= 1.0
        assert 0.0 <= result.thermal_score <= 1.0
        assert 0.0 <= result.overall_health <= 100.0


# ---------------------------------------------------------------------------
# score_pump — WARNING path
# ---------------------------------------------------------------------------

class TestScorePumpWarning:
    def test_first_warning_cycle_no_trigger(self):
        """First WARNING cycle: counter=1, not yet at trigger threshold."""
        state = fresh_state("pump2")
        result = score_pump("pump2", warning_features(), state, feature_age_s=5.0)
        assert result.state == STATE_WARNING
        assert result.action == ACTION_NONE
        assert state.consecutive_warning_cycles == 1

    def test_second_warning_cycle_triggers(self):
        """Second consecutive WARNING cycle: triggers both alert + export."""
        state = fresh_state("pump2")
        # First cycle — no trigger
        score_pump("pump2", warning_features(), state, feature_age_s=5.0)
        # Second cycle — trigger
        result = score_pump("pump2", warning_features(), state, feature_age_s=5.0)
        assert result.state == STATE_WARNING
        assert result.action == ACTION_TRIGGER_BOTH
        assert state.consecutive_warning_cycles == 2

    def test_warning_state_accumulates_counter(self):
        state = fresh_state("pump2")
        for _ in range(5):
            score_pump("pump2", warning_features(), state, feature_age_s=5.0)
        assert state.consecutive_warning_cycles == 5

    def test_recovery_to_healthy_resets_counter(self):
        state = fresh_state("pump2")
        score_pump("pump2", warning_features(), state, feature_age_s=5.0)
        score_pump("pump2", warning_features(), state, feature_age_s=5.0)
        assert state.consecutive_warning_cycles == 2
        # Pump recovers to healthy
        score_pump("pump2", healthy_features(), state, feature_age_s=5.0)
        assert state.consecutive_warning_cycles == 0


# ---------------------------------------------------------------------------
# score_pump — CRITICAL path
# ---------------------------------------------------------------------------

class TestScorePumpCritical:
    def test_critical_triggers_immediately(self):
        """CRITICAL triggers on first cycle, no need to wait."""
        state = fresh_state("pump2")
        result = score_pump("pump2", critical_features(), state, feature_age_s=5.0)
        assert result.state == STATE_CRITICAL
        assert result.action == ACTION_TRIGGER_BOTH

    def test_critical_pump1_triggers_too(self):
        """CRITICAL on the primary pump (pump1) must also trigger immediately."""
        crit = critical_features("pump1")
        crit[F_BEARING_HEALTH] = 30.0
        result = score_pump("pump1", crit, fresh_state("pump1"), feature_age_s=5.0)
        assert result.state == STATE_CRITICAL
        assert result.action == ACTION_TRIGGER_BOTH


# ---------------------------------------------------------------------------
# score_pump — DATA_STALE path
# ---------------------------------------------------------------------------

class TestScorePumpDataStale:
    def test_stale_features_returns_data_stale(self):
        stale_age = HEALTH_STALE_THRESHOLD_S + 1.0
        result = score_pump("pump1", healthy_features(), fresh_state(), feature_age_s=stale_age)
        assert result.state == STATE_DATA_STALE

    def test_empty_features_returns_data_stale(self):
        result = score_pump("pump1", {}, fresh_state(), feature_age_s=5.0)
        assert result.state == STATE_DATA_STALE

    def test_stale_trigger_requires_two_cycles(self):
        """DATA_STALE follows same WARNING_TRIGGER_CYCLES rule."""
        stale_age = HEALTH_STALE_THRESHOLD_S + 1.0
        state = fresh_state()
        r1 = score_pump("pump1", {}, state, feature_age_s=stale_age)
        assert r1.action == ACTION_NONE
        r2 = score_pump("pump1", {}, state, feature_age_s=stale_age)
        assert r2.action == ACTION_TRIGGER_BOTH

    def test_stale_trigger_label_is_data_stale(self):
        stale_age = HEALTH_STALE_THRESHOLD_S + 1.0
        result = score_pump("pump1", {}, fresh_state(), feature_age_s=stale_age)
        assert result.trigger == TRIGGER_DATA_STALE


# ---------------------------------------------------------------------------
# score_pump — trigger label selection
# ---------------------------------------------------------------------------

class TestTriggerLabel:
    def test_bearing_fault_pattern_when_axial_dominant(self):
        feats = warning_features()
        feats[F_AXIAL_DOMINANCE] = 0.70   # strong bearing fault signature
        feats[F_TEMP_RATE] = 0.0           # no thermal
        state = fresh_state("pump2")
        # Get to the trigger cycle
        score_pump("pump2", feats, state, feature_age_s=5.0)
        result = score_pump("pump2", feats, state, feature_age_s=5.0)
        assert result.trigger == TRIGGER_BEARING_FAULT

    def test_thermal_anomaly_when_temp_dominant(self):
        feats = warning_features()
        feats[F_AXIAL_DOMINANCE] = 0.31    # normal dominance
        feats[F_VIB_RMS_TREND] = 0.0       # no vibration trend
        feats[F_TEMP_RATE] = 0.04          # strong thermal rise
        state = fresh_state("pump2")
        score_pump("pump2", feats, state, feature_age_s=5.0)
        result = score_pump("pump2", feats, state, feature_age_s=5.0)
        assert result.trigger == TRIGGER_THERMAL_ANOMALY


# ---------------------------------------------------------------------------
# ScoringResult helpers
# ---------------------------------------------------------------------------

class TestScoringResult:
    def test_is_anomalous_warning(self):
        r = ScoringResult("pump1", 0.5, 0.3, 62.0, STATE_WARNING, 1, ACTION_NONE, TRIGGER_BEARING_FAULT)
        assert r.is_anomalous() is True

    def test_is_anomalous_critical(self):
        r = ScoringResult("pump1", 0.9, 0.7, 40.0, STATE_CRITICAL, 1, ACTION_TRIGGER_BOTH, TRIGGER_BEARING_FAULT)
        assert r.is_anomalous() is True

    def test_is_anomalous_data_stale(self):
        r = ScoringResult("pump1", 0.0, 0.0, 0.0, STATE_DATA_STALE, 1, ACTION_NONE, TRIGGER_DATA_STALE)
        assert r.is_anomalous() is True

    def test_is_anomalous_healthy(self):
        r = ScoringResult("pump1", 0.1, 0.0, 92.0, STATE_HEALTHY, 0, ACTION_NONE, "")
        assert r.is_anomalous() is False


# ---------------------------------------------------------------------------
# PumpState
# ---------------------------------------------------------------------------

class TestPumpState:
    def test_initial_state(self):
        s = PumpState("pump1")
        assert s.consecutive_warning_cycles == 0
        assert s.last_state == STATE_HEALTHY

    def test_increment_and_reset(self):
        s = PumpState("pump1")
        s.increment_warning()
        s.increment_warning()
        assert s.consecutive_warning_cycles == 2
        s.reset_warning_counter()
        assert s.consecutive_warning_cycles == 0

    def test_should_trigger_critical_always(self):
        s = PumpState("pump1")
        assert s.should_trigger(STATE_CRITICAL) is True

    def test_should_trigger_warning_requires_threshold(self):
        s = PumpState("pump1")
        s.consecutive_warning_cycles = 1
        assert s.should_trigger(STATE_WARNING) is False
        s.consecutive_warning_cycles = 2
        assert s.should_trigger(STATE_WARNING) is True

    def test_should_not_trigger_healthy(self):
        s = PumpState("pump1")
        s.consecutive_warning_cycles = 99
        assert s.should_trigger(STATE_HEALTHY) is False
