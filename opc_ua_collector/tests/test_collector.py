"""
Unit tests for the collector's pure logic — no OPC-UA server, no InfluxDB.

    cd <repo root> && python -m pytest opc_ua_collector/tests -v
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_COMP = os.path.dirname(_HERE)               # opc_ua_collector/
_ROOT = os.path.dirname(_COMP)               # repo root
for p in (_COMP, _ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)

from common.contract import (
    PARAM_AXIAL,
    PARAM_RPM,
    PARAM_TEMPERATURE,
    PARAMS,
)
from collector import TelemetryBuffer, in_bounds, is_valid


# ── validation ──────────────────────────────────────────────────────────────────

def test_in_bounds():
    assert in_bounds(PARAM_AXIAL, 2.5) is True
    assert in_bounds(PARAM_AXIAL, -0.1) is False      # below 0
    assert in_bounds(PARAM_RPM, 5000) is False        # above 3000
    assert in_bounds(PARAM_TEMPERATURE, 50) is True


def test_is_valid_rejects_bad_quality():
    assert is_valid(PARAM_AXIAL, 2.0, quality_good=True) is True
    assert is_valid(PARAM_AXIAL, 2.0, quality_good=False) is False


def test_is_valid_rejects_out_of_bounds_and_nan():
    assert is_valid(PARAM_RPM, 99999, quality_good=True) is False
    assert is_valid(PARAM_AXIAL, float("nan"), quality_good=True) is False
    assert is_valid(PARAM_AXIAL, float("inf"), quality_good=True) is False
    assert is_valid(PARAM_AXIAL, "not a number", quality_good=True) is False


# ── buffer grouping ──────────────────────────────────────────────────────────────

def _feed_full_tick(buf: TelemetryBuffer, pump_id: str, ts, base: float = 1.0):
    for i, param in enumerate(PARAMS):
        buf.update(pump_id, param, base + i, ts)


def test_complete_sample_emitted_when_all_params_present():
    buf = TelemetryBuffer()
    _feed_full_tick(buf, "pump2", ts="T1")
    out = buf.drain()
    assert len(out) == 1
    pump_id, vals, ts = out[0]
    assert pump_id == "pump2"
    assert ts == "T1"
    assert set(vals.keys()) == set(PARAMS)
    assert buf.completed_count == 1


def test_incomplete_tick_not_emitted():
    buf = TelemetryBuffer()
    # only 4 of 5 params
    for param in PARAMS[:-1]:
        buf.update("pump1", param, 1.0, ts="T1")
    assert buf.drain() == []
    assert buf.pending_count == 1


def test_drain_clears_queue():
    buf = TelemetryBuffer()
    _feed_full_tick(buf, "pump1", ts="T1")
    assert len(buf.drain()) == 1
    assert buf.drain() == []          # second drain is empty


def test_separate_timestamps_are_separate_samples():
    buf = TelemetryBuffer()
    _feed_full_tick(buf, "pump2", ts="T1")
    _feed_full_tick(buf, "pump2", ts="T2")
    out = buf.drain()
    assert len(out) == 2
    assert {s[2] for s in out} == {"T1", "T2"}


def test_interleaved_pumps_grouped_independently():
    buf = TelemetryBuffer()
    # interleave pump1 and pump2 at the same ts key
    for param in PARAMS:
        buf.update("pump1", param, 1.0, ts="T1")
        buf.update("pump2", param, 2.0, ts="T1")
    out = buf.drain()
    assert len(out) == 2
    pumps = {s[0] for s in out}
    assert pumps == {"pump1", "pump2"}


def test_record_drop_counts():
    buf = TelemetryBuffer()
    buf.record_drop()
    buf.record_drop()
    assert buf.dropped_bad == 2


def test_pending_is_bounded():
    buf = TelemetryBuffer(max_pending=10)
    # create 50 incomplete buckets (one param each) -> pending must stay bounded
    for i in range(50):
        buf.update("pump1", PARAMS[0], 1.0, ts=f"T{i}")
    assert buf.pending_count <= 10
