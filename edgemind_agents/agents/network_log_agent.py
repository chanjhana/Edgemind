import asyncio
import logging
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np
import redis.asyncio as aioredis
from kubernetes import client as k8s_client, watch as k8s_watch

from edgemind_agents.anomaly_types import (
    NETWORK_FLOOD, PACKET_DROP, DEPENDENCY_CONFIRM,
    K8S_OOMKILL, CRASH_LOOP,
    LOG_ERROR_SURGE, TIMEOUT_PATTERN, PUMP_HEALTH_CRIT,
    SEV_INFO, SEV_WARNING, SEV_CRITICAL,
    NET_FLOOD_MULTIPLIER, NET_FLOOD_CYCLES,
    NET_DROP_RATE_THRESHOLD,
    NET_ROLL_WINDOW, NET_WARMUP_MIN,
    LOG_TAIL_INTERVAL_S, LOG_TAIL_LINES,
    LOG_ERROR_THRESHOLD, LOG_TIMEOUT_THRESHOLD,
    DEP_CONFIRM_LAG_S,
    CRITICAL_K8S_EVENTS,
    COLLECT_INTERVAL_S,
)
from edgemind_agents.agents.base import BaseAgent
from edgemind_agents.models import MetricSnapshot

log = logging.getLogger(__name__)

_MB = 1024 * 1024

_ERROR_PATTERNS = [
    re.compile(r"ERROR"),
    re.compile(r"Exception"),
    re.compile(r"Traceback"),
    re.compile(r"CRITICAL"),
    re.compile(r"FATAL"),
]
_TIMEOUT_PATTERNS = [
    re.compile(r"timeout", re.IGNORECASE),
    re.compile(r"timed out", re.IGNORECASE),
    re.compile(r"connection refused", re.IGNORECASE),
    re.compile(r"deadline exceeded", re.IGNORECASE),
]
_PUMP_HEALTH_RE = re.compile(
    r"pump=(\w+)\s+bearing_health=([\d.]+)\s+state=(\w+)\s+action=(\w+)"
)


class _PodNetState:
    def __init__(self):
        self.tx_window: deque = deque(maxlen=NET_ROLL_WINDOW)
        self.rx_window: deque = deque(maxlen=NET_ROLL_WINDOW)
        self.sustained_flood_cycles: int = 0
        self.last_tx_spike_ts: Optional[float] = None
        self.last_rx_spike_ts: Optional[float] = None


