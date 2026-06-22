"""
main.py — alert-manager runtime.

FastAPI service running on port 8090.  Receives enriched alert POSTs from
health-scorer, deduplicates, writes JSONL to PVC-2, and exposes a REST API
that the dashboard polls every 15 seconds.

Endpoints
---------
POST /alert                  ← health-scorer sends here
POST /alerts/resolve         ← health-scorer sends when pump recovers to HEALTHY
GET  /alerts                 ← last 100 alerts, newest first
GET  /alerts?pump=pump2      ← filtered by pump_id
GET  /alerts/active          ← WARNING + CRITICAL + DATA_STALE only (most-recent-per-pump)
GET  /health                 ← liveness check

JSONL path on PVC-2
-------------------
{ALERTS_DIR}/{YYYY-MM-DD}/pump_station_alerts.jsonl
One JSON object per line, appended on every accepted alert.

Environment variables
---------------------
ALERTS_DIR      /data/alerts  (PVC-2 mount path within the container)
HOST            0.0.0.0
PORT            8090
LOG_LEVEL       INFO
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from enricher import DedupTracker, IncomingAlert, enrich

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s  [%(levelname)-8s]  alert-manager — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("alert-manager")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ALERTS_DIR = Path(os.environ.get("ALERTS_DIR", "/data/alerts"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8090"))

# In-memory ring buffer: last 500 alerts for the REST API.
# Oldest entries drop off automatically.  The JSONL file on PVC-2 is the
# durable record.
_ALERT_BUFFER: deque = deque(maxlen=500)

# One DedupTracker per service lifetime.
_dedup = DedupTracker()

# Latest health score per pump, updated every scorer cycle regardless of state.
_LIVE_SCORES: dict = {}

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="EdgeMind Alert Manager",
    description="Receives, enriches, and stores pump-station alerts.",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# JSONL writer (sync — called inside async handler, fast enough)
# ---------------------------------------------------------------------------

def _write_jsonl(alert_dict: dict) -> None:
    """Append one JSON object to today's JSONL log on PVC-2."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day_dir = ALERTS_DIR / today
    try:
        day_dir.mkdir(parents=True, exist_ok=True)
        jsonl_path = day_dir / "pump_station_alerts.jsonl"
        with jsonl_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(alert_dict) + "\n")
    except OSError as exc:
        log.error("JSONL write failed: %s", exc)


# ---------------------------------------------------------------------------
# POST /alert
# ---------------------------------------------------------------------------

