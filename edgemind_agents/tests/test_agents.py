import asyncio
import json
import pytest
from unittest.mock import MagicMock, AsyncMock

from edgemind_agents.models import MetricSnapshot, PodMetrics, NodeMetrics, PVCMetrics
from edgemind_agents.agents.cpu_agent import CPUAgent
from edgemind_agents.agents.memory_agent import MemoryAgent
from edgemind_agents.agents.storage_agent import StorageAgent
from edgemind_agents.agents.network_log_agent import NetworkLogAgent
from edgemind_agents.anomaly_types import (
    CPU_SPIKE, CPU_THROTTLE,
    MEMORY_LEAK, NODE_PRESSURE,
    IO_SATURATION, WRITE_BURST, PVC_FILL, PVC_CONTENTION,
    NETWORK_FLOOD, PACKET_DROP, LOG_ERROR_SURGE, PUMP_HEALTH_CRIT,
    SEV_WARNING,
)

_MB = 1024 * 1024
_GB = 1024 * _MB


# ── Fixtures & helpers ────────────────────────────────────────────────────────

@pytest.fixture
def mock_redis():
    redis = MagicMock()
    pipe = MagicMock()
    pipe.execute = AsyncMock(return_value=[1, 1])
    redis.pipeline.return_value = pipe

    def get_findings():
        findings = []
        for call in pipe.lpush.call_args_list:
            args = call.args
            if len(args) >= 2:
                findings.append(json.loads(args[1]))
        return findings

    redis.get_findings = get_findings
    return redis


def make_snapshot() -> MetricSnapshot:
    """Healthy baseline snapshot for all pump-station pods."""
    return MetricSnapshot(
        pods={
            "pump-station/opc-ua-collector": PodMetrics(
                pod="opc-ua-collector-xyz",
                namespace="pump-station",
                container="opc-ua-collector",
                cpu_usage_cores=0.05,
                cpu_throttle_rate=0.0,
                cpu_limit_cores=0.5,
                mem_rss_bytes=120 * _MB,
                mem_working_set_bytes=125 * _MB,
                mem_limit_bytes=256 * _MB,
                restart_count=0,
            ),
            "pump-station/feature-extractor": PodMetrics(
                pod="feature-extractor-xyz",
                namespace="pump-station",
                container="feature-extractor",
                cpu_usage_cores=0.15,
                cpu_throttle_rate=0.0,
                cpu_limit_cores=1.0,
                mem_rss_bytes=200 * _MB,
                mem_working_set_bytes=210 * _MB,
                mem_limit_bytes=512 * _MB,
                restart_count=0,
            ),
            "pump-station/anomaly-detector": PodMetrics(
                pod="anomaly-detector-xyz",
                namespace="pump-station",
                container="anomaly-detector",
                cpu_usage_cores=0.02,
                cpu_throttle_rate=0.0,
                cpu_limit_cores=0.5,
                mem_rss_bytes=60 * _MB,
                mem_working_set_bytes=65 * _MB,
                mem_limit_bytes=256 * _MB,
                restart_count=0,
            ),
            # storage-test pods
            "pump-station/batch-sync": PodMetrics(
                pod="batch-sync-xyz",
                namespace="pump-station",
                container="batch-sync",
                cpu_usage_cores=0.02,
                cpu_limit_cores=0.5,
                mem_rss_bytes=60 * _MB,
                mem_working_set_bytes=65 * _MB,
                mem_limit_bytes=256 * _MB,
                fs_write_bytes_per_sec=2 * _MB,
                fs_io_saturation=0.0,
            ),
            "pump-station/alert-manager": PodMetrics(
                pod="alert-manager-xyz",
                namespace="pump-station",
                container="alert-manager",
                cpu_usage_cores=0.02,
                cpu_limit_cores=0.5,
                mem_rss_bytes=60 * _MB,
                mem_working_set_bytes=65 * _MB,
                mem_limit_bytes=256 * _MB,
                fs_io_saturation=0.0,
            ),
            # network-test pod
            "pump-station/sensor-sim-2": PodMetrics(
                pod="sensor-sim-2-xyz",
                namespace="pump-station",
                container="sensor-sim-2",
                cpu_usage_cores=0.02,
                cpu_limit_cores=0.5,
                mem_rss_bytes=60 * _MB,
                mem_working_set_bytes=65 * _MB,
                mem_limit_bytes=256 * _MB,
                net_tx_bytes_per_sec=0.1 * _MB,
                net_rx_bytes_per_sec=0.05 * _MB,
            ),
        },
        node=NodeMetrics(
            cpu_idle_ratio=0.6,
            mem_available_bytes=4 * _GB,
            mem_total_bytes=8 * _GB,
        ),
        pvcs={
            "pump-station/export-data": PVCMetrics(
                pvc_name="export-data",
                namespace="pump-station",
                used_bytes=300 * _MB,
                capacity_bytes=1000 * _MB,
            ),
        },
    )


