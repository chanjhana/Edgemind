"""
main.py — edgemind-server runtime.

FastAPI + WebSocket server that wires:
  - CorrelationFilter (reads Redis findings)
  - Orchestrator (OpenAI-compatible LLM)
  - DependencyGraph (K8s topology)

REST endpoints:
  GET  /health              liveness
  GET  /api/alerts          recent AI analyses (last 50)
  GET  /api/dependency-graph  current pod topology
  GET  /api/graph           alias for /api/dependency-graph
  GET  /api/findings        recent raw findings from Redis
  GET  /api/agent-status    heartbeat status of 4 agents
  GET  /api/metrics         current pod + PVC metrics from Prometheus
  DELETE /api/alerts        clear alert history + cooldown

WebSocket:
  WS   /ws                  streams findings + AI analyses to dashboard

WS event types emitted:
  initial_state   — on connect: recent findings, alerts, graph
  agent_finding   — each new finding relayed from Redis
  correlated_alert — AI analysis result (with nlp_summary, llm_available)
  metric_update   — pod + PVC metrics snapshot every METRIC_BROADCAST_INTERVAL s
  agent_heartbeat — agent liveness pulse every HEARTBEAT_BROADCAST_INTERVAL s
"""

import asyncio
import json
import logging
import os
import sys
import urllib.parse
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional, Set

import redis.asyncio as aioredis
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from kubernetes import client as k8s_client, config as k8s_config

from edgemind_server.correlation_filter import CorrelationFilter, CorrelatedSignalBundle
from edgemind_server.dependency_graph import DependencyGraph
from edgemind_server.orchestrator import Orchestrator

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)-8s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("edgemind.server")

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis-svc.monitoring.svc.cluster.local:6379")
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus-svc.monitoring.svc.cluster.local:9090")
METRIC_BROADCAST_INTERVAL = int(os.environ.get("METRIC_BROADCAST_INTERVAL", "15"))
HEARTBEAT_BROADCAST_INTERVAL = int(os.environ.get("HEARTBEAT_BROADCAST_INTERVAL", "30"))

# In-memory stores
_recent_alerts: deque = deque(maxlen=50)
_recent_findings: deque = deque(maxlen=200)
_ws_clients: Set[WebSocket] = set()
_last_metrics: Optional[Dict[str, Any]] = None

