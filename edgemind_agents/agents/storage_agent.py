import asyncio
import logging
import time
from collections import defaultdict, deque
from typing import Dict, List, Optional, Set

import numpy as np
import redis.asyncio as aioredis
from kubernetes import client as k8s_client
from scipy import stats

from edgemind_agents.anomaly_types import (
    IO_SATURATION, WRITE_BURST, PVC_FILL, PVC_CONTENTION, RESTART_IO,
    SEV_WARNING, SEV_CRITICAL,
    STORAGE_IO_SAT_WARNING, STORAGE_IO_SAT_CRITICAL,
    STORAGE_WRITE_BURST_Z,
    STORAGE_PVC_FILL_WARN, STORAGE_PVC_FILL_CRIT,
    STORAGE_TTF_WARN_HOURS, STORAGE_TTF_CRIT_HOURS,
    STORAGE_ROLL_WINDOW, STORAGE_PVC_ROLL_WINDOW, STORAGE_WARMUP_MIN,
    STORAGE_PVC_REFRESH_S, STORAGE_SUSTAINED_BURST_CYCLES,
    COLLECT_INTERVAL_S,
)
from edgemind_agents.agents.base import BaseAgent
from edgemind_agents.models import MetricSnapshot

log = logging.getLogger(__name__)

_MB = 1024 * 1024


class _PodStorageState:
    def __init__(self):
        self.write_window: deque = deque(maxlen=STORAGE_ROLL_WINDOW)
        self.io_sat_window: deque = deque(maxlen=STORAGE_ROLL_WINDOW)
        self.sustained_burst_cycles: int = 0
        self.last_restart_count: int = 0
        self.last_io_sat: float = 0.0