async def warm_agent(agent, snapshot: MetricSnapshot, n: int = 25) -> None:
    """Feed n identical snapshots to move the agent past its warmup window."""
    for _ in range(n):
        await agent.process(snapshot)


# ── CPU agent tests ───────────────────────────────────────────────────────────

async def test_cpu_no_findings_healthy(mock_redis):
    agent = CPUAgent("cpu", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)
    assert mock_redis.get_findings() == []


async def test_cpu_spike_warning(mock_redis):
    agent = CPUAgent("cpu", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)

    # 3 cycles of sustained spike: triggers after 2nd cycle (sustained_spike_cycles >= 2)
    for _ in range(3):
        snap = make_snapshot()
        snap.pods["pump-station/opc-ua-collector"].cpu_usage_cores = 0.8
        await agent.process(snap)

    findings = mock_redis.get_findings()
    spike_findings = [f for f in findings if f["anomaly_type"] == CPU_SPIKE]
    assert len(spike_findings) > 0
    assert all(f["container"] == "opc-ua-collector" for f in spike_findings)


async def test_cpu_spike_requires_two_cycles(mock_redis):
    agent = CPUAgent("cpu", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)

    # A single spike cycle cannot satisfy the 2-cycle sustain requirement
    snap = make_snapshot()
    snap.pods["pump-station/opc-ua-collector"].cpu_usage_cores = 0.8
    await agent.process(snap)

    spike_findings = [f for f in mock_redis.get_findings() if f["anomaly_type"] == CPU_SPIKE]
    assert len(spike_findings) == 0


async def test_cpu_throttle(mock_redis):
    agent = CPUAgent("cpu", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)

    # throttle_rate=0.3 > CPU_THROTTLE_RATIO(0.2); fires after CPU_THROTTLE_CYCLES(3)
    for _ in range(4):
        snap = make_snapshot()
        snap.pods["pump-station/opc-ua-collector"].cpu_throttle_rate = 0.3
        snap.pods["pump-station/opc-ua-collector"].cpu_usage_cores = 0.1
        await agent.process(snap)

    findings = mock_redis.get_findings()
    throttle_findings = [f for f in findings if f["anomaly_type"] == CPU_THROTTLE]
    assert len(throttle_findings) > 0
    assert all(f["container"] == "opc-ua-collector" for f in throttle_findings)


async def test_cpu_warmup_suppression(mock_redis):
    agent = CPUAgent("cpu", asyncio.Queue(), mock_redis)

    # Only 10 snapshots: window < CPU_WARMUP_MIN(20), so spike detection is skipped
    for _ in range(10):
        snap = make_snapshot()
        snap.pods["pump-station/opc-ua-collector"].cpu_usage_cores = 0.8
        await agent.process(snap)

    assert mock_redis.get_findings() == []


