"""
pump_config.py — single source of truth for the EdgeMind pump-station sensor sim.

Phase 0 contract. Person A owns this file; Persons B and C import constants from
it but never mutate it. Every baseline, fault definition, noise sigma, ISO zone
threshold, and the OPC-UA address-space layout lives here so that no component
drifts on the numbers.

All numeric values come directly from the "Data Synthesis" design doc
(Sensor Simulation Design — Pump Station) and match the v2 architecture doc.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Parameter names — the canonical 5 raw parameters every sensor emits.
# These exact strings are the keys of the dict returned by compute_reading()
# (Person A) and map to OPC-UA node display names (Person B). Do not rename.
# ---------------------------------------------------------------------------

PARAM_RADIAL = "vibration_radial"
PARAM_TANGENTIAL = "vibration_tangential"
PARAM_AXIAL = "vibration_axial"
PARAM_TEMPERATURE = "temperature"
PARAM_RPM = "rpm"

# Order matters for OPC-UA node creation and deterministic test output.
PARAMS: List[str] = [
    PARAM_RADIAL,
    PARAM_TANGENTIAL,
    PARAM_AXIAL,
    PARAM_TEMPERATURE,
    PARAM_RPM,
]

# Internal snake_case parameter name -> OPC-UA node display name.
# Person B builds Objects/PumpStation/PumpN/<NodeName> using these exact strings
# so the (future) opc-ua-collector can rely on them.
OPC_NODE_NAMES: Dict[str, str] = {
    PARAM_RADIAL: "VibrationRadial",
    PARAM_TANGENTIAL: "VibrationTangential",
    PARAM_AXIAL: "VibrationAxial",
    PARAM_TEMPERATURE: "Temperature",
    PARAM_RPM: "RPM",
}

# Timestamp node lives alongside the 5 parameter nodes (DateTime, not Float).
OPC_TIMESTAMP_NODE = "Timestamp"

# OPC-UA namespace URI and the object-tree root. Person B registers this URI and
# builds the subtree below it: Objects/PumpStation/PumpN/...
OPC_NAMESPACE_URI = "http://edgemind.abb/pump-station"
OPC_ROOT_OBJECT = "PumpStation"

# pump_id -> the OPC-UA object name under PumpStation/ (e.g. "Pump1").
OPC_PUMP_OBJECT: Dict[str, str] = {
    "pump1": "Pump1",
    "pump2": "Pump2",
    "pump3": "Pump3",
}

# ---------------------------------------------------------------------------
# Emission frequency
# ---------------------------------------------------------------------------

NORMAL_HZ = 1.0     # one reading per second per pump under normal operation
FLOOD_HZ = 10.0     # flood mode: 10x the emission RATE; values stay normal

NORMAL_PERIOD_S = 1.0 / NORMAL_HZ   # 1.0 s
FLOOD_PERIOD_S = 1.0 / FLOOD_HZ     # 0.1 s

# ---------------------------------------------------------------------------
# Noise (Gaussian sigma applied on top of every reading)
#   vibration ±0.15 mm/s, temperature ±0.5 °C, RPM ±2
# ---------------------------------------------------------------------------

NOISE_SIGMA: Dict[str, float] = {
    PARAM_RADIAL: 0.15,
    PARAM_TANGENTIAL: 0.15,
    PARAM_AXIAL: 0.15,
    PARAM_TEMPERATURE: 0.5,
    PARAM_RPM: 2.0,
}

# ---------------------------------------------------------------------------
# Physical sanity bounds — every emitted value is clamped into these ranges so
# noise/faults can never produce something physically impossible (e.g. negative
# RPM). compute_reading() applies these as the final step.
# ---------------------------------------------------------------------------

SANITY_BOUNDS: Dict[str, Tuple[float, float]] = {
    PARAM_RADIAL: (0.0, 15.0),
    PARAM_TANGENTIAL: (0.0, 15.0),
    PARAM_AXIAL: (0.0, 15.0),
    PARAM_TEMPERATURE: (-10.0, 150.0),
    PARAM_RPM: (0.0, 3000.0),
}


# ---------------------------------------------------------------------------
# Per-pump baselines — the mid-value the simulator emits at rest (before noise).
# Stored as the midpoint of the doc's normal-operation range so noise of the
# stated sigma keeps readings inside that range most of the time.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PumpBaseline:
    """Normal-operation midpoint per parameter for one pump."""

    pump_id: str
    name: str
    radial: float
    tangential: float
    axial: float
    temperature: float
    rpm: float

    def as_dict(self) -> Dict[str, float]:
        return {
            PARAM_RADIAL: self.radial,
            PARAM_TANGENTIAL: self.tangential,
            PARAM_AXIAL: self.axial,
            PARAM_TEMPERATURE: self.temperature,
            PARAM_RPM: self.rpm,
        }


# Midpoints of the doc's per-pump baseline ranges.
PUMP_BASELINES: Dict[str, PumpBaseline] = {
    "pump1": PumpBaseline(
        pump_id="pump1",
        name="Pump 1 (Primary transfer, 75 kW, 1450 RPM)",
        radial=2.05,        # range 1.8 - 2.3
        tangential=1.75,    # range 1.5 - 2.0
        axial=1.0,          # range 0.8 - 1.2
        temperature=51.5,   # range 48 - 55
        rpm=1451.5,         # range 1448 - 1455
    ),
    "pump2": PumpBaseline(
        pump_id="pump2",
        name="Pump 2 (Secondary transfer, 45 kW, 1450 RPM)",
        radial=1.65,        # range 1.4 - 1.9
        tangential=1.4,     # range 1.2 - 1.6
        axial=0.8,          # range 0.6 - 1.0
        temperature=46.5,   # range 43 - 50
        rpm=1452.5,         # range 1449 - 1456
    ),
    "pump3": PumpBaseline(
        pump_id="pump3",
        name="Pump 3 (Chemical dosing, 7.5 kW, 960 RPM, 6-pole)",
        radial=1.0,         # range 0.8 - 1.2
        tangential=0.8,     # range 0.6 - 1.0
        axial=0.45,         # range 0.3 - 0.6
        temperature=41.5,   # range 38 - 45
        rpm=960.5,          # range 958 - 963
    ),
}

PUMP_IDS: List[str] = list(PUMP_BASELINES.keys())


# ---------------------------------------------------------------------------
# Fault definitions
# ---------------------------------------------------------------------------

class Pattern(str, Enum):
    """How a single parameter's value evolves over the life of a fault."""

    LINEAR = "linear"        # linear drift start -> end over duration_s
    STEP = "step"            # jump to `end` immediately at t=0, sustained
    RATE_ONLY = "rate_only"  # values unchanged; only emission RATE changes
    NOISE = "noise"          # occasional random spikes on all parameters


