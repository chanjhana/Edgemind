"""
tools.py — tool implementations for the AI orchestrator.

Three tools available to Qwen3:
  query_prometheus    — run a PromQL query and return results
  get_pod_logs        — get recent logs from a pod
  get_kubernetes_events — get K8s events for a pod or namespace

These are called synchronously by the orchestrator during tool-use turns.
"""

import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from kubernetes import client as k8s_client
from datetime import datetime, timezone

_EPOCH = datetime.min.replace(tzinfo=timezone.utc)
log = logging.getLogger(__name__)

PROMETHEUS_URL = os.environ.get(
    "PROMETHEUS_URL",
    "http://prometheus-operated.monitoring.svc.cluster.local:9090"
)


# ── Tool definitions for Ollama tool-use API ─────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "query_prometheus",
            "description": (
                "Run a PromQL query against Prometheus to get current or recent "
                "metric values for pods. Use this to check CPU usage, memory, "
                "network traffic, or filesystem metrics for specific pods. "
                "Returns the metric values as a list of results."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "promql": {
                        "type": "string",
                        "description": (
                            "The PromQL query to run. Always filter by namespace "
                            "and container/pod labels. Example: "
                            "rate(container_cpu_usage_seconds_total{container='opc-ua-collector',namespace='pump-station'}[5m])"
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of why you're running this query",
                    },
                },
                "required": ["promql", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pod_logs",
            "description": (
                "Get recent log lines from a specific pod. Use this to confirm "
                "the cause of a metric anomaly — look for error messages, "
                "connection failures, or health-scorer decisions. "
                "Returns the last N lines of pod logs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pod_name": {
                        "type": "string",
                        "description": "Exact pod name (e.g. 'opc-ua-collector-6bb4c7cb48-g55s7')",
                    },
                    "namespace": {
                        "type": "string",
                        "description": "Kubernetes namespace (e.g. 'pump-station')",
                    },
                    "tail_lines": {
                        "type": "integer",
                        "description": "Number of recent log lines to retrieve (default 30, max 100)",
                        "default": 30,
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of what you're looking for",
                    },
                },
                "required": ["pod_name", "namespace", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_kubernetes_events",
            "description": (
                "Get recent Kubernetes events for a pod or namespace. "
                "Use this to detect OOMKill, CrashLoopBackOff, eviction, "
                "or other lifecycle events that explain a pod's behavior. "
                "Returns recent events sorted by time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "namespace": {
                        "type": "string",
                        "description": "Kubernetes namespace to query events for",
                    },
                    "pod_name": {
                        "type": "string",
                        "description": "Optional: filter events for a specific pod name",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of what you're looking for",
                    },
                },
                "required": ["namespace", "reason"],
            },
        },
    },
]


# ── Tool execution functions ──────────────────────────────────────────────────

def query_prometheus(promql: str, reason: str) -> Dict[str, Any]:
    """Execute a PromQL query and return structured results."""
    log.info("Tool: query_prometheus — %s", reason)
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                f"{PROMETHEUS_URL}/api/v1/query",
                params={"query": promql},
            )
            data = resp.json()
            if data.get("status") == "success":
                results = data["data"]["result"]
                # Format results for LLM consumption
                formatted = []
                for r in results[:10]:  # limit to 10 results
                    metric = r.get("metric", {})
                    value = r.get("value", [None, "0"])
                    formatted.append({
                        "pod": metric.get("pod", metric.get("container", "unknown")),
                        "namespace": metric.get("namespace", "unknown"),
                        "value": float(value[1]) if value[1] else 0.0,
                        "labels": {k: v for k, v in metric.items()
                                   if k not in ("__name__", "job", "instance")},
                    })
                return {
                    "success": True,
                    "query": promql,
                    "result_count": len(results),
                    "results": formatted,
                }
            else:
                return {"success": False, "error": data.get("error", "unknown")}
    except Exception as e:
        log.warning("query_prometheus failed: %s", e)
        return {"success": False, "error": str(e)}


