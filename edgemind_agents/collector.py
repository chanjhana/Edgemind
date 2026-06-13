import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List

import httpx

from edgemind_agents.anomaly_types import (
    COLLECT_INTERVAL_S,
    STARTUP_OFFSET_S,
    QUERY_TIMEOUT_S,
    WATCHED_NAMESPACES,
)
from edgemind_agents.models import MetricSnapshot, PodMetrics, NodeMetrics, PVCMetrics

log = logging.getLogger(__name__)

BATCH_QUERIES = {
    "cpu_usage": (
        f'rate(container_cpu_usage_seconds_total{{container!="POD",container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "cpu_throttle": (
        f'rate(container_cpu_cfs_throttled_seconds_total{{container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "cpu_limits": (
        f'kube_pod_container_resource_limits{{namespace=~"{WATCHED_NAMESPACES}"}}'
    ),
    "node_cpu_idle": 'rate(node_cpu_seconds_total{mode="idle"}[1m])',
    "mem_rss": (
        f'container_memory_rss{{container!="POD",container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}'
    ),
    "mem_working_set": (
        f'container_memory_working_set_bytes{{container!="POD",container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}'
    ),
    "node_mem_available": "node_memory_MemAvailable_bytes",
    "node_mem_total": "node_memory_MemTotal_bytes",
    "pvc_used": "kubelet_volume_stats_used_bytes",
    "pvc_capacity": "kubelet_volume_stats_capacity_bytes",
    "fs_writes": (
        f'rate(container_fs_writes_bytes_total{{container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "fs_reads": (
        f'rate(container_fs_reads_bytes_total{{container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "fs_io_time": (
        f'rate(container_fs_io_time_seconds_total{{container!="",'
        f'namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "net_tx": (
        f'rate(container_network_transmit_bytes_total{{namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "net_rx": (
        f'rate(container_network_receive_bytes_total{{namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "net_tx_packets": (
        f'rate(container_network_transmit_packets_total{{namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "net_rx_drops": (
        f'rate(container_network_receive_packets_dropped_total{{namespace=~"{WATCHED_NAMESPACES}"}}[1m])'
    ),
    "pod_restarts": (
        f'kube_pod_container_status_restarts_total{{namespace=~"{WATCHED_NAMESPACES}"}}'
    ),
}


def _pod_key(namespace: str, container: str) -> str:
    return f"{namespace}/{container}"