@dataclass(frozen=True)
class ParamFault:
    """How one parameter changes during a fault (start -> end value)."""

    param: str
    start: float
    end: float


@dataclass(frozen=True)
class FaultDef:
    """
    A named fault on a specific pump.

    `pattern` governs time evolution. `params` lists parameters that deviate
    from baseline; any parameter not listed stays at baseline (+noise). For
    RATE_ONLY (flood) and NOISE faults, `params` is empty — values track
    baseline and only the cadence / spikiness changes.
    """

    name: str
    pump_id: str
    pattern: Pattern
    duration_s: int
    params: List[ParamFault] = field(default_factory=list)
    description: str = ""


# Single-pump faults, values straight from the "Fault Values" section.
FAULT_DEFS: Dict[str, FaultDef] = {
    "imbalance": FaultDef(
        name="imbalance",
        pump_id="pump1",
        pattern=Pattern.LINEAR,
        duration_s=240,  # 4 min
        params=[
            ParamFault(PARAM_RADIAL, 2.0, 5.8),
            ParamFault(PARAM_TANGENTIAL, 1.7, 5.1),
            ParamFault(PARAM_TEMPERATURE, 52.0, 61.0),
            # RPM unchanged
        ],
        description="Radial + tangential rise together with temperature.",
    ),
    "seal_leak": FaultDef(
        name="seal_leak",
        pump_id="pump1",
        pattern=Pattern.LINEAR,
        duration_s=360,  # 6 min
        params=[
            ParamFault(PARAM_TEMPERATURE, 51.0, 74.0),
            ParamFault(PARAM_AXIAL, 1.0, 2.6),
            ParamFault(PARAM_RPM, 1451.0, 1443.0),
            # radial + tangential unchanged
        ],
        description="Temperature rises sharply, axial moderate rise, RPM slight drop.",
    ),
    "bearing_fault": FaultDef(
        name="bearing_fault",
        pump_id="pump2",
        pattern=Pattern.LINEAR,
        duration_s=300,  # 5 min
        params=[
            ParamFault(PARAM_AXIAL, 0.8, 4.8),  # Zone B -> Zone D
            # everything else unchanged
        ],
        description="Axial vibration rises; everything else unchanged.",
    ),
    "cavitation": FaultDef(
        name="cavitation",
        pump_id="pump2",
        pattern=Pattern.STEP,
        duration_s=0,  # step: sustained from t=0 until cleared
        params=[
            ParamFault(PARAM_RADIAL, 1.6, 5.2),
            ParamFault(PARAM_TANGENTIAL, 1.6, 5.2),
            ParamFault(PARAM_RPM, 1452.0, 1438.0),
            ParamFault(PARAM_TEMPERATURE, 47.0, 53.0),
        ],
        description="Radial + tangential sudden spike, RPM drop, temp rise.",
    ),
    "flood": FaultDef(
        name="flood",
        pump_id="pump2",
        pattern=Pattern.RATE_ONLY,
        duration_s=0,  # sustained until cleared
        params=[],  # values stay in normal range; only emission rate changes
        description="All parameters at 10x emission RATE; values unchanged.",
    ),
    "overheat": FaultDef(
        name="overheat",
        pump_id="pump3",
        pattern=Pattern.LINEAR,
        duration_s=300,  # 5 min
        params=[
            ParamFault(PARAM_TEMPERATURE, 42.0, 79.0),
            ParamFault(PARAM_RPM, 960.0, 951.0),
            ParamFault(PARAM_RADIAL, 1.0, 1.7),
        ],
        description="Temperature rises, RPM slight drop, radial slight rise.",
    ),
    "sensor_noise": FaultDef(
        name="sensor_noise",
        pump_id="any",
        pattern=Pattern.NOISE,
        duration_s=0,  # sustained until cleared
        params=[],
        description="Random spikes on all parameters; occasional outliers.",
    ),
}