class StorageAgent(BaseAgent):
    def __init__(self, name: str, queue: asyncio.Queue, redis: aioredis.Redis, k8s_v1: k8s_client.CoreV1Api):
        super().__init__(name, queue, redis)
        self._k8s = k8s_v1
        self._states: Dict[str, _PodStorageState] = defaultdict(_PodStorageState)
        self._pvc_windows: Dict[str, deque] = defaultdict(lambda: deque(maxlen=STORAGE_PVC_ROLL_WINDOW))
        # pvc_name -> set of container names that mount it
        self._pvc_pod_map: Dict[str, Set[str]] = {}
        self._last_pvc_refresh: float = 0.0

    async def _refresh_pvc_map(self) -> None:
        now = time.monotonic()
        if now - self._last_pvc_refresh < STORAGE_PVC_REFRESH_S:
            return
        try:
            pods = self._k8s.list_pod_for_all_namespaces(watch=False)
            mapping: Dict[str, Set[str]] = defaultdict(set)
            for pod in pods.items:
                ns = pod.metadata.namespace
                container_names = [c.name for c in (pod.spec.containers or [])]
                for vol in (pod.spec.volumes or []):
                    if vol.persistent_volume_claim:
                        pvc = vol.persistent_volume_claim.claim_name
                        for cn in container_names:
                            mapping[pvc].add(f"{ns}/{cn}")
            self._pvc_pod_map = dict(mapping)
            self._last_pvc_refresh = now
            log.debug("PVC map refreshed: %d pvcs", len(self._pvc_pod_map))
        except Exception as e:
            log.warning("Failed to refresh PVC map: %s", e)

    async def process(self, snapshot: MetricSnapshot) -> None:
        await self._refresh_pvc_map()

        saturated_pods = []

        for pod in snapshot.pods.values():
            key = f"{pod.namespace}/{pod.container}"
            state = self._states[key]

            # Restart + recent high I/O → RESTART_IO
            if pod.restart_count > state.last_restart_count:
                if state.last_io_sat > STORAGE_IO_SAT_WARNING:
                    await self.publish_finding({
                        "anomaly_type": RESTART_IO,
                        "severity": SEV_WARNING,
                        "pod": pod.pod,
                        "namespace": pod.namespace,
                        "container": pod.container,
                        "pre_restart_io_sat": round(state.last_io_sat, 3),
                        "restart_count": pod.restart_count,
                        "current_value": state.last_io_sat,
                        "evidence": [
                            f"Pod restarted after I/O saturation of {state.last_io_sat:.1%}",
                            "High disk I/O likely contributed to instability",
                        ],
                    })
                state.write_window.clear()
                state.io_sat_window.clear()
                state.sustained_burst_cycles = 0
                state.last_restart_count = pod.restart_count

            state.last_io_sat = pod.fs_io_saturation
            state.write_window.append(pod.fs_write_bytes_per_sec)
            state.io_sat_window.append(pod.fs_io_saturation)

            if len(state.write_window) < STORAGE_WARMUP_MIN:
                continue

            # I/O saturation
            io_evidence = [
                f"I/O saturation {pod.fs_io_saturation:.1%} — {'above critical' if pod.fs_io_saturation >= STORAGE_IO_SAT_CRITICAL else 'above warning'} threshold",
                f"Disk has {'no' if pod.fs_io_saturation >= 0.99 else 'limited'} remaining I/O capacity",
                f"Write rate: {pod.fs_write_bytes_per_sec / _MB:.1f} MB/s, Read rate: {pod.fs_read_bytes_per_sec / _MB:.1f} MB/s",
            ]
            if pod.fs_io_saturation >= STORAGE_IO_SAT_CRITICAL:
                saturated_pods.append(pod)
                await self.publish_finding({
                    "anomaly_type": IO_SATURATION,
                    "severity": SEV_CRITICAL,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "io_saturation": round(pod.fs_io_saturation, 3),
                    "current_value": pod.fs_io_saturation,
                    "evidence": io_evidence,
                })
            elif pod.fs_io_saturation >= STORAGE_IO_SAT_WARNING:
                saturated_pods.append(pod)
                await self.publish_finding({
                    "anomaly_type": IO_SATURATION,
                    "severity": SEV_WARNING,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "io_saturation": round(pod.fs_io_saturation, 3),
                    "current_value": pod.fs_io_saturation,
                    "evidence": io_evidence,
                })

            # Write burst detection
            arr = np.array(state.write_window)
            mean = arr.mean()
            std = arr.std()
            z = (pod.fs_write_bytes_per_sec - mean) / std if std > 0 else 0.0

            if z >= STORAGE_WRITE_BURST_Z:
                state.sustained_burst_cycles += 1
            else:
                state.sustained_burst_cycles = 0

            if state.sustained_burst_cycles >= STORAGE_SUSTAINED_BURST_CYCLES:
                await self.publish_finding({
                    "anomaly_type": WRITE_BURST,
                    "severity": SEV_WARNING,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "write_bytes_per_sec": pod.fs_write_bytes_per_sec,
                    "z_score": round(z, 2),
                    "current_value": pod.fs_write_bytes_per_sec / _MB,
                    "evidence": [
                        f"Write rate {pod.fs_write_bytes_per_sec / _MB:.1f} MB/s — Z-score {z:.1f} above {STORAGE_ROLL_WINDOW}-cycle baseline",
                        f"Sustained for {state.sustained_burst_cycles} consecutive cycles",
                        f"Baseline mean: {mean / _MB:.1f} MB/s",
                    ],
                })

        # PVC contention: multiple saturated pods on same PVC
        if len(saturated_pods) >= 2:
            saturated_keys = {f"{p.namespace}/{p.container}" for p in saturated_pods}
            for pvc_name, pod_keys in self._pvc_pod_map.items():
                shared = saturated_keys & pod_keys
                if len(shared) >= 2:
                    await self.publish_finding({
                        "anomaly_type": PVC_CONTENTION,
                        "severity": SEV_WARNING,
                        "pvc": pvc_name,
                        "contending_pods": list(shared),
                        "current_value": len(shared),
                        "evidence": [
                            f"{len(shared)} pods showing elevated I/O simultaneously on PVC {pvc_name}",
                            f"Contending pods: {', '.join(shared)}",
                            "Concurrent access causing disk saturation",
                        ],
                    })

        # PVC fill
        for pvc_name, pvc in snapshot.pvcs.items():
            win = self._pvc_windows[pvc_name]
            win.append(pvc.used_bytes)

            if pvc.fill_ratio >= STORAGE_PVC_FILL_CRIT:
                severity = SEV_CRITICAL
            elif pvc.fill_ratio >= STORAGE_PVC_FILL_WARN:
                severity = SEV_WARNING
            else:
                severity = None

            ttf_hours: Optional[float] = None
            if len(win) >= 3:
                x = list(range(len(win)))
                slope, _, _, _, _ = stats.linregress(x, list(win))
                if slope > 0:
                    free = pvc.free_bytes
                    slope_per_sec = slope / COLLECT_INTERVAL_S
                    ttf_hours = (free / slope_per_sec) / 3600.0

                    if ttf_hours < STORAGE_TTF_CRIT_HOURS:
                        severity = SEV_CRITICAL
                    elif ttf_hours < STORAGE_TTF_WARN_HOURS and severity is None:
                        severity = SEV_WARNING

            if severity:
                await self.publish_finding({
                    "anomaly_type": PVC_FILL,
                    "severity": severity,
                    "pvc": pvc_name,
                    "namespace": pvc.namespace,
                    "fill_ratio": round(pvc.fill_ratio, 3),
                    "used_bytes": pvc.used_bytes,
                    "capacity_bytes": pvc.capacity_bytes,
                    "ttf_hours": round(ttf_hours, 1) if ttf_hours is not None else None,
                    "current_value": pvc.fill_ratio,
                    "evidence": [
                        f"PVC {pvc_name} at {pvc.fill_ratio:.1%} capacity ({pvc.used_bytes / _MB:.0f} MB / {pvc.capacity_bytes / _MB:.0f} MB)",
                        f"TTF: {ttf_hours:.1f} hours at current fill rate" if ttf_hours is not None else "Fill rate insufficient for TTF forecast",
                    ],
                })
