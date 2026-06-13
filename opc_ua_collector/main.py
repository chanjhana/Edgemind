"""
main.py — opc-ua-collector runtime.

Subscribes (push model) to all 3 sensor-sim OPC-UA servers, validates each
reading, groups per-tick samples (collector.TelemetryBuffer), and batch-writes
completed samples to InfluxDB every 500 ms as `pump_telemetry`.

Single process for all 3 sensors — the intended flood bottleneck.

Environment:
  SENSOR_ENDPOINTS  pump1=opc.tcp://sensor-sim-1:4840,pump2=...,pump3=...
  INFLUX_URL        http://influxdb:8086
  INFLUX_TOKEN      <token>
  INFLUX_ORG        edgemind
  INFLUX_BUCKET     pump_station   (default from contract)
  FLUSH_INTERVAL_S  0.5
  LOG_LEVEL         INFO
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Tuple

from asyncua import Client

from influxdb_client import Point
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from common.contract import (
    INFLUX_BUCKET,
    M_TELEMETRY,
    OPC_NAMESPACE_URI,
    OPC_NODE_NAMES,
    OPC_PUMP_OBJECT,
    OPC_ROOT_OBJECT,
    PARAMS,
    TAG_PUMP_ID,
)
from collector import TelemetryBuffer, is_valid

# ── Config ─────────────────────────────────────────────────────────────────────
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s  [%(levelname)-8s]  collector — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("collector")

# asyncua's own loggers are extremely chatty at INFO (every Publish callback).
# Keep our logs readable by raising their threshold to WARNING.
for _noisy in ("asyncua", "asyncua.client.ua_client", "asyncua.common.subscription"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

_DEFAULT_ENDPOINTS = (
    "pump1=opc.tcp://sensor-sim-1:4840,"
    "pump2=opc.tcp://sensor-sim-2:4841,"
    "pump3=opc.tcp://sensor-sim-3:4842"
)
INFLUX_URL = os.environ.get("INFLUX_URL", "http://influxdb:8086")
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN", "")
INFLUX_ORG = os.environ.get("INFLUX_ORG", "edgemind")
BUCKET = os.environ.get("INFLUX_BUCKET", INFLUX_BUCKET)
FLUSH_INTERVAL_S = float(os.environ.get("FLUSH_INTERVAL_S", "0.5"))
SUB_PERIOD_MS = int(os.environ.get("SUB_PERIOD_MS", "100"))


def parse_endpoints(raw: str) -> Dict[str, str]:
    """Parse 'pump1=opc.tcp://...,pump2=opc.tcp://...' into {pump_id: url}."""
    out: Dict[str, str] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        pump_id, _, url = item.partition("=")
        out[pump_id.strip()] = url.strip()
    return out


# ── OPC-UA subscription handler ─────────────────────────────────────────────────
class SubHandler:
    """Receives data-change notifications and feeds validated values to the buffer."""

    def __init__(self, node_map: Dict[object, Tuple[str, str]], buffer: TelemetryBuffer):
        self.node_map = node_map      # NodeId -> (pump_id, param)
        self.buffer = buffer

    def datachange_notification(self, node, val, data):  # noqa: D401 (asyncua callback)
        mapping = self.node_map.get(node.nodeid)
        if mapping is None:
            return
        pump_id, param = mapping

        dv = data.monitored_item.Value
        sc = getattr(dv, "StatusCode_", None) or getattr(dv, "StatusCode", None)
        quality_good = sc is None or sc.is_good()
        ts = getattr(dv, "SourceTimestamp", None) or datetime.now(timezone.utc)

        if is_valid(param, val, quality_good):
            self.buffer.update(pump_id, param, val, ts)
        else:
            self.buffer.record_drop()


async def _build_param_nodes(client: Client, pump_id: str):
    """Browse to Objects/PumpStation/Pump<N> and return ({NodeId:(pump,param)}, [nodes])."""
    ns_idx = await client.get_namespace_index(OPC_NAMESPACE_URI)
    objects = client.nodes.objects
    pump_station = await objects.get_child([f"{ns_idx}:{OPC_ROOT_OBJECT}"])
    pump_obj = await pump_station.get_child([f"{ns_idx}:{OPC_PUMP_OBJECT[pump_id]}"])

    node_map: Dict[object, Tuple[str, str]] = {}
    nodes = []
    for param in PARAMS:
        node = await pump_obj.get_child([f"{ns_idx}:{OPC_NODE_NAMES[param]}"])
        node_map[node.nodeid] = (pump_id, param)
        nodes.append(node)
    return node_map, nodes


async def manage_pump(pump_id: str, url: str, buffer: TelemetryBuffer) -> None:
    """Connect, subscribe, and keep alive — reconnecting forever on failure."""
    while True:
        try:
            async with Client(url=url) as client:
                node_map, nodes = await _build_param_nodes(client, pump_id)
                handler = SubHandler(node_map, buffer)
                sub = await client.create_subscription(SUB_PERIOD_MS, handler)
                await sub.subscribe_data_change(nodes)
                log.info("subscribed pump=%s url=%s (%d nodes)", pump_id, url, len(nodes))

                # Keepalive: detect a dropped connection and trigger reconnect.
                while True:
                    await asyncio.sleep(5)
                    await client.check_connection()
        except Exception as exc:  # noqa: BLE001
            log.warning("pump=%s connection issue: %s — retrying in 3s", pump_id, exc)
            await asyncio.sleep(3)


async def flush_loop(buffer: TelemetryBuffer, write_api) -> None:
    """Every FLUSH_INTERVAL_S, batch-write completed samples to InfluxDB."""
    last_log = 0.0
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_S)
        samples = buffer.drain()
        if samples:
            points: List[Point] = []
            for pump_id, vals, ts in samples:
                p = Point(M_TELEMETRY).tag(TAG_PUMP_ID, pump_id)
                for param in PARAMS:
                    p.field(param, float(vals[param]))
                p.time(ts)
                points.append(p)
            try:
                await write_api.write(bucket=BUCKET, record=points)
            except Exception as exc:  # noqa: BLE001
                log.error("InfluxDB write failed (%d points dropped): %s", len(points), exc)

        # Periodic heartbeat so the demo shows progress.
        now = asyncio.get_event_loop().time()
        if now - last_log >= 15:
            log.info(
                "telemetry: completed=%d dropped_bad=%d pending=%d",
                buffer.completed_count, buffer.dropped_bad, buffer.pending_count,
            )
            last_log = now


async def main() -> None:
    endpoints = parse_endpoints(os.environ.get("SENSOR_ENDPOINTS", _DEFAULT_ENDPOINTS))
    log.info("starting collector: endpoints=%s influx=%s bucket=%s", endpoints, INFLUX_URL, BUCKET)

    buffer = TelemetryBuffer()

    async with InfluxDBClientAsync(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG) as client:
        write_api = client.write_api()
        tasks = [asyncio.create_task(manage_pump(pid, url, buffer)) for pid, url in endpoints.items()]
        tasks.append(asyncio.create_task(flush_loop(buffer, write_api)))
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("interrupted")