# Combined scenarios are NOT separate fault defs — they are produced by injecting
# two single-pump faults on two different sensor-sim containers at once
# (e.g. flood on pump2 + overheat on pump3). The inject API (Person C) is
# per-container, so combined scenarios need no special handling in the engine.
# Listed for documentation / test reference only.
COMBINED_SCENARIOS: Dict[str, List[str]] = {
    "combined_cascade": ["flood", "overheat"],                    # pump2 + pump3
    "combined_primary_failure": ["imbalance", "bearing_fault"],   # pump1 + pump2
}

# sensor_noise applies to any pump; the occasional outlier spike magnitude as a
# multiple of the parameter's normal sigma, and how often a tick gets a spike.
SENSOR_NOISE_SPIKE_SIGMA_MULT = 8.0
SENSOR_NOISE_SPIKE_PROBABILITY = 0.05  # ~5% of ticks get a spike


# ---------------------------------------------------------------------------
# ISO 10816-3 vibration zones + temperature bands (severity framing; the
# bearing-health score is computed downstream by feature-extractor, not here).
# ---------------------------------------------------------------------------

class ISOZone(str, Enum):
    A = "A"  # <= 1.4 mm/s — newly commissioned, excellent
    B = "B"  # 1.4 - 2.8   — acceptable, long-term operation
    C = "C"  # 2.8 - 4.5   — investigate, restricted operation
    D = "D"  # > 4.5       — damage occurring, take out of service


# (upper_bound_inclusive, zone) ascending; anything above the last -> Zone D.
ISO_ZONE_BOUNDS: List[Tuple[float, ISOZone]] = [
    (1.4, ISOZone.A),
    (2.8, ISOZone.B),
    (4.5, ISOZone.C),
]


def iso_zone(vibration_mm_s: float) -> ISOZone:
    """Classify a vibration RMS value into its ISO 10816-3 zone."""
    for upper, zone in ISO_ZONE_BOUNDS:
        if vibration_mm_s <= upper:
            return zone
    return ISOZone.D


# Temperature bands (°C): normal 40-60, warning 60-75, critical > 75.
TEMP_NORMAL_MAX = 60.0
TEMP_WARNING_MAX = 75.0


# ---------------------------------------------------------------------------
# Inject API contract (Phase 0). Person C implements the server; Person B's
# emit loop reads the resulting FaultState. Documented here so all three agree.
#
#   POST /inject   body: {"mode": "<mode>", "duration_s": 300}
#                  (pump_id is fixed per container via env var, NOT in the body)
#                  response: {"ok": true, "active_fault": "<mode>|null"}
#
#   GET  /status   response: {"pump_id", "active_fault", "elapsed_s", "readings"}
#
# Valid modes: every key in FAULT_DEFS, plus "clear" (cancel the active fault).
# A mode whose FaultDef.pump_id does not match this container's pump is still
# accepted (e.g. injecting "bearing_fault" on pump1) — the engine applies the
# named fault's parameter curves regardless. FaultDef.pump_id is advisory (which
# pump the scenario is designed for), not an enforcement gate.
# ---------------------------------------------------------------------------

INJECT_CLEAR_MODE = "clear"
INJECT_DEFAULT_DURATION_S = 300


def valid_inject_modes() -> List[str]:
    """All accepted /inject mode strings (fault names + 'clear')."""
    return list(FAULT_DEFS.keys()) + [INJECT_CLEAR_MODE]
