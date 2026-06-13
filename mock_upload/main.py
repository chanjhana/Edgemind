"""
main.py — mock-upload service.

Simulates a cloud upload endpoint. Accepts multipart file uploads from
batch-sync, logs filename + size, discards the bytes, and returns 200.

No persistence — this is deliberately a stub. The important thing is that
batch-sync successfully POSTs to it, creating the network egress burst.

Endpoints
---------
POST /upload    ← multipart/form-data, field "file"
GET  /health    ← liveness check

Environment variables
---------------------
HOST        0.0.0.0
PORT        9000
LOG_LEVEL   INFO
"""

from __future__ import annotations

import logging
import os
import sys

import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s  [%(levelname)-8s]  mock-upload — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("mock-upload")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "9000"))

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="EdgeMind Mock Upload",
    description="Simulates cloud upload endpoint — receives Parquet files from batch-sync.",
    version="1.0.0",
)

# Running tally for the health endpoint.
_upload_count = 0
_total_bytes = 0


@app.post("/upload")
async def receive_upload(file: UploadFile = File(...)) -> JSONResponse:
    """
    Accept a multipart file upload.

    Reads the file in 64 KB chunks to avoid loading it all into memory —
    mimicking real upload behaviour (and creating real network egress from
    batch-sync). Discards bytes immediately after reading.
    """
    global _upload_count, _total_bytes

    filename = file.filename or "unknown"
    total = 0
    chunk_size = 65536  # 64 KB

    try:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
        await file.close()
    except Exception as exc:  # noqa: BLE001
        log.error("upload read error file=%s: %s", filename, exc)
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

    _upload_count += 1
    _total_bytes += total
    size_mb = total / (1024 * 1024)

    log.info(
        "upload received file=%s size_mb=%.2f total_uploads=%d",
        filename, size_mb, _upload_count,
    )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "filename": filename,
            "size_bytes": total,
            "size_mb": round(size_mb, 3),
        },
    )


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        content={
            "ok": True,
            "service": "mock-upload",
            "upload_count": _upload_count,
            "total_bytes_received": _total_bytes,
        }
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    log.info("starting mock-upload on %s:%d", HOST, PORT)
    uvicorn.run("main:app", host=HOST, port=PORT, log_level=LOG_LEVEL.lower())
