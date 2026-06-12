"""
fault_engine.py — Person A's pure-math fault engine for the sensor sim.

No server, no asyncio, no network. Everything here is deterministic math given
an explicit time `t` (except the Gaussian noise term, which is the only source
of randomness). This lets Person A develop and test the entire value-generation
path before B's OPC-UA server or C's inject endpoint exist.

Division of responsibility (Phase 0 split):
  - A produces values   -> compute_reading(), the math helpers, FaultState.
  - B publishes them     -> owns the FaultState *instance*, reads it in emit_loop.
  - C controls when      -> mutates the FaultState *instance* via the HTTP API.

FaultState is the only shared mutable object. A defines its shape and methods;
A's compute_reading() treats it as read-only input. B creates the single
instance in main.py; C calls activate()/set_flood()/clear() on it.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

from pump_config import (
    FAULT_DEFS,
    INJECT_CLEAR_MODE,
    NOISE_SIGMA,
    PARAM_RADIAL,
    PARAM_TANGENTIAL,
    PARAMS,
    PUMP_BASELINES,
    SANITY_BOUNDS,
    SENSOR_NOISE_SPIKE_PROBABILITY,
    SENSOR_NOISE_SPIKE_SIGMA_MULT,
    FaultDef,
    Pattern,
)


# ---------------------------------------------------------------------------
# FaultState — the shared mutable object (Phase 0 contract).
# ---------------------------------------------------------------------------

@dataclass
class FaultState:
    """
    Holds the currently-active fault for ONE sensor-sim container.

    Mutated only by Person C's inject endpoint (activate / set_flood / clear).
    Read only by Person A's compute_reading() and Person B's emit loop. A new
    FaultState() with mode=None means "normal operation".

    `started_at` is a wall-clock epoch seconds timestamp captured at activation,
    used so elapsed_s() can be computed without the caller threading time
    through. compute_reading() can also take an explicit `t` for testing, which
    bypasses started_at entirely.
    """

    mode: Optional[str] = None        # active fault name, or None for normal
    duration_s: int = 0               # intended duration (advisory; engine clamps)
    started_at: Optional[float] = field(default=None)  # epoch seconds at activation
    flood: bool = False               # rate-only flag; emit loop reads this

    # --- mutation API (Person C calls these) ------------------------------

    def activate(self, mode: str, duration_s: int) -> None:
        """Activate a named fault. 'flood' is handled via set_flood()."""
        if mode not in FAULT_DEFS:
            raise ValueError(f"unknown fault mode: {mode!r}")
        fault = FAULT_DEFS[mode]
        if fault.pattern is Pattern.RATE_ONLY:
            # flood: values stay normal, only the emit RATE changes.
            self.set_flood(True)
            self.mode = mode
            self.duration_s = duration_s
            self.started_at = time.time()
        else:
            self.mode = mode
            self.duration_s = duration_s
            self.started_at = time.time()
            self.flood = False

    def set_flood(self, on: bool) -> None:
        """Toggle flood (rate-only) mode. Read by B's emit loop for cadence."""
        self.flood = on

    def clear(self) -> None:
        """Return to normal operation."""
        self.mode = None
        self.duration_s = 0
        self.started_at = None
        self.flood = False

    # --- read API (Person A / B call these) -------------------------------

    def elapsed_s(self) -> float:
        """Seconds since the active fault started; 0.0 if no fault active."""
        if self.started_at is None:
            return 0.0
        return max(0.0, time.time() - self.started_at)

    def active_fault(self) -> Optional[FaultDef]:
        """The FaultDef for the active mode, or None for normal operation."""
        if self.mode is None or self.mode == INJECT_CLEAR_MODE:
            return None
        return FAULT_DEFS.get(self.mode)


# ---------------------------------------------------------------------------
# Math helpers — pure functions.
# ---------------------------------------------------------------------------

def linear_drift(start: float, end: float, duration_s: float, elapsed_s: float) -> float:
    """
    Linearly interpolate from `start` to `end` over `duration_s`, evaluated at
    `elapsed_s`. Clamps at `end` once elapsed >= duration. Before t=0 returns
    `start`. A zero/negative duration jumps straight to `end`.
    """
    if elapsed_s <= 0:
        return start
    if duration_s <= 0 or elapsed_s >= duration_s:
        return end
    fraction = elapsed_s / duration_s
    return start + (end - start) * fraction