@app.post("/alert")
async def receive_alert(payload: dict) -> JSONResponse:
    """
    Receive an alert POST from health-scorer.

    Returns 200 with alert_id on acceptance.
    Returns 422 on invalid payload.
    Returns 429 on deduplication suppression.
    """
    # --- Parse and validate -----------------------------------------------
    try:
        incoming = IncomingAlert.from_dict(payload)
    except ValueError as exc:
        log.warning("bad alert payload: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))

    # --- Deduplication check -----------------------------------------------
    existing_id = _dedup.check(incoming.pump_id, incoming.trigger)
    if existing_id is not None:
        log.debug(
            "dedup suppressed pump=%s trigger=%s existing=%s",
            incoming.pump_id, incoming.trigger, existing_id,
        )
        return JSONResponse(
            status_code=429,
            content={
                "ok": False,
                "reason": "duplicate",
                "existing_alert_id": existing_id,
            },
        )

    # --- Enrich ------------------------------------------------------------
    enriched = enrich(incoming)

    # --- Record in dedup tracker -------------------------------------------
    _dedup.record(incoming.pump_id, incoming.trigger, enriched.alert_id)

    # --- Write to JSONL on PVC-2 -------------------------------------------
    alert_dict = enriched.to_dict()
    _write_jsonl(alert_dict)

    # --- Store in ring buffer ----------------------------------------------
    _ALERT_BUFFER.append(alert_dict)

    log.info(
        "alert accepted pump=%s state=%s trigger=%s severity=%s alert_id=%s",
        enriched.pump_id, enriched.state, enriched.trigger,
        enriched.severity, enriched.alert_id,
    )

    return JSONResponse(
        status_code=200,
        content={"ok": True, "alert_id": enriched.alert_id},
    )


# ---------------------------------------------------------------------------
# GET /alerts
# ---------------------------------------------------------------------------

@app.get("/alerts")
async def list_alerts(
    pump: Optional[str] = Query(default=None, description="Filter by pump_id"),
    limit: int = Query(default=100, le=500),
) -> JSONResponse:
    """
    Return recent alerts, newest first.

    Query params:
      pump  — optional pump_id filter (e.g. ?pump=pump2)
      limit — max results (default 100, max 500)
    """
    alerts: List[dict] = list(reversed(_ALERT_BUFFER))
    if pump:
        alerts = [a for a in alerts if a.get("pump_id") == pump]
    return JSONResponse(content={"alerts": alerts[:limit], "count": len(alerts[:limit])})


# ---------------------------------------------------------------------------
# GET /alerts/active
# ---------------------------------------------------------------------------

@app.get("/alerts/active")
async def active_alerts() -> JSONResponse:
    """Return only alerts in WARNING, CRITICAL, or DATA_STALE state.

    Uses the most-recent alert per pump (regardless of state) so that a
    HEALTHY resolution record (written by POST /alerts/resolve) correctly
    clears a preceding WARNING/DATA_STALE from the active set.
    """
    active_states = {"WARNING", "CRITICAL", "DATA_STALE"}
    seen_pumps: set = set()
    active: List[dict] = []
    for alert in reversed(_ALERT_BUFFER):
        pid = alert.get("pump_id")
        if pid not in seen_pumps:
            seen_pumps.add(pid)
            if alert.get("state") in active_states:
                active.append(alert)
    return JSONResponse(content={"alerts": active, "count": len(active)})


# ---------------------------------------------------------------------------
# POST /alerts/resolve
# ---------------------------------------------------------------------------

@app.post("/alerts/resolve")
async def resolve_alert(payload: dict) -> JSONResponse:
    """
    Health-scorer calls this when a pump transitions back to HEALTHY.
    Adds a HEALTHY tombstone to the ring buffer so active_alerts no longer
    surfaces the previous WARNING/CRITICAL/DATA_STALE for this pump.
    """
    pump_id = payload.get("pump_id")
    if pump_id not in ("pump1", "pump2", "pump3"):
        raise HTTPException(status_code=422, detail=f"Unknown pump_id: {pump_id!r}")

    tombstone = {
        "alert_id": str(uuid.uuid4()),
        "pump_id": pump_id,
        "state": "HEALTHY",
        "severity": "INFO",
        "overall_health": float(payload.get("overall_health", 100.0)),
        "vibration_score": 0.0,
        "thermal_score": 0.0,
        "bearing_health": float(payload.get("overall_health", 100.0)),
        "trigger": "resolved",
        "consecutive_cycles": 0,
        "description": f"Pump {pump_id.replace('pump', '')} health restored to normal.",
        "recommended_action": "No action required.",
        "received_at": datetime.now(timezone.utc).isoformat(),
        "source_timestamp": payload.get("timestamp", datetime.now(timezone.utc).isoformat()),
    }
    _ALERT_BUFFER.append(tombstone)
    log.info("resolved pump=%s overall_health=%.1f", pump_id, tombstone["overall_health"])
    return JSONResponse(content={"ok": True, "alert_id": tombstone["alert_id"]})


# ---------------------------------------------------------------------------
# POST /scores  (health-scorer calls this every cycle, regardless of state)
# GET  /scores  (dashboard polls this for live pre-alert health data)
# ---------------------------------------------------------------------------

@app.post("/scores")
async def receive_score(payload: dict) -> JSONResponse:
    pump_id = payload.get("pump_id")
    if pump_id not in ("pump1", "pump2", "pump3"):
        raise HTTPException(status_code=422, detail=f"Unknown pump_id: {pump_id!r}")
    _LIVE_SCORES[pump_id] = {
        "pump_id": pump_id,
        "overall_health": payload.get("overall_health"),
        "vibration_score": payload.get("vibration_score"),
        "thermal_score": payload.get("thermal_score"),
        "bearing_health": payload.get("bearing_health"),
        "state": payload.get("state", "HEALTHY"),
        "timestamp": payload.get("timestamp"),
    }
    return JSONResponse(content={"ok": True})


@app.get("/scores")
async def live_scores() -> JSONResponse:
    return JSONResponse(content={"scores": list(_LIVE_SCORES.values())})


# ---------------------------------------------------------------------------
# PVC fill demo (Scenario 3) — UI-driven, self-cleaning.
#
# POST   /fill   start a bounded background write loop on the export-data PVC.
#                Grows the volume fast enough to trip the storage agent's
#                slope-based pvc_fill detector, holds briefly so the alert can
#                fire and be observed, then deletes everything it wrote.
# DELETE /fill   cancel immediately and clean up (Clear button / manual stop).
# GET    /fill   current status.
#
# Writing is bounded (MAX_CHUNKS) and auto-cleaned so we never fill the shared
# node disk and never need a manual terminal cleanup.
# ---------------------------------------------------------------------------
_FILL_DIR = Path(os.environ.get("FILL_DIR", str(ALERTS_DIR.parent / "_fill")))
_FILL_CHUNK_MB = 30
_FILL_INTERVAL_S = 15        # one chunk per scrape interval → steady slope
_FILL_MAX_CHUNKS = 10        # 300 MB total — trips detector, safe on node disk
_FILL_HOLD_S = 30            # keep data long enough for the alert to fire
_FILL_CHUNK = b"\0" * (_FILL_CHUNK_MB * 1024 * 1024)

_fill_task: Optional[asyncio.Task] = None


def _cleanup_fill() -> None:
    try:
        if _FILL_DIR.exists():
            shutil.rmtree(_FILL_DIR, ignore_errors=True)
            log.info("PVC fill: cleanup complete (%s removed)", _FILL_DIR)
    except Exception as exc:  # noqa: BLE001
        log.error("PVC fill: cleanup failed: %s", exc)


async def _fill_loop() -> None:
    """Grow the PVC, hold so the alert fires, then always clean up."""
    try:
        _FILL_DIR.mkdir(parents=True, exist_ok=True)
        for i in range(_FILL_MAX_CHUNKS):
            await asyncio.to_thread((_FILL_DIR / f"{i}.bin").write_bytes, _FILL_CHUNK)
            log.info("PVC fill: chunk %d/%d (%d MB)", i + 1, _FILL_MAX_CHUNKS, (i + 1) * _FILL_CHUNK_MB)
            await asyncio.sleep(_FILL_INTERVAL_S)
        log.info("PVC fill: cap reached, holding %ds before auto-cleanup", _FILL_HOLD_S)
        await asyncio.sleep(_FILL_HOLD_S)
    except asyncio.CancelledError:
        log.info("PVC fill: cancelled")
        raise
    finally:
        _cleanup_fill()


@app.post("/fill")
async def start_fill() -> JSONResponse:
    global _fill_task
    if _fill_task and not _fill_task.done():
        return JSONResponse(content={"ok": True, "filling": True, "note": "already running"})
    _fill_task = asyncio.create_task(_fill_loop())
    log.info("PVC fill: started")
    return JSONResponse(content={"ok": True, "filling": True})


@app.delete("/fill")
async def stop_fill() -> JSONResponse:
    global _fill_task
    if _fill_task and not _fill_task.done():
        _fill_task.cancel()
        try:
            await _fill_task
        except asyncio.CancelledError:
            pass
    _cleanup_fill()
    return JSONResponse(content={"ok": True, "filling": False})


@app.get("/fill")
async def fill_status() -> JSONResponse:
    return JSONResponse(content={"ok": True, "filling": bool(_fill_task and not _fill_task.done())})


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(content={"ok": True, "service": "alert-manager", "buffered_alerts": len(_ALERT_BUFFER)})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info("starting alert-manager on %s:%d  alerts_dir=%s", HOST, PORT, ALERTS_DIR)
    uvicorn.run("main:app", host=HOST, port=PORT, log_level=LOG_LEVEL.lower())
