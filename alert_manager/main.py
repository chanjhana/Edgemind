"""
main.py — alert-manager runtime.

FastAPI service running on port 8090.  Receives enriched alert POSTs from
health-scorer, deduplicates, writes JSONL to PVC-2, and exposes a REST API
that the dashboard polls every 15 seconds.

Endpoints
---------
POST /alert                  ← health-scorer sends here
GET  /alerts                 ← last 100 alerts, newest first
GET  /alerts?pump=pump2      ← filtered by pump_id
GET  /alerts/active          ← WARNING + CRITICAL + DATA_STALE only
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

import json
import logging
import os
import sys
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
    """Return only alerts in WARNING, CRITICAL, or DATA_STALE state."""
    active_states = {"WARNING", "CRITICAL", "DATA_STALE"}
    # Return the most recent alert per pump (newest first, deduplicated by pump_id).
    seen_pumps: set = set()
    active: List[dict] = []
    for alert in reversed(_ALERT_BUFFER):
        pid = alert.get("pump_id")
        if alert.get("state") in active_states and pid not in seen_pumps:
            active.append(alert)
            seen_pumps.add(pid)
    return JSONResponse(content={"alerts": active, "count": len(active)})


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