def step_change(target: float, elapsed_s: float) -> float:
    """
    Step fault: jump to `target` immediately at t=0 and hold. Used for
    cavitation. Before activation (elapsed < 0) the fault isn't active, so the
    caller should not invoke this; we return `target` for elapsed >= 0.
    """
    return target


def sensor_noise(value: float, sigma: float, rng: Optional[random.Random] = None) -> float:
    """Add zero-mean Gaussian noise of the given sigma to `value`."""
    r = rng if rng is not None else random
    return value + r.gauss(0.0, sigma)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


# ---------------------------------------------------------------------------
# compute_reading — the one function B and C both call.
# ---------------------------------------------------------------------------

def compute_reading(
    pump_id: str,
    fault_state: Optional[FaultState],
    t: Optional[float] = None,
    rng: Optional[random.Random] = None,
) -> Dict[str, object]:
    """
    Compute one tick of sensor output for `pump_id`.

    Returns a dict with the 5 raw parameters plus an ISO-8601 UTC `timestamp`:
        {
          "vibration_radial":     float,
          "vibration_tangential": float,
          "vibration_axial":      float,
          "temperature":          float,
          "rpm":                  float,
          "timestamp":            "2026-06-12T08:32:15.123456+00:00",
        }

    Args:
      pump_id:     "pump1" | "pump2" | "pump3".
      fault_state: the shared FaultState, or None for normal operation.
      t:           elapsed seconds into the active fault. If None, derived from
                   fault_state.elapsed_s() (real wall clock). Tests pass an
                   explicit t to make the math deterministic.
      rng:         optional random.Random for reproducible noise in tests.

    Pure math: no I/O, no asyncio. Noise is the only randomness.
    """
    if pump_id not in PUMP_BASELINES:
        raise ValueError(f"unknown pump_id: {pump_id!r}")

    baseline = PUMP_BASELINES[pump_id].as_dict()
    # Start from baseline values for every parameter.
    values: Dict[str, float] = dict(baseline)

    fault = fault_state.active_fault() if fault_state is not None else None

    if fault is not None:
        elapsed = t if t is not None else fault_state.elapsed_s()

        if fault.pattern is Pattern.LINEAR:
            for pf in fault.params:
                values[pf.param] = linear_drift(pf.start, pf.end, fault.duration_s, elapsed)

        elif fault.pattern is Pattern.STEP:
            for pf in fault.params:
                values[pf.param] = step_change(pf.end, elapsed)

        elif fault.pattern is Pattern.RATE_ONLY:
            # flood: values track baseline; only the emit RATE changes (handled
            # by B's emit loop reading fault_state.flood). Nothing to do here.
            pass

        elif fault.pattern is Pattern.NOISE:
            # sensor_noise: baseline values, but occasional large outlier spikes
            # added below alongside the normal noise term.
            pass

    # Apply Gaussian noise to every parameter.
    spike = (
        fault is not None
        and fault.pattern is Pattern.NOISE
    )
    r = rng if rng is not None else random
    for param in PARAMS:
        sigma = NOISE_SIGMA[param]
        if spike and r.random() < SENSOR_NOISE_SPIKE_PROBABILITY:
            # occasional outlier: noise at a large multiple of normal sigma
            values[param] = sensor_noise(values[param], sigma * SENSOR_NOISE_SPIKE_SIGMA_MULT, r)
        else:
            values[param] = sensor_noise(values[param], sigma, r)

    # Final clamp into physical sanity bounds (no negative RPM, etc.).
    for param in PARAMS:
        lo, hi = SANITY_BOUNDS[param]
        values[param] = _clamp(values[param], lo, hi)

    values["timestamp"] = datetime.now(timezone.utc).isoformat()
    return values


# Re-export so callers can `from fault_engine import FaultState, compute_reading`.
__all__ = [
    "FaultState",
    "compute_reading",
    "linear_drift",
    "step_change",
    "sensor_noise",
]
