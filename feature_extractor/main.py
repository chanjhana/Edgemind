"""
main.py — feature-extractor runtime.

Every CYCLE_S seconds, for each pump: query the last WINDOW of `pump_telemetry`
from InfluxDB, compute derived features (features.compute_features), and write
them back as `pump_features`.

Environment:
  INFLUX_URL      http://influxdb:8086
  INFLUX_TOKEN    <token>
  INFLUX_ORG      edgemind
  INFLUX_BUCKET   pump_station   (default from contract)
  CYCLE_S         30
  WINDOW          5m             (Flux duration literal)
  LEAK_MODE       false          (true → intentional memory leak for Scenario 2)
  LOG_LEVEL       INFO
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Dict, List

import numpy as np
from influxdb_client import Point
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from common.contract import (
    INFLUX_BUCKET,
    M_FEATURES,
    M_TELEMETRY,
    PARAM_AXIAL,
    PARAM_RADIAL,
    PARAM_RPM,
    PARAM_TANGENTIAL,
    PARAM_TEMPERATURE,
    PUMP_IDS,
    TAG_PUMP_ID,
)
from features import MIN_SAMPLES, compute_features

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s  [%(levelname)-8s]  feature-extractor — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("feature-extractor")

INFLUX_URL = os.environ.get("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN", "")
INFLUX_ORG = os.environ.get("INFLUX_ORG", "edgemind")
BUCKET = os.environ.get("INFLUX_BUCKET", INFLUX_BUCKET)
CYCLE_S = float(os.environ.get("CYCLE_S", "30"))
WINDOW = os.environ.get("WINDOW", "5m")
LEAK_MODE = os.environ.get("LEAK_MODE", "false").lower() == "true"

# Module-level sink for the intentional leak (Scenario 2). Never released.
_LEAK_SINK: List[np.ndarray] = []


def _flux_query(pump_id: str) -> str:
    return f'''
from(bucket: "{BUCKET}")
  |> range(start: -{WINDOW})
  |> filter(fn: (r) => r._measurement == "{M_TELEMETRY}" and r.{TAG_PUMP_ID} == "{pump_id}")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''


async def _query_window(query_api, pump_id: str):
    """Return parallel lists (times_s, radial, tangential, axial, temp, rpm)."""
    tables = await query_api.query(_flux_query(pump_id), org=INFLUX_ORG)
    times_s: List[float] = []
    cols: Dict[str, List[float]] = {
        PARAM_RADIAL: [], PARAM_TANGENTIAL: [], PARAM_AXIAL: [],
        PARAM_TEMPERATURE: [], PARAM_RPM: [],
    }
    for table in tables:
        for rec in table.records:
            vals = rec.values
            # require all 5 fields present in the pivoted row
            if not all(p in vals for p in cols):
                continue
            times_s.append(rec.get_time().timestamp())
            for p in cols:
                cols[p].append(float(vals[p]))
    return times_s, cols


async def run_cycle(query_api, write_api) -> None:
    points: List[Point] = []
    for pump_id in PUMP_IDS:
        try:
            times_s, cols = await _query_window(query_api, pump_id)
        except Exception as exc:  # noqa: BLE001
            log.error("query failed pump=%s: %s", pump_id, exc)
            continue

        if len(times_s) < MIN_SAMPLES:
            log.info("pump=%s: only %d samples (<%d) — skipping", pump_id, len(times_s), MIN_SAMPLES)
            continue

        feats = compute_features(
            pump_id, times_s,
            cols[PARAM_RADIAL], cols[PARAM_TANGENTIAL], cols[PARAM_AXIAL],
            cols[PARAM_TEMPERATURE], cols[PARAM_RPM],
        )

        if LEAK_MODE:
            # Allocate and retain a buffer sized to the window (the leak).
            _LEAK_SINK.append(np.ones(len(times_s) * 64, dtype=np.float64))

        p = Point(M_FEATURES).tag(TAG_PUMP_ID, pump_id)
        for field, value in feats.items():
            p.field(field, float(value))
        points.append(p)
        log.info(
            "pump=%s samples=%d bearing_health=%.1f vib_trend=%.4f",
            pump_id, len(times_s), feats["bearing_health"], feats["vibration_rms_trend"],
        )

    if points:
        try:
            await write_api.write(bucket=BUCKET, record=points)
        except Exception as exc:  # noqa: BLE001
            log.error("InfluxDB write failed: %s", exc)


async def main() -> None:
    log.info("starting feature-extractor: influx=%s cycle=%ss window=%s leak=%s",
             INFLUX_URL, CYCLE_S, WINDOW, LEAK_MODE)
    async with InfluxDBClientAsync(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG) as client:
        query_api = client.query_api()
        write_api = client.write_api()
        while True:
            await run_cycle(query_api, write_api)
            await asyncio.sleep(CYCLE_S)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("interrupted")