def get_pod_logs(
    pod_name: str,
    namespace: str,
    reason: str,
    tail_lines: int = 30,
) -> Dict[str, Any]:
    """Retrieve recent pod logs via Kubernetes API."""
    log.info("Tool: get_pod_logs %s/%s — %s", namespace, pod_name, reason)
    tail_lines = min(tail_lines, 100)
    try:
        v1 = k8s_client.CoreV1Api()
        # Resolve prefix → full pod name if an exact match doesn't exist.
        # Strip trailing hash segments first so hallucinated full names like
        # "opc-ua-collector-7d9c8f6b9c-abc12" reduce to "opc-ua-collector"
        # before the prefix search.
        clean_name = re.sub(r'-[a-z0-9]{5,12}-[a-z0-9]{5}$', '', pod_name)
        if clean_name != pod_name:
            log.debug("Stripped hash from pod_name: %s → %s", pod_name, clean_name)
        resolved_name = pod_name
        try:
            v1.read_namespaced_pod(name=pod_name, namespace=namespace)
        except Exception:
            pods = v1.list_namespaced_pod(namespace=namespace)
            match = next(
                (p.metadata.name for p in pods.items
                 if p.metadata.name.startswith(clean_name)),
                None,
            )
            if match:
                log.info("get_pod_logs: resolved '%s' → '%s'", pod_name, match)
                resolved_name = match
        logs = v1.read_namespaced_pod_log(
            name=resolved_name,
            namespace=namespace,
            tail_lines=tail_lines,
            _preload_content=True,
        )
        lines = logs.splitlines() if logs else []
        # Filter for relevant lines
        error_lines = [l for l in lines if any(
            kw in l for kw in ("ERROR", "CRITICAL", "Exception", "error", "failed", "pump=")
        )]
        return {
            "success": True,
            "pod": resolved_name,
            "namespace": namespace,
            "total_lines": len(lines),
            "error_lines": error_lines[:20],
            "recent_lines": lines[-10:],
        }
    except Exception as e:
        log.warning("get_pod_logs failed: %s", e)
        return {"success": False, "pod": pod_name, "error": str(e)}


def get_kubernetes_events(
    namespace: str,
    reason: str,
    pod_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieve recent Kubernetes events for namespace or specific pod."""
    log.info("Tool: get_kubernetes_events %s/%s — %s", namespace, pod_name, reason)
    try:
        v1 = k8s_client.CoreV1Api()
        events = v1.list_namespaced_event(
            namespace=namespace,
            field_selector=f"involvedObject.name={pod_name}" if pod_name else None,
        )
        formatted = []
        for e in sorted(events.items, key=lambda x: x.last_timestamp or _EPOCH, reverse=True)[:15]:
            formatted.append({
                "reason": e.reason,
                "message": e.message,
                "pod": e.involved_object.name if e.involved_object else "unknown",
                "type": e.type,
                "count": e.count,
                "last_seen": e.last_timestamp.isoformat() if e.last_timestamp else "unknown",
            })
        return {
            "success": True,
            "namespace": namespace,
            "event_count": len(formatted),
            "events": formatted,
        }
    except Exception as e:
        log.warning("get_kubernetes_events failed: %s", e)
        return {"success": False, "namespace": namespace, "error": str(e)}


def execute_tool(tool_name: str, tool_args: Dict[str, Any]) -> str:
    """Dispatch tool call and return JSON string result."""
    import json
    if tool_name == "query_prometheus":
        result = query_prometheus(**tool_args)
    elif tool_name == "get_pod_logs":
        result = get_pod_logs(**tool_args)
    elif tool_name == "get_kubernetes_events":
        result = get_kubernetes_events(**tool_args)
    else:
        result = {"error": f"Unknown tool: {tool_name}"}
    return json.dumps(result, default=str)