async def test_cpu_restart_suppresses(mock_redis):
    agent = CPUAgent("cpu", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)

    # Restart detected → window cleared + suppress_cycles_remaining = 3; no spike that cycle
    snap = make_snapshot()
    snap.pods["pump-station/opc-ua-collector"].restart_count = 1
    snap.pods["pump-station/opc-ua-collector"].cpu_usage_cores = 0.8
    await agent.process(snap)

    spike_findings = [f for f in mock_redis.get_findings() if f["anomaly_type"] == CPU_SPIKE]
    assert len(spike_findings) == 0


# ── Memory agent tests ────────────────────────────────────────────────────────

async def test_memory_no_findings_healthy(mock_redis):
    agent = MemoryAgent("memory", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)
    assert mock_redis.get_findings() == []


async def test_memory_leak_detection(mock_redis):
    agent = MemoryAgent("memory", asyncio.Queue(), mock_redis)
    await warm_agent(agent, make_snapshot(), n=25)

    # feature-extractor RSS grows 200MB → 580MB linearly over 20 snapshots (20MB/step)
    # step < MEM_STEP_CHANGE_MB(50MB) so no step-change fires; slope 80MB/min >> threshold 5MB/min
    for i in range(20):
        rss = int((200 + i * 20) * _MB)
        snap = make_snapshot()
        snap.pods["pump-station/feature-extractor"].mem_rss_bytes = rss
        snap.pods["pump-station/feature-extractor"].mem_working_set_bytes = 210 * _MB
        await agent.process(snap)

    findings = mock_redis.get_findings()
    leak_findings = [f for f in findings if f["anomaly_type"] == MEMORY_LEAK]
    assert len(leak_findings) > 0
    assert all(f["container"] == "feature-extractor" for f in leak_findings)


async def test_memory_node_pressure(mock_redis):
    agent = MemoryAgent("memory", asyncio.Queue(), mock_redis)

    # 0.6GB available of 8GB = 7.5% → below MEM_NODE_CRIT_RATIO(10%) → SEV_CRITICAL
    for _ in range(25):
        snap = make_snapshot()
        snap.node.mem_available_bytes = int(0.6 * _GB)
        snap.node.mem_total_bytes = 8 * _GB
        await agent.process(snap)

    findings = mock_redis.get_findings()
    pressure_findings = [f for f in findings if f["anomaly_type"] == NODE_PRESSURE]
    assert len(pressure_findings) > 0


async def test_memory_warmup_suppression(mock_redis):
    agent = MemoryAgent("memory", asyncio.Queue(), mock_redis)

    # 15 snapshots < MEM_WARMUP_MIN(20); 30MB/step < MEM_STEP_CHANGE_MB(50MB)
    # → no leak detection, no step-change, healthy node → 0 findings
    for i in range(15):
        rss = int((200 + i * 30) * _MB)
        snap = make_snapshot()
        snap.pods["pump-station/feature-extractor"].mem_rss_bytes = rss
        await agent.process(snap)

    assert mock_redis.get_findings() == []


# ── Storage agent tests ───────────────────────────────────────────────────────

@pytest.fixture
def mock_k8s():
    k8s = MagicMock()
    k8s.list_pod_for_all_namespaces.return_value = MagicMock(items=[])
    k8s.list_namespaced_pod.return_value = MagicMock(items=[])
    k8s.read_namespaced_pod_log.return_value = ""
    return k8s


async def test_storage_no_findings_healthy(mock_redis, mock_k8s):
    agent = StorageAgent("storage", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)
    assert mock_redis.get_findings() == []


