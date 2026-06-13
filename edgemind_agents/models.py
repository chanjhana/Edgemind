from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class PodMetrics:
    pod: str
    namespace: str
    container: str
    cpu_usage_cores: float = 0.0
    cpu_throttle_rate: float = 0.0
    cpu_limit_cores: float = 0.0
    mem_rss_bytes: float = 0.0
    mem_working_set_bytes: float = 0.0
    mem_limit_bytes: float = 0.0
    fs_write_bytes_per_sec: float = 0.0
    fs_read_bytes_per_sec: float = 0.0
    fs_io_saturation: float = 0.0
    net_tx_bytes_per_sec: float = 0.0
    net_rx_bytes_per_sec: float = 0.0
    net_tx_packets_per_sec: float = 0.0
    net_rx_drop_rate: float = 0.0
    restart_count: int = 0
    collected_at: Optional[datetime] = None
    is_stale: bool = False


@dataclass
class NodeMetrics:
    cpu_idle_ratio: float = 0.0
    mem_available_bytes: float = 0.0
    mem_total_bytes: float = 0.0
    collected_at: Optional[datetime] = None

    @property
    def mem_pressure_ratio(self) -> float:
        if self.mem_total_bytes == 0:
            return 1.0
        return self.mem_available_bytes / self.mem_total_bytes


@dataclass
class PVCMetrics:
    pvc_name: str
    namespace: str
    used_bytes: float = 0.0
    capacity_bytes: float = 0.0
    collected_at: Optional[datetime] = None

    @property
    def fill_ratio(self) -> float:
        if self.capacity_bytes == 0:
            return 0.0
        return self.used_bytes / self.capacity_bytes

    @property
    def free_bytes(self) -> float:
        return max(0.0, self.capacity_bytes - self.used_bytes)


@dataclass
class MetricSnapshot:
    pods: Dict[str, PodMetrics] = field(default_factory=dict)
    node: Optional[NodeMetrics] = None
    pvcs: Dict[str, PVCMetrics] = field(default_factory=dict)
    collected_at: Optional[datetime] = None
    collection_errors: Dict[str, str] = field(default_factory=dict)

    def pod(self, namespace: str, container: str) -> Optional[PodMetrics]:
        return self.pods.get(f"{namespace}/{container}")

    def pump_station_pods(self) -> List[PodMetrics]:
        return [p for p in self.pods.values() if p.namespace == "pump-station"]

    def monitoring_pods(self) -> List[PodMetrics]:
        return [p for p in self.pods.values() if p.namespace == "monitoring"]

    @property
    def is_empty(self) -> bool:
        return len(self.pods) == 0
