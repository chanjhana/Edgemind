"""
test_faults.py — Person A's tests. Pure math, no server, no network.

Run from the sensor_sim/ directory so the engine modules import cleanly:
    cd sensor_sim && python -m pytest tests/test_faults.py -v
or, without pytest installed:
    cd sensor_sim && python tests/test_faults.py

Noise is the only randomness in the engine. Every test that asserts on a value
either (a) uses a seeded random.Random for reproducibility, or (b) asserts a
tolerance wide enough to absorb the stated noise sigma.
"""

from __future__ import annotations

import os
import random
import sys

# Allow `import pump_config` / `import fault_engine` when run from anywhere.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pump_config as cfg
from fault_engine import (
    FaultState,
    compute_reading,
    linear_drift,
    step_change,
)


def _seeded() -> random.Random:
    return random.Random(1234)


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def test_linear_drift_endpoints_and_midpoint():
    assert linear_drift(0.8, 4.8, 300, 0) == 0.8          # start
    assert linear_drift(0.8, 4.8, 300, 300) == 4.8        # end
    assert abs(linear_drift(0.8, 4.8, 300, 150) - 2.8) < 1e-9   # midpoint
    # clamps past duration
    assert linear_drift(0.8, 4.8, 300, 600) == 4.8
    # before t=0 returns start
    assert linear_drift(0.8, 4.8, 300, -10) == 0.8


def test_step_change_is_immediate():
    assert step_change(5.2, 0) == 5.2
    assert step_change(5.2, 0.001) == 5.2
    assert step_change(5.2, 999) == 5.2


# ---------------------------------------------------------------------------
# bearing_fault (Pump 2): axial 0.8 -> 4.8 over 300 s, linear
# ---------------------------------------------------------------------------

def test_bearing_fault_axial_rises_0_8_to_4_8():
    fs = FaultState()
    fs.activate("bearing_fault", duration_s=300)

    start = compute_reading("pump2", fs, t=0, rng=_seeded())
    end = compute_reading("pump2", fs, t=300, rng=_seeded())

    # axial within one noise sigma (0.15) of the documented endpoints
    assert abs(start[cfg.PARAM_AXIAL] - 0.8) < 0.5
    assert abs(end[cfg.PARAM_AXIAL] - 4.8) < 0.5

    # monotone rise across the fault
    assert end[cfg.PARAM_AXIAL] > start[cfg.PARAM_AXIAL]

    # ISO zone transitions B -> D across the fault (using clean midpoint math)
    assert cfg.iso_zone(0.8) is cfg.ISOZone.A or cfg.iso_zone(0.8) is cfg.ISOZone.B
    assert cfg.iso_zone(4.8) is cfg.ISOZone.D


def test_bearing_fault_leaves_other_params_at_baseline():
    fs = FaultState()
    fs.activate("bearing_fault", duration_s=300)
    base = cfg.PUMP_BASELINES["pump2"]
    r = compute_reading("pump2", fs, t=300, rng=_seeded())
    # radial / tangential / temp / rpm stay near baseline (within ~3 sigma)
    assert abs(r[cfg.PARAM_RADIAL] - base.radial) < 0.5
    assert abs(r[cfg.PARAM_TEMPERATURE] - base.temperature) < 2.0
    assert abs(r[cfg.PARAM_RPM] - base.rpm) < 8.0


# ---------------------------------------------------------------------------
# cavitation (Pump 2): step change, already at target at t=0
# ---------------------------------------------------------------------------

def test_cavitation_at_target_from_t0():
    fs = FaultState()
    fs.activate("cavitation", duration_s=0)
    r = compute_reading("pump2", fs, t=0, rng=_seeded())
    # radial + tangential already at the 5.2 target (within noise)
    assert abs(r[cfg.PARAM_RADIAL] - 5.2) < 0.5
    assert abs(r[cfg.PARAM_TANGENTIAL] - 5.2) < 0.5
    # RPM dropped toward 1438, temp risen toward 53
    assert abs(r[cfg.PARAM_RPM] - 1438.0) < 8.0
    assert abs(r[cfg.PARAM_TEMPERATURE] - 53.0) < 2.0


# ---------------------------------------------------------------------------
# flood (Pump 2): rate-only, values stay in normal range regardless of t
# ---------------------------------------------------------------------------

