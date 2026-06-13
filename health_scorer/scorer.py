"""
scorer.py — pure scoring logic for health-scorer.

No InfluxDB or HTTP imports here.  All the stateful classification and
trigger-decision logic lives in this module so it can be unit-tested on
synthetic feature dicts without a running InfluxDB or network.

Terminology (from the data-synthesis doc):
  bearing_health  0–100 from feature-extractor (100 = perfect, 0 = failed)
  vibration_score computed here from vib_rms_trend + axial_dominance_ratio
  thermal_score   computed here from temp_rate_of_change
  state           HEALTHY / WARNING / CRITICAL / DATA_STALE

Thresholds (from common.contract):
  bearing_health >= 75   → HEALTHY
  50 <= bearing_health < 75 → WARNING
  bearing_health < 50    → CRITICAL

Stale threshold:
  latest pump_features entry older than 90 s → DATA_STALE + WARNING

Downstream trigger rules:
  WARNING for 2+ consecutive cycles → trigger alert + export
  CRITICAL immediately              → trigger alert + export
  Either trigger sends to BOTH alert-manager AND batch-sync.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

from common.contract import (
    ACTION_NONE,
    ACTION_TRIGGER_ALERT,
    ACTION_TRIGGER_BOTH,
    ACTION_TRIGGER_EXPORT,
    F_AXIAL_DOMINANCE,
    F_BEARING_HEALTH,
    F_RPM_STABILITY,
    F_TEMP_RATE,
    F_VIB_RMS_TREND,
    HEALTH_HEALTHY_MIN,
    HEALTH_STALE_THRESHOLD_S,
    HEALTH_WARNING_MIN,
    STATE_CRITICAL,
    STATE_DATA_STALE,
    STATE_HEALTHY,
    STATE_WARNING,
    TRIGGER_BEARING_FAULT,
    TRIGGER_DATA_STALE,
    TRIGGER_THERMAL_ANOMALY,
)

# How many consecutive WARNING cycles before we send a trigger.
# 1 means "trigger immediately on WARNING" (CRITICAL always triggers immediately).
WARNING_TRIGGER_CYCLES = 2

# Vibration score weight constants.
_VIB_TREND_WEIGHT = 0.6
_AXIAL_DOM_WEIGHT = 0.4

# Thermal score: rate in °C/s at which score saturates to 1.0.
_TEMP_RATE_SATURATION = 0.05   # 3 °C/min


@dataclass
class PumpState:
    """Per-pump running state held across scoring cycles."""
    pump_id: str
    consecutive_warning_cycles: int = 0
    last_state: str = STATE_HEALTHY

    def reset_warning_counter(self) -> None:
        self.consecutive_warning_cycles = 0

    def increment_warning(self) -> None:
        self.consecutive_warning_cycles += 1

    def should_trigger(self, state: str) -> bool:
        """True when a downstream trigger should be sent this cycle."""
        if state == STATE_CRITICAL:
            return True
        if state == STATE_WARNING and self.consecutive_warning_cycles >= WARNING_TRIGGER_CYCLES:
            return True
        if state == STATE_DATA_STALE:
            # DATA_STALE is treated like WARNING for trigger purposes.
            return self.consecutive_warning_cycles >= WARNING_TRIGGER_CYCLES
        return False


@dataclass
class ScoringResult:
    """Everything produced by one scoring cycle for one pump."""
    pump_id: str
    vibration_score: float        # 0.0–1.0 (1.0 = worst)
    thermal_score: float          # 0.0–1.0 (1.0 = worst)
    overall_health: float         # 0–100 (100 = best)
    state: str                    # HEALTHY / WARNING / CRITICAL / DATA_STALE
    consecutive_warning_cycles: int
    action: str                   # none / trigger_alert / trigger_export / trigger_both
    trigger: str                  # trigger type label for the alert payload
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def is_anomalous(self) -> bool:
        return self.state in (STATE_WARNING, STATE_CRITICAL, STATE_DATA_STALE)


def _vibration_score(features: Dict[str, float]) -> float:
    """
    0.0 = no vibration anomaly, 1.0 = severe.

    Combines rising RMS trend and axial dominance.
    axial_dominance_ratio >0.35 is the bearing-fault signature.
    vib_rms_trend >0 with significant magnitude is rising vibration.
    """
    trend = features.get(F_VIB_RMS_TREND, 0.0)
    dom = features.get(F_AXIAL_DOMINANCE, 0.0)

    # Trend score: cap at 0.02 mm/s² (very steep ramp) → 1.0.
    # Negative trend (vibration decreasing) scores 0.
    trend_score = min(max(trend, 0.0) / 0.02, 1.0)

    # Axial dominance: 0.35 = onset bearing signature, 0.7 = severe.
    dom_score = min(max(dom - 0.3, 0.0) / 0.4, 1.0)

    return _VIB_TREND_WEIGHT * trend_score + _AXIAL_DOM_WEIGHT * dom_score


def _thermal_score(features: Dict[str, float]) -> float:
    """
    0.0 = temperature stable, 1.0 = rapid rise.

    Based on temp_rate_of_change (°C/s from linear regression).
    Positive = heating up. Saturates at _TEMP_RATE_SATURATION °C/s.
    """
    rate = features.get(F_TEMP_RATE, 0.0)
    return min(max(rate, 0.0) / _TEMP_RATE_SATURATION, 1.0)


def _classify(bearing_health: float) -> str:
    """Map bearing_health score to a state string."""
    if bearing_health >= HEALTH_HEALTHY_MIN:
        return STATE_HEALTHY
    if bearing_health >= HEALTH_WARNING_MIN:
        return STATE_WARNING
    return STATE_CRITICAL


def _determine_trigger(state: str, features: Dict[str, float]) -> str:
    """Pick the most specific trigger label for the alert payload."""
    if state == STATE_DATA_STALE:
        return TRIGGER_DATA_STALE
    vib = _vibration_score(features)
    therm = _thermal_score(features)
    if vib > therm:
        return TRIGGER_BEARING_FAULT
    return TRIGGER_THERMAL_ANOMALY


def score_pump(
    pump_id: str,
    features: Dict[str, float],
    pump_state: PumpState,
    feature_age_s: float,
) -> ScoringResult:
    """
    Produce a ScoringResult for one pump given its latest features.

    Parameters
    ----------
    pump_id       : pump identifier (pump1 / pump2 / pump3)
    features      : dict of feature field values from InfluxDB (may be empty
                    if the query returned nothing)
    pump_state    : mutable PumpState object (updated in place)
    feature_age_s : how many seconds since the latest pump_features was written
    """
    # --- stale-data path ---------------------------------------------------
    if feature_age_s > HEALTH_STALE_THRESHOLD_S or not features:
        pump_state.increment_warning()
        will_trigger = pump_state.should_trigger(STATE_DATA_STALE)
        action = ACTION_TRIGGER_BOTH if will_trigger else ACTION_NONE
        return ScoringResult(
            pump_id=pump_id,
            vibration_score=0.0,
            thermal_score=0.0,
            overall_health=features.get(F_BEARING_HEALTH, 0.0),
            state=STATE_DATA_STALE,
            consecutive_warning_cycles=pump_state.consecutive_warning_cycles,
            action=action,
            trigger=TRIGGER_DATA_STALE,
        )

    # --- normal scoring path -----------------------------------------------
    bearing = features.get(F_BEARING_HEALTH, 100.0)
    vib_score = _vibration_score(features)
    therm_score = _thermal_score(features)
    state = _classify(bearing)
    trigger = _determine_trigger(state, features)

    # Update the warning counter.
    if state == STATE_WARNING:
        pump_state.increment_warning()
    elif state == STATE_CRITICAL:
        pump_state.increment_warning()   # keep counting through critical
    else:
        pump_state.reset_warning_counter()

    pump_state.last_state = state
    will_trigger = pump_state.should_trigger(state)

    # Determine action label.
    if will_trigger:
        action = ACTION_TRIGGER_BOTH
    else:
        action = ACTION_NONE

    return ScoringResult(
        pump_id=pump_id,
        vibration_score=round(vib_score, 4),
        thermal_score=round(therm_score, 4),
        overall_health=round(bearing, 2),
        state=state,
        consecutive_warning_cycles=pump_state.consecutive_warning_cycles,
        action=action,
        trigger=trigger,
    )
