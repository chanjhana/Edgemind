"""
collector.py — pure logic for the opc-ua-collector.

Deliberately free of asyncua / influxdb imports so it is unit-testable without a
live OPC-UA server or InfluxDB. main.py wires this logic to the real OPC-UA
subscription and the async InfluxDB writer.

Responsibilities:
  • validate each incoming reading (quality flag + physical bounds)
  • group per-tick notifications into complete 5-parameter samples
  • hand complete samples to the flush loop for batched InfluxDB writes

Grouping strategy: the sensor writes all 5 parameter nodes in one tick sharing a
single SourceTimestamp (see sensor_sim/opc_server.update_nodes). So we bucket
incoming values by (pump_id, source_timestamp); when all 5 PARAMS for a bucket
have arrived, that bucket is a complete sample. This is robust to notification
ordering and captures every tick at 1 Hz and 10 Hz (flood) alike.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from common.contract import PARAMS, SANITY_BOUNDS


def in_bounds(param: str, value: float) -> bool:
    """True if value is within the parameter's physical sanity bounds."""
    lo, hi = SANITY_BOUNDS[param]
    return lo <= value <= hi


def is_valid(param: str, value: Any, quality_good: bool) -> bool:
    """A reading is valid iff quality is good, value is finite, and in bounds."""
    if not quality_good:
        return False
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False
    if v != v or v in (float("inf"), float("-inf")):  # NaN / inf
        return False
    return in_bounds(param, v)


# A complete sample handed to the flush loop: (pump_id, {param: value}, timestamp)
Sample = Tuple[str, Dict[str, float], Any]


class TelemetryBuffer:
    """
    Accumulates per-tick parameter values into complete 5-parameter samples.

    update() is called from the OPC-UA data-change handler for every valid
    reading. When a (pump_id, timestamp) bucket holds all 5 PARAMS it becomes a
    completed sample, queued for the next flush. drain() returns and clears the
    queue of completed samples (called every 500 ms by the flush loop).

    Incomplete buckets older than `stale_after` completed samples are pruned so a
    sensor that drops a parameter mid-tick can never leak memory.
    """

    def __init__(self, max_pending: int = 2000) -> None:
        # key (pump_id, ts_key) -> {param: value}
        self._pending: Dict[Tuple[str, Any], Dict[str, float]] = {}
        self._completed: List[Sample] = []
        self._max_pending = max_pending
        # metrics for logging / tests
        self.dropped_bad = 0
        self.completed_count = 0

    def record_drop(self) -> None:
        """Account for a reading rejected by is_valid()."""
        self.dropped_bad += 1

    def update(self, pump_id: str, param: str, value: float, ts: Any) -> None:
        """Add one validated parameter value to its (pump, timestamp) bucket."""
        key = (pump_id, ts)
        bucket = self._pending.get(key)
        if bucket is None:
            bucket = {}
            self._pending[key] = bucket
        bucket[param] = float(value)

        if all(p in bucket for p in PARAMS):
            self._completed.append((pump_id, dict(bucket), ts))
            self.completed_count += 1
            del self._pending[key]

        # Bound memory: if too many incomplete buckets pile up, drop the oldest.
        if len(self._pending) > self._max_pending:
            oldest = next(iter(self._pending))
            del self._pending[oldest]

    def drain(self) -> List[Sample]:
        """Return all completed samples since the last drain and clear the queue."""
        out = self._completed
        self._completed = []
        return out

    @property
    def pending_count(self) -> int:
        return len(self._pending)