async def test_storage_pvc_fill_warning(mock_redis, mock_k8s):
    agent = StorageAgent("storage", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    # PVC grows 300MB → 750MB (75% fill) linearly over 20 snapshots (step ≈ 23.7MB).
    # fill_ratio crosses STORAGE_PVC_FILL_WARN(0.70) at step 17; TTF-based upgrade
    # gives SEV_WARNING from step 2 onward (TTF < STORAGE_TTF_WARN_HOURS=8h).
    for i in range(20):
        used = int((300 + i * (450 / 19)) * _MB)
        snap = make_snapshot()
        snap.pvcs["pump-station/export-data"].used_bytes = used
        await agent.process(snap)

    findings = mock_redis.get_findings()
    fill_findings = [f for f in findings if f["anomaly_type"] == PVC_FILL]
    assert len(fill_findings) > 0
    assert any(f["severity"] == SEV_WARNING for f in fill_findings)


async def test_storage_io_saturation_warning(mock_redis, mock_k8s):
    agent = StorageAgent("storage", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    for _ in range(3):
        snap = make_snapshot()
        snap.pods["pump-station/batch-sync"].fs_io_saturation = 0.85
        await agent.process(snap)

    findings = mock_redis.get_findings()
    sat_findings = [f for f in findings if f["anomaly_type"] == IO_SATURATION]
    assert len(sat_findings) > 0
    assert all(f["container"] == "batch-sync" for f in sat_findings)


async def test_storage_write_burst(mock_redis, mock_k8s):
    agent = StorageAgent("storage", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    # 90MB/s >> baseline 2MB/s; _SUSTAINED_BURST_REQUIRED=2 so fires on 2nd cycle
    for _ in range(3):
        snap = make_snapshot()
        snap.pods["pump-station/batch-sync"].fs_write_bytes_per_sec = 90 * _MB
        await agent.process(snap)

    findings = mock_redis.get_findings()
    burst_findings = [f for f in findings if f["anomaly_type"] == WRITE_BURST]
    assert len(burst_findings) > 0
    assert all(f["container"] == "batch-sync" for f in burst_findings)


async def test_storage_pvc_contention(mock_redis):
    k8s = MagicMock()
    # Both batch-sync and alert-manager mount export-data
    batch_pod = MagicMock()
    batch_pod.metadata.namespace = "pump-station"
    batch_vol = MagicMock()
    batch_vol.persistent_volume_claim = MagicMock()
    batch_vol.persistent_volume_claim.claim_name = "export-data"
    batch_pod.spec.volumes = [batch_vol]
    batch_container = MagicMock()
    batch_container.name = "batch-sync"
    batch_pod.spec.containers = [batch_container]

    alert_pod = MagicMock()
    alert_pod.metadata.namespace = "pump-station"
    alert_vol = MagicMock()
    alert_vol.persistent_volume_claim = MagicMock()
    alert_vol.persistent_volume_claim.claim_name = "export-data"
    alert_pod.spec.volumes = [alert_vol]
    alert_container = MagicMock()
    alert_container.name = "alert-manager"
    alert_pod.spec.containers = [alert_container]

    k8s.list_pod_for_all_namespaces.return_value = MagicMock(items=[batch_pod, alert_pod])

    agent = StorageAgent("storage", asyncio.Queue(), mock_redis, k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    for _ in range(3):
        snap = make_snapshot()
        snap.pods["pump-station/batch-sync"].fs_io_saturation = 0.85
        snap.pods["pump-station/alert-manager"].fs_io_saturation = 0.85
        await agent.process(snap)

    findings = mock_redis.get_findings()
    contention_findings = [f for f in findings if f["anomaly_type"] == PVC_CONTENTION]
    assert len(contention_findings) > 0
    assert all(f["pvc"] == "export-data" for f in contention_findings)


async def test_storage_warmup_suppression(mock_redis, mock_k8s):
    agent = StorageAgent("storage", asyncio.Queue(), mock_redis, mock_k8s)

    # 15 snapshots < STORAGE_WARMUP_MIN(20); io_saturation check is now gated by warmup
    for _ in range(15):
        snap = make_snapshot()
        snap.pods["pump-station/batch-sync"].fs_io_saturation = 0.85
        await agent.process(snap)

    assert mock_redis.get_findings() == []


# ── Network + Log agent tests ─────────────────────────────────────────────────

async def test_network_no_findings_healthy(mock_redis, mock_k8s):
    agent = NetworkLogAgent("network_log", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)
    assert mock_redis.get_findings() == []


async def test_network_flood_sensor_sim_2(mock_redis, mock_k8s):
    agent = NetworkLogAgent("network_log", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    # 1.2MB/s = 12x baseline p75 of 0.1MB/s >> NET_FLOOD_MULTIPLIER(2×);
    # fires after NET_FLOOD_CYCLES(2) sustained cycles
    for _ in range(3):
        snap = make_snapshot()
        snap.pods["pump-station/sensor-sim-2"].net_tx_bytes_per_sec = 1.2 * _MB
        await agent.process(snap)

    findings = mock_redis.get_findings()
    flood_findings = [f for f in findings if f["anomaly_type"] == NETWORK_FLOOD]
    assert len(flood_findings) > 0
    assert all(f["container"] == "sensor-sim-2" for f in flood_findings)


async def test_network_flood_requires_sustained(mock_redis, mock_k8s):
    agent = NetworkLogAgent("network_log", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    flood_snap = make_snapshot()
    flood_snap.pods["pump-station/sensor-sim-2"].net_tx_bytes_per_sec = 1.2 * _MB
    await agent.process(flood_snap)

    # One healthy snapshot drops sustained_flood_cycles via max(0, cycles-1)
    await agent.process(make_snapshot())

    flood_findings = [f for f in mock_redis.get_findings() if f["anomaly_type"] == NETWORK_FLOOD]
    assert len(flood_findings) == 0


async def test_network_packet_drop(mock_redis, mock_k8s):
    agent = NetworkLogAgent("network_log", asyncio.Queue(), mock_redis, mock_k8s)
    await warm_agent(agent, make_snapshot(), n=25)

    # 0.005 > NET_DROP_RATE_THRESHOLD(0.001)
    for _ in range(3):
        snap = make_snapshot()
        snap.pods["pump-station/opc-ua-collector"].net_rx_drop_rate = 0.005
        await agent.process(snap)

    findings = mock_redis.get_findings()
    drop_findings = [f for f in findings if f["anomaly_type"] == PACKET_DROP]
    assert len(drop_findings) > 0
    assert all(f["container"] == "opc-ua-collector" for f in drop_findings)


async def test_log_error_surge(mock_redis):
    k8s = MagicMock()
    fake_pod = MagicMock()
    fake_pod.metadata.name = "opc-ua-collector-xyz"
    fake_pod.metadata.namespace = "pump-station"
    fake_container = MagicMock()
    fake_container.name = "opc-ua-collector"
    fake_pod.spec.containers = [fake_container]
    k8s.list_namespaced_pod.return_value = MagicMock(items=[fake_pod])
    k8s.read_namespaced_pod_log.return_value = "\n".join(["ERROR: connection failed"] * 5)

    agent = NetworkLogAgent("network_log", asyncio.Queue(), mock_redis, k8s)
    await agent._tail_logs()

    findings = mock_redis.get_findings()
    error_findings = [f for f in findings if f["anomaly_type"] == LOG_ERROR_SURGE]
    assert len(error_findings) == 1
    assert error_findings[0]["error_count"] == 5


async def test_log_health_scorer_pump_critical(mock_redis):
    k8s = MagicMock()
    fake_pod = MagicMock()
    fake_pod.metadata.name = "health-scorer-xyz"
    fake_pod.metadata.namespace = "pump-station"
    fake_container = MagicMock()
    fake_container.name = "health-scorer"
    fake_pod.spec.containers = [fake_container]
    k8s.list_namespaced_pod.return_value = MagicMock(items=[fake_pod])
    k8s.read_namespaced_pod_log.return_value = (
        "2026-01-01 12:00:00 INFO pump=pump2 bearing_health=42.1 state=CRITICAL action=trigger_both"
    )

    agent = NetworkLogAgent("network_log", asyncio.Queue(), mock_redis, k8s)
    await agent._tail_logs()

    findings = mock_redis.get_findings()
    pump_findings = [f for f in findings if f["anomaly_type"] == PUMP_HEALTH_CRIT]
    assert len(pump_findings) == 1
    assert pump_findings[0]["pump"] == "pump2"
