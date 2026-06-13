"""
main.py — batch-sync runtime.


Bulk-exports pump-station data from InfluxDB to Parquet (snappy-compressed)
files on PVC-2, then simulates a cloud upload via HTTP POST to mock-upload.

Two trigger modes
-----------------
1. SCHEDULED — every SCHEDULE_S seconds (default 300 = 5 min).
   Exports last 5 min of pump_telemetry for ALL pumps.
   Output: /data/exports/scheduled/YYYY-MM-DD_HH-MM.parquet
   Retention: deleted after 24 h.

2. FAULT-TRIGGERED — POST /trigger from health-scorer.
   Exports last 30 min of pump_telemetry + pump_features + pump_health
   for the affected pump.
   Output: /data/exports/fault/YYYY-MM-DD_HH-MM_{pump_id}.parquet
   Retention: PERMANENT — fault records never deleted, so PVC-2 fills
   measurably across a demo session (storage agent forecasts time-to-full).

Resource signatures produced
-----------------------------
- Parquet snappy compression: real CPU spike during serialisation.
- Bulk InfluxDB read: large sequential read, degrades TSM read performance
  for concurrent readers (feature-extractor), creating IC1.
- Sequential PVC-2 write: large file write, concurrent with alert-manager
  JSONL writes, creating storage contention (IC2).
- HTTP egress burst to mock-upload: network transmit spike visible to
  the network+log agent.

Endpoints
---------
POST /trigger   ← health-scorer sends here on WARNING/CRITICAL
GET  /status    ← current export state + summary stats
GET  /health    ← liveness check

Environment variables
---------------------
INFLUX_URL          http://data-historian:8086
INFLUX_TOKEN        <token>
INFLUX_ORG          edgemind
INFLUX_BUCKET       pump_station
EXPORTS_DIR         /data/exports    (PVC-2 mount path)
MOCK_UPLOAD_URL     http://mock-upload:9000
SCHEDULE_S          300              (5 min; lower for testing)
FAULT_WINDOW_MIN    30               (minutes of history in a fault export)
HOST                0.0.0.0
PORT                8091
LOG_LEVEL           INFO
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
import pandas as pd
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s  [%(levelname)-8s]  batch-sync — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("batch-sync")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
INFLUX_URL    = os.environ.get("INFLUX_URL",    "http://data-historian:8086")
INFLUX_TOKEN  = os.environ.get("INFLUX_TOKEN",  "")
INFLUX_ORG    = os.environ.get("INFLUX_ORG",    "edgemind")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "pump_station")

EXPORTS_DIR      = Path(os.environ.get("EXPORTS_DIR", "/data/exports"))
MOCK_UPLOAD_URL  = os.environ.get("MOCK_UPLOAD_URL", "http://mock-upload:9000")

SCHEDULE_S       = float(os.environ.get("SCHEDULE_S",    "300"))
FAULT_WINDOW_MIN = int(os.environ.get("FAULT_WINDOW_MIN", "30"))

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8091"))

# Scheduled exports are deleted after 24 h; fault exports are permanent.
SCHEDULED_RETENTION_H = 24

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class ExportState:
    """
    Thread-safe (asyncio single-loop) export state tracker.
    One export at a time — if health-scorer triggers during an active export,
    we return 409.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.active: bool = False
        self.active_export_id: Optional[str] = None

        # Running totals for /status
        self.scheduled_count: int = 0
        self.fault_count: int = 0
        self.total_bytes_written: int = 0
        self.last_export_ts: Optional[str] = None
        self.last_export_file: Optional[str] = None
        self.last_export_size_mb: float = 0.0

    async def try_acquire(self, export_id: str) -> bool:
        """Return True and mark busy; return False if already busy."""
        async with self._lock:
            if self.active:
                return False
            self.active = True
            self.active_export_id = export_id
            return True

    async def release(self, export_id: str, size_bytes: int, path: Path) -> None:
        async with self._lock:
            self.active = False
            self.active_export_id = None
            self.total_bytes_written += size_bytes
            self.last_export_ts = datetime.now(timezone.utc).isoformat()
            self.last_export_file = str(path)
            self.last_export_size_mb = round(size_bytes / (1024 * 1024), 3)


_state = ExportState()

# ---------------------------------------------------------------------------
# InfluxDB Flux queries
# ---------------------------------------------------------------------------

