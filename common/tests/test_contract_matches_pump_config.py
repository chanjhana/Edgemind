"""
Guard test: the pipeline contract (common/contract.py) must never drift from the
sensor layer's source of truth (sensor_sim/pump_config.py).

Runs in dev where both modules are present. (In containers only common/ ships, so
this test is a development-time guard, not a runtime dependency.)

    cd <repo root> && python -m pytest common/tests -v
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
_SENSOR = os.path.join(_ROOT, "sensor_sim")
for p in (_ROOT, _SENSOR):
    if p not in sys.path:
        sys.path.insert(0, p)

from common import contract as C
import pump_config as PC  # noqa: E402  (sensor_sim/pump_config.py)


def test_opc_constants_match():
    assert C.PARAMS == PC.PARAMS
    assert C.OPC_NODE_NAMES == PC.OPC_NODE_NAMES
    assert C.OPC_TIMESTAMP_NODE == PC.OPC_TIMESTAMP_NODE
    assert C.OPC_NAMESPACE_URI == PC.OPC_NAMESPACE_URI
    assert C.OPC_ROOT_OBJECT == PC.OPC_ROOT_OBJECT
    assert C.OPC_PUMP_OBJECT == PC.OPC_PUMP_OBJECT


def test_sanity_bounds_match():
    assert C.SANITY_BOUNDS == PC.SANITY_BOUNDS


def test_pump_baselines_match():
    # pump_config stores PumpBaseline dataclasses; compare via .as_dict().
    for pump_id, baseline in PC.PUMP_BASELINES.items():
        assert C.PUMP_BASELINES[pump_id] == baseline.as_dict(), (
            f"baseline drift for {pump_id}"
        )


def test_pump_ids_match():
    assert C.PUMP_IDS == PC.PUMP_IDS
