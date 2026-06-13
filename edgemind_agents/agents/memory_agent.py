import asyncio
import logging
from collections import defaultdict, deque
from typing import Dict, Optional

import redis.asyncio as aioredis
from scipy import stats

from edgemind_agents.anomaly_types import (
    MEMORY_LEAK, PRE_OOM, NODE_PRESSURE, OOMKILL, MEMORY_STEP,
    SEV_INFO, SEV_WARNING, SEV_CRITICAL,
    MEM_LEAK_SLOPE_MB_PER_MIN, MEM_LEAK_R2_MIN,
    MEM_PRE_OOM_RATIO,
    MEM_OOM_ETA_CRITICAL_MIN, MEM_OOM_ETA_WARNING_MIN, MEM_OOM_ETA_INFO_MIN,
    MEM_NODE_WARN_RATIO, MEM_NODE_CRIT_RATIO,
    MEM_STEP_CHANGE_MB,
    MEM_REGRESSION_WINDOW, MEM_WARMUP_MIN,
    COLLECT_INTERVAL_S,
)
from edgemind_agents.agents.base import BaseAgent
from edgemind_agents.models import MetricSnapshot

log = logging.getLogger(__name__)

_MB = 1024 * 1024
_SCRAPES_PER_MIN = 60.0 / COLLECT_INTERVAL_S
_OOM_WS_RATIO = 0.90


class _PodMemState:
    def __init__(self):
        self.rss_window: deque = deque(maxlen=MEM_REGRESSION_WINDOW)
        self.ws_window: deque = deque(maxlen=MEM_REGRESSION_WINDOW)
        self.last_restart_count: int = 0
        self.last_rss: float = 0.0


