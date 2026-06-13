import asyncio
import logging
from collections import defaultdict, deque
from typing import Dict, Optional

import numpy as np
import redis.asyncio as aioredis

from edgemind_agents.anomaly_types import (
    CPU_SPIKE, CPU_THROTTLE, CPU_CONTENTION,
    SEV_WARNING, SEV_CRITICAL,
    CPU_SPIKE_WARNING_Z, CPU_SPIKE_CRITICAL_Z,
    CPU_THROTTLE_RATIO, CPU_THROTTLE_CYCLES,
    CPU_ROLLING_WINDOW, CPU_WARMUP_MIN,
)
from edgemind_agents.agents.base import BaseAgent
from edgemind_agents.models import MetricSnapshot, PodMetrics

log = logging.getLogger(__name__)

_SUSTAINED_SPIKE_REQUIRED = 2
_RESTART_SUPPRESS_CYCLES = 3


class _PodCPUState:
    def __init__(self):
        self.window: deque = deque(maxlen=CPU_ROLLING_WINDOW)
        self.sustained_spike_cycles: int = 0
        self.sustained_throttle_cycles: int = 0
        self.last_restart_count: int = 0
        self.suppress_cycles_remaining: int = 0


class CPUAgent(BaseAgent):
    def __init__(self, name: str, queue: asyncio.Queue, redis: aioredis.Redis):
        super().__init__(name, queue, redis)
        self._states: Dict[str, _PodCPUState] = defaultdict(_PodCPUState)

    def _get_state(self, pod_key: str) -> _PodCPUState:
        return self._states[pod_key]

    async def process(self, snapshot: MetricSnapshot) -> None:
        all_pods = list(snapshot.pods.values())

        spiked_pods = []
        throttled_pods = []

        for pod in all_pods:
            key = f"{pod.namespace}/{pod.container}"
            state = self._get_state(key)

            # Reset on restart
            if pod.restart_count > state.last_restart_count:
                log.info("[cpu] restart detected on %s, resetting window", key)
                state.window.clear()
                state.sustained_spike_cycles = 0
                state.sustained_throttle_cycles = 0
                state.suppress_cycles_remaining = _RESTART_SUPPRESS_CYCLES
                state.last_restart_count = pod.restart_count

            if state.suppress_cycles_remaining > 0:
                state.suppress_cycles_remaining -= 1
                continue

            state.window.append(pod.cpu_usage_cores)

            if len(state.window) < CPU_WARMUP_MIN:
                continue

            arr = np.array(state.window)
            mean = arr.mean()
            std = arr.std()

            # Z-score spike detection
            z = (pod.cpu_usage_cores - mean) / std if std > 0 else 0.0

            if z >= CPU_SPIKE_CRITICAL_Z:
                state.sustained_spike_cycles += 1
            elif z >= CPU_SPIKE_WARNING_Z:
                state.sustained_spike_cycles += 1
            else:
                state.sustained_spike_cycles = 0

            if state.sustained_spike_cycles >= _SUSTAINED_SPIKE_REQUIRED:
                severity = SEV_CRITICAL if z >= CPU_SPIKE_CRITICAL_Z else SEV_WARNING
                spiked_pods.append((pod, z, severity))

            # Throttle detection
            if pod.cpu_throttle_rate >= CPU_THROTTLE_RATIO:
                state.sustained_throttle_cycles += 1
            else:
                state.sustained_throttle_cycles = 0

            if state.sustained_throttle_cycles >= CPU_THROTTLE_CYCLES:
                throttled_pods.append(pod)

        # Attribution and finding emission
        node = snapshot.node
        node_cpu_high = node is not None and node.cpu_idle_ratio < 0.20

        for pod, z, severity in spiked_pods:
            if node_cpu_high and len(spiked_pods) > 1:
                anomaly_type = CPU_CONTENTION
            else:
                anomaly_type = CPU_SPIKE

            await self.publish_finding({
                "anomaly_type": anomaly_type,
                "severity": severity,
                "pod": pod.pod,
                "namespace": pod.namespace,
                "container": pod.container,
                "cpu_usage_cores": pod.cpu_usage_cores,
                "cpu_limit_cores": pod.cpu_limit_cores,
                "z_score": round(z, 2),
                "node_cpu_idle_ratio": round(node.cpu_idle_ratio, 3) if node else None,
            })

        for pod in throttled_pods:
            if len(throttled_pods) > 1 and not node_cpu_high:
                detail = "multiple_pods_throttled"
            elif not node_cpu_high:
                detail = "hitting_own_limit"
            else:
                detail = "node_contention"

            await self.publish_finding({
                "anomaly_type": CPU_THROTTLE,
                "severity": SEV_WARNING,
                "pod": pod.pod,
                "namespace": pod.namespace,
                "container": pod.container,
                "cpu_throttle_rate": round(pod.cpu_throttle_rate, 3),
                "cpu_usage_cores": pod.cpu_usage_cores,
                "cpu_limit_cores": pod.cpu_limit_cores,
                "detail": detail,
            })
