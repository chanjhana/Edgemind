"""
main.py — health-scorer runtime.

Every CYCLE_S seconds:
  For each pump:
    1. Query InfluxDB for the latest pump_features entry (last 2 min window).
    2. Compute feature_age_s = now − entry_timestamp.
    3. Call scorer.score_pump() to classify state and decide action.
    4. Write pump_health to InfluxDB.
    5. If action requires it: POST to alert-manager and/or batch-sync.

Log format contract (parsed by the network+log agent):
    pump=<id> bearing_health=<float> state=<str> action=<str>

Environment variables:
    INFLUX_URL          http://data-historian:8086
    INFLUX_TOKEN        <token>
    INFLUX_ORG          edgemind
    INFLUX_BUCKET       pump_station
    ALERT_MANAGER_URL   http://alert-manager:8090   (Docker Compose service name)
    BATCH_SYNC_URL      http://batch-sync:8091       (Docker Compose service name)
    CYCLE_S             30
    LOG_LEVEL           INFO
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Dict, Optional

import httpx
from influxdb_client import Point
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from common.contract import (
    ACTION_NONE,
    ACTION_TRIGGER_ALERT,
    ACTION_TRIGGER_BOTH,
    ACTION_TRIGGER_EXPORT,
    F_AXIAL_DOMINANCE,
    F_BEARING_HEALTH,
    F_CONSECUTIVE_WARNING_CYCLES,
    F_OVERALL_HEALTH,
    F_RPM_STABILITY,
    F_STATE,
    F_TEMP_RATE,
    F_THERMAL_SCORE,
    F_VIB_RMS_TREND,
    F_VIBRATION_SCORE,
    INFLUX_BUCKET,
    M_FEATURES,
    M_HEALTH,
    PUMP_IDS,
    STATE_HEALTHY,
    TAG_PUMP_ID,
    TRIGGER_BEARING_FAULT,
    TRIGGER_DATA_STALE,
)
from scorer import PumpState, score_pump

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s  [%(levelname)-8s]  health-scorer — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("health-scorer")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
INFLUX_URL = os.environ.get("INFLUX_URL", "http://data-historian:8086")
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN", "")
INFLUX_ORG = os.environ.get("INFLUX_ORG", "edgemind")
BUCKET = os.environ.get("INFLUX_BUCKET", INFLUX_BUCKET)

# Docker Compose service names (override via env for k3s ClusterIP names later).
_ALERT_MANAGER_URL = os.environ.get("ALERT_MANAGER_URL", "http://alert-manager:8090")
_BATCH_SYNC_URL = os.environ.get("BATCH_SYNC_URL", "http://batch-sync:8091")

CYCLE_S = float(os.environ.get("CYCLE_S", "30"))

# ---------------------------------------------------------------------------
# InfluxDB Flux queries
# ---------------------------------------------------------------------------

def _flux_latest_features(pump_id: str) -> str:
    """Return the most recent pump_features record for one pump (last 2 min)."""
    return f'''
from(bucket: "{BUCKET}")
  |> range(start: -2m)
  |> filter(fn: (r) => r._measurement == "{M_FEATURES}" and r.{TAG_PUMP_ID} == "{pump_id}")
  |> last()
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
'''


async def _query_latest_features(
    query_api, pump_id: str
) -> tuple[Dict[str, float], float]:
    """
    Query InfluxDB for the latest pump_features entry.

    Returns
    -------
    features   : dict of field→value (empty if no data)
    age_s      : seconds since the entry was written (large if no data → stale)
    """
    try:
        tables = await query_api.query(_flux_latest_features(pump_id), org=INFLUX_ORG)
    except Exception as exc:  # noqa: BLE001
        log.error("InfluxDB query failed pump=%s: %s", pump_id, exc)
        return {}, 9999.0

    features: Dict[str, float] = {}
    entry_time: Optional[datetime] = None

    for table in tables:
        for rec in table.records:
            vals = rec.values
            # Pivoted row: fields are top-level keys alongside tags/_time.
            for field in (
                F_VIB_RMS_TREND, F_AXIAL_DOMINANCE, F_TEMP_RATE,
                F_RPM_STABILITY, F_BEARING_HEALTH,
            ):
                if field in vals and vals[field] is not None:
                    features[field] = float(vals[field])
            if rec.get_time() is not None:
                entry_time = rec.get_time()

    if entry_time is None:
        return {}, 9999.0

    now = datetime.now(timezone.utc)
    age_s = (now - entry_time).total_seconds()
    return features, max(age_s, 0.0)


# ---------------------------------------------------------------------------
# HTTP triggers — alert-manager and batch-sync
# ---------------------------------------------------------------------------

async def _post_alert(client: httpx.AsyncClient, result) -> None:
    """POST alert payload to alert-manager. Fire-and-forget on error."""
    payload = {
        "pump_id": result.pump_id,
        "state": result.state,
        "overall_health": result.overall_health,
        "vibration_score": result.vibration_score,
        "thermal_score": result.thermal_score,
        "bearing_health": result.overall_health,
        "trigger": result.trigger,
        "consecutive_cycles": result.consecutive_warning_cycles,
        "timestamp": result.timestamp.isoformat(),
    }
    url = f"{_ALERT_MANAGER_URL}/alert"
    try:
        resp = await client.post(url, json=payload, timeout=5.0)
        if resp.status_code == 429:
            log.debug("alert deduped by alert-manager pump=%s", result.pump_id)
        elif resp.status_code == 200:
            log.info("alert sent pump=%s state=%s", result.pump_id, result.state)
        else:
            log.warning("alert-manager returned %d for pump=%s", resp.status_code, result.pump_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("alert-manager POST failed pump=%s: %s", result.pump_id, exc)


async def _post_live_score(client: httpx.AsyncClient, result) -> None:
    """Always POST the current score to alert-manager /scores — every cycle."""
    payload = {
        "pump_id": result.pump_id,
        "state": result.state,
        "overall_health": result.overall_health,
        "vibration_score": result.vibration_score,
        "thermal_score": result.thermal_score,
        "bearing_health": result.overall_health,
        "timestamp": result.timestamp.isoformat(),
    }
    url = f"{_ALERT_MANAGER_URL}/scores"
    try:
        await client.post(url, json=payload, timeout=5.0)
    except Exception as exc:
        log.debug("live score POST failed pump=%s: %s", result.pump_id, exc)


async def _post_resolve(client: httpx.AsyncClient, result) -> None:
    """POST resolution to alert-manager when pump transitions back to HEALTHY."""
    payload = {
        "pump_id": result.pump_id,
        "overall_health": result.overall_health,
        "timestamp": result.timestamp.isoformat(),
    }
    url = f"{_ALERT_MANAGER_URL}/alerts/resolve"
    try:
        resp = await client.post(url, json=payload, timeout=5.0)
        if resp.status_code == 200:
            log.info("resolution sent pump=%s overall_health=%.1f", result.pump_id, result.overall_health)
        else:
            log.warning("alert-manager resolve returned %d for pump=%s", resp.status_code, result.pump_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("alert-manager resolve POST failed pump=%s: %s", result.pump_id, exc)


async def _post_trigger(client: httpx.AsyncClient, result) -> None:
    """POST export trigger to batch-sync. Fire-and-forget on error."""
    payload = {
        "pump_id": result.pump_id,
        "state": result.state,
        "overall_health": result.overall_health,
        "trigger_reason": result.trigger,
        "timestamp": result.timestamp.isoformat(),
    }
    url = f"{_BATCH_SYNC_URL}/trigger"
    try:
        resp = await client.post(url, json=payload, timeout=5.0)
        if resp.status_code == 409:
            log.debug("batch-sync export already in progress — skipping pump=%s", result.pump_id)
        elif resp.status_code == 200:
            log.info("batch-sync triggered pump=%s", result.pump_id)
        else:
            log.warning("batch-sync returned %d for pump=%s", resp.status_code, result.pump_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("batch-sync POST failed pump=%s: %s", result.pump_id, exc)


# ---------------------------------------------------------------------------
# Write pump_health back to InfluxDB
# ---------------------------------------------------------------------------

def _make_health_point(result) -> Point:
    return (
        Point(M_HEALTH)
        .tag(TAG_PUMP_ID, result.pump_id)
        .field(F_VIBRATION_SCORE, result.vibration_score)
        .field(F_THERMAL_SCORE, result.thermal_score)
        .field(F_OVERALL_HEALTH, result.overall_health)
        .field(F_STATE, result.state)
        .field(F_CONSECUTIVE_WARNING_CYCLES, result.consecutive_warning_cycles)
    )


# ---------------------------------------------------------------------------
# Main scoring cycle
# ---------------------------------------------------------------------------

async def run_cycle(
    query_api,
    write_api,
    http_client: httpx.AsyncClient,
    pump_states: Dict[str, PumpState],
) -> None:
    points = []
    trigger_tasks = []

    for pump_id in PUMP_IDS:
        features, age_s = await _query_latest_features(query_api, pump_id)
        state_obj = pump_states[pump_id]

        result = score_pump(pump_id, features, state_obj, feature_age_s=age_s)

        # --- Mandatory log contract (parsed by network+log agent) ----------
        log.info(
            "pump=%s bearing_health=%.1f state=%s action=%s",
            pump_id, result.overall_health, result.state, result.action,
        )

        points.append(_make_health_point(result))

        # --- Fire HTTP triggers if action requires it ----------------------
        trigger_tasks.append(_post_live_score(http_client, result))
        if result.action in (ACTION_TRIGGER_BOTH, ACTION_TRIGGER_ALERT):
            trigger_tasks.append(_post_alert(http_client, result))
        if result.action in (ACTION_TRIGGER_BOTH, ACTION_TRIGGER_EXPORT):
            trigger_tasks.append(_post_trigger(http_client, result))
        if result.is_recovery:
            trigger_tasks.append(_post_resolve(http_client, result))

    # Write all health points in one batch.
    if points:
        try:
            await write_api.write(bucket=BUCKET, record=points)
        except Exception as exc:  # noqa: BLE001
            log.error("InfluxDB write failed: %s", exc)

    # Fire HTTP triggers concurrently (don't block the cycle on them).
    if trigger_tasks:
        await asyncio.gather(*trigger_tasks, return_exceptions=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def _bootstrap_pump_states(
    http_client: httpx.AsyncClient,
    pump_states: Dict[str, PumpState],
) -> None:
    """
    On startup, fetch alertmanager active alerts and set last_state accordingly.
    Without this, PumpState always starts with last_state=HEALTHY, so is_recovery
    never fires after a restart even if alertmanager holds DATA_STALE entries.
    """
    try:
        resp = await http_client.get(f"{_ALERT_MANAGER_URL}/alerts/active", timeout=5.0)
        if resp.status_code != 200:
            return
        alerts = resp.json().get("alerts", [])
        for alert in alerts:
            pump_id = alert.get("pump_id")
            state = alert.get("state", STATE_HEALTHY)
            if pump_id in pump_states and state != STATE_HEALTHY:
                pump_states[pump_id].last_state = state
                log.info("bootstrap pump=%s last_state=%s from alertmanager", pump_id, state)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not bootstrap pump states from alertmanager: %s", exc)


async def main() -> None:
    log.info(
        "starting health-scorer: influx=%s cycle=%ss alert-manager=%s batch-sync=%s",
        INFLUX_URL, CYCLE_S, _ALERT_MANAGER_URL, _BATCH_SYNC_URL,
    )

    pump_states = {pump_id: PumpState(pump_id) for pump_id in PUMP_IDS}

    async with InfluxDBClientAsync(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG) as client:
        query_api = client.query_api()
        write_api = client.write_api()
        async with httpx.AsyncClient() as http_client:
            await _bootstrap_pump_states(http_client, pump_states)
            while True:
                try:
                    await run_cycle(query_api, write_api, http_client, pump_states)
                except Exception as exc:  # noqa: BLE001
                    log.error("cycle error: %s", exc)
                await asyncio.sleep(CYCLE_S)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("interrupted")
