"""
dmd_agent.py — DMD (Dynamic Mode Decomposition) Early Warning Agent.

Fifth monitoring agent. Subscribes to the same MetricCollector queue as the
other four agents. Every DMD_FIT_INTERVAL cycles it fits a DMD model on the
per-pod rolling buffer, computes eigenvalues, and forecasts 2 minutes ahead.

Findings emitted (all have is_dmd=True):
  dmd_cpu_forecast   — predicted CPU breach in < DMD_FORECAST_STEPS * 15s
  dmd_mem_forecast   — predicted memory breach
  dmd_io_forecast    — predicted I/O saturation breach
  dmd_net_forecast   — predicted TX network flood
  dmd_instability    — any growing eigenmode (growth rate > threshold)

Design decisions:
  - Advisory only: DMD findings are NOT in CRITICAL_ANOMALY_TYPES_IMMEDIATE
    and will NOT trigger the LLM orchestrator. They show up on the dashboard
    as early warnings only.
  - pump-station namespace pods only.
  - DMD agent does NOT count toward the existing agentsReady check (which
    requires the 4 original agents). It's shown separately in the UI.
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import redis.asyncio as aioredis

from edgemind_agents.anomaly_types import (
    DMD_CPU_FORECAST, DMD_MEM_FORECAST, DMD_IO_FORECAST,
    DMD_NET_FORECAST, DMD_INSTABILITY,
    SEV_INFO, SEV_WARNING, SEV_CRITICAL,
    DMD_WINDOW, DMD_WARMUP_MIN, DMD_FIT_INTERVAL, DMD_FORECAST_STEPS,
    DMD_N_MODES, DMD_GROWTH_RATE_THRESH, DMD_WARNING_COOLDOWN_S,
    DMD_CPU_BREACH_RATIO, DMD_MEM_BREACH_RATIO,
    DMD_IO_BREACH_RATIO, DMD_NET_FLOOD_FACTOR,
    COLLECT_INTERVAL_S,
)
from edgemind_agents.agents.base import BaseAgent
from edgemind_agents.dmd_core import DMDForecaster, build_feature_matrix, denormalize_forecast, normalize_features
from edgemind_agents.models import MetricSnapshot, PodMetrics

log = logging.getLogger(__name__)

# Feature definition: (key in PodMetrics, display name, breach-threshold getter)
FEATURE_KEYS = [
    "cpu_usage_cores",
    "mem_rss_bytes",
    "net_tx_bytes_per_sec",
    "net_rx_bytes_per_sec",
    "fs_write_bytes_per_sec",
    "fs_io_saturation",
]

FEATURE_LABELS = {
    "cpu_usage_cores":       "CPU Usage",
    "mem_rss_bytes":         "Memory RSS",
    "net_tx_bytes_per_sec":  "Network TX",
    "net_rx_bytes_per_sec":  "Network RX",
    "fs_write_bytes_per_sec":"Disk Writes",
    "fs_io_saturation":      "I/O Saturation",
}

# Only check breach for these features (not raw RX/writes which have no fixed limit)
_BREACH_CHECKED_FEATURES = {
    "cpu_usage_cores",
    "mem_rss_bytes",
    "fs_io_saturation",
    "net_tx_bytes_per_sec",
}

_MB = 1024 * 1024


@dataclass
class _PodDMDState:
    """Per-pod rolling state for the DMD agent."""
    # Raw metric history — each entry is a dict: {feature_key: float}
    buffer: deque = field(default_factory=lambda: deque(maxlen=DMD_WINDOW))
    # Per-metric (anomaly_type) last warning timestamp for cooldown
    last_warning_ts: Dict[str, float] = field(default_factory=dict)
    # Cycle counter — fit every DMD_FIT_INTERVAL cycles
    cycle: int = 0
    # Last known limits (cpu_limit_cores, mem_limit_bytes, net_tx_p75)
    cpu_limit: float = 0.0
    mem_limit: float = 0.0
    net_tx_p75: float = 0.0


class DMDAgent(BaseAgent):
    """DMD-based early warning agent — advisory-only, non-blocking."""

    def __init__(self, name: str, queue: asyncio.Queue, redis: aioredis.Redis):
        super().__init__(name, queue, redis)
        self._states: Dict[str, _PodDMDState] = defaultdict(_PodDMDState)

    # ------------------------------------------------------------------
    # Main processing loop
    # ------------------------------------------------------------------

    async def process(self, snapshot: MetricSnapshot) -> None:
        pump_pods = snapshot.pump_station_pods()

        for pod in pump_pods:
            key = f"{pod.namespace}/{pod.container}"
            state = self._states[key]
            state.cycle += 1

            # Update known limits from latest snapshot
            if pod.cpu_limit_cores > 0:
                state.cpu_limit = pod.cpu_limit_cores
            if pod.mem_limit_bytes > 0:
                state.mem_limit = pod.mem_limit_bytes

            # Record current feature vector
            entry = {k: getattr(pod, k, 0.0) for k in FEATURE_KEYS}
            state.buffer.append(entry)

            # Track P75 of net_tx for flood detection
            tx_vals = [e["net_tx_bytes_per_sec"] for e in state.buffer if e["net_tx_bytes_per_sec"] > 0]
            if tx_vals:
                state.net_tx_p75 = float(np.percentile(tx_vals, 75))

            # Only fit every DMD_FIT_INTERVAL cycles
            if state.cycle % DMD_FIT_INTERVAL != 0:
                continue

            if len(state.buffer) < DMD_WARMUP_MIN:
                log.debug(
                    "[dmd] %s: warming up (%d/%d snapshots)",
                    key, len(state.buffer), DMD_WARMUP_MIN,
                )
                continue

            await self._run_dmd_for_pod(pod, key, state)

    # ------------------------------------------------------------------
    # DMD fit + analysis per pod
    # ------------------------------------------------------------------

    async def _run_dmd_for_pod(
        self,
        pod: PodMetrics,
        key: str,
        state: _PodDMDState,
    ) -> None:
        """Fit DMD, compute growth rates, forecast, emit findings."""
        history = list(state.buffer)
        n = len(history)

        # Build limits dict for ratio normalisation
        limits = {
            "cpu_usage_cores":        max(state.cpu_limit, 0.001),
            "mem_rss_bytes":          max(state.mem_limit, 1.0),
            "net_tx_bytes_per_sec":   max(state.net_tx_p75 * DMD_NET_FLOOD_FACTOR, 1.0),
            "net_rx_bytes_per_sec":   max(state.net_tx_p75 * DMD_NET_FLOOD_FACTOR, 1.0),
            "fs_write_bytes_per_sec": max(
                max((e["fs_write_bytes_per_sec"] for e in history), default=1.0),
                1.0,
            ),
            "fs_io_saturation": 1.0,
        }

        X_raw = build_feature_matrix(history, FEATURE_KEYS, limits)
        if X_raw is None:
            return

        # Normalise to zero-mean unit-std for numerical stability
        X_norm, mu, sigma = normalize_features(X_raw)

        # Fit DMD
        dmd = DMDForecaster(n_modes=DMD_N_MODES, dt=COLLECT_INTERVAL_S)
        dmd.fit(X_norm)

        if not dmd.is_fitted:
            log.debug("[dmd] %s: fit returned unfitted (too few snapshots?)", key)
            return

        growth_rate = dmd.max_growth_rate_per_sec()
        n_growing = dmd.n_growing_modes(threshold=DMD_GROWTH_RATE_THRESH)

        # ── 1. Instability finding (growing eigenmode) ─────────────────
        if growth_rate > DMD_GROWTH_RATE_THRESH:
            doubling_time = int(0.693 / growth_rate) if growth_rate > 0 else 0
            await self._maybe_emit(
                state=state,
                cooldown_key=DMD_INSTABILITY,
                finding={
                    "anomaly_type":       DMD_INSTABILITY,
                    "severity":           SEV_WARNING,
                    "pod":                pod.pod,
                    "namespace":          pod.namespace,
                    "container":          pod.container,
                    "is_dmd":             True,
                    "dominant_growth_rate_per_sec": round(growth_rate, 5),
                    "n_growing_modes":    n_growing,
                    "dmd_window_steps":   n,
                    "current_value":      round(growth_rate, 5),
                    "baseline_value":     DMD_GROWTH_RATE_THRESH,
                    "predicted_breach_seconds": doubling_time,
                    "deviation":          f"max growth rate {growth_rate:.4f}/s (threshold {DMD_GROWTH_RATE_THRESH}/s)",
                    "evidence": [
                        f"{n_growing} growing DMD mode(s) detected across {n} snapshots",
                        f"Fastest growth rate: {growth_rate:.5f}/s "
                        f"→ amplitude doubles every {doubling_time}s",
                        "Multivariate instability — system is accelerating before any "
                        "single metric has crossed its threshold",
                    ],
                },
            )

        # ── 2. Per-metric forecast breach ──────────────────────────────
        x_current_norm = X_norm[:, -1]
        forecasts_norm = dmd.forecast(x_current_norm, n_steps=DMD_FORECAST_STEPS)
        if forecasts_norm is None:
            return

        # Denormalise back to raw units then convert to ratios via limits
        forecasts_raw = denormalize_forecast(forecasts_norm, mu * sigma + mu * 0 + mu, sigma)
        # Simpler: X_norm * sigma + mu gives back raw values
        forecasts_raw = forecasts_norm * sigma[np.newaxis, :] + mu[np.newaxis, :]
        # Convert raw back to limit ratios for threshold comparison
        forecasts_ratio = np.zeros_like(forecasts_raw)
        for fi, fk in enumerate(FEATURE_KEYS):
            lim = limits[fk]
            forecasts_ratio[:, fi] = forecasts_raw[:, fi] / lim

        current_ratio = np.array([history[-1][k] / limits[k] for k in FEATURE_KEYS])

        thresholds = {
            "cpu_usage_cores":       DMD_CPU_BREACH_RATIO,
            "mem_rss_bytes":         DMD_MEM_BREACH_RATIO,
            "fs_io_saturation":      DMD_IO_BREACH_RATIO,
            "net_tx_bytes_per_sec":  1.0,  # already normalised to P75×FLOOD_FACTOR
        }

        anomaly_types = {
            "cpu_usage_cores":       DMD_CPU_FORECAST,
            "mem_rss_bytes":         DMD_MEM_FORECAST,
            "fs_io_saturation":      DMD_IO_FORECAST,
            "net_tx_bytes_per_sec":  DMD_NET_FORECAST,
        }

        for fi, fk in enumerate(FEATURE_KEYS):
            if fk not in _BREACH_CHECKED_FEATURES:
                continue
            thresh = thresholds.get(fk)
            if thresh is None:
                continue

            cur = current_ratio[fi]
            if cur >= thresh:
                # Already breached — let the existing agents handle it
                continue

            forecast_col = forecasts_ratio[:, fi]  # (DMD_FORECAST_STEPS,)
            breach_steps = np.where(forecast_col >= thresh)[0]
            if len(breach_steps) == 0:
                continue  # No breach predicted in horizon

            breach_step = int(breach_steps[0]) + 1   # 1-indexed
            breach_seconds = breach_step * COLLECT_INTERVAL_S
            predicted_val = float(forecast_col[breach_step - 1])

            severity = (
                SEV_CRITICAL if breach_seconds <= 30
                else SEV_WARNING if breach_seconds <= 90
                else SEV_INFO
            )

            anomaly_type = anomaly_types[fk]
            await self._maybe_emit(
                state=state,
                cooldown_key=anomaly_type,
                finding={
                    "anomaly_type":                  anomaly_type,
                    "severity":                      severity,
                    "pod":                           pod.pod,
                    "namespace":                     pod.namespace,
                    "container":                     pod.container,
                    "is_dmd":                        True,
                    "metric":                        fk,
                    "metric_label":                  FEATURE_LABELS.get(fk, fk),
                    "dmd_forecast_horizon_steps":    DMD_FORECAST_STEPS,
                    "dmd_forecast_horizon_seconds":  DMD_FORECAST_STEPS * COLLECT_INTERVAL_S,
                    "predicted_breach_step":         breach_step,
                    "predicted_breach_seconds":      breach_seconds,
                    "predicted_value_at_breach":     round(predicted_val, 4),
                    "threshold_ratio":               thresh,
                    "current_ratio":                 round(float(cur), 4),
                    "dominant_growth_rate_per_sec":  round(growth_rate, 5),
                    "n_growing_modes":               n_growing,
                    "current_value":                 round(float(cur), 4),
                    "baseline_value":                thresh,
                    "deviation": (
                        f"{FEATURE_LABELS.get(fk, fk)} predicted to reach "
                        f"{predicted_val:.1%} of limit in {breach_seconds}s"
                    ),
                    "evidence": [
                        f"DMD forecast: {FEATURE_LABELS.get(fk, fk)} currently at "
                        f"{cur:.1%} of limit",
                        f"Predicted to reach {predicted_val:.1%} in {breach_seconds}s "
                        f"({breach_step} steps of {COLLECT_INTERVAL_S}s)",
                        f"DMD model fitted on {n} snapshots "
                        f"({n * COLLECT_INTERVAL_S}s history window)",
                        f"Dominant growth rate: {growth_rate:.5f}/s "
                        f"({n_growing} growing mode(s))",
                    ],
                },
            )

    # ------------------------------------------------------------------
    # Cooldown-gated emit
    # ------------------------------------------------------------------

    async def _maybe_emit(
        self,
        state: _PodDMDState,
        cooldown_key: str,
        finding: dict,
    ) -> None:
        """Emit a finding unless the same anomaly_type is within cooldown window."""
        now = time.monotonic()
        last = state.last_warning_ts.get(cooldown_key, -99999.0)
        if now - last < DMD_WARNING_COOLDOWN_S:
            log.debug(
                "[dmd] suppressed %s on %s (cooldown %.0fs remaining)",
                cooldown_key, finding.get("pod"), DMD_WARNING_COOLDOWN_S - (now - last),
            )
            return
        state.last_warning_ts[cooldown_key] = now
        await self.publish_finding(finding)