class NetworkLogAgent(BaseAgent):
    def __init__(self, name: str, queue: asyncio.Queue, redis: aioredis.Redis, k8s_v1: k8s_client.CoreV1Api):
        super().__init__(name, queue, redis)
        self._k8s = k8s_v1
        self._net_states: Dict[str, _PodNetState] = defaultdict(_PodNetState)
        self._last_log_tail: float = 0.0

    async def _process_network(self, snapshot: MetricSnapshot) -> None:
        now = time.monotonic()
        tx_spike_pods: List[Tuple[str, str, float]] = []  # (ns, container, ts)
        rx_spike_pods: List[Tuple[str, str, float]] = []

        for pod in snapshot.pods.values():
            key = f"{pod.namespace}/{pod.container}"
            state = self._net_states[key]

            state.tx_window.append(pod.net_tx_bytes_per_sec)
            state.rx_window.append(pod.net_rx_bytes_per_sec)

            if len(state.tx_window) < NET_WARMUP_MIN:
                continue

            tx_arr = np.array(state.tx_window)
            rx_arr = np.array(state.rx_window)
            tx_p75 = np.percentile(tx_arr[:-1], 75) if len(tx_arr) > 1 else 0.0
            rx_p75 = np.percentile(rx_arr[:-1], 75) if len(rx_arr) > 1 else 0.0

            # TX flood
            if tx_p75 > 0 and pod.net_tx_bytes_per_sec > tx_p75 * NET_FLOOD_MULTIPLIER:
                state.sustained_flood_cycles += 1
                state.last_tx_spike_ts = now
                tx_spike_pods.append((pod.namespace, pod.container, now))
            else:
                state.sustained_flood_cycles = max(0, state.sustained_flood_cycles - 1)

            if state.sustained_flood_cycles >= NET_FLOOD_CYCLES:
                await self.publish_finding({
                    "anomaly_type": NETWORK_FLOOD,
                    "severity": SEV_WARNING,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "direction": "tx",
                    "tx_bytes_per_sec": pod.net_tx_bytes_per_sec,
                    "baseline_p75": round(tx_p75, 1),
                    "current_value": pod.net_tx_bytes_per_sec / _MB,
                    "evidence": [
                        f"TX rate {pod.net_tx_bytes_per_sec / _MB:.2f} MB/s — {pod.net_tx_bytes_per_sec / tx_p75:.1f}x above 75th-percentile baseline",
                        f"Sustained for {state.sustained_flood_cycles} consecutive cycles ({state.sustained_flood_cycles * COLLECT_INTERVAL_S}s)",
                        f"Baseline P75: {tx_p75 / _MB:.3f} MB/s",
                    ],
                })

            # RX flood
            if rx_p75 > 0 and pod.net_rx_bytes_per_sec > rx_p75 * NET_FLOOD_MULTIPLIER:
                state.last_rx_spike_ts = now
                rx_spike_pods.append((pod.namespace, pod.container, now))
                await self.publish_finding({
                    "anomaly_type": NETWORK_FLOOD,
                    "severity": SEV_WARNING,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "direction": "rx",
                    "rx_bytes_per_sec": pod.net_rx_bytes_per_sec,
                    "baseline_p75": round(rx_p75, 1),
                    "current_value": pod.net_rx_bytes_per_sec / _MB,
                    "evidence": [
                        f"RX rate {pod.net_rx_bytes_per_sec / _MB:.2f} MB/s — {pod.net_rx_bytes_per_sec / rx_p75:.1f}x above 75th-percentile baseline",
                        f"Sustained for 1 consecutive cycle ({COLLECT_INTERVAL_S}s)",
                        f"Baseline P75: {rx_p75 / _MB:.3f} MB/s",
                    ],
                })

            # Packet drop
            if pod.net_rx_drop_rate > NET_DROP_RATE_THRESHOLD:
                await self.publish_finding({
                    "anomaly_type": PACKET_DROP,
                    "severity": SEV_WARNING,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "drop_rate": round(pod.net_rx_drop_rate, 5),
                    "current_value": pod.net_rx_drop_rate,
                    "evidence": [
                        f"Packet drop rate {pod.net_rx_drop_rate:.3%} exceeds {NET_DROP_RATE_THRESHOLD:.1%} threshold",
                        "Receive buffer likely overwhelmed",
                        "Upstream sender exceeding pod processing capacity",
                    ],
                })

        # Dependency confirmation: tx spike from pod_A and rx spike on pod_B within DEP_CONFIRM_LAG_S
        for tx_ns, tx_cn, tx_ts in tx_spike_pods:
            for rx_ns, rx_cn, rx_ts in rx_spike_pods:
                if tx_cn == rx_cn:
                    continue
                if abs(tx_ts - rx_ts) <= DEP_CONFIRM_LAG_S:
                    await self.publish_finding({
                        "anomaly_type": DEPENDENCY_CONFIRM,
                        "severity": SEV_INFO,
                        "source_pod": tx_cn,
                        "source_namespace": tx_ns,
                        "dest_pod": rx_cn,
                        "dest_namespace": rx_ns,
                        "lag_seconds": round(abs(tx_ts - rx_ts), 1),
                        "current_value": abs(tx_ts - rx_ts),
                        "evidence": [
                            f"{tx_cn} transmit spike and {rx_cn} receive spike within {abs(tx_ts - rx_ts):.0f}s",
                            "Simultaneous spikes confirm direct communication between pods",
                        ],
                    })

    async def _tail_logs(self) -> None:
        try:
            pods = self._k8s.list_namespaced_pod("pump-station", watch=False)
        except Exception as e:
            log.warning("Failed to list pump-station pods: %s", e)
            return

        for pod in pods.items:
            pod_name = pod.metadata.name
            ns = pod.metadata.namespace
            container = pod.spec.containers[0].name if pod.spec.containers else ""

            try:
                logs = self._k8s.read_namespaced_pod_log(
                    name=pod_name,
                    namespace=ns,
                    tail_lines=LOG_TAIL_LINES,
                    _preload_content=True,
                )
            except Exception as e:
                log.debug("Log tail failed for %s/%s: %s", ns, pod_name, e)
                continue

            lines = logs.splitlines() if logs else []
            error_count = sum(
                1 for line in lines if any(p.search(line) for p in _ERROR_PATTERNS)
            )
            timeout_count = sum(
                1 for line in lines if any(p.search(line) for p in _TIMEOUT_PATTERNS)
            )

            if error_count >= LOG_ERROR_THRESHOLD:
                await self.publish_finding({
                    "anomaly_type": LOG_ERROR_SURGE,
                    "severity": SEV_WARNING,
                    "pod": pod_name,
                    "namespace": ns,
                    "container": container,
                    "error_count": error_count,
                    "sample_lines": LOG_TAIL_LINES,
                    "current_value": error_count,
                    "evidence": [
                        f"{error_count} ERROR-level log lines in last {LOG_TAIL_LINES} lines",
                        f"Threshold: {LOG_ERROR_THRESHOLD} errors per {LOG_TAIL_INTERVAL_S}s interval",
                    ],
                })

            if timeout_count >= LOG_TIMEOUT_THRESHOLD:
                await self.publish_finding({
                    "anomaly_type": TIMEOUT_PATTERN,
                    "severity": SEV_WARNING,
                    "pod": pod_name,
                    "namespace": ns,
                    "container": container,
                    "timeout_count": timeout_count,
                    "current_value": timeout_count,
                    "evidence": [
                        f"{timeout_count} timeout/connection-refused patterns in last {LOG_TAIL_LINES} lines",
                        "Upstream dependency likely slow or unavailable",
                    ],
                })

            # health-scorer pump health parsing
            for line in lines:
                m = _PUMP_HEALTH_RE.search(line)
                if m:
                    pump, bearing_health, state, action = m.groups()
                    if state in ("CRITICAL", "WARNING"):
                        await self.publish_finding({
                            "anomaly_type": PUMP_HEALTH_CRIT,
                            "severity": SEV_CRITICAL if state == "CRITICAL" else SEV_WARNING,
                            "pod": pod_name,
                            "namespace": ns,
                            "pump": pump,
                            "bearing_health": float(bearing_health),
                            "state": state,
                            "action": action,
                            "current_value": float(bearing_health),
                            "evidence": [
                                f"health-scorer log: pump={pump} bearing_health={bearing_health} state={state}",
                                f"Action triggered: {action}",
                                "Root cause traceable to pump-level fault injection",
                            ],
                        })

    async def _watch_k8s_events(self) -> None:
        w = k8s_watch.Watch()
        while True:
            try:
                for event in w.stream(
                    self._k8s.list_event_for_all_namespaces,
                    timeout_seconds=60,
                ):
                    obj = event.get("object")
                    if obj is None:
                        continue
                    reason = getattr(obj, "reason", "") or ""
                    anomaly_type = CRITICAL_K8S_EVENTS.get(reason)
                    if anomaly_type:
                        involved = getattr(obj, "involved_object", None)
                        pod_name = getattr(involved, "name", "") if involved else ""
                        ns = getattr(involved, "namespace", "") if involved else ""
                        await self.publish_finding({
                            "anomaly_type": anomaly_type,
                            "severity": SEV_CRITICAL,
                            "pod": pod_name,
                            "namespace": ns,
                            "k8s_reason": reason,
                            "message": getattr(obj, "message", ""),
                            "current_value": 1,
                            "evidence": [
                                f"Kubernetes control plane event: reason={reason}",
                                f"Message: {getattr(obj, 'message', '')}",
                            ],
                        })
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("K8s event watch disconnected: %s. Reconnecting in 5s.", e)
                await asyncio.sleep(5)

    async def run(self) -> None:
        hb_task = asyncio.create_task(self._heartbeat_loop())
        event_task = asyncio.create_task(self._watch_k8s_events())
        try:
            while True:
                snapshot = await self.queue.get()
                try:
                    await self._process_network(snapshot)
                except Exception as e:
                    log.error("[%s] network process error: %s", self.name, e, exc_info=True)

                now = time.monotonic()
                if now - self._last_log_tail >= LOG_TAIL_INTERVAL_S:
                    try:
                        await self._tail_logs()
                    except Exception as e:
                        log.error("[%s] log tail error: %s", self.name, e, exc_info=True)
                    self._last_log_tail = now
        finally:
            hb_task.cancel()
            event_task.cancel()

    async def process(self, snapshot: MetricSnapshot) -> None:
        # Satisfies abstract base but run() overrides the full loop
        await self._process_network(snapshot)
