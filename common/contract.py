"""
common/contract.py — single source of truth for the pump-station DATA PIPELINE.

The sensor layer owns `sensor_sim/pump_config.py`. The downstream pipeline
(opc-ua-collector, feature-extractor, …) runs in separate container images that
do not ship `sensor_sim/`, so the constants they share with the sensors are
mirrored here verbatim. `common/tests/test_contract_matches_pump_config.py`
asserts the two never diverge.

This module also defines the InfluxDB schema (bucket + measurement/field names)
that every pipeline component reads from and writes to.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# OPC-UA address-space contract (mirror of sensor_sim/pump_config.py)
# The collector browses Objects/PumpStation/Pump<N>/<NodeName> using these.
# ---------------------------------------------------------------------------

PARAM_RADIAL = "vibration_radial"
PARAM_TANGENTIAL = "vibration_tangential"
PARAM_AXIAL = "vibration_axial"
PARAM_TEMPERATURE = "temperature"
PARAM_RPM = "rpm"

PARAMS: List[str] = [
    PARAM_RADIAL,
    PARAM_TANGENTIAL,
    PARAM_AXIAL,
    PARAM_TEMPERATURE,
    PARAM_RPM,
]

OPC_NODE_NAMES: Dict[str, str] = {
    PARAM_RADIAL: "VibrationRadial",
    PARAM_TANGENTIAL: "VibrationTangential",
    PARAM_AXIAL: "VibrationAxial",
    PARAM_TEMPERATURE: "Temperature",
    PARAM_RPM: "RPM",
}

OPC_TIMESTAMP_NODE = "Timestamp"
OPC_NAMESPACE_URI = "http://edgemind.abb/pump-station"
OPC_ROOT_OBJECT = "PumpStation"

OPC_PUMP_OBJECT: Dict[str, str] = {
    "pump1": "Pump1",
    "pump2": "Pump2",
    "pump3": "Pump3",
}

PUMP_IDS: List[str] = list(OPC_PUMP_OBJECT.keys())

# ---------------------------------------------------------------------------
# Physical sanity bounds (mirror). The collector drops any reading outside
# these ranges as bad quality.
# ---------------------------------------------------------------------------

SANITY_BOUNDS: Dict[str, Tuple[float, float]] = {
    PARAM_RADIAL: (0.0, 15.0),
    PARAM_TANGENTIAL: (0.0, 15.0),
    PARAM_AXIAL: (0.0, 15.0),
    PARAM_TEMPERATURE: (-10.0, 150.0),
    PARAM_RPM: (0.0, 3000.0),
}

# ---------------------------------------------------------------------------
# Per-pump baselines (mirror; midpoints of normal operating ranges).
# feature-extractor needs the axial baseline for the bearing-health formula.
# Stored as plain param->value dicts keyed by pump_id.
# ---------------------------------------------------------------------------

PUMP_BASELINES: Dict[str, Dict[str, float]] = {
    "pump1": {
        PARAM_RADIAL: 2.05,
        PARAM_TANGENTIAL: 1.75,
        PARAM_AXIAL: 1.0,
        PARAM_TEMPERATURE: 51.5,
        PARAM_RPM: 1451.5,
    },
    "pump2": {
        PARAM_RADIAL: 1.65,
        PARAM_TANGENTIAL: 1.4,
        PARAM_AXIAL: 0.8,
        PARAM_TEMPERATURE: 46.5,
        PARAM_RPM: 1452.5,
    },
    "pump3": {
        PARAM_RADIAL: 1.0,
        PARAM_TANGENTIAL: 0.8,
        PARAM_AXIAL: 0.45,
        PARAM_TEMPERATURE: 41.5,
        PARAM_RPM: 960.5,
    },
}


def axial_baseline(pump_id: str) -> float:
    """Axial-vibration baseline for a pump (used by the bearing-health formula)."""
    return PUMP_BASELINES[pump_id][PARAM_AXIAL]


# ---------------------------------------------------------------------------
# InfluxDB schema — bucket, measurements, tag, and field names.
# Every pipeline component reads/writes through these constants.
# ---------------------------------------------------------------------------

INFLUX_BUCKET = "pump_station"

TAG_PUMP_ID = "pump_id"

# Raw telemetry written by opc-ua-collector. Fields are the 5 raw PARAMS.
M_TELEMETRY = "pump_telemetry"

# Derived features written by feature-extractor.
M_FEATURES = "pump_features"
F_VIB_RMS_TREND = "vibration_rms_trend"
F_AXIAL_DOMINANCE = "axial_dominance_ratio"
F_TEMP_RATE = "temp_rate_of_change"
F_RPM_STABILITY = "rpm_stability"
F_BEARING_HEALTH = "bearing_health"

FEATURE_FIELDS: List[str] = [
    F_VIB_RMS_TREND,
    F_AXIAL_DOMINANCE,
    F_TEMP_RATE,
    F_RPM_STABILITY,
    F_BEARING_HEALTH,
]

# Health-state thresholds on bearing_health (used downstream by health-scorer;
# defined here so the whole pipeline agrees).
HEALTH_HEALTHY_MIN = 75.0   # >= 75      -> HEALTHY
HEALTH_WARNING_MIN = 50.0   # 50 .. 75   -> WARNING ; < 50 -> CRITICAL
