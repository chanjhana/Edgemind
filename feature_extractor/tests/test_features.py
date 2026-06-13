"""
Unit tests for feature math — synthetic arrays, no InfluxDB.

    cd <repo root> && python -m pytest feature_extractor/tests -v
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_COMP = os.path.dirname(_HERE)               # feature_extractor/
_ROOT = os.path.dirname(_COMP)               # repo root
for p in (_COMP, _ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)

from common.contract import (
    F_AXIAL_DOMINANCE,
    F_BEARING_HEALTH,
    F_RPM_STABILITY,
    F_TEMP_RATE,
    F_VIB_RMS_TREND,
    axial_baseline,
)
from features import bearing_health, compute_features


def _const(n, v):
    return [v] * n


# ── bearing_health formula ───────────────────────────────────────────────────────

def test_bearing_health_perfect_at_baseline():
    # axial == baseline, temp below 60, rpm stable → ~100
    h = bearing_health(mean_axial=0.8, axial_base=0.8, mean_temp=46.0, rpm_std=0.0)
    assert h == 100.0


def test_bearing_health_drops_with_axial_rise():
    base = 0.8
    healthy = bearing_health(0.8, base, 46.0, 0.0)
    degraded = bearing_health(4.8, base, 46.0, 0.0)   # Zone D axial
    assert degraded < healthy
    # axial >> baseline saturates the vibration penalty at 40 → health 60
    assert degraded == 60.0


def test_bearing_health_temp_and_rpm_penalties():
    # temp 80 (>60) saturates temp penalty (30); rpm_std 20 saturates rpm penalty (30)
    h = bearing_health(0.8, 0.8, 80.0, 20.0)
    assert h == 100.0 - 0 - 30.0 - 30.0


# ── compute_features ─────────────────────────────────────────────────────────────

def test_flat_baseline_window_is_healthy():
    n = 300
    times = list(range(n))
    base = axial_baseline("pump2")  # 0.8
    feats = compute_features(
        "pump2", times,
        radial=_const(n, 1.65), tangential=_const(n, 1.4), axial=_const(n, base),
        temperature=_const(n, 46.5), rpm=_const(n, 1452.5),
    )
    assert feats[F_BEARING_HEALTH] > 95.0
    assert abs(feats[F_VIB_RMS_TREND]) < 1e-6        # flat → ~0 slope
    assert abs(feats[F_TEMP_RATE]) < 1e-6
    assert feats[F_RPM_STABILITY] == 0.0


def test_rising_axial_gives_positive_trend_and_low_health():
    n = 300
    times = list(range(n))
    # axial ramps 0.8 → 4.8 (bearing_fault signature)
    axial = [0.8 + (4.8 - 0.8) * i / (n - 1) for i in range(n)]
    feats = compute_features(
        "pump2", times,
        radial=_const(n, 1.65), tangential=_const(n, 1.4), axial=axial,
        temperature=_const(n, 46.5), rpm=_const(n, 1452.5),
    )
    assert feats[F_VIB_RMS_TREND] > 0.0              # vibration growing
    assert feats[F_BEARING_HEALTH] < 75.0            # below HEALTHY
    # mean axial ~2.8 >> baseline 0.8 → saturates vibration penalty
    assert feats[F_BEARING_HEALTH] == 60.0


def test_trend_correct_at_epoch_scale_timestamps():
    # Regression guard: epoch-second timestamps (~1.7e9) over a 5-min span must
    # NOT collapse to a zero slope. axial ramps over a realistic epoch window.
    n = 300
    t0 = 1_780_000_000.0                     # epoch seconds
    times = [t0 + i for i in range(n)]       # 1 Hz, 300 s span
    axial = [0.8 + (4.8 - 0.8) * i / (n - 1) for i in range(n)]
    feats = compute_features(
        "pump2", times,
        radial=_const(n, 1.65), tangential=_const(n, 1.4), axial=axial,
        temperature=_const(n, 46.5), rpm=_const(n, 1452.5),
    )
    assert feats[F_VIB_RMS_TREND] > 0.005, (
        f"epoch-scale slope wrongly ~0: {feats[F_VIB_RMS_TREND]}"
    )


def test_axial_dominance_ratio():
    n = 50
    times = list(range(n))
    feats = compute_features(
        "pump2", times,
        radial=_const(n, 2.0), tangential=_const(n, 2.0), axial=_const(n, 2.0),
        temperature=_const(n, 46.0), rpm=_const(n, 1452.0),
    )
    # axial / (radial + tangential) = 2 / 4 = 0.5
    assert abs(feats[F_AXIAL_DOMINANCE] - 0.5) < 1e-9


def test_rising_temperature_gives_positive_rate():
    n = 100
    times = list(range(n))
    temp = [42.0 + (79.0 - 42.0) * i / (n - 1) for i in range(n)]  # overheat ramp
    feats = compute_features(
        "pump3", times,
        radial=_const(n, 1.0), tangential=_const(n, 0.8), axial=_const(n, 0.45),
        temperature=temp, rpm=_const(n, 960.0),
    )
    assert feats[F_TEMP_RATE] > 0.0
    assert feats[F_BEARING_HEALTH] < 100.0           # hot → temp penalty applies


def test_unstable_rpm_increases_stability_metric():
    n = 100
    times = list(range(n))
    rpm = [1452.0 + (5.0 if i % 2 else -5.0) for i in range(n)]   # ±5 jitter
    feats = compute_features(
        "pump2", times,
        radial=_const(n, 1.65), tangential=_const(n, 1.4), axial=_const(n, 0.8),
        temperature=_const(n, 46.5), rpm=rpm,
    )
    assert feats[F_RPM_STABILITY] > 4.0              # std ≈ 5