class MetricCollector:
    def __init__(self, queues: Dict[str, asyncio.Queue], prometheus_url: str):
        self._queues = queues
        self._prometheus_url = prometheus_url.rstrip("/")
        self._client: httpx.AsyncClient = None

    async def _query(self, client: httpx.AsyncClient, name: str, promql: str) -> List[dict]:
        try:
            resp = await client.get(
                f"{self._prometheus_url}/api/v1/query",
                params={"query": promql},
                timeout=QUERY_TIMEOUT_S,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == "success":
                return data["data"]["result"]
        except Exception as e:
            log.warning("Prometheus query failed [%s]: %s", name, e)
        return []

    async def _collect_once(self, client: httpx.AsyncClient) -> MetricSnapshot:
        now = datetime.now(timezone.utc)
        errors: Dict[str, str] = {}

        # Fire all queries concurrently
        tasks = {
            name: asyncio.create_task(self._query(client, name, promql))
            for name, promql in BATCH_QUERIES.items()
        }
        results: Dict[str, List[dict]] = {}
        for name, task in tasks.items():
            try:
                results[name] = await task
            except Exception as e:
                results[name] = []
                errors[name] = str(e)

        pods: Dict[str, PodMetrics] = {}

        def get_or_create(ns: str, container: str, pod_name: str = "") -> PodMetrics:
            key = _pod_key(ns, container)
            if key not in pods:
                pods[key] = PodMetrics(
                    pod=pod_name or container,
                    namespace=ns,
                    container=container,
                    collected_at=now,
                )
            return pods[key]

        # cpu_usage
        for item in results.get("cpu_usage", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            pod_name = lbl.get("pod", container)
            if not (ns and container):
                continue
            p = get_or_create(ns, container, pod_name)
            p.cpu_usage_cores = float(item["value"][1])

        # cpu_throttle
        for item in results.get("cpu_throttle", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            throttled = float(item["value"][1])
            total = p.cpu_usage_cores + throttled
            p.cpu_throttle_rate = throttled / total if total > 0 else 0.0

        # cpu_limits (filters by resource=cpu)
        for item in results.get("cpu_limits", []):
            lbl = item["metric"]
            if lbl.get("resource") != "cpu":
                continue
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.cpu_limit_cores = float(item["value"][1])

        # mem_rss
        for item in results.get("mem_rss", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.mem_rss_bytes = float(item["value"][1])

        # mem_working_set
        for item in results.get("mem_working_set", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.mem_working_set_bytes = float(item["value"][1])

        # memory limits (from cpu_limits query, filter by resource=memory)
        for item in results.get("cpu_limits", []):
            lbl = item["metric"]
            if lbl.get("resource") != "memory":
                continue
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.mem_limit_bytes = float(item["value"][1])

        # fs_writes
        for item in results.get("fs_writes", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.fs_write_bytes_per_sec = float(item["value"][1])

        # fs_reads
        for item in results.get("fs_reads", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.fs_read_bytes_per_sec = float(item["value"][1])

        # fs_io_time (saturation = fraction of time doing I/O, capped at 1.0)
        for item in results.get("fs_io_time", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            p = get_or_create(ns, container)
            p.fs_io_saturation = min(1.0, float(item["value"][1]))

        # Network metrics: matched by pod label substring against container name
        def _match_net(pod_label: str, ns: str) -> str:
            """Return container key if a pod in ns contains pod_label as substring."""
            for key, pm in pods.items():
                if pm.namespace == ns and pm.container in pod_label:
                    return key
            return ""

        for item in results.get("net_tx", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            pod_name = lbl.get("pod", "")
            key = _match_net(pod_name, ns)
            if key:
                pods[key].net_tx_bytes_per_sec = float(item["value"][1])

        for item in results.get("net_rx", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            pod_name = lbl.get("pod", "")
            key = _match_net(pod_name, ns)
            if key:
                pods[key].net_rx_bytes_per_sec = float(item["value"][1])

        for item in results.get("net_tx_packets", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            pod_name = lbl.get("pod", "")
            key = _match_net(pod_name, ns)
            if key:
                pods[key].net_tx_packets_per_sec = float(item["value"][1])

        for item in results.get("net_rx_drops", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            pod_name = lbl.get("pod", "")
            drops = float(item["value"][1])
            key = _match_net(pod_name, ns)
            if key:
                rx = pods[key].net_rx_bytes_per_sec
                pods[key].net_rx_drop_rate = drops / (drops + rx) if (drops + rx) > 0 else 0.0

        # pod_restarts
        for item in results.get("pod_restarts", []):
            lbl = item["metric"]
            ns = lbl.get("namespace", "")
            container = lbl.get("container", "")
            if not (ns and container):
                continue
            key = _pod_key(ns, container)
            if key in pods:
                pods[key].restart_count = int(float(item["value"][1]))

        # Node metrics (average across all CPUs/nodes)
        node_idle_vals = [float(r["value"][1]) for r in results.get("node_cpu_idle", [])]
        node_cpu_idle = sum(node_idle_vals) / len(node_idle_vals) if node_idle_vals else 0.0

        node_mem_avail_vals = [float(r["value"][1]) for r in results.get("node_mem_available", [])]
        node_mem_total_vals = [float(r["value"][1]) for r in results.get("node_mem_total", [])]
        node_mem_avail = sum(node_mem_avail_vals) / max(1, len(node_mem_avail_vals))
        node_mem_total = sum(node_mem_total_vals) / max(1, len(node_mem_total_vals))

        node = NodeMetrics(
            cpu_idle_ratio=node_cpu_idle,
            mem_available_bytes=node_mem_avail,
            mem_total_bytes=node_mem_total,
            collected_at=now,
        )

        # PVC metrics
        pvcs: Dict[str, PVCMetrics] = {}
        for item in results.get("pvc_used", []):
            lbl = item["metric"]
            pvc_name = lbl.get("persistentvolumeclaim", "")
            ns = lbl.get("namespace", "")
            if not pvc_name:
                continue
            pvcs[pvc_name] = PVCMetrics(
                pvc_name=pvc_name,
                namespace=ns,
                used_bytes=float(item["value"][1]),
                collected_at=now,
            )

        for item in results.get("pvc_capacity", []):
            lbl = item["metric"]
            pvc_name = lbl.get("persistentvolumeclaim", "")
            if pvc_name in pvcs:
                pvcs[pvc_name].capacity_bytes = float(item["value"][1])

        return MetricSnapshot(
            pods=pods,
            node=node,
            pvcs=pvcs,
            collected_at=now,
            collection_errors=errors,
        )

    async def _broadcast(self, snapshot: MetricSnapshot) -> None:
        for q in self._queues.values():
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await q.put(snapshot)

    async def run(self) -> None:
        await asyncio.sleep(STARTUP_OFFSET_S)
        async with httpx.AsyncClient() as client:
            while True:
                try:
                    snapshot = await self._collect_once(client)
                    if snapshot.collection_errors:
                        log.warning("Collection errors: %s", snapshot.collection_errors)
                    await self._broadcast(snapshot)
                    log.debug(
                        "Collected snapshot: %d pods, %d pvcs",
                        len(snapshot.pods), len(snapshot.pvcs),
                    )
                except Exception as e:
                    log.error("Collector error: %s", e, exc_info=True)
                await asyncio.sleep(COLLECT_INTERVAL_S)