def test_flood_values_stay_in_normal_range():
    fs = FaultState()
    fs.activate("flood", duration_s=0)
    assert fs.flood is True  # emit loop will read this for cadence
    base = cfg.PUMP_BASELINES["pump2"]
    for t in (0, 30, 300, 9999):
        r = compute_reading("pump2", fs, t=t, rng=_seeded())
        # values track baseline (only the RATE changes, not the values)
        assert abs(r[cfg.PARAM_AXIAL] - base.axial) < 0.5
        assert abs(r[cfg.PARAM_RADIAL] - base.radial) < 0.5
        assert abs(r[cfg.PARAM_TEMPERATURE] - base.temperature) < 2.0


# ---------------------------------------------------------------------------
# imbalance (Pump 1): radial 2.0->5.8, tangential 1.7->5.1, temp 52->61, 240 s
# ---------------------------------------------------------------------------

def test_imbalance_radial_and_tangential_rise_together():
    fs = FaultState()
    fs.activate("imbalance", duration_s=240)
    start = compute_reading("pump1", fs, t=0, rng=_seeded())
    end = compute_reading("pump1", fs, t=240, rng=_seeded())
    assert end[cfg.PARAM_RADIAL] > start[cfg.PARAM_RADIAL]
    assert end[cfg.PARAM_TANGENTIAL] > start[cfg.PARAM_TANGENTIAL]
    assert abs(end[cfg.PARAM_RADIAL] - 5.8) < 0.5
    assert abs(end[cfg.PARAM_TANGENTIAL] - 5.1) < 0.5
    assert abs(end[cfg.PARAM_TEMPERATURE] - 61.0) < 2.0


# ---------------------------------------------------------------------------
# overheat (Pump 3): temp 42->79 over 300 s
# ---------------------------------------------------------------------------

def test_overheat_temperature_rises_to_79():
    fs = FaultState()
    fs.activate("overheat", duration_s=300)
    end = compute_reading("pump3", fs, t=300, rng=_seeded())
    assert abs(end[cfg.PARAM_TEMPERATURE] - 79.0) < 2.0
    assert end[cfg.PARAM_TEMPERATURE] > cfg.TEMP_WARNING_MAX  # > 75 -> critical band


# ---------------------------------------------------------------------------
# Normal operation: every pump within its documented baseline range (+/- noise)
# ---------------------------------------------------------------------------

def test_normal_operation_within_baseline():
    for pump_id in cfg.PUMP_IDS:
        fs = FaultState()  # no fault active
        base = cfg.PUMP_BASELINES[pump_id]
        r = compute_reading(pump_id, fs, rng=_seeded())
        assert abs(r[cfg.PARAM_AXIAL] - base.axial) < 0.6
        assert abs(r[cfg.PARAM_RADIAL] - base.radial) < 0.6
        assert abs(r[cfg.PARAM_RPM] - base.rpm) < 8.0


# ---------------------------------------------------------------------------
# Sanity bounds: no physically impossible values, ever, across many draws
# ---------------------------------------------------------------------------

def test_values_stay_within_sanity_bounds():
    r = random.Random(7)
    for pump_id in cfg.PUMP_IDS:
        for mode in cfg.FAULT_DEFS:
            fs = FaultState()
            fs.activate(mode, duration_s=300)
            for t in (0, 60, 150, 300, 1000):
                reading = compute_reading(pump_id, fs, t=t, rng=r)
                for param in cfg.PARAMS:
                    lo, hi = cfg.SANITY_BOUNDS[param]
                    assert lo <= reading[param] <= hi, (
                        f"{pump_id}/{mode}/t={t}: {param}={reading[param]} "
                        f"outside [{lo}, {hi}]"
                    )
                assert "timestamp" in reading


# ---------------------------------------------------------------------------
# FaultState lifecycle: activate -> clear returns to normal
# ---------------------------------------------------------------------------

def test_faultstate_clear_returns_to_normal():
    fs = FaultState()
    fs.activate("bearing_fault", duration_s=300)
    assert fs.mode == "bearing_fault"
    fs.clear()
    assert fs.mode is None
    assert fs.flood is False
    assert fs.active_fault() is None
    # after clear, readings are back at baseline
    base = cfg.PUMP_BASELINES["pump2"]
    r = compute_reading("pump2", fs, rng=_seeded())
    assert abs(r[cfg.PARAM_AXIAL] - base.axial) < 0.6


def test_unknown_mode_rejected():
    fs = FaultState()
    try:
        fs.activate("not_a_real_fault", duration_s=300)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown fault mode")


# ---------------------------------------------------------------------------
# Allow running directly without pytest.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = 0
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        try:
            test()
            print(f"PASS  {test.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL  {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