class MemoryAgent(BaseAgent):
    def __init__(self, name: str, queue: asyncio.Queue, redis: aioredis.Redis):
        super().__init__(name, queue, redis)
        self._states: Dict[str, _PodMemState] = defaultdict(_PodMemState)

    def _get_state(self, key: str) -> _PodMemState:
        return self._states[key]

    async def process(self, snapshot: MetricSnapshot) -> None:
        node = snapshot.node

        # Node pressure check
        if node and node.mem_total_bytes > 0:
            pressure = node.mem_pressure_ratio
            if pressure < MEM_NODE_CRIT_RATIO:
                # Find pod with steepest RSS slope as likely cause
                worst_pod = None
                worst_slope = 0.0
                for pod in snapshot.pods.values():
                    key = f"{pod.namespace}/{pod.container}"
                    st = self._get_state(key)
                    if len(st.rss_window) >= MEM_WARMUP_MIN:
                        x = list(range(len(st.rss_window)))
                        slope, _, _, _, _ = stats.linregress(x, list(st.rss_window))
                        slope_mb_per_min = (slope * _SCRAPES_PER_MIN) / _MB
                        if slope_mb_per_min > worst_slope:
                            worst_slope = slope_mb_per_min
                            worst_pod = pod

                await self.publish_finding({
                    "anomaly_type": NODE_PRESSURE,
                    "severity": SEV_CRITICAL,
                    "mem_available_bytes": node.mem_available_bytes,
                    "mem_total_bytes": node.mem_total_bytes,
                    "mem_pressure_ratio": round(pressure, 3),
                    "likely_cause_pod": worst_pod.pod if worst_pod else None,
                    "likely_cause_slope_mb_per_min": round(worst_slope, 2) if worst_pod else None,
                })
            elif pressure < MEM_NODE_WARN_RATIO:
                await self.publish_finding({
                    "anomaly_type": NODE_PRESSURE,
                    "severity": SEV_WARNING,
                    "mem_available_bytes": node.mem_available_bytes,
                    "mem_total_bytes": node.mem_total_bytes,
                    "mem_pressure_ratio": round(pressure, 3),
                })

        for pod in snapshot.pods.values():
            key = f"{pod.namespace}/{pod.container}"
            state = self._get_state(key)

            # OOMKill detection: restart + pre-restart WS was near limit
            if pod.restart_count > state.last_restart_count:
                if state.ws_window and pod.mem_limit_bytes > 0:
                    pre_ws = list(state.ws_window)[-1]
                    if pre_ws / pod.mem_limit_bytes > _OOM_WS_RATIO:
                        await self.publish_finding({
                            "anomaly_type": OOMKILL,
                            "severity": SEV_CRITICAL,
                            "pod": pod.pod,
                            "namespace": pod.namespace,
                            "container": pod.container,
                            "pre_restart_ws_bytes": pre_ws,
                            "mem_limit_bytes": pod.mem_limit_bytes,
                            "restart_count": pod.restart_count,
                        })
                state.rss_window.clear()
                state.ws_window.clear()
                state.last_restart_count = pod.restart_count

            # Step change
            if state.last_rss > 0 and pod.mem_rss_bytes > 0:
                delta_mb = (pod.mem_rss_bytes - state.last_rss) / _MB
                if delta_mb > MEM_STEP_CHANGE_MB:
                    await self.publish_finding({
                        "anomaly_type": MEMORY_STEP,
                        "severity": SEV_INFO,
                        "pod": pod.pod,
                        "namespace": pod.namespace,
                        "container": pod.container,
                        "delta_mb": round(delta_mb, 1),
                        "rss_mb": round(pod.mem_rss_bytes / _MB, 1),
                    })

            state.last_rss = pod.mem_rss_bytes
            state.rss_window.append(pod.mem_rss_bytes)
            state.ws_window.append(pod.mem_working_set_bytes)

            if len(state.rss_window) < MEM_WARMUP_MIN:
                continue

            x = list(range(len(state.rss_window)))
            rss_vals = list(state.rss_window)
            slope, intercept, r_value, _, _ = stats.linregress(x, rss_vals)
            r_squared = r_value ** 2
            slope_mb_per_min = (slope * _SCRAPES_PER_MIN) / _MB

            # Leak detection
            if slope_mb_per_min > MEM_LEAK_SLOPE_MB_PER_MIN and r_squared > MEM_LEAK_R2_MIN:
                await self.publish_finding({
                    "anomaly_type": MEMORY_LEAK,
                    "severity": SEV_WARNING,
                    "pod": pod.pod,
                    "namespace": pod.namespace,
                    "container": pod.container,
                    "slope_mb_per_min": round(slope_mb_per_min, 2),
                    "r_squared": round(r_squared, 3),
                    "current_rss_mb": round(pod.mem_rss_bytes / _MB, 1),
                })

            # OOM prediction
            if pod.mem_limit_bytes > 0:
                ws_ratio = pod.mem_working_set_bytes / pod.mem_limit_bytes
                if ws_ratio > MEM_PRE_OOM_RATIO and slope > 0:
                    free_bytes = pod.mem_limit_bytes - pod.mem_working_set_bytes
                    slope_bytes_per_sec = slope / COLLECT_INTERVAL_S
                    eta_min = (free_bytes / slope_bytes_per_sec) / 60.0 if slope_bytes_per_sec > 0 else float("inf")

                    if eta_min < MEM_OOM_ETA_CRITICAL_MIN:
                        severity = SEV_CRITICAL
                    elif eta_min < MEM_OOM_ETA_WARNING_MIN:
                        severity = SEV_WARNING
                    elif eta_min < MEM_OOM_ETA_INFO_MIN:
                        severity = SEV_INFO
                    else:
                        continue

                    await self.publish_finding({
                        "anomaly_type": PRE_OOM,
                        "severity": severity,
                        "pod": pod.pod,
                        "namespace": pod.namespace,
                        "container": pod.container,
                        "ws_ratio": round(ws_ratio, 3),
                        "eta_minutes": round(eta_min, 1),
                        "mem_limit_bytes": pod.mem_limit_bytes,
                        "mem_working_set_bytes": pod.mem_working_set_bytes,
                    })
