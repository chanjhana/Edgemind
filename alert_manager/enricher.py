"""
enricher.py — pure enrichment and deduplication logic for alert-manager.

No FastAPI, no filesystem, no network.  Fully unit-testable on synthetic
alert payloads.

Responsibilities
----------------
1. Validate the incoming payload shape.
2. Apply per-trigger-type enrichment templates (description / severity /
   recommendation).  These are hardcoded — NOT LLM-generated.  LLM
   reasoning lives exclusively in the EdgeMind orchestrator.
3. Track deduplication state: same (pump_id, trigger) key for fewer than
   DEDUP_SUPPRESS_AFTER consecutive POSTs → allow; at or beyond that →
   suppress with the existing alert_id.  The counter resets when the key
   changes (state/trigger changed, pump recovered).
4. Assign a UUID to each accepted alert.

Deduplication gap (by design)
------------------------------
DATA_STALE is a distinct trigger from BEARING_FAULT.  Under a flood
scenario, health-scorer sends both streams simultaneously.  They use
different dedup keys, so both pass through — this is the burst that stresses
alert-manager's write path and is the whole point of the scenario.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from common.contract import (
    STATE_CRITICAL,
    STATE_WARNING,
    STATE_DATA_STALE,
    TRIGGER_BEARING_FAULT,
    TRIGGER_THERMAL_ANOMALY,
    TRIGGER_DATA_STALE,
    TRIGGER_COMBINED_FAULT,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# After this many consecutive identical (pump_id, trigger) POSTs, suppress.
DEDUP_SUPPRESS_AFTER = 10

# Severity map: state string → severity label
_SEVERITY: Dict[str, str] = {
    STATE_CRITICAL:   "CRITICAL",
    STATE_WARNING:    "WARNING",
    STATE_DATA_STALE: "WARNING",
}

# ---------------------------------------------------------------------------
# Enrichment templates
# Each entry: (description_template, recommended_action)
# Use {pump_id} and {pump_num} placeholders; formatted at call time.
# ---------------------------------------------------------------------------

_TEMPLATES: Dict[str, Tuple[str, str]] = {
    TRIGGER_BEARING_FAULT: (
        "Pump {pump_num} bearing health declining. Axial vibration rising "
        "above ISO 10816-3 Zone C threshold. Bearing wear pattern detected.",
        "Schedule bearing inspection within 48 hours. "
        "Monitor axial vibration trend closely.",
    ),
    TRIGGER_THERMAL_ANOMALY: (
        "Pump {pump_num} motor temperature rising at an abnormal rate. "
        "Thermal anomaly detected — possible seal degradation or lubrication issue.",
        "Check motor cooling system and seal integrity. "
        "Reduce load if temperature exceeds 70 °C.",
    ),
    TRIGGER_DATA_STALE: (
        "Pump {pump_num} telemetry data has not been updated for more than 90 seconds. "
        "feature-extractor may be delayed or the data historian may be under pressure.",
        "Check opc-ua-collector and feature-extractor logs. "
        "Verify InfluxDB write latency is not elevated.",
    ),
    TRIGGER_COMBINED_FAULT: (
        "Pump {pump_num} is showing multiple concurrent fault signatures: "
        "vibration and thermal anomalies detected simultaneously.",
        "Halt pump operation if safe to do so. "
        "Dispatch maintenance team for full inspection.",
    ),
}

_FALLBACK_TEMPLATE: Tuple[str, str] = (
    "Pump {pump_num} health anomaly detected. Trigger: {trigger}.",
    "Investigate pump {pump_num} condition immediately.",
)


def _pump_num(pump_id: str) -> str:
    """Convert 'pump1' → '1', 'pump2' → '2', etc."""
    return pump_id.replace("pump", "")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class IncomingAlert:
    """Parsed and validated alert payload from health-scorer."""
    pump_id: str
    state: str
    overall_health: float
    vibration_score: float
    thermal_score: float
    bearing_health: float
    trigger: str
    consecutive_cycles: int
    timestamp: datetime

    @classmethod
    def from_dict(cls, data: dict) -> "IncomingAlert":
        """Parse a raw request dict.  Raises ValueError on bad input."""
        required = ("pump_id", "state", "overall_health", "trigger", "timestamp")
        missing = [k for k in required if k not in data]
        if missing:
            raise ValueError(f"Missing required fields: {missing}")

        pump_id = str(data["pump_id"])
        if pump_id not in ("pump1", "pump2", "pump3"):
            raise ValueError(f"Unknown pump_id: {pump_id!r}")

        state = str(data["state"])
        if state not in (STATE_WARNING, STATE_CRITICAL, STATE_DATA_STALE):
            raise ValueError(f"Unexpected state: {state!r}")

        ts_raw = data["timestamp"]
        if isinstance(ts_raw, datetime):
            ts = ts_raw
        else:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))

        return cls(
            pump_id=pump_id,
            state=state,
            overall_health=float(data.get("overall_health", 0.0)),
            vibration_score=float(data.get("vibration_score", 0.0)),
            thermal_score=float(data.get("thermal_score", 0.0)),
            bearing_health=float(data.get("bearing_health", data.get("overall_health", 0.0))),
            trigger=str(data.get("trigger", TRIGGER_BEARING_FAULT)),
            consecutive_cycles=int(data.get("consecutive_cycles", 1)),
            timestamp=ts,
        )


@dataclass
class EnrichedAlert:
    """Alert after enrichment — ready to write to JSONL and serve via REST."""
    alert_id: str
    pump_id: str
    state: str
    severity: str
    overall_health: float
    vibration_score: float
    thermal_score: float
    bearing_health: float
    trigger: str
    consecutive_cycles: int
    description: str
    recommended_action: str
    received_at: datetime
    source_timestamp: datetime

    def to_dict(self) -> dict:
        return {
            "alert_id": self.alert_id,
            "pump_id": self.pump_id,
            "state": self.state,
            "severity": self.severity,
            "overall_health": self.overall_health,
            "vibration_score": self.vibration_score,
            "thermal_score": self.thermal_score,
            "bearing_health": self.bearing_health,
            "trigger": self.trigger,
            "consecutive_cycles": self.consecutive_cycles,
            "description": self.description,
            "recommended_action": self.recommended_action,
            "received_at": self.received_at.isoformat(),
            "source_timestamp": self.source_timestamp.isoformat(),
        }

    @property
    def is_active(self) -> bool:
        return self.state in (STATE_WARNING, STATE_CRITICAL, STATE_DATA_STALE)


# ---------------------------------------------------------------------------
# Enrichment function (pure, stateless)
# ---------------------------------------------------------------------------

def enrich(incoming: IncomingAlert) -> EnrichedAlert:
    """
    Apply enrichment templates to a validated IncomingAlert.
    Returns a fully enriched alert with a fresh UUID.
    """
    description_tmpl, recommended_tmpl = _TEMPLATES.get(
        incoming.trigger, _FALLBACK_TEMPLATE
    )
    ctx = {"pump_id": incoming.pump_id, "pump_num": _pump_num(incoming.pump_id),
           "trigger": incoming.trigger}
    description = description_tmpl.format(**ctx)
    recommended = recommended_tmpl.format(**ctx)
    severity = _SEVERITY.get(incoming.state, "WARNING")

    return EnrichedAlert(
        alert_id=str(uuid.uuid4()),
        pump_id=incoming.pump_id,
        state=incoming.state,
        severity=severity,
        overall_health=incoming.overall_health,
        vibration_score=incoming.vibration_score,
        thermal_score=incoming.thermal_score,
        bearing_health=incoming.bearing_health,
        trigger=incoming.trigger,
        consecutive_cycles=incoming.consecutive_cycles,
        description=description,
        recommended_action=recommended,
        received_at=datetime.now(timezone.utc),
        source_timestamp=incoming.timestamp,
    )


# ---------------------------------------------------------------------------
# Deduplication tracker (stateful, one instance per service lifetime)
# ---------------------------------------------------------------------------

@dataclass
class _DedupKey:
    pump_id: str
    trigger: str


@dataclass
class _DedupEntry:
    alert_id: str
    count: int = 1


class DedupTracker:
    """
    Tracks (pump_id, trigger) pairs.  After DEDUP_SUPPRESS_AFTER consecutive
    identical hits, further POSTs are suppressed.

    Resetting: call reset(pump_id, trigger) when the pump recovers or the
    trigger type changes.  main.py calls reset() after any non-duplicate POST.
    """

    def __init__(self) -> None:
        self._state: Dict[Tuple[str, str], _DedupEntry] = {}

    def check(self, pump_id: str, trigger: str) -> Optional[str]:
        """
        Returns None if the alert should be written (allowed).
        Returns the existing alert_id if the alert should be suppressed.
        """
        key = (pump_id, trigger)
        entry = self._state.get(key)
        if entry is None:
            return None
        if entry.count >= DEDUP_SUPPRESS_AFTER:
            return entry.alert_id
        return None

    def record(self, pump_id: str, trigger: str, alert_id: str) -> None:
        """Record a newly accepted alert.  Creates or increments the counter."""
        key = (pump_id, trigger)
        entry = self._state.get(key)
        if entry is None:
            self._state[key] = _DedupEntry(alert_id=alert_id, count=1)
        else:
            entry.count += 1
            entry.alert_id = alert_id   # update to latest

    def reset(self, pump_id: str, trigger: str) -> None:
        """Reset the counter for a (pump_id, trigger) pair."""
        self._state.pop((pump_id, trigger), None)

    def reset_pump(self, pump_id: str) -> None:
        """Reset all counters for a pump (e.g. pump recovered to HEALTHY)."""
        keys_to_remove = [k for k in self._state if k[0] == pump_id]
        for k in keys_to_remove:
            del self._state[k]

    def get_count(self, pump_id: str, trigger: str) -> int:
        """Return current dedup count for a key (0 = not seen)."""
        entry = self._state.get((pump_id, trigger))
        return entry.count if entry else 0