app = FastAPI(title="EdgeMind Server", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared components (initialized at startup)
_redis: Optional[aioredis.Redis] = None
_graph: Optional[DependencyGraph] = None
_orchestrator: Optional[Orchestrator] = None
_correlation_filter: Optional[CorrelationFilter] = None
_executor = ThreadPoolExecutor(max_workers=2)

# Track IDs of findings already relayed (to avoid duplicates)
_relayed_ids: set = set()


# ── Prometheus scraper ────────────────────────────────────────────────────────

_PROM_QUERIES = {
    "cpu_usage":       'sum by (pod,namespace) (rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[1m]))',
    "cpu_throttle":    'sum by (pod,namespace) (rate(container_cpu_cfs_throttled_seconds_total{container!="",container!="POD"}[1m]) / (rate(container_cpu_cfs_periods_total{container!="",container!="POD"}[1m]) + 1))',
    "mem_rss":         'sum by (pod,namespace) (container_memory_rss{container!="",container!="POD"})',
    "mem_working_set": 'sum by (pod,namespace) (container_memory_working_set_bytes{container!="",container!="POD"})',
    "net_tx":          'sum by (pod,namespace) (rate(container_network_transmit_bytes_total[1m]))',
    "net_rx":          'sum by (pod,namespace) (rate(container_network_receive_bytes_total[1m]))',
    "fs_write":        'sum by (pod,namespace) (rate(container_fs_writes_bytes_total{container!="",container!="POD"}[1m]))',
    "fs_read":         'sum by (pod,namespace) (rate(container_fs_reads_bytes_total{container!="",container!="POD"}[1m]))',
    "fs_io_time":      'sum by (pod,namespace) (rate(container_fs_io_time_seconds_total{container!="",container!="POD"}[1m]))',
    "cpu_limit":       'sum by (pod,namespace) (kube_pod_container_resource_limits{resource="cpu",container!=""})',
    "mem_limit":       'sum by (pod,namespace) (kube_pod_container_resource_limits{resource="memory",container!=""})',
    "restarts":        'sum by (pod,namespace) (kube_pod_container_status_restarts_total)',
}


def _prom_instant(query: str) -> Dict[str, float]:
    url = f"{PROMETHEUS_URL}/api/v1/query?" + urllib.parse.urlencode({"query": query})
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = json.loads(resp.read())
        result: Dict[str, float] = {}
        for item in body.get("data", {}).get("result", []):
            pod = item["metric"].get("pod", "")
            if pod:
                try:
                    result[pod] = float(item["value"][1])
                except (IndexError, ValueError):
                    pass
        return result
    except Exception as exc:
        log.debug("Prometheus query failed (%s): %s", query[:60], exc)
        return {}


def _pvc_instant(metric: str) -> Dict[str, float]:
    url = f"{PROMETHEUS_URL}/api/v1/query?" + urllib.parse.urlencode({"query": metric})
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = json.loads(resp.read())
        result: Dict[str, float] = {}
        for item in body.get("data", {}).get("result", []):
            pvc = item["metric"].get("persistentvolumeclaim", "")
            if pvc:
                try:
                    result[pvc] = float(item["value"][1])
                except (IndexError, ValueError):
                    pass
        return result
    except Exception as exc:
        log.debug("PVC query failed (%s): %s", metric, exc)
        return {}


def _scrape_metrics() -> Dict[str, Any]:
    """Blocking: scrape all pod + PVC metrics from Prometheus."""
    series = {k: _prom_instant(q) for k, q in _PROM_QUERIES.items()}

    all_pods: set = set()
    for v in series.values():
        all_pods.update(v.keys())

    pods: Dict[str, Any] = {}
    for pod in all_pods:
        pods[pod] = {k: series[k].get(pod) for k in series}

    pvc_used = _pvc_instant("kubelet_volume_stats_used_bytes")
    pvc_cap = _pvc_instant("kubelet_volume_stats_capacity_bytes")
    pvcs: Dict[str, Any] = {}
    for pvc in set(pvc_used) | set(pvc_cap):
        pvcs[pvc] = {
            "used_bytes":     pvc_used.get(pvc),
            "capacity_bytes": pvc_cap.get(pvc),
        }

    from datetime import datetime, timezone
    return {"pods": pods, "pvcs": pvcs, "timestamp": datetime.now(timezone.utc).isoformat()}


def _normalize_alert(result_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Add frontend-expected fields to orchestrator result dict."""
    import uuid
    out = dict(result_dict)
    out["nlp_summary"] = out.get("nlp_summary") or out.get("insight", "")
    out.setdefault("id", str(uuid.uuid4()))
    out.setdefault("llm_available", True)
    out.setdefault("causal_chain", [])
    out.setdefault("root_cause_pod", None)
    out.setdefault("alert_type", "unknown")
    out.setdefault("confidence", 0.0)
    out.setdefault("recommendation", "")
    # Promote bundle window timestamps to top-level for timeline rendering
    bundle = out.get("bundle", {})
    out.setdefault("window_start", bundle.get("window_start") or out.get("timestamp"))
    out.setdefault("window_end", bundle.get("window_end") or out.get("timestamp"))
    # Alias duration field name the frontend expects
    out.setdefault("analysis_time_s", out.get("analysis_duration_s", 0))
    return out


async def _broadcast_to_ws(message: Dict[str, Any]) -> None:
    """Send a message to all connected WebSocket clients."""
    if not _ws_clients:
        return
    payload = json.dumps(message, default=str)
    dead = set()
    for ws in _ws_clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


async def _on_correlated_bundle(bundle: CorrelatedSignalBundle) -> None:
    """Called by correlation filter when a trigger fires."""
    log.info("Orchestrator triggered: %s", bundle.trigger_reason)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            _executor,
            _orchestrator.analyze,
            bundle,
        )
        result_dict = result.to_dict()
        result_dict["bundle"] = bundle.to_dict()
        result_dict = _normalize_alert(result_dict)
        _recent_alerts.appendleft(result_dict)

        await _broadcast_to_ws({"type": "correlated_alert", "data": result_dict})
        log.info(
            "Analysis complete: root_cause=%s confidence=%.2f duration=%.1fs",
            result.root_cause_pod, result.confidence, result.analysis_duration_s,
        )
    except Exception as e:
        log.error("Orchestrator failed: %s", e, exc_info=True)
        await _broadcast_to_ws({
            "type": "correlated_alert",
            "data": _normalize_alert({
                "llm_available": False,
                "bundle": bundle.to_dict(),
                "insight": "LLM analysis unavailable.",
                "causal_chain": [],
                "confidence": 0.0,
            }),
        })


async def _finding_relay_loop() -> None:
    while True:
        try:
            # Read from relay key — correlation filter uses BRPOP on the main key
            findings = await _redis.lrange("edgemind:findings:relay", 0, 9)
            for payload in findings:
                finding = json.loads(payload)
                fid = finding.get("finding_id", "")
                if fid and fid not in _relayed_ids:
                    _relayed_ids.add(fid)
                    _recent_findings.appendleft(finding)
                    await _broadcast_to_ws({"type": "agent_finding", "data": finding})
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("Finding relay error: %s", e)
        await asyncio.sleep(2)


async def _metric_broadcast_loop() -> None:
    """Scrape Prometheus every METRIC_BROADCAST_INTERVAL s and broadcast metric_update."""
    global _last_metrics
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(METRIC_BROADCAST_INTERVAL)
        try:
            snapshot = await loop.run_in_executor(_executor, _scrape_metrics)
            _last_metrics = snapshot
            await _broadcast_to_ws({"type": "metric_update", "data": snapshot})
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("Metric broadcast error: %s", e)


async def _heartbeat_broadcast_loop() -> None:
    """Poll Redis heartbeat keys and broadcast agent_heartbeat events."""
    agents = ["cpu", "memory", "storage", "network_log", "dmd"]
    while True:
        await asyncio.sleep(HEARTBEAT_BROADCAST_INTERVAL)
        try:
            for agent in agents:
                val = await _redis.get(f"edgemind:heartbeat:{agent}")
                if val:
                    await _broadcast_to_ws({
                        "type": "agent_heartbeat",
                        "data": {"agent": agent, "timestamp": val},
                    })
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("Heartbeat broadcast error: %s", e)


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return JSONResponse({"ok": True, "service": "edgemind-server"})

@app.get("/api/alerts")
async def get_alerts(limit: int = 20):
    return JSONResponse({
        "alerts": [_normalize_alert(a) for a in list(_recent_alerts)[:limit]],
        "count": len(_recent_alerts),
    })

@app.get("/api/findings")
async def get_findings(limit: int = 50):
    return JSONResponse({
        "findings": list(_recent_findings)[:limit],
        "count": len(_recent_findings),
    })

@app.get("/api/dependency-graph")
async def get_dependency_graph():
    return JSONResponse(_graph.to_json() if _graph else {})

@app.get("/api/graph")
async def get_graph():
    """Alias for /api/dependency-graph."""
    return JSONResponse(_graph.to_json() if _graph else {})

@app.get("/api/metrics")
async def get_metrics():
    """Return current pod + PVC metrics snapshot from Prometheus."""
    loop = asyncio.get_running_loop()
    try:
        snapshot = await loop.run_in_executor(_executor, _scrape_metrics)
        return JSONResponse(snapshot)
    except Exception as e:
        log.warning("Metrics endpoint error: %s", e)
        from datetime import datetime, timezone
        return JSONResponse({"pods": {}, "pvcs": {}, "timestamp": datetime.now(timezone.utc).isoformat()})

@app.get("/api/agent-status")
async def get_agent_status():
    """Check heartbeats of all 4 core agents + DMD early-warning agent."""
    agents = ["cpu", "memory", "storage", "network_log", "dmd"]
    status = {}
    for agent in agents:
        key = f"edgemind:heartbeat:{agent}"
        val = await _redis.get(key)
        status[agent] = {
            "alive": val is not None,
            "last_heartbeat": val,
        }
    return JSONResponse(status)

@app.get("/api/dmd-forecasts")
async def get_dmd_forecasts(limit: int = 20):
    """Return latest DMD early-warning findings (is_dmd=True) for initial page load."""
    dmd_findings = [
        f for f in list(_recent_findings)
        if f.get("is_dmd") is True
    ][:limit]
    return JSONResponse({"dmd_findings": dmd_findings, "count": len(dmd_findings)})

@app.delete("/api/alerts")
async def clear_alerts():
    _recent_alerts.clear()
    if _correlation_filter:
        _correlation_filter.reset_cooldown()
    await _broadcast_to_ws({"type": "alerts_cleared"})
    return JSONResponse({"cleared": True})

class ChatRequest(BaseModel):
    message: str
    history: list = []

@app.post("/api/chat")
async def handle_chat(req: ChatRequest):
    if not _orchestrator:
        return JSONResponse({"response": "Orchestrator not initialized."}, status_code=503)
    try:
        loop = asyncio.get_running_loop()
        metrics = await loop.run_in_executor(_executor, _scrape_metrics)
        
        response = await loop.run_in_executor(
            _executor,
            _orchestrator.answer_user_query,
            req.message,
            req.history,
            list(_recent_findings),
            list(_recent_alerts),
            metrics
        )
        return JSONResponse({"response": response})
    except Exception as e:
        log.error("Chat handler failed: %s", e)
        return JSONResponse({"response": f"Error calling Copilot: {str(e)}"}, status_code=500)


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    log.info("WebSocket client connected (%d total)", len(_ws_clients))
    try:
        # Send current state on connect
        await ws.send_text(json.dumps({
            "type": "initial_state",
            "data": {
                "recent_findings": list(_recent_findings)[:20],
                "recent_alerts": [_normalize_alert(a) for a in list(_recent_alerts)[:5]],
                "dependency_graph": _graph.to_json() if _graph else {},
                "metrics": _last_metrics,
            }
        }, default=str))
        # Emit current heartbeats immediately so dashboard doesn't wait 30s
        for agent in ["cpu", "memory", "storage", "network_log", "dmd"]:
            val = await _redis.get(f"edgemind:heartbeat:{agent}")
            if val:
                await ws.send_text(json.dumps({
                    "type": "agent_heartbeat",
                    "data": {"agent": agent, "timestamp": val},
                }, default=str))
        # Keep alive
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(ws)
        log.info("WebSocket client disconnected (%d total)", len(_ws_clients))


# ── Startup / shutdown ────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _redis, _graph, _orchestrator

    # Redis — retry on startup to tolerate CoreDNS not yet ready
    _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    for _attempt in range(10):
        try:
            await _redis.ping()
            break
        except Exception as _e:
            if _attempt == 9:
                raise
            _wait = min(2 ** _attempt, 30)
            log.warning("Redis not ready (attempt %d/10), retrying in %ds: %s", _attempt + 1, _wait, _e)
            await asyncio.sleep(_wait)
    log.info("Redis connected")

    # Kubernetes
    try:
        k8s_config.load_incluster_config()
    except Exception:
        k8s_config.load_kube_config()
    k8s_v1 = k8s_client.CoreV1Api()

    # Dependency graph
    _graph = DependencyGraph(k8s_v1)
    _graph.refresh()

    # Orchestrator
    _orchestrator = Orchestrator(_graph)

    # Start background tasks
    asyncio.create_task(_run_correlation_filter())
    asyncio.create_task(_finding_relay_loop())
    asyncio.create_task(_metric_broadcast_loop())
    asyncio.create_task(_heartbeat_broadcast_loop())

    log.info("edgemind-server ready on %s:%d", HOST, PORT)


async def _run_correlation_filter():
    """Run the correlation filter as a background task."""
    global _correlation_filter
    _correlation_filter = CorrelationFilter(
        redis=_redis,
        on_trigger=_on_correlated_bundle,
    )
    await _correlation_filter.run()


@app.on_event("shutdown")
async def shutdown():
    if _orchestrator:
        _orchestrator.close()
    if _redis:
        await _redis.aclose()


if __name__ == "__main__":
    uvicorn.run("edgemind_server.main:app", host=HOST, port=PORT, log_level=LOG_LEVEL.lower())