def _flux_telemetry(window: str, pump_filter: str = "") -> str:
    """
    Query pump_telemetry for a time window. Optionally filter by pump_id.
    Returns a pivoted table (one row per timestamp, one column per field).
    """
    pump_clause = f'|> filter(fn: (r) => r.pump_id == "{pump_filter}")' if pump_filter else ""
    return f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{window})
  |> filter(fn: (r) => r._measurement == "pump_telemetry")
  {pump_clause}
  |> pivot(rowKey: ["_time", "pump_id", "location"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''


def _flux_features(window: str, pump_id: str) -> str:
    return f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{window})
  |> filter(fn: (r) => r._measurement == "pump_features" and r.pump_id == "{pump_id}")
  |> pivot(rowKey: ["_time", "pump_id"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''


def _flux_health(window: str, pump_id: str) -> str:
    return f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{window})
  |> filter(fn: (r) => r._measurement == "pump_health" and r.pump_id == "{pump_id}")
  |> pivot(rowKey: ["_time", "pump_id"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''


# ---------------------------------------------------------------------------
# InfluxDB → pandas
# ---------------------------------------------------------------------------

async def _query_to_df(query_api, flux: str) -> pd.DataFrame:
    """
    Execute a Flux query and return a pandas DataFrame.
    Returns an empty DataFrame on error so the caller can still proceed.
    """
    try:
        tables = await query_api.query(flux, org=INFLUX_ORG)
    except Exception as exc:  # noqa: BLE001
        log.error("InfluxDB query error: %s", exc)
        return pd.DataFrame()

    rows = []
    for table in tables:
        for record in table.records:
            rows.append(record.values)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    # Drop internal Flux columns that aren't meaningful in export.
    drop_cols = [c for c in ("result", "table", "_start", "_stop") if c in df.columns]
    df.drop(columns=drop_cols, inplace=True, errors="ignore")
    # Rename _time → timestamp for clarity.
    if "_time" in df.columns:
        df.rename(columns={"_time": "timestamp"}, inplace=True)
    return df


# ---------------------------------------------------------------------------
# Parquet serialisation
# ---------------------------------------------------------------------------

def _df_to_parquet_bytes(df: pd.DataFrame) -> bytes:
    """Serialise a DataFrame to snappy-compressed Parquet bytes (in memory)."""
    buf = io.BytesIO()
    df.to_parquet(buf, engine="pyarrow", compression="snappy", index=False)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Mock upload
# ---------------------------------------------------------------------------

async def _upload_file(
    http_client: httpx.AsyncClient,
    parquet_bytes: bytes,
    filename: str,
) -> bool:
    """
    POST parquet_bytes to the mock-upload endpoint as multipart/form-data.
    Returns True on success, False on error.
    Creates the network egress burst visible to the network+log agent.
    """
    url = f"{MOCK_UPLOAD_URL}/upload"
    try:
        resp = await http_client.post(
            url,
            files={"file": (filename, parquet_bytes, "application/octet-stream")},
            timeout=120.0,   # large files may take a while even on localhost
        )
        if resp.status_code == 200:
            log.info("upload OK file=%s size_mb=%.2f", filename, len(parquet_bytes) / (1024 * 1024))
            return True
        else:
            log.warning("upload returned %d file=%s", resp.status_code, filename)
            return False
    except Exception as exc:  # noqa: BLE001
        log.warning("upload failed file=%s: %s", filename, exc)
        return False


# ---------------------------------------------------------------------------
# Cleanup: delete scheduled exports older than SCHEDULED_RETENTION_H hours
# ---------------------------------------------------------------------------

def _cleanup_scheduled(exports_dir: Path) -> None:
    """
    Delete scheduled export Parquet files older than SCHEDULED_RETENTION_H hours.
    Fault exports (in fault/ subdirectory) are never touched.
    """
    sched_dir = exports_dir / "scheduled"
    if not sched_dir.exists():
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=SCHEDULED_RETENTION_H)
    deleted = 0
    for f in sched_dir.glob("*.parquet"):
        try:
            mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                f.unlink()
                deleted += 1
                log.info("cleanup deleted %s (age>%dh)", f.name, SCHEDULED_RETENTION_H)
        except OSError as exc:
            log.warning("cleanup error for %s: %s", f.name, exc)

    if deleted:
        log.info("cleanup: removed %d scheduled export(s)", deleted)


# ---------------------------------------------------------------------------
# Core export logic
# ---------------------------------------------------------------------------

async def _run_scheduled_export(
    query_api,
    http_client: httpx.AsyncClient,
    export_id: str,
) -> None:
    """
    Scheduled export: last 5 min of pump_telemetry for all 3 pumps.
    Expected file size: ~500 KB–1 MB at 1 Hz.
    """
    log.info("scheduled export start export_id=%s", export_id)

    df = await _query_to_df(query_api, _flux_telemetry("5m"))

    if df.empty:
        log.warning("scheduled export: no data in InfluxDB (cold start?)")
        # Still release the lock so the next cycle can proceed.
        await _state.release(export_id, 0, Path("(empty)"))
        return

    parquet_bytes = _df_to_parquet_bytes(df)
    size_mb = len(parquet_bytes) / (1024 * 1024)

    # Write to PVC-2.
    ts_str = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M")
    out_dir = EXPORTS_DIR / "scheduled"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{ts_str}.parquet"

    try:
        out_path.write_bytes(parquet_bytes)
        log.info(
            "scheduled export written path=%s rows=%d size_mb=%.2f",
            out_path.name, len(df), size_mb,
        )
    except OSError as exc:
        log.error("scheduled export write failed: %s", exc)
        await _state.release(export_id, 0, out_path)
        return

    # Upload to mock-upload (creates network egress burst).
    await _upload_file(http_client, parquet_bytes, out_path.name)

    # Cleanup stale exports.
    _cleanup_scheduled(EXPORTS_DIR)

    _state.scheduled_count += 1
    await _state.release(export_id, len(parquet_bytes), out_path)
    log.info("scheduled export done export_id=%s size_mb=%.2f", export_id, size_mb)


async def _run_fault_export(
    query_api,
    http_client: httpx.AsyncClient,
    export_id: str,
    pump_id: str,
    trigger_reason: str,
    state: str,
) -> None:
    """
    Fault-triggered export: last FAULT_WINDOW_MIN min of telemetry + features + health
    for the affected pump.

    Expected file size: ~50–100 MB at 1 Hz; 500 MB–1 GB at 10 Hz (flood mode).
    This is the deliberate large-file-I/O event.
    Fault exports are never deleted — PVC-2 fills across the demo session.
    """
    window = f"{FAULT_WINDOW_MIN}m"
    log.info(
        "fault export start export_id=%s pump=%s reason=%s window=%s",
        export_id, pump_id, trigger_reason, window,
    )

    # Fetch all three measurements sequentially to avoid overloading InfluxDB.
    df_telemetry = await _query_to_df(query_api, _flux_telemetry(window, pump_filter=pump_id))
    df_features  = await _query_to_df(query_api, _flux_features(window, pump_id))
    df_health    = await _query_to_df(query_api, _flux_health(window, pump_id))

    # Tag each sub-dataframe so they're distinguishable in the merged export.
    for df, meas in [
        (df_telemetry, "pump_telemetry"),
        (df_features,  "pump_features"),
        (df_health,    "pump_health"),
    ]:
        if not df.empty:
            df.insert(0, "_measurement", meas)

    # Concatenate into one export DataFrame.
    frames = [df for df in [df_telemetry, df_features, df_health] if not df.empty]
    if not frames:
        log.warning("fault export: no data for pump=%s (InfluxDB cold?)", pump_id)
        await _state.release(export_id, 0, Path("(empty)"))
        return

    # Sort by timestamp within each measurement group.
    df_merged = pd.concat(frames, ignore_index=True, sort=False)

    parquet_bytes = _df_to_parquet_bytes(df_merged)
    size_mb = len(parquet_bytes) / (1024 * 1024)

    # Write to PVC-2 — fault exports are permanent.
    ts_str = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M")
    out_dir = EXPORTS_DIR / "fault"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{ts_str}_{pump_id}.parquet"

    try:
        out_path.write_bytes(parquet_bytes)
        log.info(
            "fault export written path=%s pump=%s rows=%d size_mb=%.2f",
            out_path.name, pump_id, len(df_merged), size_mb,
        )
    except OSError as exc:
        log.error("fault export write failed pump=%s: %s", pump_id, exc)
        await _state.release(export_id, 0, out_path)
        return

    # Upload to mock-upload.
    await _upload_file(http_client, parquet_bytes, out_path.name)

    _state.fault_count += 1
    await _state.release(export_id, len(parquet_bytes), out_path)
    log.info(
        "fault export done export_id=%s pump=%s size_mb=%.2f",
        export_id, pump_id, size_mb,
    )


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
# Single shared httpx client — reused across export tasks.
_http_client: Optional[httpx.AsyncClient] = None
_influx_client: Optional[InfluxDBClientAsync] = None
_query_api = None


@contextlib.asynccontextmanager
async def _lifespan(app: "FastAPI"):
    """FastAPI lifespan: start shared clients and scheduled loop on startup,
    close them cleanly on shutdown."""
    global _http_client, _influx_client, _query_api
    _http_client = httpx.AsyncClient()
    _influx_client = InfluxDBClientAsync(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
    _query_api = _influx_client.query_api()
    asyncio.create_task(_scheduled_loop())
    log.info(
        "batch-sync started influx=%s exports_dir=%s schedule=%ss fault_window=%sm upload=%s",
        INFLUX_URL, EXPORTS_DIR, SCHEDULE_S, FAULT_WINDOW_MIN, MOCK_UPLOAD_URL,
    )
    yield
    # Shutdown: close network clients.
    if _http_client:
        await _http_client.aclose()
    if _influx_client:
        await _influx_client.close()


app = FastAPI(
    title="EdgeMind Batch Sync",
    description="Bulk Parquet export service: scheduled (5 min) and fault-triggered.",
    version="1.0.0",
    lifespan=_lifespan,
)


async def _scheduled_loop() -> None:
    """
    Background coroutine: wait SCHEDULE_S, then run a scheduled export.
    Runs forever; skips a cycle if an export is already in progress.
    """
    log.info("scheduled export loop starting (interval=%.0f s)", SCHEDULE_S)
    while True:
        await asyncio.sleep(SCHEDULE_S)
        export_id = str(uuid.uuid4())
        acquired = await _state.try_acquire(export_id)
        if not acquired:
            log.info("scheduled export skipped — fault export in progress")
            continue
        try:
            await _run_scheduled_export(_query_api, _http_client, export_id)
        except Exception as exc:  # noqa: BLE001
            log.error("scheduled export crashed: %s", exc)
            # Force-release the lock so we don't get permanently stuck.
            async with _state._lock:
                _state.active = False
                _state.active_export_id = None


# ---------------------------------------------------------------------------
# POST /trigger
# ---------------------------------------------------------------------------

@app.post("/trigger")
async def trigger_export(payload: dict) -> JSONResponse:
    """
    Receive a fault-triggered export request from health-scorer.

    Returns 200 immediately; the export runs as a background asyncio task.
    Returns 409 if an export is already in progress.
    """
    pump_id = payload.get("pump_id", "unknown")
    state_val = payload.get("state", "UNKNOWN")
    trigger_reason = payload.get("trigger_reason", "unknown")

    # Validate pump_id.
    from common.contract import PUMP_IDS  # local import to keep module clean
    if pump_id not in PUMP_IDS:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": f"Unknown pump_id: {pump_id}"},
        )

    export_id = str(uuid.uuid4())
    acquired = await _state.try_acquire(export_id)

    if not acquired:
        log.info(
            "trigger rejected (export in progress) pump=%s active=%s",
            pump_id, _state.active_export_id,
        )
        return JSONResponse(
            status_code=409,
            content={
                "ok": False,
                "reason": "export_in_progress",
                "active_export_id": _state.active_export_id,
            },
        )

    # Estimate size for the response (heuristic — actuals vary with flood mode).
    # 30 min × 60 s/min × 5 fields × 8 bytes/float × ~3 measurements × pump compression ≈ 65–100 MB.
    estimated_size_mb = round(FAULT_WINDOW_MIN * 60 * 5 * 8 * 3 / (1024 * 1024), 1)

    log.info(
        "fault export triggered export_id=%s pump=%s state=%s reason=%s estimated_mb=%.1f",
        export_id, pump_id, state_val, trigger_reason, estimated_size_mb,
    )

    # Launch the export as a background task — return 200 immediately.
    asyncio.create_task(
        _run_fault_export(
            _query_api, _http_client, export_id, pump_id, trigger_reason, state_val,
        )
    )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "export_id": export_id,
            "estimated_size_mb": estimated_size_mb,
        },
    )


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

@app.get("/status")
async def status() -> JSONResponse:
    """Return current export state and running totals."""
    return JSONResponse(
        content={
            "active": _state.active,
            "active_export_id": _state.active_export_id,
            "scheduled_count": _state.scheduled_count,
            "fault_count": _state.fault_count,
            "total_bytes_written": _state.total_bytes_written,
            "total_mb_written": round(_state.total_bytes_written / (1024 * 1024), 3),
            "last_export_ts": _state.last_export_ts,
            "last_export_file": _state.last_export_file,
            "last_export_size_mb": _state.last_export_size_mb,
        }
    )


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        content={
            "ok": True,
            "service": "batch-sync",
            "active_export": _state.active,
        }
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, log_level=LOG_LEVEL.lower())
