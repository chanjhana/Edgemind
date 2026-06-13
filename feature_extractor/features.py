"""
features.py — pure feature math for the feature-extractor.

No InfluxDB import here, so the math is unit-testable on synthetic arrays.
main.py queries InfluxDB and calls compute_features() with the resulting arrays.

Features (per pump, over a 5-minute window) — exact definitions from the
Data Synthesis doc:

  vibration_rms_trend   linregress slope of per-sample vibration RMS vs time
  axial_dominance_ratio mean(axial) / (mean(radial) + mean(tangential))
  temp_rate_of_change   linregress slope of temperature vs time
  rpm_stability         std(rpm)
  bearing_health        100 - vibration_penalty - temp_penalty - rpm_penalty
                          vibration_penalty = clip((mean_axial - axial_baseline)
                                                    / axial_baseline, 0, 1) * 40
                          temp_penalty      = clip((mean_temp - 60) / 20, 0, 1) * 30
                          rpm_penalty       = clip(rpm_std / 10, 0, 1) * 30
"""

from __future__ import annotations

from typing import Dict, Sequence

import numpy as np
from scipy import stats

from common.contract import (
    F_AXIAL_DOMINANCE,
    F_BEARING_HEALTH,
    F_RPM_STABILITY,
    F_TEMP_RATE,
    F_VIB_RMS_TREND,
    axial_baseline,
)

# Minimum samples needed for a meaningful regression (cold-start guard).
MIN_SAMPLES = 3


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _slope(times_s: Sequence[float], values: Sequence[float]) -> float:
    """Linear-regression slope of values vs time (per second). 0.0 if degenerate.

    Times are rebased to start at 0 before regression. This matters because the
    inputs are epoch seconds (~1.7e9): a relative-tolerance equality check on
    raw epoch values would treat a 5-minute span as "all equal" (rtol*1.7e9 ≈
    hours) and wrongly report a zero slope. Rebasing also conditions the fit.
    """
    t = np.asarray(times_s, dtype=float)
    v = np.asarray(values, dtype=float)
    if t.size < 2:
        return 0.0
    t = t - t.min()
    if np.ptp(t) == 0.0:           # all samples share one timestamp
        return 0.0
    result = stats.linregress(t, v)
    slope = float(result.slope)
    return slope if np.isfinite(slope) else 0.0


def bearing_health(mean_axial: float, axial_base: float, mean_temp: float, rpm_std: float) -> float:
    """Edgenius-style bearing-health score (0-100). Higher is healthier."""
    vibration_penalty = _clip01((mean_axial - axial_base) / axial_base) * 40.0
    temp_penalty = _clip01((mean_temp - 60.0) / 20.0) * 30.0
    rpm_penalty = _clip01(rpm_std / 10.0) * 30.0
    return 100.0 - vibration_penalty - temp_penalty - rpm_penalty


def compute_features(
    pump_id: str,
    times_s: Sequence[float],
    radial: Sequence[float],
    tangential: Sequence[float],
    axial: Sequence[float],
    temperature: Sequence[float],
    rpm: Sequence[float],
) -> Dict[str, float]:
    """
    Compute the 5 derived features for one pump from a window of raw samples.

    `times_s` are relative seconds (any consistent origin); only differences
    matter for the regression slopes. Returns a dict keyed by the contract's
    feature field names.
    """
    r = np.asarray(radial, dtype=float)
    t = np.asarray(tangential, dtype=float)
    a = np.asarray(axial, dtype=float)
    temp = np.asarray(temperature, dtype=float)
    speed = np.asarray(rpm, dtype=float)

    # Per-sample vibration RMS magnitude across the 3 axes.
    vib_rms = np.sqrt(r**2 + t**2 + a**2)

    mean_axial = float(np.mean(a))
    mean_radial = float(np.mean(r))
    mean_tangential = float(np.mean(t))
    mean_temp = float(np.mean(temp))
    rpm_std = float(np.std(speed))

    denom = mean_radial + mean_tangential
    axial_dominance = mean_axial / denom if denom > 1e-9 else 0.0

    return {
        F_VIB_RMS_TREND: _slope(times_s, vib_rms),
        F_AXIAL_DOMINANCE: axial_dominance,
        F_TEMP_RATE: _slope(times_s, temp),
        F_RPM_STABILITY: rpm_std,
        F_BEARING_HEALTH: bearing_health(mean_axial, axial_baseline(pump_id), mean_temp, rpm_std),
    }
